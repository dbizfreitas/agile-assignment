-- Suite de verificacao da RPC public.delete_team (issue #14).
-- Roda inteiramente dentro de uma transacao com ROLLBACK: nao deixa residuo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Secao N OK' por secao.
-- Falha = ERROR: com a mensagem do ASSERT que falhou.
--
-- Nota sobre a Secao 6 (W4002): a suite simula o ator via
-- set_config('request.jwt.claims', ...), o mesmo mecanismo usado pelas outras
-- suites deste diretorio (ex.: user_delete_smoke.sql). auth.uid() so le essa
-- configuracao de sessao — nao depende de uma linha em auth.users — entao foi
-- possivel testar o caminho real da RPC (um ator cujo uuid nao tem linha em
-- public.user_roles) em vez de cair no fallback de verificar
-- private.can_edit_board(...) isoladamente.
--
-- Todas as linhas de setup usam nomes prefixados _SMOKE_ para que um ROLLBACK
-- que falhe por algum motivo fique obvio numa consulta manual. Nenhuma linha
-- pre-existente e referenciada.
BEGIN;

-- ============================================================
-- Secao 1 — Setup e estrutura
-- ============================================================
DO $$
DECLARE
  v_actor  uuid := 'a1111111-1111-1111-1111-111111111111';
  v_team_a uuid := 'a3333333-3333-3333-3333-333333333333';
  v_team_b uuid := 'a4444444-4444-4444-4444-444444444444';
  v_team_c uuid := 'a5555555-5555-5555-5555-555555555555';
  v_dev_a1 uuid := 'a7777777-7777-7777-7777-777777777777';
  v_dev_a2 uuid := 'a8888888-8888-8888-8888-888888888888';
  v_dev_b1 uuid := 'a9999999-9999-9999-9999-999999999999';
BEGIN
  IF to_regprocedure('public.delete_team(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.1: funcao public.delete_team(uuid, uuid) nao existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'public.delete_team(uuid, uuid)'::regprocedure
       AND prosecdef
  ) THEN
    RAISE EXCEPTION 'FALHA 1.2: delete_team nao e SECURITY DEFINER';
  END IF;

  IF has_function_privilege('anon', 'public.delete_team(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA 1.3: anon tem EXECUTE em delete_team';
  END IF;
  IF NOT has_function_privilege(
       'authenticated', 'public.delete_team(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA 1.4: authenticated nao tem EXECUTE em delete_team';
  END IF;

  -- Ator com papel de edicao, usado por todas as chamadas felizes da suite.
  -- Sem linha em auth.users de proposito: user_roles.user_id nao tem FK para
  -- auth.users, e auth.uid() so le request.jwt.claims.
  INSERT INTO public.user_roles (user_id, role) VALUES (v_actor, 'editor');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  -- Dois times no mesmo projeto (A e B, PIM) e um terceiro em outro
  -- projeto (C, PH), usado na Secao 5 para acionar W4006.
  INSERT INTO public.teams (id, name, jira_project, position) VALUES
    (v_team_a, '_SMOKE_A_', 'PIM', 100),
    (v_team_b, '_SMOKE_B_', 'PIM', 101),
    (v_team_c, '_SMOKE_C_', 'PH', 100);

  -- Duas pessoas em A (position 0 e 1) e uma em B (position 0), como pede a
  -- Secao 3 da task. jira_project de todas vem do trigger devs_set_project.
  INSERT INTO public.devs (id, name, team_id, position) VALUES
    (v_dev_a1, '_SMOKE_DEV_A1_', v_team_a, 0),
    (v_dev_a2, '_SMOKE_DEV_A2_', v_team_a, 1),
    (v_dev_b1, '_SMOKE_DEV_B1_', v_team_b, 0);

  ASSERT (SELECT count(*) FROM public.teams WHERE id IN (v_team_a, v_team_b, v_team_c)) = 3,
    'setup: os tres times nao foram inseridos';
  ASSERT (SELECT count(*) FROM public.devs WHERE id IN (v_dev_a1, v_dev_a2, v_dev_b1)) = 3,
    'setup: as tres pessoas nao foram inseridas';

  RAISE NOTICE 'Secao 1 OK';
END $$;

-- ============================================================
-- Secao 2 — Time vazio
-- ============================================================
DO $$
DECLARE
  v_actor  uuid := 'a1111111-1111-1111-1111-111111111111';
  v_team_d uuid := 'a6666666-6666-6666-6666-666666666666';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  INSERT INTO public.teams (id, name, jira_project, position) VALUES
    (v_team_d, '_SMOKE_D_', 'PIM', 102);

  PERFORM public.delete_team(v_team_d, NULL);

  ASSERT NOT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team_d),
    'Secao 2: time vazio D sobreviveu a delete_team(D, NULL)';

  RAISE NOTICE 'Secao 2 OK';
END $$;

-- ============================================================
-- Secao 3 — Realocacao: delete_team(A, B)
-- ============================================================
DO $$
DECLARE
  v_actor    uuid := 'a1111111-1111-1111-1111-111111111111';
  v_team_a   uuid := 'a3333333-3333-3333-3333-333333333333';
  v_team_b   uuid := 'a4444444-4444-4444-4444-444444444444';
  v_dev_a1   uuid := 'a7777777-7777-7777-7777-777777777777';
  v_dev_a2   uuid := 'a8888888-8888-8888-8888-888888888888';
  v_dev_b1   uuid := 'a9999999-9999-9999-9999-999999999999';
  v_positions int[];
  v_projects  text[];
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  PERFORM public.delete_team(v_team_a, v_team_b);

  ASSERT NOT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team_a),
    'Secao 3: time A ainda existe apos delete_team(A, B)';

  ASSERT (SELECT team_id FROM public.devs WHERE id = v_dev_a1) = v_team_b
     AND (SELECT team_id FROM public.devs WHERE id = v_dev_a2) = v_team_b,
    'Secao 3: pessoas de A nao foram movidas para B';

  ASSERT (SELECT count(*) FROM public.devs WHERE team_id = v_team_b) = 3,
    'Secao 3: B nao tem as 3 pessoas esperadas apos a realocacao';

  SELECT array_agg(position ORDER BY position) INTO v_positions
    FROM public.devs WHERE team_id = v_team_b;
  ASSERT v_positions = ARRAY[0, 1, 2],
    format('Secao 3: positions de B deviam ser 0/1/2 sem repeticao, achou %s', v_positions);

  SELECT array_agg(DISTINCT jira_project) INTO v_projects
    FROM public.devs WHERE id IN (v_dev_a1, v_dev_a2, v_dev_b1);
  ASSERT v_projects = ARRAY['PIM'],
    format('Secao 3: jira_project das 3 pessoas deveria ser so PIM, achou %s', v_projects);

  RAISE NOTICE 'Secao 3 OK';
END $$;

-- ============================================================
-- Secao 4 — W4004: time povoado sem destino
-- ============================================================
DO $$
DECLARE
  v_actor  uuid := 'a1111111-1111-1111-1111-111111111111';
  v_team_b uuid := 'a4444444-4444-4444-4444-444444444444';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.delete_team(v_team_b, NULL);
    ASSERT false, 'Secao 4: delete_team(B, NULL) deveria falhar com B povoado';
  EXCEPTION WHEN SQLSTATE 'W4004' THEN
    NULL;
  END;

  ASSERT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team_b),
    'Secao 4: time B sumiu apos uma tentativa que deveria ter sido recusada';

  RAISE NOTICE 'Secao 4 OK';
END $$;

-- ============================================================
-- Secao 5 — W4006: destino em outro projeto
-- ============================================================
DO $$
DECLARE
  v_actor  uuid := 'a1111111-1111-1111-1111-111111111111';
  v_team_b uuid := 'a4444444-4444-4444-4444-444444444444';
  v_team_c uuid := 'a5555555-5555-5555-5555-555555555555';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.delete_team(v_team_b, v_team_c);
    ASSERT false, 'Secao 5: delete_team(B, C) deveria falhar (C esta em outro projeto)';
  EXCEPTION WHEN SQLSTATE 'W4006' THEN
    NULL;
  END;

  ASSERT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team_b),
    'Secao 5: time B sumiu apos uma tentativa que deveria ter sido recusada';
  ASSERT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team_c),
    'Secao 5: time C sumiu apos uma tentativa que deveria ter sido recusada';

  RAISE NOTICE 'Secao 5 OK';
END $$;

-- ============================================================
-- Secao 6 — W4002: ator sem papel de edicao
-- ============================================================
DO $$
DECLARE
  v_no_role uuid := 'a2222222-2222-2222-2222-222222222222';
  v_team_b  uuid := 'a4444444-4444-4444-4444-444444444444';
BEGIN
  -- v_no_role nao tem linha em public.user_roles: private.can_edit_board deve
  -- devolver false para ele, e a RPC deve recusar antes de tocar em qualquer
  -- linha. Confirmado tambem de forma isolada, para dar cobertura ao helper
  -- em si e nao so ao caminho que passa pela RPC.
  ASSERT private.can_edit_board(v_no_role) IS FALSE,
    'Secao 6: private.can_edit_board deveria ser false para um uuid sem papel';

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_no_role, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.delete_team(v_team_b, NULL);
    ASSERT false, 'Secao 6: ator sem papel de edicao conseguiu chamar delete_team';
  EXCEPTION WHEN SQLSTATE 'W4002' THEN
    NULL;
  END;

  ASSERT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team_b),
    'Secao 6: time B sumiu apos uma tentativa que deveria ter sido recusada';

  RAISE NOTICE 'Secao 6 OK';
END $$;

ROLLBACK;
