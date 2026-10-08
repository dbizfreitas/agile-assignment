-- supabase/tests/retro_participants_smoke.sql
-- Suíte de verificação de participantes/sorteio de Retrospectivas (issue #24),
-- já no esquema por projeto (migration 20261008120000_retro_por_projeto.sql).
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura e dados por projeto
-- ============================================================
DO $$
DECLARE
  v_count int;
BEGIN
  IF to_regclass('public.retro_participants') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.1: tabela public.retro_participants não existe';
  END IF;
  IF to_regclass('public.retro_roulette_state') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.2: tabela public.retro_roulette_state não existe';
  END IF;

  -- A migration 20261008120000 atribui tudo o que existia ao projeto PIM e a
  -- coluna é NOT NULL: nenhum participante pode ficar sem projeto. Não há
  -- contagem fixa: a lista muda por edição manual no banco.
  SELECT count(*) INTO v_count FROM public.retro_participants WHERE jira_project IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 1.3: % participante(s) sem jira_project', v_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.retro_roulette_state WHERE jira_project = 'PIM') THEN
    RAISE EXCEPTION 'FALHA 1.4: retro_roulette_state sem a linha do projeto PIM';
  END IF;

  RAISE NOTICE 'Seção 1 OK';
END $$;

-- ============================================================
-- Seção 2 — helpers can_view_retrospectivas / can_edit_retrospectivas e
-- isolamento de ms_graph_token (mesmo padrão de
-- alocacoes_auth_helpers_smoke.sql)
-- ============================================================
DO $$
DECLARE
  v_editor_com_rota uuid := 'b1111111-1111-1111-1111-111111111111';
  v_editor_sem_rota uuid := 'b2222222-2222-2222-2222-222222222222';
  v_viewer_com_rota uuid := 'b3333333-3333-3333-3333-333333333333';
  v_count int;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at, raw_app_meta_data,
     raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_editor_com_rota, 'authenticated', 'authenticated',
     'retro-smoke-1@test.local', '', now(), now(), now(), '{}', '{}', false),
    ('00000000-0000-0000-0000-000000000000', v_editor_sem_rota, 'authenticated', 'authenticated',
     'retro-smoke-2@test.local', '', now(), now(), now(), '{}', '{}', false),
    ('00000000-0000-0000-0000-000000000000', v_viewer_com_rota, 'authenticated', 'authenticated',
     'retro-smoke-3@test.local', '', now(), now(), now(), '{}', '{}', false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_editor_com_rota, 'editor'), (v_editor_sem_rota, 'editor'), (v_viewer_com_rota, 'viewer');

  INSERT INTO public.user_route_access (user_id, route) VALUES
    (v_editor_com_rota, 'retrospectivas'), (v_viewer_com_rota, 'retrospectivas');
  -- v_editor_sem_rota fica sem linha, de propósito.

  ASSERT private.can_edit_retrospectivas(v_editor_com_rota) = true,
    'Seção 2: editor com rota deveria poder editar retrospectivas';
  ASSERT private.can_edit_retrospectivas(v_editor_sem_rota) = false,
    'Seção 2: editor sem rota NÃO deveria poder editar retrospectivas';
  ASSERT private.can_view_retrospectivas(v_viewer_com_rota) = true,
    'Seção 2: viewer com rota deveria poder VER retrospectivas';
  ASSERT private.can_edit_retrospectivas(v_viewer_com_rota) = false,
    'Seção 2: viewer com rota NÃO deveria poder editar retrospectivas';

  -- ms_graph_token: RLS ligado, zero policies — usuário comum não lê nada,
  -- mesmo sendo admin de papel (o isolamento aqui não depende de papel).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor_com_rota, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.ms_graph_token;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 2.1: usuário authenticated leu % linha(s) de ms_graph_token — deveria ser zero (sem policies)', v_count;
  END IF;

  RAISE NOTICE 'Seção 2 OK';
END $$;

-- ============================================================
-- Seção 3 — RPCs do sorteio (projeto PIM)
-- ============================================================
DO $$
DECLARE
  v_editor uuid := 'b1111111-1111-1111-1111-111111111111';
  v_viewer uuid := 'b3333333-3333-3333-3333-333333333333';
  v_winner text;
  v_state record;
BEGIN
  -- Parte de um estado zerado do PIM: a suíte não depende de como o sorteio
  -- real estava (o ROLLBACK final desfaz tudo mesmo assim).
  UPDATE public.retro_roulette_state
     SET drawn_emails = '{}', skipped_emails = '{}', last_winner_email = NULL
   WHERE jira_project = 'PIM';

  -- 3.1 — viewer (só rota, sem papel de editor) não consegue sortear
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.spin_roulette('PIM');
    RAISE EXCEPTION 'FALHA 3.1: viewer conseguiu chamar spin_roulette';
  EXCEPTION WHEN sqlstate 'W2001' THEN NULL;
  END;

  -- 3.2 — editor com rota consegue sortear, e o vencedor é do PIM
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  v_winner := public.spin_roulette('PIM');
  IF NOT EXISTS (
    SELECT 1 FROM public.retro_participants WHERE email = v_winner AND jira_project = 'PIM'
  ) THEN
    RAISE EXCEPTION 'FALHA 3.2: spin_roulette retornou e-mail fora dos participantes do PIM: %', v_winner;
  END IF;

  SELECT * INTO v_state FROM public.retro_roulette_state WHERE jira_project = 'PIM';
  IF NOT (v_winner = ANY(v_state.drawn_emails)) THEN
    RAISE EXCEPTION 'FALHA 3.3: vencedor não foi adicionado a drawn_emails';
  END IF;
  IF v_state.last_winner_email <> v_winner THEN
    RAISE EXCEPTION 'FALHA 3.4: last_winner_email não foi atualizado para o vencedor';
  END IF;

  -- 3.5 — sortear de novo nunca repete quem já foi sorteado
  DECLARE
    v_winner2 text;
  BEGIN
    v_winner2 := public.spin_roulette('PIM');
    IF v_winner2 = v_winner THEN
      RAISE EXCEPTION 'FALHA 3.5: spin_roulette sorteou o mesmo vencedor duas vezes seguidas';
    END IF;
  END;

  -- 3.6 — skip_participant marca ausente, e o ausente não é mais elegível
  PERFORM public.skip_participant('PIM', 'andre.secco@way2.com.br');
  SELECT * INTO v_state FROM public.retro_roulette_state WHERE jira_project = 'PIM';
  IF NOT ('andre.secco@way2.com.br' = ANY(v_state.skipped_emails)) THEN
    RAISE EXCEPTION 'FALHA 3.6: skip_participant não marcou o e-mail como ausente';
  END IF;

  -- 3.7 — reset_roulette zera os três campos
  PERFORM public.reset_roulette('PIM');
  SELECT * INTO v_state FROM public.retro_roulette_state WHERE jira_project = 'PIM';
  IF array_length(v_state.drawn_emails, 1) IS NOT NULL
     OR array_length(v_state.skipped_emails, 1) IS NOT NULL
     OR v_state.last_winner_email IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 3.7: reset_roulette não zerou o estado';
  END IF;

  -- 3.8 — sortear com todos do PIM já sorteados/ausentes lança W2402
  UPDATE public.retro_roulette_state
     SET drawn_emails = (
       SELECT array_agg(email) FROM public.retro_participants WHERE jira_project = 'PIM')
   WHERE jira_project = 'PIM';
  BEGIN
    PERFORM public.spin_roulette('PIM');
    RAISE EXCEPTION 'FALHA 3.8: spin_roulette não lançou erro com todos já sorteados';
  EXCEPTION WHEN sqlstate 'W2402' THEN NULL;
  END;

  RAISE NOTICE 'Seção 3 OK';
END $$;

-- ============================================================
-- Seção 4 — regressão do achado de code review do PR #38: as 5 RPCs do
-- sorteio travam a linha de estado do projeto (SELECT ... FOR UPDATE) antes
-- de ler drawn_emails/skipped_emails, para que duas chamadas concorrentes não
-- possam sortear o mesmo vencedor sob READ COMMITTED. Uma corrida real
-- exige duas conexões simultâneas, que este formato de smoke test (uma
-- sessão, BEGIN/ROLLBACK) não reproduz — em vez disso, confirma
-- estruturalmente que o lock existe no corpo de cada função, o que é a
-- garantia real por trás da correção (a fonte da função é o que executa
-- em produção, não um teste de timing frágil).
-- ============================================================
DO $$
DECLARE
  r record;
  v_src text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('spin_roulette', 'public.spin_roulette(text)'::regprocedure),
      ('skip_participant', 'public.skip_participant(text, text)'::regprocedure),
      ('unskip_participant', 'public.unskip_participant(text, text)'::regprocedure),
      ('unmark_participant', 'public.unmark_participant(text, text)'::regprocedure),
      ('reset_roulette', 'public.reset_roulette(text)'::regprocedure)
    ) AS t(name, sig)
  LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = r.sig;
    IF v_src IS NULL OR v_src NOT ILIKE '%FOR UPDATE%' THEN
      RAISE EXCEPTION 'FALHA 4.1: % não trava a linha de estado do projeto (sem FOR UPDATE no corpo) — corrida entre chamadas concorrentes pode sortear/mutar em cima de estado obsoleto', r.name;
    END IF;
  END LOOP;

  RAISE NOTICE 'Seção 4 OK';
END $$;

-- ============================================================
-- Seção 5 — Isolamento entre projetos: cada projeto tem a sua lista e o seu
-- estado de sorteio. Usa projetos fictícios (ZZTEST, ZZTEST2) para não
-- depender de quem está cadastrado nos projetos reais.
-- ============================================================
DO $$
DECLARE
  v_editor uuid := 'b1111111-1111-1111-1111-111111111111';
  v_winner text;
  v_pim_antes record;
  v_pim_depois record;
  v_state record;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);

  INSERT INTO public.retro_participants (name, email, sort_order, jira_project) VALUES
    ('Teste Um', 'zztest.um@test.local', 0, 'ZZTEST'),
    ('Teste Dois', 'zztest.dois@test.local', 1, 'ZZTEST');

  -- Garante um estado de PIM não trivial para provar que ele não muda.
  PERFORM public.skip_participant('PIM', 'andre.secco@way2.com.br');
  SELECT * INTO v_pim_antes FROM public.retro_roulette_state WHERE jira_project = 'PIM';

  -- 5.1/5.2 — o estado do projeto novo nasce sob demanda no primeiro uso
  IF EXISTS (SELECT 1 FROM public.retro_roulette_state WHERE jira_project = 'ZZTEST') THEN
    RAISE EXCEPTION 'FALHA 5.1: ZZTEST não deveria ter estado antes do primeiro uso';
  END IF;
  v_winner := public.spin_roulette('ZZTEST');
  IF NOT EXISTS (SELECT 1 FROM public.retro_roulette_state WHERE jira_project = 'ZZTEST') THEN
    RAISE EXCEPTION 'FALHA 5.2: spin_roulette não criou o estado de ZZTEST sob demanda';
  END IF;

  -- 5.3/5.4 — o vencedor é de ZZTEST, nunca de outro projeto
  IF v_winner NOT IN ('zztest.um@test.local', 'zztest.dois@test.local') THEN
    RAISE EXCEPTION 'FALHA 5.3: vencedor de ZZTEST veio de fora do projeto: %', v_winner;
  END IF;
  SELECT * INTO v_state FROM public.retro_roulette_state WHERE jira_project = 'ZZTEST';
  IF NOT (v_winner = ANY(v_state.drawn_emails)) THEN
    RAISE EXCEPTION 'FALHA 5.4: vencedor não foi gravado no estado de ZZTEST';
  END IF;

  -- 5.5 — o estado do PIM não mudou com o sorteio de ZZTEST
  SELECT * INTO v_pim_depois FROM public.retro_roulette_state WHERE jira_project = 'PIM';
  IF v_pim_depois.drawn_emails IS DISTINCT FROM v_pim_antes.drawn_emails
     OR v_pim_depois.skipped_emails IS DISTINCT FROM v_pim_antes.skipped_emails
     OR v_pim_depois.last_winner_email IS DISTINCT FROM v_pim_antes.last_winner_email THEN
    RAISE EXCEPTION 'FALHA 5.5: sortear em ZZTEST alterou o estado do PIM';
  END IF;

  -- 5.6/5.7 — reset de ZZTEST não zera o PIM
  PERFORM public.reset_roulette('ZZTEST');
  SELECT * INTO v_state FROM public.retro_roulette_state WHERE jira_project = 'ZZTEST';
  IF array_length(v_state.drawn_emails, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 5.6: reset_roulette(ZZTEST) não zerou o estado de ZZTEST';
  END IF;
  SELECT * INTO v_pim_depois FROM public.retro_roulette_state WHERE jira_project = 'PIM';
  IF v_pim_depois.skipped_emails IS DISTINCT FROM v_pim_antes.skipped_emails THEN
    RAISE EXCEPTION 'FALHA 5.7: reset_roulette(ZZTEST) alterou o estado do PIM';
  END IF;

  -- 5.8 — projeto fora do formato (minúsculo) é rejeitado
  BEGIN
    PERFORM public.spin_roulette('pim');
    RAISE EXCEPTION 'FALHA 5.8: spin_roulette aceitou projeto em minúsculas';
  EXCEPTION WHEN sqlstate 'W2403' THEN NULL;
  END;

  -- 5.9 — a mesma pessoa pode estar em dois projetos, mas não duas vezes no
  -- mesmo (UNIQUE (jira_project, email))
  INSERT INTO public.retro_participants (name, email, sort_order, jira_project)
  VALUES ('Teste Um', 'zztest.um@test.local', 0, 'ZZTEST2');
  BEGIN
    INSERT INTO public.retro_participants (name, email, sort_order, jira_project)
    VALUES ('Teste Um', 'zztest.um@test.local', 0, 'ZZTEST2');
    RAISE EXCEPTION 'FALHA 5.9: e-mail repetido no mesmo projeto foi aceito';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'Seção 5 OK';
END $$;

ROLLBACK;
