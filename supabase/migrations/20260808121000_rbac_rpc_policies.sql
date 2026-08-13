-- ============================================================
-- 1. Mutação de papel
-- ============================================================
-- O ator vem de auth.uid(), nunca de parâmetro: é impossível agir
-- em nome de outra pessoa, mesmo com a service_role key.
CREATE OR REPLACE FUNCTION public.set_user_role(_target uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current public.app_role;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  SELECT role INTO v_current FROM public.user_roles WHERE user_id = _target;

  IF v_actor = _target
     AND v_current = 'admin'::public.app_role
     AND _role IS DISTINCT FROM 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Você não pode remover seu próprio acesso de administrador'
      USING ERRCODE = 'W2002';
  END IF;

  PERFORM set_config('app.actor_id', v_actor::text, true);

  IF _role IS NULL THEN
    DELETE FROM public.user_roles WHERE user_id = _target;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target, _role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
    WHERE user_roles.role IS DISTINCT FROM EXCLUDED.role;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_user_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) TO authenticated;

-- ============================================================
-- 2. Criação de convite
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_invitation(_email text, _role public.app_role)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := lower(trim(_email));
  v_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'E-mail inválido' USING ERRCODE = 'W2004';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'Já existe um usuário com este e-mail' USING ERRCODE = 'W2004';
  END IF;

  IF EXISTS (SELECT 1 FROM public.invitations
              WHERE email = v_email AND consumed_at IS NULL AND expires_at > now()) THEN
    RAISE EXCEPTION 'Já existe um convite pendente para este e-mail' USING ERRCODE = 'W2004';
  END IF;

  -- Limpa convites pendentes já expirados para liberar o índice único
  DELETE FROM public.invitations WHERE email = v_email AND consumed_at IS NULL;

  INSERT INTO public.invitations (email, role, invited_by)
  VALUES (v_email, _role, v_actor)
  RETURNING id INTO v_id;

  -- Nenhuma linha de user_roles muda aqui, então o trigger de auditoria
  -- não dispara: a própria função registra o evento.
  INSERT INTO public.role_audit_log (action, target_email, actor_user_id, actor_email, new_role)
  VALUES ('invite', v_email, v_actor, (SELECT email FROM auth.users WHERE id = v_actor), _role);

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_invitation(text, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_invitation(text, public.app_role) TO authenticated;

-- ============================================================
-- 3. Concessão de papel na criação do usuário
-- ============================================================
-- Sem convite válido, nenhum papel é concedido — e sem papel o usuário
-- não enxerga uma única linha do board. Deny by default.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.invitations%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM public.invitations
   WHERE email = lower(NEW.email)
     AND consumed_at IS NULL
     AND expires_at > now()
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    PERFORM set_config('app.actor_id', inv.invited_by::text, true);
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, inv.role)
    ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.invitations SET consumed_at = now() WHERE id = inv.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Falhar aqui não pode impedir a criação do usuário. Falhar sem
  -- conceder papel é falhar de forma segura.
  RAISE WARNING 'handle_new_user falhou para %: %', NEW.email, SQLERRM;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 4. Fechamento das policies de leitura
-- ============================================================
-- Antes: USING (true) — qualquer autenticado lia o board inteiro.
DROP POLICY IF EXISTS devs_select_authenticated ON public.devs;
CREATE POLICY devs_select_viewers ON public.devs
  FOR SELECT TO authenticated USING (private.can_view_board(auth.uid()));

DROP POLICY IF EXISTS teams_select_authenticated ON public.teams;
CREATE POLICY teams_select_viewers ON public.teams
  FOR SELECT TO authenticated USING (private.can_view_board(auth.uid()));

DROP POLICY IF EXISTS sprints_select_authenticated ON public.sprints;
CREATE POLICY sprints_select_viewers ON public.sprints
  FOR SELECT TO authenticated USING (private.can_view_board(auth.uid()));

DROP POLICY IF EXISTS allocations_select_authenticated ON public.allocations;
CREATE POLICY allocations_select_viewers ON public.allocations
  FOR SELECT TO authenticated USING (private.can_view_board(auth.uid()));
