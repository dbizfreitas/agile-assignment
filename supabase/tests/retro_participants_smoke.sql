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

ROLLBACK;
