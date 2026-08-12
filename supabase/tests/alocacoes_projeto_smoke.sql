-- Suíte de verificação da dimensão de projeto do quadro de alocação.
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
-- Falha = ERROR: com a mensagem da asserção.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura (Tasks 1 e 2)
-- ============================================================
DO $$
DECLARE
  t text;
  v_count int;
BEGIN
  FOREACH t IN ARRAY ARRAY['teams','sprints','devs','allocations'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'jira_project'
    ) THEN
      RAISE EXCEPTION 'FALHA 1.1: coluna jira_project ausente em public.%', t;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t
         AND column_name = 'jira_project' AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'FALHA 1.2: public.%.jira_project não é NOT NULL', t;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = t || '_jira_project_format'
         AND conrelid = ('public.' || t)::regclass
         AND contype = 'c'
    ) THEN
      RAISE EXCEPTION 'FALHA 1.3: CHECK %_jira_project_format ausente', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['teams','sprints','devs'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = t || '_id_project_key'
         AND conrelid = ('public.' || t)::regclass
         AND contype = 'u'
    ) THEN
      RAISE EXCEPTION 'FALHA 1.4: UNIQUE %_id_project_key ausente', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['devs_team_project_fkey',
                           'allocations_dev_project_fkey',
                           'allocations_sprint_project_fkey'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = t AND contype = 'f' AND condeferrable
    ) THEN
      RAISE EXCEPTION 'FALHA 1.5: FK composta % ausente ou não deferível', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.devs'::regclass
                    AND tgname = 'devs_set_project') THEN
    RAISE EXCEPTION 'FALHA 1.6: trigger devs_set_project ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.allocations'::regclass
                    AND tgname = 'allocations_set_project') THEN
    RAISE EXCEPTION 'FALHA 1.7: trigger allocations_set_project ausente';
  END IF;

  SELECT count(*) INTO v_count FROM pg_class
   WHERE relname IN ('teams_project_position_idx','sprints_project_start_idx',
                     'devs_project_position_idx','allocations_project_idx');
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'FALHA 1.8: esperados 4 índices de projeto, achou %', v_count;
  END IF;

  RAISE NOTICE 'Seção 1 OK';
END $$;

-- ============================================================
-- Seção 2 — Backfill sem linha órfã (Task 1)
-- ============================================================
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.devs d
    JOIN public.teams t ON t.id = d.team_id
   WHERE d.jira_project <> t.jira_project;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 2.1: % pessoa(s) com projeto diferente do time', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.allocations a
    JOIN public.devs d ON d.id = a.dev_id
   WHERE a.jira_project <> d.jira_project;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 2.2: % cartão(ões) com projeto diferente da pessoa', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.allocations a
    JOIN public.sprints s ON s.id = a.sprint_id
   WHERE a.jira_project <> s.jira_project;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 2.3: % cartão(ões) com projeto diferente da sprint', v_count;
  END IF;

  RAISE NOTICE 'Seção 2 OK';
END $$;

-- ============================================================
-- Seções 3 a 8 — Comportamento, com fixtures compartilhadas
-- ============================================================
DO $$
DECLARE
  v_team_pim uuid; v_team_ph uuid; v_team_vazio uuid; v_team_cur uuid;
  v_sprint_pim uuid; v_sprint_ph uuid; v_sprint_cur uuid;
  v_dev_pim uuid; v_dev_ph uuid; v_dev_livre uuid; v_dev_cur uuid;
  v_proj text;
  v_count int;
BEGIN
  -- Fixtures: position alto para não brigar com os dados reais na tela
  -- (a transação faz ROLLBACK ao final de qualquer forma).
  INSERT INTO public.teams (name, color, position, jira_project)
       VALUES ('Smoke time PIM', '#0f766e', 900, 'PIM') RETURNING id INTO v_team_pim;
  INSERT INTO public.teams (name, color, position, jira_project)
       VALUES ('Smoke time PH', '#1d4ed8', 901, 'PH') RETURNING id INTO v_team_ph;
  INSERT INTO public.teams (name, color, position, jira_project)
       VALUES ('Smoke time vazio', '#b45309', 902, 'PIM') RETURNING id INTO v_team_vazio;
  INSERT INTO public.teams (name, color, position, jira_project)
       VALUES ('Smoke time curadoria', '#be123c', 903, 'PIM') RETURNING id INTO v_team_cur;

  INSERT INTO public.sprints (code, quarter, start_date, end_date, days, position, jira_project)
       VALUES ('SMOKE-PIM', 'Q3', '2026-08-01', '2026-08-15', 15, 900, 'PIM')
    RETURNING id INTO v_sprint_pim;
  INSERT INTO public.sprints (code, quarter, start_date, end_date, days, position, jira_project)
       VALUES ('SMOKE-PH', 'Q3', '2026-08-01', '2026-08-15', 15, 901, 'PH')
    RETURNING id INTO v_sprint_ph;
  INSERT INTO public.sprints (code, quarter, start_date, end_date, days, position, jira_project)
       VALUES ('SMOKE-CUR', 'Q3', '2026-08-01', '2026-08-15', 15, 902, 'PIM')
    RETURNING id INTO v_sprint_cur;

  -- ---------- Seção 3 — Derivação por trigger ----------
  -- Envia 'PIM' de propósito num time do PH: o trigger tem de sobrescrever.
  INSERT INTO public.devs (name, initials, team_id, position, jira_project)
       VALUES ('Smoke Dev PH', 'SP', v_team_ph, 900, 'PIM')
    RETURNING id, jira_project INTO v_dev_ph, v_proj;
  IF v_proj IS DISTINCT FROM 'PH' THEN
    RAISE EXCEPTION 'FALHA 3.1: trigger não derivou o projeto do time (achou %)', v_proj;
  END IF;

  INSERT INTO public.devs (name, initials, team_id, position)
       VALUES ('Smoke Dev PIM', 'SD', v_team_pim, 901) RETURNING id INTO v_dev_pim;
  INSERT INTO public.devs (name, initials, team_id, position)
       VALUES ('Smoke Dev livre', 'SL', v_team_ph, 902) RETURNING id INTO v_dev_livre;
  INSERT INTO public.devs (name, initials, team_id, position)
       VALUES ('Smoke Dev curadoria', 'SC', v_team_cur, 903) RETURNING id INTO v_dev_cur;

  -- O cartão herda o projeto da pessoa, mesmo enviando outro.
  INSERT INTO public.allocations (sprint_id, dev_id, title, jira_project)
       VALUES (v_sprint_ph, v_dev_ph, 'Smoke cartão PH', 'PIM')
    RETURNING jira_project INTO v_proj;
  IF v_proj IS DISTINCT FROM 'PH' THEN
    RAISE EXCEPTION 'FALHA 3.2: trigger não derivou o projeto da pessoa (achou %)', v_proj;
  END IF;
  RAISE NOTICE 'Seção 3 OK';

  -- ---------- Seção 4 — Cartão cruzado ----------
  BEGIN
    INSERT INTO public.allocations (sprint_id, dev_id, title)
         VALUES (v_sprint_pim, v_dev_ph, 'Smoke cartão cruzado');
    RAISE EXCEPTION 'FALHA 4.1: cartão de pessoa do PH aceito em sprint do PIM';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'Seção 4 OK';

  -- ---------- Seção 5 — Drag cruzado ----------
  BEGIN
    UPDATE public.allocations SET sprint_id = v_sprint_pim WHERE dev_id = v_dev_ph;
    RAISE EXCEPTION 'FALHA 5.1: cartão do PH movido para sprint do PIM';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'Seção 5 OK';

  -- ---------- Seção 6 — Time troca de projeto ----------
  BEGIN
    UPDATE public.teams SET jira_project = 'PDC' WHERE id = v_team_pim;
    RAISE EXCEPTION 'FALHA 6.1: time com pessoas trocou de projeto';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  UPDATE public.teams SET jira_project = 'PDC' WHERE id = v_team_vazio;
  IF (SELECT jira_project FROM public.teams WHERE id = v_team_vazio) IS DISTINCT FROM 'PDC' THEN
    RAISE EXCEPTION 'FALHA 6.2: time sem pessoas não conseguiu trocar de projeto';
  END IF;
  RAISE NOTICE 'Seção 6 OK';

  -- ---------- Seção 7 — Pessoa troca de time ----------
  BEGIN
    UPDATE public.devs SET team_id = v_team_pim WHERE id = v_dev_ph;
    RAISE EXCEPTION 'FALHA 7.1: pessoa com alocações mudou para time de outro projeto';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  UPDATE public.devs SET team_id = v_team_pim WHERE id = v_dev_livre;
  IF (SELECT jira_project FROM public.devs WHERE id = v_dev_livre) IS DISTINCT FROM 'PIM' THEN
    RAISE EXCEPTION 'FALHA 7.2: pessoa sem alocações não migrou de projeto junto com o time';
  END IF;
  RAISE NOTICE 'Seção 7 OK';

  -- ---------- Seção 8 — Curadoria com FKs diferidas ----------
  INSERT INTO public.allocations (sprint_id, dev_id, title)
       VALUES (v_sprint_cur, v_dev_cur, 'Smoke cartão curadoria');
  BEGIN
    SET CONSTRAINTS ALL DEFERRED;
    UPDATE public.teams       SET jira_project = 'INTFLOW' WHERE id = v_team_cur;
    UPDATE public.devs        SET jira_project = 'INTFLOW' WHERE team_id = v_team_cur;
    UPDATE public.allocations SET jira_project = 'INTFLOW'
     WHERE dev_id IN (SELECT id FROM public.devs WHERE team_id = v_team_cur);
    UPDATE public.sprints     SET jira_project = 'INTFLOW' WHERE id = v_sprint_cur;
    -- Substitui o COMMIT: voltar as constraints para IMMEDIATE força a
    -- verificação do que ficou pendente, aqui e agora, sem sair da transação
    -- (o script termina em ROLLBACK).
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'FALHA 8.1: curadoria coerente recusada mesmo com SET CONSTRAINTS ALL DEFERRED';
  END;

  SELECT count(*) INTO v_count FROM public.allocations a
    JOIN public.sprints s ON s.id = a.sprint_id
   WHERE a.dev_id = v_dev_cur
     AND a.jira_project = 'INTFLOW'
     AND s.jira_project = 'INTFLOW';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 8.2: curadoria não deixou cartão e sprint no projeto de destino (achou %)', v_count;
  END IF;
  RAISE NOTICE 'Seção 8 OK';
END $$;

-- ============================================================
-- Seção 9 — Regressão de RLS: a coluna nova não abriu caminho novo
-- ============================================================
DO $$
DECLARE
  v_viewer uuid := '88888888-8888-8888-8888-888888888888';
  v_nobody uuid := '99999999-9999-9999-9999-999999999999';
  v_count int;
  v_total int;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_viewer, 'authenticated', 'authenticated',
     'smoke-proj-viewer@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_nobody, 'authenticated', 'authenticated',
     'smoke-proj-nobody@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES (v_viewer, 'viewer');

  -- 9.1 a 9.4 — sem papel, nenhuma das quatro tabelas devolve linha
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_nobody, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_count FROM public.teams;
  IF v_count <> 0 THEN RESET ROLE;
    RAISE EXCEPTION 'FALHA 9.1: sem papel leu % linha(s) de teams', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.devs;
  IF v_count <> 0 THEN RESET ROLE;
    RAISE EXCEPTION 'FALHA 9.2: sem papel leu % linha(s) de devs', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.sprints;
  IF v_count <> 0 THEN RESET ROLE;
    RAISE EXCEPTION 'FALHA 9.3: sem papel leu % linha(s) de sprints', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.allocations;
  IF v_count <> 0 THEN RESET ROLE;
    RAISE EXCEPTION 'FALHA 9.4: sem papel leu % linha(s) de allocations', v_count; END IF;

  RESET ROLE;

  -- 9.5 — viewer lê tudo o que existe: a RLS libera leitura, não filtra projeto
  SELECT count(*) INTO v_total FROM public.sprints;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.sprints;
  RESET ROLE;
  IF v_count <> v_total THEN
    RAISE EXCEPTION 'FALHA 9.5: viewer viu % sprints, esperado %', v_count, v_total;
  END IF;

  -- 9.6 — viewer continua sem escrever, inclusive enviando jira_project
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.teams (name, color, position, jira_project)
    VALUES ('Smoke viewer', '#475569', 950, 'PIM');
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 9.6: viewer inseriu time sob RLS real';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;

  RAISE NOTICE 'Seção 9 OK';
END $$;

ROLLBACK;
