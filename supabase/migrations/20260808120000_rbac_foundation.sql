-- ============================================================
-- 1. Um papel por usuário
-- ============================================================
-- O schema atual permite acumular papéis (UNIQUE (user_id, role)).
-- O modelo passa a ser um papel por pessoa. Remove duplicatas mantendo
-- o mais privilegiado, para a constraint aplicar sem conflito.
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.user_id = b.user_id
  AND a.id <> b.id
  AND array_position(ARRAY['admin','editor','viewer']::public.app_role[], a.role)
    > array_position(ARRAY['admin','editor','viewer']::public.app_role[], b.role);

ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);

-- ============================================================
-- 2. Convites
-- ============================================================
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role public.app_role NOT NULL,
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_email_lowercase CHECK (email = lower(email))
);

-- Um convite pendente por e-mail; reconvidar após consumo continua possível.
CREATE UNIQUE INDEX invitations_pending_email_idx
  ON public.invitations (email) WHERE consumed_at IS NULL;

GRANT SELECT ON public.invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.invitations TO service_role;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY invitations_select_admin ON public.invitations
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 3. Auditoria imutável
-- ============================================================
CREATE TYPE public.role_audit_action AS ENUM ('invite','grant','revoke','bootstrap');

CREATE TABLE public.role_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action public.role_audit_action NOT NULL,
  target_user_id uuid,
  target_email text,
  actor_user_id uuid,
  actor_email text,
  previous_role public.app_role,
  new_role public.app_role,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX role_audit_log_created_at_idx ON public.role_audit_log (created_at DESC);

GRANT SELECT ON public.role_audit_log TO authenticated;
GRANT SELECT ON public.role_audit_log TO service_role;
-- Append-only: nem a aplicação com service_role reescreve o histórico.
-- Os triggers inserem como owner da função, sem depender destes grants.
REVOKE INSERT, UPDATE, DELETE ON public.role_audit_log FROM authenticated, service_role;

ALTER TABLE public.role_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_audit_log_select_admin ON public.role_audit_log
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 4. Helper de leitura do board
-- ============================================================
CREATE OR REPLACE FUNCTION private.can_view_board(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;

REVOKE ALL ON FUNCTION private.can_view_board(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.can_view_board(uuid) TO authenticated, service_role;

-- ============================================================
-- 5. Trigger de auditoria
-- ============================================================
-- Escrever a auditoria aqui, e não na aplicação, garante que nenhum caminho
-- de código consiga alterar papel sem deixar registro.
CREATE OR REPLACE FUNCTION private.audit_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_override text := nullif(current_setting('app.audit_action', true), '');
  v_action public.role_audit_action;
  v_target uuid;
  v_prev public.app_role;
  v_new public.app_role;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_target := NEW.user_id; v_new := NEW.role;
  ELSIF TG_OP = 'UPDATE' THEN
    v_target := NEW.user_id; v_prev := OLD.role; v_new := NEW.role;
  ELSE
    v_target := OLD.user_id; v_prev := OLD.role;
  END IF;

  IF v_override IS NOT NULL THEN
    v_action := v_override::public.role_audit_action;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'revoke';
  ELSE
    v_action := 'grant';
  END IF;

  INSERT INTO public.role_audit_log (
    action, target_user_id, target_email,
    actor_user_id, actor_email, previous_role, new_role
  ) VALUES (
    v_action,
    v_target,
    (SELECT email FROM auth.users WHERE id = v_target),
    v_actor,
    (SELECT email FROM auth.users WHERE id = v_actor),
    v_prev,
    v_new
  );

  RETURN NULL;
END $$;

CREATE TRIGGER audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION private.audit_user_roles();

-- ============================================================
-- 6. Trava do último administrador
-- ============================================================
-- Rede de segurança independente da RPC: protege inclusive contra
-- um DELETE manual no SQL Editor.
CREATE OR REPLACE FUNCTION private.guard_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role <> 'admin'::public.app_role THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role = 'admin'::public.app_role THEN
    RETURN NEW;
  END IF;

  IF (SELECT count(*) FROM public.user_roles
      WHERE role = 'admin'::public.app_role AND user_id <> OLD.user_id) = 0 THEN
    RAISE EXCEPTION 'É necessário ao menos um administrador na plataforma'
      USING ERRCODE = 'W2003';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE TRIGGER guard_last_admin
BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION private.guard_last_admin();
