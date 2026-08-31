-- Suíte de verificação de permissões por rota (issue #23).
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
--
-- ORDEM DAS SEÇÕES: a Seção 0 TEM de continuar sendo a primeira. Ela audita
-- o estado real do banco e só é válida enquanto nenhum fixture existe — as
-- seções seguintes criam usuários de teste, e a 5.6 fabrica um órfão de
-- propósito. Mover a Seção 0 para baixo faria ela acusar esses fixtures como
-- defeito de produção, com uma mensagem de erro que aponta para o lugar
-- errado. Seções novas entram DEPOIS dela.
BEGIN;

-- ============================================================
-- Seção 0 — Pós-condição da limpeza de órfãos (Finding I-2)
-- ============================================================
-- A migration 20260828134000 fez uma limpeza única das linhas de
-- user_route_access cujo usuário não tem papel. Nada verificava que ela
-- realmente zerou — e órfãos são silenciosos: não quebram nada hoje (a
-- policy de SELECT exige papel E rota), mas voltariam a conceder rotas
-- sozinhos se o usuário fosse reativado, sem passar por set_user_routes e
-- sem deixar 'route_grant' na auditoria.
--
-- Roda PRIMEIRO, antes de qualquer seção criar fixtures. Isso é o que torna
-- a asserção simples e sem manutenção: neste ponto da transação só existem
-- as linhas reais do banco, então não é preciso excluir uuid de teste algum
-- (a Seção 5.6, por exemplo, fabrica um órfão de propósito mais adiante).
--
-- Nem todo órfão é necessariamente bug: set_user_routes NÃO exige que o
-- alvo já tenha papel, então um admin chamando a RPC direto pela API (a UI
-- desabilita o toggle quando role é null — UserTable.tsx) criaria uma linha
-- órfã legítima. Isso não é fluxo suportado hoje; se esta seção falhar,
-- confirmar de qual caminho vieram as linhas antes de concluir que a
-- limpeza de 20260828134000 falhou.
-- ============================================================
DO $$
DECLARE
  v_orfaos int;
BEGIN
  SELECT count(*) INTO v_orfaos
    FROM public.user_route_access ura
   WHERE NOT EXISTS (
           SELECT 1 FROM public.user_roles ur WHERE ur.user_id = ura.user_id
         );

  IF v_orfaos <> 0 THEN
    RAISE EXCEPTION 'FALHA 0.1: % linha(s) órfã(s) em user_route_access (usuário sem papel). A limpeza de 20260828134000 não rodou, ou algo voltou a criar órfãos — investigar antes de reativar qualquer usuário', v_orfaos;
  END IF;

  RAISE NOTICE 'Seção 0 OK';
END $$;

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

  -- 1.12 — array VAZIO revoga tudo. É um caso de borda de verdade, não uma
  -- variação de 1.10: `route <> ALL('{}')` é vacuamente verdadeiro para toda
  -- linha, então o DELETE apaga tudo, e `unnest('{}')` não insere nada. Se
  -- alguém trocar o `<> ALL` por outra construção (um NOT IN, por exemplo,
  -- que com conjunto vazio se comporta diferente), a revogação total quebra
  -- silenciosamente e nenhuma outra asserção pegaria.
  PERFORM public.set_user_routes(v_target, ARRAY[]::public.app_route[]);
  SELECT count(*) INTO v_count FROM public.user_route_access WHERE user_id = v_target;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 1.12: array vazio deveria revogar todas as rotas, restaram %', v_count;
  END IF;

  -- 1.13 — RLS da própria user_route_access: cada um enxerga só as suas
  -- linhas. As asserções acima passam por private.has_route, que é
  -- SECURITY DEFINER e IGNORA RLS — ou seja, nada até aqui exercita as
  -- policies route_access_select_own/_admin de fato.
  PERFORM public.set_user_routes(v_target, ARRAY['alocacoes']::public.app_route[]);

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_target, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.user_route_access;
  RESET ROLE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 1.13: usuário comum deveria ver só a própria rota (1), viu %', v_count;
  END IF;

  -- 1.14 — e o admin enxerga as linhas de terceiros (policy _select_admin).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.user_route_access WHERE user_id = v_target;
  RESET ROLE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 1.14: admin deveria enxergar a rota de outro usuário, viu %', v_count;
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

  -- 2.4 — leitura: editor COM rota alocacoes LÊ devs sob RLS real.
  -- Contraponto positivo de 2.1: sem esta asserção, uma policy de SELECT
  -- quebrada (que negasse a TODO mundo) passaria na suíte, porque 2.1 só
  -- prova que quem não tem rota é barrado. 2.3 cobre o lado positivo da
  -- ESCRITA; este cobre o da LEITURA, que é uma policy diferente.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor_com_rota, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.devs;
  RESET ROLE;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'FALHA 2.4: editor com papel e rota alocacoes não leu nenhuma linha de devs — a policy de SELECT está negando a quem deveria permitir';
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

-- ============================================================
-- Seção 4 — Convite com rotas (Task 4)
-- ============================================================
DO $$
DECLARE
  v_admin uuid := 'a1111111-1111-1111-1111-111111111111';
  v_invited uuid := 'a7777777-7777-7777-7777-777777777777';
  v_custom uuid := 'a8888888-8888-8888-8888-888888888888';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- 4.1 — convite sem _routes usa o default (alocacoes)
  PERFORM public.create_invitation('route-smoke-invited@test.local', 'viewer'::public.app_role);
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_invited, 'authenticated', 'authenticated',
     'route-smoke-invited@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  IF NOT private.has_route(v_invited, 'alocacoes'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 4.1: usuário novo sem _routes explícito não recebeu alocacoes';
  END IF;
  IF private.has_route(v_invited, 'compromisso'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 4.2: usuário novo recebeu rota além do default';
  END IF;

  -- 4.3 — convite com _routes customizado propaga na criação do usuário
  PERFORM public.create_invitation(
    'route-smoke-custom@test.local', 'editor'::public.app_role,
    ARRAY['compromisso', 'cycle-time']::public.app_route[]
  );
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_custom, 'authenticated', 'authenticated',
     'route-smoke-custom@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  IF private.has_route(v_custom, 'alocacoes'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 4.3: usuário com _routes customizado recebeu alocacoes indevidamente';
  END IF;
  IF NOT private.has_route(v_custom, 'compromisso'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 4.4: usuário com _routes customizado não recebeu compromisso';
  END IF;
  IF NOT private.has_route(v_custom, 'cycle-time'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 4.5: usuário com _routes customizado não recebeu cycle-time';
  END IF;

  RAISE NOTICE 'Seção 4 OK';
END $$;

-- ============================================================
-- Seção 5 — Regressão do Finding C1: leitura não pode sobreviver à
-- revogação do papel (fix em 20260828134000_route_access_fix_read_requires_role.sql)
-- ============================================================
DO $$
DECLARE
  v_admin uuid := 'a1111111-1111-1111-1111-111111111111';
  v_revoked uuid := 'a9999999-9999-9999-9999-999999999999';
  v_count int;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_revoked, 'authenticated', 'authenticated',
     'route-smoke-revoked@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- Setup: papel editor + rota alocacoes, via os mesmos caminhos que o
  -- restante da app usa (set_user_role e set_user_routes).
  PERFORM public.set_user_role(v_revoked, 'editor'::public.app_role);
  PERFORM public.set_user_routes(v_revoked, ARRAY['alocacoes']::public.app_route[]);

  -- 5.1 — confirma que, ANTES da revogação, a leitura sob RLS real funciona
  -- (mesmo idioma da Seção 2: SET LOCAL ROLE + request.jwt.claims).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_revoked, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.devs;
  RESET ROLE;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'FALHA 5.1: usuário com papel editor + rota alocacoes não leu nenhuma linha de devs (setup da seção está errado)';
  END IF;

  -- Revoga o papel por completo, como um admin faz em /admin ao definir
  -- "Sem acesso". Esta é a operação que, antes do fix, deixava
  -- user_route_access intacto.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.set_user_role(v_revoked, NULL);

  -- 5.2 — a regressão em si: leitura sob RLS real agora tem que voltar a
  -- zero linhas, não mais "acesso negado só na UI".
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_revoked, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.devs;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 5.2: usuário com papel revogado ainda leu % linha(s) de devs sob RLS real', v_count;
  END IF;

  -- 5.3 — prova de que o cascade delete realmente rodou (não é a policy
  -- fechando por outro motivo).
  IF private.has_route(v_revoked, 'alocacoes'::public.app_route) THEN
    RAISE EXCEPTION 'FALHA 5.3: has_route ainda retorna true após set_user_role(NULL) — cascade não rodou';
  END IF;

  -- 5.4 — a revogação de papel foi auditada...
  SELECT count(*) INTO v_count FROM public.role_audit_log
   WHERE target_user_id = v_revoked AND action = 'revoke' AND actor_user_id = v_admin;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 5.4: role_revoke (action=revoke) não registrado para o papel (achou %)', v_count;
  END IF;

  -- 5.5 — ...e o cascade de rota também, atribuído ao mesmo ator (prova que
  -- app.actor_id ainda estava setado quando o DELETE em user_route_access
  -- rodou dentro de set_user_role).
  SELECT count(*) INTO v_count FROM public.role_audit_log
   WHERE target_user_id = v_revoked AND action = 'route_revoke'
     AND route = 'alocacoes'::public.app_route AND actor_user_id = v_admin;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 5.5: route_revoke não registrado para o cascade de rota (achou %)', v_count;
  END IF;

  RAISE NOTICE 'Seção 5 OK';
END $$;

-- ============================================================
-- Seção 5.6 — Finding I-1: isola a metade "policy de RLS" do fix da
-- metade "cascade delete". A 5.1-5.5 acima só passa por set_user_role(NULL),
-- que APAGA a linha de rota junto — então aquele teste passaria mesmo se a
-- policy de SELECT tivesse ficado no has_route(...) antigo (sem exigir
-- papel), porque a rota já não existe mais quando 5.2 roda. Isso nunca
-- exercita o estado "tem rota, mas não tem papel" — que é exatamente o
-- estado em que TODO usuário já desativado antes deste fix se encontra
-- hoje em produção (rota do backfill original, papel já removido por um
-- set_user_role antigo, sem a correção do item 2 desta migration), e é
-- exatamente o que a metade "policy" do fix (item 1), e não a metade
-- "cascade" (item 2), tem que barrar sozinha.
-- ============================================================
DO $$
DECLARE
  v_admin uuid := 'a1111111-1111-1111-1111-111111111111';
  v_orphan uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_count int;
  v_has_route boolean;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_orphan, 'authenticated', 'authenticated',
     'route-smoke-orphan-route@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- Setup normal: papel + rota, pelos caminhos oficiais da app.
  PERFORM public.set_user_role(v_orphan, 'editor'::public.app_role);
  PERFORM public.set_user_routes(v_orphan, ARRAY['alocacoes']::public.app_route[]);

  -- Bypass deliberado do cascade: DELETE cru em user_roles, NUNCA passando
  -- por set_user_role. A linha de user_route_access sobrevive, porque só
  -- set_user_role (item 2 do fix) apaga user_route_access, e ele não foi
  -- chamado aqui.
  DELETE FROM public.user_roles WHERE user_id = v_orphan;

  -- 5.6a — a rota sobreviveu ao DELETE cru (prova que não foi um cascade
  -- automático de FK ou trigger apagando a rota por baixo dos panos).
  v_has_route := private.has_route(v_orphan, 'alocacoes'::public.app_route);
  IF NOT v_has_route THEN
    RAISE EXCEPTION 'FALHA 5.6a: has_route retornou false — a rota não deveria ter sido removida pelo DELETE cru em user_roles (setup do teste está errado)';
  END IF;

  -- 5.6b — mesmo com has_route = true, a leitura sob RLS real tem que ser
  -- zero: só a policy (papel E rota), e não a ausência da rota, pode estar
  -- barreando aqui.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_orphan, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.devs;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 5.6b: usuário sem papel mas com rota alocacoes ainda leu % linha(s) de devs — a policy de SELECT não está exigindo can_view_board(...) além de has_route(...)', v_count;
  END IF;

  RAISE NOTICE 'Seção 5.6 OK';
END $$;

-- ============================================================
-- Seção 6 — Guarda W2004 (uuid inexistente em set_user_role)
-- ============================================================
-- Esta guarda já foi perdida silenciosamente UMA VEZ: a primeira versão da
-- migration 20260828134000 reconstruiu set_user_role a partir de um corpo
-- superado (20260808121000) em vez do corpo em produção (20260809100000),
-- e teria revertido a guarda. Só foi pego por revisão manual, linha a linha.
-- Nada na suíte pegaria uma terceira perda — esta seção é essa rede.
-- ============================================================
DO $$
DECLARE
  v_admin uuid := 'a1111111-1111-1111-1111-111111111111';
  v_inexistente uuid := 'deadbeef-0000-0000-0000-000000000000';
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- 6.1 — conceder papel a um uuid que não existe em auth.users tem que
  -- levantar W2004 ('Usuário não encontrado'), não um 23503 cru de FK.
  -- A diferença importa: W2004 é mapeado para mensagem legível em
  -- src/lib/admin-errors.ts; a violação de FK vazaria texto do Postgres
  -- para a tela do admin.
  BEGIN
    PERFORM public.set_user_role(v_inexistente, 'viewer'::public.app_role);
    RAISE EXCEPTION 'FALHA 6.1: set_user_role aceitou um uuid inexistente — a guarda W2004 sumiu do corpo da função';
  EXCEPTION
    WHEN sqlstate 'W2004' THEN NULL;
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'FALHA 6.1: a FK barrou (23503), mas a guarda W2004 não rodou antes — o erro chega cru na UI em vez da mensagem tratada';
  END;

  -- 6.2 — a guarda é condicionada a _role IS NOT NULL: revogar (NULL) um
  -- usuário inexistente não deve estourar, é no-op idempotente.
  PERFORM public.set_user_role(v_inexistente, NULL);

  RAISE NOTICE 'Seção 6 OK';
END $$;

-- ============================================================
-- Seção 7 — invariantes de segurança (issue #31): reafirma existência e
-- definição dos objetos que já sumiram em silêncio 3 vezes neste projeto.
-- ============================================================
DO $$
BEGIN
  PERFORM private.assert_security_invariants();
  RAISE NOTICE 'Seção 7 OK';
END $$;

ROLLBACK;
