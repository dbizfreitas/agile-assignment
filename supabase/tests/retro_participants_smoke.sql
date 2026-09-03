-- supabase/tests/retro_participants_smoke.sql
-- Suíte de verificação de participantes/sorteio de Retrospectivas (issue #24).
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura e seed
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

  SELECT count(*) INTO v_count FROM public.retro_participants;
  IF v_count <> 20 THEN
    RAISE EXCEPTION 'FALHA 1.3: esperava 20 participantes no seed, achou %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.retro_roulette_state;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 1.4: retro_roulette_state deveria ter exatamente 1 linha, tem %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.retro_participants WHERE email = 'bruno@shippit.app' AND color = '#0ea5e9'
  ) THEN
    RAISE EXCEPTION 'FALHA 1.5: participante externo (Shippit) sem a cor fixa esperada';
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
-- Seção 3 — RPCs do sorteio
-- ============================================================
DO $$
DECLARE
  v_editor uuid := 'b1111111-1111-1111-1111-111111111111';
  v_viewer uuid := 'b3333333-3333-3333-3333-333333333333';
  v_winner text;
  v_state record;
BEGIN
  -- 3.1 — viewer (só rota, sem papel de editor) não consegue sortear
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.spin_roulette();
    RAISE EXCEPTION 'FALHA 3.1: viewer conseguiu chamar spin_roulette';
  EXCEPTION WHEN sqlstate 'W2001' THEN NULL;
  END;

  -- 3.2 — editor com rota consegue sortear, e o vencedor é um dos 20 seed
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  v_winner := public.spin_roulette();
  IF NOT EXISTS (SELECT 1 FROM public.retro_participants WHERE email = v_winner) THEN
    RAISE EXCEPTION 'FALHA 3.2: spin_roulette retornou e-mail fora da tabela de participantes: %', v_winner;
  END IF;

  SELECT * INTO v_state FROM public.retro_roulette_state;
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
    v_winner2 := public.spin_roulette();
    IF v_winner2 = v_winner THEN
      RAISE EXCEPTION 'FALHA 3.5: spin_roulette sorteou o mesmo vencedor duas vezes seguidas';
    END IF;
  END;

  -- 3.6 — skip_participant marca ausente, e o ausente não é mais elegível
  PERFORM public.skip_participant('andre.secco@way2.com.br');
  SELECT * INTO v_state FROM public.retro_roulette_state;
  IF NOT ('andre.secco@way2.com.br' = ANY(v_state.skipped_emails)) THEN
    RAISE EXCEPTION 'FALHA 3.6: skip_participant não marcou o e-mail como ausente';
  END IF;

  -- 3.7 — reset_roulette zera os três campos
  PERFORM public.reset_roulette();
  SELECT * INTO v_state FROM public.retro_roulette_state;
  IF array_length(v_state.drawn_emails, 1) IS NOT NULL
     OR array_length(v_state.skipped_emails, 1) IS NOT NULL
     OR v_state.last_winner_email IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 3.7: reset_roulette não zerou o estado';
  END IF;

  -- 3.8 — sortear com todos os 20 já sorteados/ausentes lança W2402
  UPDATE public.retro_roulette_state
     SET drawn_emails = (SELECT array_agg(email) FROM public.retro_participants);
  BEGIN
    PERFORM public.spin_roulette();
    RAISE EXCEPTION 'FALHA 3.8: spin_roulette não lançou erro com todos já sorteados';
  EXCEPTION WHEN sqlstate 'W2402' THEN NULL;
  END;

  RAISE NOTICE 'Seção 3 OK';
END $$;

-- ============================================================
-- Seção 4 — regressão do achado de code review do PR #38: as 5 RPCs do
-- sorteio travam a linha singleton (SELECT ... FOR UPDATE) antes de ler
-- drawn_emails/skipped_emails, para que duas chamadas concorrentes não
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
      ('spin_roulette', 'public.spin_roulette()'::regprocedure),
      ('skip_participant', 'public.skip_participant(text)'::regprocedure),
      ('unskip_participant', 'public.unskip_participant(text)'::regprocedure),
      ('unmark_participant', 'public.unmark_participant(text)'::regprocedure),
      ('reset_roulette', 'public.reset_roulette()'::regprocedure)
    ) AS t(name, sig)
  LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = r.sig;
    IF v_src IS NULL OR v_src NOT ILIKE '%FOR UPDATE%' THEN
      RAISE EXCEPTION 'FALHA 4.1: % não trava a linha singleton (sem FOR UPDATE no corpo) — corrida entre chamadas concorrentes pode sortear/mutar em cima de estado obsoleto', r.name;
    END IF;
  END LOOP;

  RAISE NOTICE 'Seção 4 OK';
END $$;

ROLLBACK;
