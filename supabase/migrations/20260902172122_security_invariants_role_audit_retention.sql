-- Estende private.assert_security_invariants() (20260831160000) para cobrir
-- os objetos de seguranca introduzidos pela retencao de role_audit_log
-- (issue #28, 20260902140819_role_audit_log_retention.sql): o EXECUTE de
-- private.purge_role_audit_log() (SEC-B5, mesmo padrao do bloco B) e a
-- existencia/atividade do job pg_cron purge-role-audit-log (SEC-J1, bloco
-- novo). Sem isso, o job cron seria exatamente o tipo de objeto que ja
-- sumiu silenciosamente em remix do projeto tres vezes antes (REVOKEs, um
-- trigger, uma RPC -- ver cabecalho de 20260831160000) sem que este checker
-- central percebesse: a retencao de 90 dias pararia de rodar em silencio,
-- mesmo com assert_security_invariants() continuando a retornar true.
CREATE OR REPLACE FUNCTION private.assert_security_invariants()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_def text;
  v_tgenabled "char";
  v_expected_src text;
  v_actual_src text;
BEGIN
  -- ============================================================
  -- A. Triggers de seguranca -- existem, apontam para a funcao certa, para
  -- os eventos certos, e nao estao desabilitados (ALTER TABLE ... DISABLE
  -- TRIGGER e tao silencioso quanto o trigger sumir de vez).
  -- pg_get_triggerdef nao qualifica o nome da funcao quando o schema dela
  -- esta no search_path da sessao -- por isso handle_new_user() (schema
  -- public, que esta no search_path desta funcao) aparece sem prefixo,
  -- enquanto as funcoes de private. (fora do search_path) continuam
  -- qualificadas. Alem disso, para triggers com mais de um evento,
  -- pg_get_triggerdef sempre imprime na ordem fixa INSERT, DELETE, UPDATE,
  -- TRUNCATE -- nao na ordem escrita no CREATE TRIGGER original.
  -- ============================================================
  FOR r IN
    SELECT * FROM (VALUES
      ('SEC-A1', 'auth.users'::regclass,              'on_auth_user_created',    'AFTER',  'INSERT',                      'handle_new_user()'),
      ('SEC-A2', 'public.user_roles'::regclass,        'audit_user_roles',        'AFTER',  'INSERT OR DELETE OR UPDATE', 'private.audit_user_roles()'),
      ('SEC-A3', 'public.user_roles'::regclass,        'guard_last_admin',        'BEFORE', 'DELETE OR UPDATE',           'private.guard_last_admin()'),
      ('SEC-A4', 'public.user_route_access'::regclass, 'audit_user_route_access', 'AFTER',  'INSERT OR DELETE',           'private.audit_user_route_access()'),
      ('SEC-A5', 'public.devs'::regclass,               'devs_set_project',        'BEFORE', 'INSERT OR UPDATE',           'private.set_dev_project()'),
      ('SEC-A6', 'public.allocations'::regclass,        'allocations_set_project', 'BEFORE', 'INSERT OR UPDATE',           'private.set_allocation_project()'),
      ('SEC-A7', 'public.teams'::regclass,              'teams_set_position',      'BEFORE', 'INSERT',                     'private.set_team_position()')
    ) AS t(id, tbl, trigname, timing, events, func)
  LOOP
    v_def := NULL;
    v_tgenabled := NULL;

    SELECT pg_get_triggerdef(tg.oid), tg.tgenabled
      INTO v_def, v_tgenabled
      FROM pg_trigger tg
     WHERE tg.tgrelid = r.tbl AND tg.tgname = r.trigname AND NOT tg.tgisinternal;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'INVARIANTE %: trigger % ausente em %', r.id, r.trigname, r.tbl::text USING ERRCODE = 'W5000';
    END IF;

    IF v_tgenabled <> 'O' THEN
      RAISE EXCEPTION 'INVARIANTE %: trigger % existe mas esta desabilitado (tgenabled=%)', r.id, r.trigname, v_tgenabled USING ERRCODE = 'W5000';
    END IF;

    IF v_def NOT LIKE ('%' || r.timing || ' ' || r.events || '%')
       OR v_def NOT LIKE ('%EXECUTE FUNCTION ' || r.func || '%') THEN
      RAISE EXCEPTION 'INVARIANTE %: trigger % com definicao inesperada: %', r.id, r.trigname, v_def USING ERRCODE = 'W5000';
    END IF;
  END LOOP;

  -- ============================================================
  -- B. EXECUTE revogado de PUBLIC/anon nas RPCs SECURITY DEFINER que ja
  -- perderam o REVOKE uma vez (ocorrencia 1, 20260813120000). SEC-B5
  -- acrescenta private.purge_role_audit_log() (issue #28): mesmo risco de
  -- EXECUTE liberado por acidente, mesma checagem.
  -- has_function_privilege(role, ...) reflete tanto grant direto ao role
  -- quanto grant a PUBLIC (que todo role herda) -- checar so 'anon' ja
  -- cobre os dois casos.
  -- ============================================================
  FOR r IN
    SELECT * FROM (VALUES
      ('SEC-B1', 'public.set_user_role(uuid, public.app_role)'),
      ('SEC-B2', 'public.create_invitation(text, public.app_role, public.app_route[])'),
      ('SEC-B3', 'public.cancel_invitation(text)'),
      ('SEC-B4', 'public.handle_new_user()'),
      ('SEC-B5', 'private.purge_role_audit_log()')
    ) AS t(id, sig)
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'INVARIANTE %: EXECUTE em % ainda liberado para anon/PUBLIC', r.id, r.sig USING ERRCODE = 'W5000';
    END IF;
  END LOOP;

  -- ============================================================
  -- C. role_audit_log continua somente-leitura para authenticated/anon/
  -- service_role (ocorrencia 3, 20260828135000).
  -- ============================================================
  FOR r IN
    SELECT 'SEC-C1' AS id, role_name, priv
      FROM unnest(ARRAY['authenticated','anon','service_role']) AS role_name
     CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE']) AS priv
  LOOP
    IF has_table_privilege(r.role_name, 'public.role_audit_log', r.priv) THEN
      RAISE EXCEPTION 'INVARIANTE %: % tem % em role_audit_log (deveria ser somente leitura)', r.id, r.role_name, r.priv USING ERRCODE = 'W5000';
    END IF;
  END LOOP;

  -- ============================================================
  -- D. RLS habilitado nas tabelas sensiveis -- um DISABLE ROW LEVEL SECURITY
  -- silencioso seria catastrofico e invisivel.
  -- ============================================================
  FOR r IN
    SELECT * FROM (VALUES
      ('SEC-D1', 'public.devs'::regclass),
      ('SEC-D2', 'public.teams'::regclass),
      ('SEC-D3', 'public.sprints'::regclass),
      ('SEC-D4', 'public.allocations'::regclass),
      ('SEC-D5', 'public.user_roles'::regclass),
      ('SEC-D6', 'public.user_route_access'::regclass),
      ('SEC-D7', 'public.invitations'::regclass),
      ('SEC-D8', 'public.role_audit_log'::regclass)
    ) AS t(id, tbl)
  LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = r.tbl) THEN
      RAISE EXCEPTION 'INVARIANTE %: RLS desabilitado em %', r.id, r.tbl::text USING ERRCODE = 'W5000';
    END IF;
  END LOOP;

  -- ============================================================
  -- E. As 4 policies de SELECT do board exigem papel (can_view_board) E a
  -- rota alocacoes (has_route) -- a policy existir com o nome certo nao
  -- basta, o USING errado passaria batido (ponto de atencao da #31).
  -- ============================================================
  FOR r IN
    SELECT * FROM (VALUES
      ('SEC-E1', 'devs',        'devs_select_route'),
      ('SEC-E2', 'teams',       'teams_select_route'),
      ('SEC-E3', 'sprints',     'sprints_select_route'),
      ('SEC-E4', 'allocations', 'allocations_select_route')
    ) AS t(id, tbl, pol)
  LOOP
    v_def := NULL;

    SELECT qual INTO v_def
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = r.tbl AND policyname = r.pol;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'INVARIANTE %: policy % ausente em public.%', r.id, r.pol, r.tbl USING ERRCODE = 'W5000';
    END IF;

    IF v_def NOT LIKE '%can_view_board(auth.uid())%'
       OR v_def NOT LIKE '%has_route(auth.uid(), ''alocacoes''%' THEN
      RAISE EXCEPTION 'INVARIANTE %: policy % com USING inesperado: %', r.id, r.pol, v_def USING ERRCODE = 'W5000';
    END IF;
  END LOOP;

  -- ============================================================
  -- F. As 12 policies de escrita do board exigem can_edit_board E
  -- has_route(alocacoes). INSERT so tem with_check; UPDATE tem qual E
  -- with_check; DELETE so tem qual -- concatena os dois em vez de assumir
  -- qual sempre preenchido.
  -- ============================================================
  FOR r IN
    SELECT * FROM (VALUES
      ('SEC-F1',  'devs',        'devs_insert_editors'),
      ('SEC-F2',  'devs',        'devs_update_editors'),
      ('SEC-F3',  'devs',        'devs_delete_editors'),
      ('SEC-F4',  'teams',       'teams_insert_editors'),
      ('SEC-F5',  'teams',       'teams_update_editors'),
      ('SEC-F6',  'teams',       'teams_delete_editors'),
      ('SEC-F7',  'sprints',     'sprints_insert_editors'),
      ('SEC-F8',  'sprints',     'sprints_update_editors'),
      ('SEC-F9',  'sprints',     'sprints_delete_editors'),
      ('SEC-F10', 'allocations', 'allocations_insert_editors'),
      ('SEC-F11', 'allocations', 'allocations_update_editors'),
      ('SEC-F12', 'allocations', 'allocations_delete_editors')
    ) AS t(id, tbl, pol)
  LOOP
    v_def := NULL;

    SELECT coalesce(qual, '') || ' ' || coalesce(with_check, '') INTO v_def
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = r.tbl AND policyname = r.pol;

    IF v_def IS NULL OR trim(v_def) = '' THEN
      RAISE EXCEPTION 'INVARIANTE %: policy % ausente em public.%', r.id, r.pol, r.tbl USING ERRCODE = 'W5000';
    END IF;

    IF v_def NOT LIKE '%can_edit_board(auth.uid())%'
       OR v_def NOT LIKE '%has_route(auth.uid(), ''alocacoes''%' THEN
      RAISE EXCEPTION 'INVARIANTE %: policy % com USING/WITH CHECK inesperado: %', r.id, r.pol, v_def USING ERRCODE = 'W5000';
    END IF;
  END LOOP;

  -- ============================================================
  -- G. user_route_access: 2 policies de leitura (dono ve a propria, admin ve
  -- tudo), e por desenho NENHUMA policy de escrita -- so a RPC SECURITY
  -- DEFINER grava, via RLS-por-ausencia-de-policy. (O GRANT de tabela em si
  -- nao e o invariante aqui: authenticated tem INSERT/UPDATE/DELETE de
  -- fabrica em toda tabela nova de public via ALTER DEFAULT PRIVILEGES do
  -- proprio Supabase, fora do controle das migrations -- nao e algo que
  -- desapareceu, e revogar so essa tabela seria inconsistente com o resto
  -- do schema.)
  -- ============================================================
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'user_route_access'
       AND policyname = 'route_access_select_own'
       AND qual LIKE '%user_id = auth.uid()%'
  ) THEN
    RAISE EXCEPTION 'INVARIANTE SEC-G1: policy route_access_select_own ausente ou com USING inesperado' USING ERRCODE = 'W5000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'user_route_access'
       AND policyname = 'route_access_select_admin'
       AND qual LIKE '%has_role(auth.uid(), ''admin''%'
  ) THEN
    RAISE EXCEPTION 'INVARIANTE SEC-G2: policy route_access_select_admin ausente ou com USING inesperado' USING ERRCODE = 'W5000';
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'user_route_access') <> 2 THEN
    RAISE EXCEPTION 'INVARIANTE SEC-G3: user_route_access deveria ter exatamente 2 policies (so leitura)' USING ERRCODE = 'W5000';
  END IF;

  -- ============================================================
  -- H. invitations: 3 policies exigindo papel admin -- escrita direta pela
  -- aplicacao acontece via create_invitation/cancel_invitation (SECURITY
  -- DEFINER), mas as policies existem como camada independente (mesmo
  -- raciocinio do trigger guard_last_admin: uma protecao que vale mesmo se
  -- alguem escrever direto, sem passar pela RPC).
  -- ============================================================
  FOR r IN
    SELECT * FROM (VALUES
      ('SEC-H1', 'invitations_select_admin'),
      ('SEC-H2', 'invitations_insert_admin'),
      ('SEC-H3', 'invitations_update_admin')
    ) AS t(id, pol)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'invitations'
         AND policyname = r.pol
         AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%has_role(auth.uid(), ''admin''%'
    ) THEN
      RAISE EXCEPTION 'INVARIANTE %: policy % ausente em invitations ou com condicao inesperada', r.id, r.pol USING ERRCODE = 'W5000';
    END IF;
  END LOOP;

  -- ============================================================
  -- I. Corpo de private.guard_last_admin() -- o "ponto de atencao" da #31:
  -- nome e trigger certos nao provam que a logica de ultimo-admin continua
  -- correta (quase aconteceu na #23, com um corpo reconstruido a partir de
  -- versao superada). Compara o codigo-fonte normalizado (espacos
  -- colapsados) contra o texto aplicado em 20260808120000_rbac_foundation.sql.
  -- ============================================================
  v_expected_src := 'BEGIN IF OLD.role <> ''admin''::public.app_role THEN IF TG_OP = ''DELETE'' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF; IF TG_OP = ''UPDATE'' AND NEW.role = ''admin''::public.app_role THEN RETURN NEW; END IF; IF (SELECT count(*) FROM public.user_roles WHERE role = ''admin''::public.app_role AND user_id <> OLD.user_id) = 0 THEN RAISE EXCEPTION ''É necessário ao menos um administrador na plataforma'' USING ERRCODE = ''W2003''; END IF; IF TG_OP = ''DELETE'' THEN RETURN OLD; ELSE RETURN NEW; END IF; END';

  SELECT trim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_actual_src
    FROM pg_proc
   WHERE oid = 'private.guard_last_admin()'::regprocedure;

  IF v_actual_src IS NULL THEN
    RAISE EXCEPTION 'INVARIANTE SEC-I1: funcao private.guard_last_admin() nao encontrada' USING ERRCODE = 'W5000';
  END IF;

  IF v_actual_src <> v_expected_src THEN
    RAISE EXCEPTION 'INVARIANTE SEC-I1: corpo de private.guard_last_admin() diverge do esperado: %', v_actual_src USING ERRCODE = 'W5000';
  END IF;

  -- ============================================================
  -- J. Job pg_cron do expurgo de role_audit_log (issue #28,
  -- 20260902140819_role_audit_log_retention.sql) existe e esta ativo -- o
  -- mesmo padrao de objeto que ja sumiu silenciosamente em remix do projeto
  -- (ocorrencias documentadas no cabecalho de 20260831160000) se aplica a um
  -- job cron: se ele for perdido, a retencao de 90 dias para de rodar sem
  -- nenhum aviso, mesmo com este checker continuando a passar nos demais
  -- itens.
  -- ============================================================
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'purge-role-audit-log' AND active
  ) THEN
    RAISE EXCEPTION 'INVARIANTE SEC-J1: job pg_cron purge-role-audit-log ausente ou inativo' USING ERRCODE = 'W5000';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_security_invariants() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.assert_security_invariants() TO service_role;
