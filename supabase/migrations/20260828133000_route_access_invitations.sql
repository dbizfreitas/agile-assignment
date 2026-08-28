-- ============================================================
-- 1. Coluna de rotas no convite — default alocacoes, mesmo padrão do
-- critério de aceite para usuário novo
-- ============================================================
ALTER TABLE public.invitations
  ADD COLUMN routes public.app_route[] NOT NULL DEFAULT ARRAY['alocacoes']::public.app_route[];

-- ============================================================
-- 2. create_invitation ganha o parâmetro (_routes, com default) — mas isso
-- muda a lista de tipos de argumento, e CREATE OR REPLACE FUNCTION só
-- substitui uma função existente quando nome E tipos de parâmetro batem
-- exatamente. Adicionar um parâmetro (mesmo com default) criaria uma
-- SEGUNDA função create_invidation(text, app_role, app_route[]) ao lado da
-- antiga create_invitation(text, app_role) — a antiga continuaria resolvendo
-- chamadas com 2 argumentos (Postgres prefere o candidato que não precisa de
-- default), nunca gravando rotas customizadas, e a nova nasceria com o ACL
-- padrão do Postgres (EXECUTE liberado para PUBLIC/anon) em vez do REVOKE
-- explícito que todas as RPCs SECURITY DEFINER deste arquivo carregam — o
-- mesmo problema que 20260813120000_restore_rpc_execute_revokes.sql já
-- documentou e corrigiu para a função de 2 argumentos.
-- Por isso: derruba a assinatura antiga antes de criar a de 3 argumentos, e
-- repete o REVOKE/GRANT explícito para a nova, igual ao padrão já usado
-- neste arquivo (20260808121000_rbac_rpc_policies.sql) para as outras RPCs.
DROP FUNCTION IF EXISTS public.create_invitation(text, public.app_role);

CREATE OR REPLACE FUNCTION public.create_invitation(
  _email text,
  _role public.app_role,
  _routes public.app_route[] DEFAULT ARRAY['alocacoes']::public.app_route[]
)
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

  INSERT INTO public.invitations (email, role, routes, invited_by)
  VALUES (v_email, _role, _routes, v_actor)
  RETURNING id INTO v_id;

  -- Nenhuma linha de user_roles muda aqui, então o trigger de auditoria
  -- não dispara: a própria função registra o evento.
  INSERT INTO public.role_audit_log (action, target_email, actor_user_id, actor_email, new_role)
  VALUES ('invite', v_email, v_actor, (SELECT email FROM auth.users WHERE id = v_actor), _role);

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_invitation(text, public.app_role, public.app_route[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invitation(text, public.app_role, public.app_route[]) TO authenticated;

-- ============================================================
-- 3. handle_new_user grava as rotas do convite junto do papel
-- ============================================================
-- Assinatura () não muda: CREATE OR REPLACE substitui a função existente no
-- lugar (mesmo OID), preservando o REVOKE ALL FROM PUBLIC, anon, authenticated
-- já aplicado por 20260813120000_restore_rpc_execute_revokes.sql — nenhum
-- GRANT precisa ser repetido aqui.
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
    INSERT INTO public.user_route_access (user_id, route, granted_by)
    SELECT NEW.id, r, inv.invited_by FROM unnest(inv.routes) AS r
    ON CONFLICT DO NOTHING;
    UPDATE public.invitations SET consumed_at = now() WHERE id = inv.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Falhar aqui não pode impedir a criação do usuário. Falhar sem
  -- conceder papel/rotas é falhar de forma segura.
  RAISE WARNING 'handle_new_user falhou para %: %', NEW.email, SQLERRM;
  RETURN NEW;
END $$;
