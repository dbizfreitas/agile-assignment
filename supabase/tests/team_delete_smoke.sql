-- Suite de verificacao da RPC public.delete_team (issue #14).
-- Roda inteiramente dentro de uma transacao com ROLLBACK: nao deixa residuo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Secao N OK' por secao.
-- Falha = ERROR: com a mensagem do ASSERT que falhou.
--
-- Nota sobre a Secao 6 (W4002, sem papel algum): a suite simula o ator via
-- set_config('request.jwt.claims', ...), o mesmo mecanismo usado pelas outras
-- suites deste diretorio (ex.: user_delete_smoke.sql). auth.uid() so le essa
-- configuracao de sessao, entao o ator da Secao 6 (v_no_role) nao precisa de
-- linha nem em auth.users nem em public.user_roles: ele existe so como uuid
-- solto, o suficiente para exercitar o caminho real de recusa da RPC (W4002)
-- em vez de testar private.can_edit_board(...) isoladamente.
-- Isso NAO vale para o ator principal da suite (v_actor, Secao 1) nem para o
-- ator da Secao 7 (v_no_route): ambos recebem um papel em public.user_roles,
-- e user_roles.user_id TEM FK para auth.users (20260809100000_rbac_user_
-- roles_fk.sql) — por isso os dois precisam de uma linha em auth.users antes
-- do INSERT em user_roles.
--
-- Nota sobre a Secao 7 (W4002, papel sem rota): desde 20260830130000_team_
-- delete_route_guard.sql, delete_team exige papel de edicao E a rota
-- 'alocacoes' (o mesmo predicado das policies RLS que a funcao, sendo
-- SECURITY DEFINER, contorna). v_no_route tem o papel mas nenhuma linha em
-- public.user_route_access, entao a RPC deve recusar do mesmo jeito que a
-- policy direta recusaria um SELECT dele em public.teams.
--
-- Todas as linhas de setup usam nomes prefixados _SMOKE_ para que um ROLLBACK
-- que falhe por algum motivo fique obvio numa consulta manual. Nenhuma linha
-- pre-existente e referenciada.
BEGIN;

-- Sem isto, um ASSERT que falha nao levanta nada quando o servidor roda com
-- plpgsql.check_asserts desligado: a suite inteira passaria em branco sem
-- provar nenhum dos comportamentos abaixo.
SET LOCAL plpgsql.check_asserts = on;

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
  -- user_roles.user_id TEM FK para auth.users (ON DELETE CASCADE, ver
  -- 20260809100000_rbac_user_roles_fk.sql), entao v_actor precisa existir la
  -- primeiro ou o INSERT em user_roles abaixo falha com 23503. auth.uid() em
  -- si so le request.jwt.claims — mas a FK da tabela e outra checagem.
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_actor, 'authenticated', 'authenticated',
     'team-delete-smoke-actor@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES (v_actor, 'editor');

  -- Papel sozinho nao basta mais (20260830130000_team_delete_route_guard.sql):
  -- delete_team agora tambem exige a rota 'alocacoes', o mesmo predicado de
  -- teams_delete_editors/devs_update_editors. Sem esta linha, todo caminho
  -- feliz da suite (Secoes 2 e 3) cairia em W4002.
  INSERT INTO public.user_route_access (user_id, route) VALUES (v_actor, 'alocacoes');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  -- Dois times no mesmo projeto (A e B, SMOKEA) e um terceiro em outro
  -- projeto (C, SMOKEB), usado na Secao 5 para acionar W4006.
  --
  -- SMOKEA/SMOKEB sao chaves de projeto sinteticas, de proposito distintas
  -- de qualquer projeto real do quadro (ex.: PIM, o projeto padrao definido
  -- em src/lib/projects.ts, ja povoado por times de producao). A RPC
  -- renumera TODOS os times do projeto de origem apos o delete — um fixture
  -- sobre uma chave real reescreveria a position de times de producao
  -- dentro da transacao (contida pelo ROLLBACK, mas ainda assim tocando
  -- linha pre-existente) e as asserts de position abaixo dependeriam de
  -- quantos times reais ja existem, em vez de um valor fixo. Ambas batem
  -- com teams_jira_project_format (^[A-Z][A-Z0-9]{1,9}$).
  INSERT INTO public.teams (id, name, jira_project, position) VALUES
    (v_team_a, '_SMOKE_A_', 'SMOKEA', 100),
    (v_team_b, '_SMOKE_B_', 'SMOKEA', 101),
    (v_team_c, '_SMOKE_C_', 'SMOKEB', 100);

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
  v_actor       uuid := 'a1111111-1111-1111-1111-111111111111';
  v_team_d      uuid := 'a6666666-6666-6666-6666-666666666666';
  v_team_c      uuid := 'a5555555-5555-5555-5555-555555555555';
  v_source_pos  int[];
  v_other_pos   int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  INSERT INTO public.teams (id, name, jira_project, position) VALUES
    (v_team_d, '_SMOKE_D_', 'SMOKEA', 102);

  PERFORM public.delete_team(v_team_d, NULL);

  ASSERT NOT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team_d),
    'Secao 2: time vazio D sobreviveu a delete_team(D, NULL)';

  -- Renumeracao (b) da RPC: com D fora, os times SMOKEA que restam (A em
  -- 100 e B em 101, da Secao 1) devem fechar o buraco e virar 0/1, na mesma
  -- ordem relativa. Prova que a segunda CTE de renumeracao do delete_team
  -- roda. So funciona como valor fixo porque SMOKEA e uma chave sintetica
  -- sem nenhum time de producao: ver o comentario no fixture da Secao 1.
  SELECT array_agg(position ORDER BY position) INTO v_source_pos
    FROM public.teams WHERE jira_project = 'SMOKEA';
  ASSERT v_source_pos = ARRAY[0, 1],
    format('Secao 2: positions dos times SMOKEA deviam virar 0/1 apos apagar D, achou %s', v_source_pos);

  -- E o time C, de outro projeto (SMOKEB), tem que continuar intocado: prova
  -- que a renumeracao e escopada por jira_project e nao vaza para outros
  -- projetos.
  SELECT position INTO v_other_pos FROM public.teams WHERE id = v_team_c;
  ASSERT v_other_pos = 100,
    format('Secao 2: time C (SMOKEB) deveria seguir na position 100, achou %s', v_other_pos);

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
  ASSERT v_projects = ARRAY['SMOKEA'],
    format('Secao 3: jira_project das 3 pessoas deveria ser so SMOKEA, achou %s', v_projects);

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

  -- W4004 levanta antes de qualquer UPDATE em devs nesta RPC, mas isto fica
  -- como seguro barato contra uma reordenacao futura que escreva antes de
  -- validar: B tinha 3 pessoas desde a realocacao da Secao 3.
  ASSERT (SELECT count(*) FROM public.devs WHERE team_id = v_team_b) = 3,
    'Secao 4: pessoas de B nao sobreviveram a uma tentativa que deveria ter sido recusada';

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

  -- W4006 tambem levanta antes de qualquer UPDATE em devs; mesma logica de
  -- seguro barato da Secao 4.
  ASSERT (SELECT count(*) FROM public.devs WHERE team_id = v_team_b) = 3,
    'Secao 5: pessoas de B nao sobreviveram a uma tentativa que deveria ter sido recusada';

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

  -- Mesma logica de seguro barato das Secoes 4 e 5: a recusa acontece antes
  -- de qualquer escrita, mas confirmar as 3 pessoas de B tambem cobre uma
  -- reordenacao futura que escreva antes de validar.
  ASSERT (SELECT count(*) FROM public.devs WHERE team_id = v_team_b) = 3,
    'Secao 6: pessoas de B nao sobreviveram a uma tentativa que deveria ter sido recusada';

  RAISE NOTICE 'Secao 6 OK';
END $$;

-- ============================================================
-- Secao 7 — W4002: papel de edicao SEM a rota alocacoes
-- ============================================================
-- Este e o caso que realmente importa (20260830130000_team_delete_route_
-- guard.sql): um ator com papel editor mas sem a rota alocacoes nao consegue
-- nem fazer SELECT de uma linha de teams (teams_select_route exige a rota) e
-- muito menos DELETE uma direto (teams_delete_editors exige papel E rota) —
-- mas antes da correcao conseguia apagar o time inteiro pela RPC, porque ela
-- so checava o papel. E mais forte que a Secao 6 (que testa a ausencia total
-- de papel) porque isola exatamente o eixo que a correcao adiciona.
DO $$
DECLARE
  v_no_route uuid := 'aa111111-1111-1111-1111-111111111111';
  v_team_e   uuid := 'ab111111-1111-1111-1111-111111111111';
BEGIN
  -- user_roles.user_id tem FK para auth.users (mesma razao da Secao 1):
  -- v_no_route precisa existir la antes do INSERT em user_roles abaixo.
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_no_route, 'authenticated', 'authenticated',
     'team-delete-smoke-noroute@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  -- Papel de edicao presente, de proposito — e o que faz este caso ser
  -- diferente (e mais forte) do que a Secao 6 exercita. Nenhuma linha em
  -- public.user_route_access: e essa ausencia que deve derrubar a chamada.
  INSERT INTO public.user_roles (user_id, role) VALUES (v_no_route, 'editor');

  -- Time E, vazio, criado so para esta secao. Precisa ser VAZIO e nao B:
  -- B tem 3 pessoas, entao sob um guard revertido (so papel) a chamada
  -- passaria da checagem de permissao e ainda assim levantaria W4004 (time
  -- povoado sem destino) — um erro real, mas do subsistema errado, que
  -- mascararia a checagem de permissao sendo o alvo deste teste. Com E vazio,
  -- um guard revertido nao levanta excecao nenhuma: a chamada simplesmente
  -- teria sucesso e apagaria E, o que aciona o ASSERT false abaixo com a
  -- mensagem certa — prova de fato a escalada, em vez de ficar mascarada por
  -- uma validacao de negocio que nada tem a ver com permissao. Inserido aqui
  -- dentro da Secao 7 (a ultima do arquivo) para nao interferir em nenhuma
  -- assert de position das secoes anteriores.
  INSERT INTO public.teams (id, name, jira_project, position) VALUES
    (v_team_e, '_SMOKE_E_', 'SMOKEA', 1);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_no_route, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.delete_team(v_team_e, NULL);
    ASSERT false, 'Secao 7: editor sem rota alocacoes conseguiu chamar delete_team';
  EXCEPTION WHEN SQLSTATE 'W4002' THEN
    NULL;
  END;

  ASSERT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team_e),
    'Secao 7: time E sumiu apos uma tentativa que deveria ter sido recusada';

  -- Seguro barato, no mesmo espirito das Secoes 4, 5 e 6: E foi criado vazio
  -- e deve continuar vazio, provando que a recusa aconteceu antes de
  -- qualquer escrita em devs (nao que so por acaso nao havia ninguem para
  -- mover).
  ASSERT (SELECT count(*) FROM public.devs WHERE team_id = v_team_e) = 0,
    'Secao 7: time E ganhou gente apos uma tentativa que deveria ter sido recusada';

  RAISE NOTICE 'Secao 7 OK';
END $$;

ROLLBACK;
