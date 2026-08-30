-- Exclusão de usuário pela tela /admin (issue #11).
--
-- Esta função é a PRIMEIRA metade da operação. A segunda
-- (supabaseAdmin.auth.admin.deleteUser) roda na server function
-- src/integrations/supabase/admin-fns.ts, DEPOIS desta retornar sem erro.
--
-- A ordem não pode ser invertida: private.audit_user_roles e
-- private.audit_user_route_access resolvem o e-mail do alvo com
-- (SELECT email FROM auth.users WHERE id = v_target) no momento do INSERT na
-- auditoria. Apagar auth.users primeiro faria o ON DELETE CASCADE de
-- user_roles/user_route_access disparar esses triggers com a linha já
-- removida — as linhas de auditoria sairiam com target_email nulo e
-- target_user_id apontando para um uuid inexistente, ou seja, sem nenhuma
-- forma de identificar quem foi excluído.
CREATE OR REPLACE FUNCTION public.delete_platform_user(_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_role public.app_role;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF v_actor = _target THEN
    RAISE EXCEPTION 'Você não pode excluir a própria conta' USING ERRCODE = 'W2005';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = _target;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado' USING ERRCODE = 'W2004';
  END IF;

  SELECT role INTO v_role FROM public.user_roles WHERE user_id = _target;

  -- Um convite pendente ainda não expirado recadastraria o usuário com o
  -- papel e as rotas ORIGINAIS no próximo clique no magic link — o link já
  -- está na caixa de entrada dele e não é revogável pela exclusão da conta.
  DELETE FROM public.invitations
   WHERE email = lower(v_email) AND consumed_at IS NULL;

  PERFORM set_config('app.actor_id', v_actor::text, true);

  IF v_role IS NOT NULL THEN
    -- O override faz private.audit_user_roles gravar 'delete' em vez do
    -- 'revoke' padrão, preservando previous_role. Mesmo mecanismo que
    -- 'bootstrap' já usa em 20260808122000_rbac_bootstrap_admin.sql.
    PERFORM set_config('app.audit_action', 'delete', true);
    DELETE FROM public.user_roles WHERE user_id = _target;
    -- Desliga o override (o trigger lê com nullif(..., '')) antes do DELETE
    -- seguinte. private.audit_user_route_access não lê este setting hoje,
    -- mas deixá-lo ligado além do statement que ele qualifica é armadilha
    -- para quem mexer no trigger depois.
    PERFORM set_config('app.audit_action', '', true);
  ELSE
    -- Sem papel não há DELETE, logo o trigger não dispara e a exclusão
    -- passaria sem registro nenhum. previous_role/new_role ficam nulos: a
    -- coluna "Mudança" da UI já trata esse par como "—".
    INSERT INTO public.role_audit_log (
      action, target_user_id, target_email, actor_user_id, actor_email
    ) VALUES (
      'delete', _target, v_email, v_actor,
      (SELECT email FROM auth.users WHERE id = v_actor)
    );
  END IF;

  DELETE FROM public.user_route_access WHERE user_id = _target;
END $$;

REVOKE ALL ON FUNCTION public.delete_platform_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_platform_user(uuid) TO authenticated;
