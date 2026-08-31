-- Suite de verificacao dos helpers private.can_view_alocacoes /
-- can_edit_alocacoes (achado do code review do PR #33, migration
-- 20260831140000_alocacoes_auth_helpers.sql).
-- Roda inteiramente dentro de uma transacao com ROLLBACK: nao deixa residuo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Secao N OK' por secao.
-- Falha = ERROR: com a mensagem do ASSERT que falhou.
BEGIN;

SET LOCAL plpgsql.check_asserts = on;

-- ============================================================
-- Secao 1 -- setup: quatro atores cobrindo as quatro combinacoes de
-- papel x rota que importam para os dois helpers
-- ============================================================
DO $$
DECLARE
  v_editor_com_rota uuid := 'a1111111-1111-1111-1111-111111111111';
  v_editor_sem_rota uuid := 'a2222222-2222-2222-2222-222222222222';
  v_sem_papel_com_rota uuid := 'a3333333-3333-3333-3333-333333333333';
  v_viewer_com_rota uuid := 'a4444444-4444-4444-4444-444444444444';
BEGIN
  -- auth.users e obrigatorio: user_roles.user_id tem FK para auth.users
  -- (20260809100000_rbac_user_roles_fk.sql). v_sem_papel_com_rota nao
  -- recebe user_roles, entao tambem nao precisa de auth.users -- mas
  -- ganha mesmo assim, por simetria e para poder ter rota em
  -- user_route_access (que tambem referencia auth.users).
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at, raw_app_meta_data,
     raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_editor_com_rota, 'authenticated', 'authenticated',
     'auth-helpers-smoke-1@test.local', '', now(), now(), now(), '{}', '{}', false),
    ('00000000-0000-0000-0000-000000000000', v_editor_sem_rota, 'authenticated', 'authenticated',
     'auth-helpers-smoke-2@test.local', '', now(), now(), now(), '{}', '{}', false),
    ('00000000-0000-0000-0000-000000000000', v_sem_papel_com_rota, 'authenticated', 'authenticated',
     'auth-helpers-smoke-3@test.local', '', now(), now(), now(), '{}', '{}', false),
    ('00000000-0000-0000-0000-000000000000', v_viewer_com_rota, 'authenticated', 'authenticated',
     'auth-helpers-smoke-4@test.local', '', now(), now(), now(), '{}', '{}', false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_editor_com_rota, 'editor'),
    (v_editor_sem_rota, 'editor'),
    (v_viewer_com_rota, 'viewer');
  -- v_sem_papel_com_rota fica sem linha em user_roles, de proposito.

  INSERT INTO public.user_route_access (user_id, route) VALUES
    (v_editor_com_rota, 'alocacoes'),
    (v_sem_papel_com_rota, 'alocacoes'),
    (v_viewer_com_rota, 'alocacoes');
  -- v_editor_sem_rota fica sem linha em user_route_access, de proposito.

  RAISE NOTICE 'Secao 1 OK';
END $$;

-- ============================================================
-- Secao 2 -- editor com a rota: os dois helpers retornam true
-- ============================================================
DO $$
DECLARE
  v_actor uuid := 'a1111111-1111-1111-1111-111111111111';
BEGIN
  ASSERT private.can_edit_alocacoes(v_actor) = true,
    'Secao 2: editor com rota deveria poder EDITAR alocacoes';
  ASSERT private.can_view_alocacoes(v_actor) = true,
    'Secao 2: editor com rota deveria poder VER alocacoes';

  RAISE NOTICE 'Secao 2 OK';
END $$;

-- ============================================================
-- Secao 3 -- editor SEM a rota: os dois helpers retornam false -- este e
-- o caso que a primeira versao de delete_team deixava passar
-- ============================================================
DO $$
DECLARE
  v_actor uuid := 'a2222222-2222-2222-2222-222222222222';
BEGIN
  ASSERT private.can_edit_alocacoes(v_actor) = false,
    'Secao 3: editor sem rota NAO deveria poder editar alocacoes';
  ASSERT private.can_view_alocacoes(v_actor) = false,
    'Secao 3: editor sem rota NAO deveria poder ver alocacoes';

  RAISE NOTICE 'Secao 3 OK';
END $$;

-- ============================================================
-- Secao 4 -- sem papel algum, com a rota: os dois helpers retornam false
-- (can_view_board/can_edit_board exigem alguma linha em user_roles)
-- ============================================================
DO $$
DECLARE
  v_actor uuid := 'a3333333-3333-3333-3333-333333333333';
BEGIN
  ASSERT private.can_edit_alocacoes(v_actor) = false,
    'Secao 4: sem papel algum NAO deveria poder editar alocacoes';
  ASSERT private.can_view_alocacoes(v_actor) = false,
    'Secao 4: sem papel algum NAO deveria poder ver alocacoes';

  RAISE NOTICE 'Secao 4 OK';
END $$;

-- ============================================================
-- Secao 5 -- viewer (papel existe, mas nao e editor) com a rota: os dois
-- helpers respondem DIFERENTE -- prova que checam papeis diferentes,
-- nao a mesma coisa disfarcada de dois nomes
-- ============================================================
DO $$
DECLARE
  v_actor uuid := 'a4444444-4444-4444-4444-444444444444';
BEGIN
  ASSERT private.can_view_alocacoes(v_actor) = true,
    'Secao 5: viewer com rota deveria poder VER alocacoes';
  ASSERT private.can_edit_alocacoes(v_actor) = false,
    'Secao 5: viewer com rota NAO deveria poder editar alocacoes';

  RAISE NOTICE 'Secao 5 OK';
END $$;

ROLLBACK;
