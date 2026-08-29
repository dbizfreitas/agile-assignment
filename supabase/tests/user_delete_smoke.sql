-- Suíte de verificação da exclusão de usuário pela tela /admin (issue #11).
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
-- Falha = ERROR: com a mensagem da asserção.
--
-- Escopo: esta suíte exercita a RPC public.delete_platform_user, que é a
-- PRIMEIRA metade da operação. A remoção da linha em auth.users é feita pelo
-- GoTrue (auth.admin.deleteUser) a partir da server function e fica para o
-- roteiro manual — não há como chamá-la de dentro do SQL Editor.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'role_audit_action' AND e.enumlabel = 'delete'
  ) THEN
    RAISE EXCEPTION 'FALHA 1.1: valor delete ausente no enum role_audit_action';
  END IF;

  IF to_regprocedure('public.delete_platform_user(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.2: função public.delete_platform_user(uuid) não existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'public.delete_platform_user(uuid)'::regprocedure
       AND prosecdef
  ) THEN
    RAISE EXCEPTION 'FALHA 1.3: delete_platform_user não é SECURITY DEFINER';
  END IF;

  -- anon herda PUBLIC, então esta única checagem cobre os dois furos: o
  -- REVOKE ALL FROM PUBLIC não ter sido aplicado, e um GRANT direto a anon.
  IF has_function_privilege('anon', 'public.delete_platform_user(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA 1.4: anon tem EXECUTE em delete_platform_user';
  END IF;
  IF NOT has_function_privilege(
       'authenticated', 'public.delete_platform_user(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA 1.5: authenticated não tem EXECUTE em delete_platform_user';
  END IF;

  -- Rede de segurança para caminhos FORA desta RPC (DELETE manual, cascade
  -- do painel do Supabase). W2003 é inalcançável pela RPC — o ator sempre é
  -- um admin diferente do alvo, então guard_last_admin nunca chega a zero.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.user_roles'::regclass AND tgname = 'guard_last_admin'
  ) THEN
    RAISE EXCEPTION 'FALHA 1.6: trigger guard_last_admin ausente';
  END IF;

  RAISE NOTICE 'Seção 1 OK';
END $$;

-- ============================================================
-- Seção 2 — Invariantes (todas levantam ANTES de qualquer escrita)
-- ============================================================
DO $$
DECLARE
  v_admin  uuid := 'd1111111-1111-1111-1111-111111111111';
  v_editor uuid := 'd2222222-2222-2222-2222-222222222222';
  v_target uuid := 'd3333333-3333-3333-3333-333333333333';
  v_ghost  uuid := 'd9999999-9999-9999-9999-999999999999';
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'del-smoke-admin@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_editor, 'authenticated', 'authenticated',
     'del-smoke-editor@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_target, 'authenticated', 'authenticated',
     'del-smoke-target@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_admin, 'admin'), (v_editor, 'editor'), (v_target, 'viewer');

  -- 2.1 — sem sessão nenhuma
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.delete_platform_user(v_target);
    RAISE EXCEPTION 'FALHA 2.1: anônimo conseguiu excluir usuário';
  EXCEPTION WHEN sqlstate 'W2001' THEN NULL;
  END;

  -- 2.2 — editor não exclui
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.delete_platform_user(v_target);
    RAISE EXCEPTION 'FALHA 2.2: editor conseguiu excluir usuário';
  EXCEPTION WHEN sqlstate 'W2001' THEN NULL;
  END;

  -- 2.3 — admin não exclui a si mesmo. Este é o caso que cumpre o critério
  -- "impedir a exclusão do último administrador": o último admin só poderia
  -- ser excluído por ele mesmo, e é isto que bloqueia.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.delete_platform_user(v_admin);
    RAISE EXCEPTION 'FALHA 2.3: admin excluiu a própria conta';
  EXCEPTION WHEN sqlstate 'W2005' THEN NULL;
  END;

  -- 2.4 — mesma trava valendo quando ele é o ÚNICO admin da plataforma.
  -- Remove os demais admins primeiro (a transação faz ROLLBACK), no mesmo
  -- idioma da Seção 2.5 de rbac_smoke.sql.
  DELETE FROM public.user_roles
   WHERE role = 'admin'::public.app_role AND user_id <> v_admin;
  BEGIN
    PERFORM public.delete_platform_user(v_admin);
    RAISE EXCEPTION 'FALHA 2.4: último admin da plataforma excluiu a si mesmo';
  EXCEPTION WHEN sqlstate 'W2005' THEN NULL;
  END;

  -- 2.5 — uuid que não existe em auth.users
  BEGIN
    PERFORM public.delete_platform_user(v_ghost);
    RAISE EXCEPTION 'FALHA 2.5: uuid inexistente foi aceito';
  EXCEPTION WHEN sqlstate 'W2004' THEN NULL;
  END;

  -- 2.6 — nenhuma das tentativas acima deixou rastro
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_target) THEN
    RAISE EXCEPTION 'FALHA 2.6: papel do alvo sumiu numa tentativa que deveria falhar';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.role_audit_log
     WHERE action = 'delete' AND target_user_id IN (v_admin, v_target, v_ghost)
  ) THEN
    RAISE EXCEPTION 'FALHA 2.7: tentativa recusada gravou linha delete na auditoria';
  END IF;

  RAISE NOTICE 'Seção 2 OK';
END $$;

-- ============================================================
-- Seção 3 — Caminho feliz: usuário COM papel e rotas
-- ============================================================
DO $$
DECLARE
  v_admin  uuid := 'd4444444-4444-4444-4444-444444444444';
  v_target uuid := 'd5555555-5555-5555-5555-555555555555';
  v_count  int;
  v_prev   public.app_role;
  v_email  text;
  v_actor  uuid;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'del-smoke-admin2@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_target, 'authenticated', 'authenticated',
     'del-smoke-viewer@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_admin, 'admin'), (v_target, 'viewer');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.set_user_routes(v_target,
    ARRAY['alocacoes', 'compromisso']::public.app_route[]);

  PERFORM public.delete_platform_user(v_target);

  -- 3.1 — papel removido
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_target) THEN
    RAISE EXCEPTION 'FALHA 3.1: papel do usuário excluído permaneceu';
  END IF;

  -- 3.2 — rotas removidas
  SELECT count(*) INTO v_count
    FROM public.user_route_access WHERE user_id = v_target;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 3.2: % rota(s) sobraram para o usuário excluído', v_count;
  END IF;

  -- 3.3 — exatamente uma linha delete, com ator, e-mail e papel anterior
  SELECT count(*) INTO v_count
    FROM public.role_audit_log
   WHERE action = 'delete' AND target_user_id = v_target;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 3.3: esperava 1 linha delete na auditoria, achou %', v_count;
  END IF;

  SELECT previous_role, target_email, actor_user_id
    INTO v_prev, v_email, v_actor
    FROM public.role_audit_log
   WHERE action = 'delete' AND target_user_id = v_target;

  IF v_prev <> 'viewer'::public.app_role THEN
    RAISE EXCEPTION 'FALHA 3.4: previous_role da exclusão é % (esperava viewer)', v_prev;
  END IF;
  IF v_email <> 'del-smoke-viewer@test.local' THEN
    RAISE EXCEPTION 'FALHA 3.5: target_email da exclusão é % (esperava o e-mail do alvo)', v_email;
  END IF;
  IF v_actor <> v_admin THEN
    RAISE EXCEPTION 'FALHA 3.6: actor_user_id da exclusão é % (esperava o admin)', v_actor;
  END IF;

  -- 3.7 — o override desligou o 'revoke' padrão: a exclusão não pode gerar
  -- as duas linhas para o mesmo evento
  SELECT count(*) INTO v_count
    FROM public.role_audit_log
   WHERE action = 'revoke' AND target_user_id = v_target;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 3.7: exclusão gerou % linha(s) revoke além da delete', v_count;
  END IF;

  -- 3.8 — uma linha route_revoke por rota que existia
  SELECT count(*) INTO v_count
    FROM public.role_audit_log
   WHERE action = 'route_revoke' AND target_user_id = v_target;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FALHA 3.8: esperava 2 linhas route_revoke, achou %', v_count;
  END IF;

  RAISE NOTICE 'Seção 3 OK';
END $$;

-- ============================================================
-- Seção 4 — Caminho feliz: usuário SEM papel ("Sem acesso")
-- ============================================================
-- Sem linha em user_roles o trigger de auditoria não dispara. Se a RPC não
-- inserisse a linha explicitamente, excluir um "Sem acesso" passaria em
-- branco no Histórico.
DO $$
DECLARE
  v_admin  uuid := 'd6666666-6666-6666-6666-666666666666';
  v_target uuid := 'd7777777-7777-7777-7777-777777777777';
  v_count  int;
  v_prev   public.app_role;
  v_new    public.app_role;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'del-smoke-admin3@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_target, 'authenticated', 'authenticated',
     'del-smoke-norole@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  PERFORM public.delete_platform_user(v_target);

  SELECT count(*) INTO v_count
    FROM public.role_audit_log
   WHERE action = 'delete' AND target_user_id = v_target;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 4.1: usuário sem papel gerou % linha(s) delete (esperava 1)', v_count;
  END IF;

  SELECT previous_role, new_role INTO v_prev, v_new
    FROM public.role_audit_log
   WHERE action = 'delete' AND target_user_id = v_target;
  IF v_prev IS NOT NULL OR v_new IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 4.2: exclusão de usuário sem papel gravou papel (% → %)', v_prev, v_new;
  END IF;

  RAISE NOTICE 'Seção 4 OK';
END $$;

-- ============================================================
-- Seção 5 — Convite pendente
-- ============================================================
DO $$
DECLARE
  v_admin    uuid := 'd8888888-8888-8888-8888-888888888888';
  v_pending  uuid := 'da111111-1111-1111-1111-111111111111';
  v_consumed uuid := 'da222222-2222-2222-2222-222222222222';
  v_count    int;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'del-smoke-admin4@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_pending, 'authenticated', 'authenticated',
     'del-smoke-pending@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_consumed, 'authenticated', 'authenticated',
     'del-smoke-consumed@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');

  INSERT INTO public.invitations (email, role, routes, invited_by, consumed_at) VALUES
    ('del-smoke-pending@test.local', 'viewer',
     ARRAY['alocacoes']::public.app_route[], v_admin, NULL),
    ('del-smoke-consumed@test.local', 'editor',
     ARRAY['alocacoes']::public.app_route[], v_admin, now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  PERFORM public.delete_platform_user(v_pending);
  SELECT count(*) INTO v_count FROM public.invitations
   WHERE email = 'del-smoke-pending@test.local';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 5.1: convite pendente sobreviveu à exclusão (achou %)', v_count;
  END IF;

  -- Convite já consumido é histórico, não é caminho de volta: não se apaga.
  PERFORM public.delete_platform_user(v_consumed);
  SELECT count(*) INTO v_count FROM public.invitations
   WHERE email = 'del-smoke-consumed@test.local' AND consumed_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 5.2: convite já consumido foi apagado pela exclusão';
  END IF;

  RAISE NOTICE 'Seção 5 OK';
END $$;

-- ============================================================
-- Seção 6 — Nada fora do escopo é tocado
-- ============================================================
-- O quadro de alocação não referencia auth.users (public.devs é cadastro
-- próprio, allocations.dev_id aponta para devs) — esta seção fixa esse fato
-- como asserção para que uma FK futura não passe despercebida.
DO $$
DECLARE
  v_admin  uuid := 'da333333-3333-3333-3333-333333333333';
  v_target uuid := 'da444444-4444-4444-4444-444444444444';
  v_devs_antes int;
  v_devs_depois int;
  v_hist int;
BEGIN
  SELECT count(*) INTO v_devs_antes FROM public.devs;

  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'del-smoke-admin5@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_target, 'authenticated', 'authenticated',
     'del-smoke-hist@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_admin, 'admin'), (v_target, 'editor');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- Histórico anterior do alvo (a concessão do papel acima)
  SELECT count(*) INTO v_hist FROM public.role_audit_log
   WHERE target_user_id = v_target AND action = 'grant';
  IF v_hist = 0 THEN
    RAISE EXCEPTION 'FALHA 6.1: fixture não gerou histórico anterior para o alvo';
  END IF;

  PERFORM public.delete_platform_user(v_target);

  SELECT count(*) INTO v_devs_depois FROM public.devs;
  IF v_devs_antes <> v_devs_depois THEN
    RAISE EXCEPTION 'FALHA 6.2: public.devs mudou de % para % durante a exclusão',
      v_devs_antes, v_devs_depois;
  END IF;

  SELECT count(*) INTO v_hist FROM public.role_audit_log
   WHERE target_user_id = v_target AND action = 'grant';
  IF v_hist = 0 THEN
    RAISE EXCEPTION 'FALHA 6.3: histórico anterior do usuário foi apagado pela exclusão';
  END IF;

  RAISE NOTICE 'Seção 6 OK';
END $$;

ROLLBACK;
