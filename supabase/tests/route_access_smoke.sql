-- Suíte de verificação de permissões por rota (issue #23).
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura e RPC (Task 1)
-- ============================================================
DO $$
DECLARE
  v_admin uuid := 'a1111111-1111-1111-1111-111111111111';
  v_editor uuid := 'a2222222-2222-2222-2222-222222222222';
  v_target uuid := 'a3333333-3333-3333-3333-333333333333';
  v_count int;
BEGIN
  IF to_regclass('public.user_route_access') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.1: tabela public.user_route_access não existe';
  END IF;
  IF to_regproc('private.has_route') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.2: função private.has_route não existe';
  END IF;
  IF to_regproc('public.set_user_routes') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.3: função public.set_user_routes não existe';
  END IF;

  -- Fixtures: usuários temporários (a transação faz ROLLBACK ao final)
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'route-smoke-admin@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_editor, 'authenticated', 'authenticated',
     'route-smoke-editor@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_target, 'authenticated', 'authenticated',
     'route-smoke-target@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_admin, 'admin'), (v_editor, 'editor'), (v_target, 'viewer');

  -- 1.4 — backfill: quem já tinha papel antes da migration ganhou as 4 rotas.
  -- v_target foi inserido em user_roles DEPOIS do backfill rodar (é fixture
  -- desta transação), então checamos o backfill num usuário que já existia
  -- antes desta suíte — qualquer um com papel deve ter as 4 rotas.
  SELECT count(*) INTO v_count
    FROM public.user_roles ur
    JOIN public.user_route_access ura ON ura.user_id = ur.user_id
   WHERE ur.user_id NOT IN (v_admin, v_editor, v_target);
  -- Não é uma asserção de igualdade (o número de usuários pré-existentes
  -- varia); só confirma que o backfill deixou ALGUMA linha para gente que
  -- já tinha papel, ou seja, não zerou o acesso de todo mundo no deploy.
  IF v_count = 0 AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id NOT IN (v_admin, v_editor, v_target)
  ) THEN
    RAISE EXCEPTION 'FALHA 1.4: nenhum usuário pré-existente recebeu rota no backfill';
  END IF;

  -- 1.5 — has_route reflete a tabela
  IF private.has_route(v_target, 'alocacoes'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 1.5: has_route retornou true sem nenhuma linha em user_route_access';
  END IF;

  -- 1.6 — set_user_routes exige admin
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.set_user_routes(v_target, ARRAY['alocacoes']::public.app_route[]);
    RAISE EXCEPTION 'FALHA 1.6: editor conseguiu chamar set_user_routes';
  EXCEPTION WHEN sqlstate 'W2001' THEN NULL;
  END;

  -- 1.7 — admin concede rotas
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.set_user_routes(v_target, ARRAY['alocacoes', 'compromisso']::public.app_route[]);
  IF NOT private.has_route(v_target, 'alocacoes'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 1.7: alocacoes não foi concedida';
  END IF;
  IF NOT private.has_route(v_target, 'compromisso'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 1.8: compromisso não foi concedida';
  END IF;
  IF private.has_route(v_target, 'cycle-time'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 1.9: cycle-time foi concedida sem pedido';
  END IF;

  -- 1.10 — set_user_routes substitui a lista inteira (não faz delta)
  PERFORM public.set_user_routes(v_target, ARRAY['cycle-time']::public.app_route[]);
  IF private.has_route(v_target, 'alocacoes'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 1.10: alocacoes continuou concedida após substituição';
  END IF;
  IF NOT private.has_route(v_target, 'cycle-time'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 1.11: cycle-time não foi concedida na substituição';
  END IF;

  RAISE NOTICE 'Seção 1 OK';
END $$;

-- ============================================================
-- Seção 2 — RLS de Alocações ciente de rota (Task 2)
-- ============================================================
DO $$
DECLARE
  v_editor_sem_rota uuid := 'a4444444-4444-4444-4444-444444444444';
  v_editor_com_rota uuid := 'a5555555-5555-5555-5555-555555555555';
  v_team_id uuid;
  v_count int;
BEGIN
  SELECT id INTO v_team_id FROM public.teams LIMIT 1;

  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_editor_sem_rota, 'authenticated', 'authenticated',
     'route-smoke-editor-semrota@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_editor_com_rota, 'authenticated', 'authenticated',
     'route-smoke-editor-comrota@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_editor_sem_rota, 'editor'), (v_editor_com_rota, 'editor');
  -- v_editor_sem_rota tem papel editor mas NENHUMA rota (não passou pelo backfill
  -- porque foi criado depois; é exatamente o cenário que a policy nova precisa barrar).
  INSERT INTO public.user_route_access (user_id, route) VALUES (v_editor_com_rota, 'alocacoes');

  -- 2.1 — leitura: editor sem rota alocacoes não lê devs sob RLS real
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor_sem_rota, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.devs;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 2.1: editor sem rota leu % linha(s) de devs', v_count;
  END IF;

  -- 2.2 — escrita: editor sem rota alocacoes não insere em devs (papel sozinho não basta)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor_sem_rota, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.devs (name, team_id) VALUES ('Smoke Sem Rota', v_team_id);
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 2.2: editor sem rota conseguiu inserir em devs';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;

  -- 2.3 — escrita: editor COM rota alocacoes insere normalmente
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor_com_rota, 'role', 'authenticated')::text, true);
  INSERT INTO public.devs (name, team_id) VALUES ('Smoke Com Rota', v_team_id);
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.devs WHERE name = 'Smoke Com Rota') THEN
    RAISE EXCEPTION 'FALHA 2.3: editor com rota não conseguiu inserir em devs';
  END IF;

  RAISE NOTICE 'Seção 2 OK';
END $$;

-- ============================================================
-- Seção 3 — Auditoria de rota (Task 3)
-- ============================================================
DO $$
DECLARE
  v_admin uuid := 'a1111111-1111-1111-1111-111111111111';
  v_target uuid := 'a6666666-6666-6666-6666-666666666666';
  v_count int;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_target, 'authenticated', 'authenticated',
     'route-smoke-audit@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false);
  INSERT INTO public.user_roles (user_id, role) VALUES (v_target, 'viewer');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- 3.1 — conceder gera route_grant com a rota certa
  PERFORM public.set_user_routes(v_target, ARRAY['alocacoes']::public.app_route[]);
  SELECT count(*) INTO v_count FROM public.role_audit_log
   WHERE target_user_id = v_target AND action = 'route_grant'
     AND route = 'alocacoes'::public.app_route AND actor_user_id = v_admin;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 3.1: route_grant não registrado (achou %)', v_count;
  END IF;

  -- 3.2 — revogar gera route_revoke
  PERFORM public.set_user_routes(v_target, ARRAY[]::public.app_route[]);
  SELECT count(*) INTO v_count FROM public.role_audit_log
   WHERE target_user_id = v_target AND action = 'route_revoke'
     AND route = 'alocacoes'::public.app_route AND actor_user_id = v_admin;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 3.2: route_revoke não registrado (achou %)', v_count;
  END IF;

  RAISE NOTICE 'Seção 3 OK';
END $$;

ROLLBACK;
