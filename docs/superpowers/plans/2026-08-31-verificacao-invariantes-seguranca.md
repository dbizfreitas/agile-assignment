# Verificação de Invariantes de Segurança — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma função SQL `private.assert_security_invariants()` afirma a existência — e, para os casos mais críticos, a definição real — dos triggers, ACLs (REVOKE/GRANT) e policies de RLS que já sumiram do banco em silêncio três vezes neste projeto (achado da issue #31). Levanta exceção com `ERRCODE = 'W5000'` no primeiro invariante violado, identificando qual pela mensagem. Uma suíte de smoke prova tanto o caminho positivo (estado atual intacto) quanto o negativo (o checker realmente detecta cada categoria de regressão, não só passa vazio), e as duas suítes de smoke já existentes (`rbac_smoke.sql`, `route_access_smoke.sql`) ganham uma seção final chamando a função — formalizando exatamente o que já as pegou por acaso nas ocorrências 2 e 3.

**Architecture:** Uma migration SQL cria a função `private.assert_security_invariants()`, `SECURITY DEFINER`, que varre catálogos do Postgres (`pg_trigger`, `pg_policies`, `pg_proc`, `has_function_privilege`, `has_table_privilege`, `pg_class.relrowsecurity`) — sem fixtures, sem escrita, chamável a qualquer momento. Um novo arquivo de smoke prova o mecanismo com casos positivos e negativos (cada negativo quebra um invariante dentro de um `BEGIN...EXCEPTION` aninhado, confirma que o checker acusa, e o próprio `EXCEPTION WHEN` desfaz a quebra). As duas suítes existentes recebem uma seção final chamando a mesma função. Nenhum objeto de segurança existente é alterado — a função só *lê* o estado deles.

**Tech Stack:** PostgreSQL 15 (Supabase), PL/pgSQL. Nenhuma dependência de TypeScript/React.

**Issue de origem:** [#31](https://github.com/dbizfreitas/agile-assignment/issues/31) — três ocorrências documentadas de objetos de segurança sumindo do banco sem nenhuma migration os remover, atribuídas a remix do projeto no Lovable reprovisionando o banco com ACLs padrão do Postgres.

## Global Constraints

- **Escopo é a opção (2) da issue** — `private.assert_security_invariants()`, catalog-only, sem fixtures — mais a seção nova nas duas suítes existentes (opção 1, formalizando o que já as pegou por acaso). **`pg_cron`/automação agendada (opção 3) fica FORA de escopo** — a própria issue sugere começar por (2) como pré-requisito natural de (3); introduzir automação agora seria escopo não pedido.
- **Nenhum objeto de segurança existente é modificado.** A função só lê (`pg_trigger`, `pg_policies`, `pg_proc`, `has_function_privilege`, `has_table_privilege`, `pg_class`). As únicas escritas em objetos existentes são as intencionais e temporárias dentro do smoke test (Seções 2–6), cada uma desfeita pelo próprio `EXCEPTION WHEN` antes do arquivo terminar.
- **A fonte da verdade de cada objeto é a definição *atual/efetiva*, não a primeira migration que o criou** — vários objetos (as 4 policies `*_select_route`, `set_user_role`, `create_invitation`) foram legitimamente redefinidos depois. Os valores usados neste plano vêm da definição vigente, confirmada lendo a migration mais recente de cada objeto.
- **Verificação por definição, não só por nome, nos pontos que a issue chama de "ponto de atenção"**: as policies usam checagem por substring do `USING`/`WITH CHECK` real (via `pg_policies.qual`/`with_check`), e `private.guard_last_admin()` tem o corpo comparado (espaços normalizados) contra o texto aplicado em produção — não só a existência do trigger.
- **A string de comparação do corpo de `guard_last_admin` preserva o acento de `'É necessário...'`** porque é uma cópia literal de uma string já aplicada em produção (não texto novo sendo escrito) — a regra de "SQL em ASCII" do repositório vale para comentários e mensagens *novos*, não para reproduzir um valor existente que precisa bater exatamente.
- **`private.assert_security_invariants()` NÃO é chamável por `authenticated`/`anon`/`public`** — só por `service_role` (uso via SQL Editor, que roda como `postgres`, ou uma futura automação). Mensagens de erro descrevem a topologia de segurança do sistema; não é algo para expor a um usuário logado comum.
- **Migrations são aplicadas MANUALMENTE pelo usuário**, no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr` (`https://supabase.com/dashboard/project/nuvrdppxecbowxopbqcr/sql/new`) — confirmado em todo plano anterior deste repositório; não há `psql`, Supabase CLI nem `service_role` key neste ambiente. O agente cria o `.sql`, pede a aplicação e **aguarda confirmação explícita** antes de qualquer step dependente do schema.
- **SQL novo em ASCII, sem acentos** — nos comentários e mensagens de `RAISE EXCEPTION`/`RAISE NOTICE` que este plano escreve (exceto a string literal do Constraint acima).
- **Não fazer `git push`.** Push é decisão do usuário ao final.
- **Nunca reescrever histórico** (sem `rebase`, `amend`, `squash` de commits publicados).
- **Não commitar `src/routeTree.gen.ts` nem `src/components/compromisso/StatsCards.tsx`** — modificados no working tree por outra frente. Todo `git add` é por caminho explícito, nunca `git add -A`.
- **Mensagens de commit em ASCII** (sem acentos), seguindo o padrão dos commits recentes.
- **Sem test runner neste repositório.** Verificação é smoke SQL em `BEGIN…ROLLBACK`, aplicado manualmente pelo usuário.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `supabase/migrations/20260831160000_security_invariants_check.sql` | **Criar.** `private.assert_security_invariants()`. | 1 |
| `supabase/tests/security_invariants_smoke.sql` | **Criar.** Prova positiva + 5 provas negativas do checker. | 2 |
| `supabase/tests/rbac_smoke.sql` | **Modificar.** Seção 5 nova, chama o checker. | 3 |
| `supabase/tests/route_access_smoke.sql` | **Modificar.** Seção 7 nova, chama o checker. | 3 |

Nenhum arquivo TypeScript é tocado.

---

## Task 1: `private.assert_security_invariants()`

**Files:**
- Create: `supabase/migrations/20260831160000_security_invariants_check.sql`

**Interfaces:**
- Consumes: nada de código — só catálogos do Postgres (`pg_trigger`, `pg_policies`, `pg_proc`, `pg_class`) e os objetos já existentes que audita (triggers, policies, funções, tabelas listadas abaixo).
- Produces: `private.assert_security_invariants() RETURNS boolean` — `true` se tudo intacto, levanta exceção `ERRCODE = 'W5000'` no primeiro invariante violado. Consumida pela Task 2 (smoke novo) e pela Task 3 (seção nova nas suítes existentes).

- [ ] **Step 1: Criar a migration**

Arquivo `supabase/migrations/20260831160000_security_invariants_check.sql`:

```sql
-- Verificacao periodica de invariantes de seguranca (issue #31): tres vezes
-- objetos de seguranca criados por migration sumiram do banco em silencio
-- (REVOKE de RPCs SECURITY DEFINER, o trigger on_auth_user_created, REVOKE
-- de role_audit_log) sem que nenhuma migration os removesse -- consistente
-- com remix do projeto no Lovable reprovisionando o banco com ACLs padrao
-- do Postgres (20260813120000_restore_rpc_execute_revokes.sql documenta a
-- primeira ocorrencia). As tres ocorrencias so foram descobertas por acaso.
--
-- private.assert_security_invariants() afirma a EXISTENCIA e, para os casos
-- mais criticos, a DEFINICAO real dos invariantes de seguranca do sistema:
-- nao basta o objeto existir com o nome certo (ver o quase-incidente da
-- guarda W2004 durante a #23, onde um corpo de funcao reconstruido a partir
-- de versao superada quase reverteu silenciosamente uma protecao). Levanta
-- excecao no primeiro invariante violado, com ERRCODE W5000 e uma mensagem
-- identificando qual (ex.: 'INVARIANTE SEC-A3: ...'). Retorna true quando
-- tudo esta intacto.
--
-- Callable a qualquer momento (SELECT private.assert_security_invariants();
-- no SQL Editor) -- e o pre-requisito natural para automatizar a checagem
-- depois (pg_cron ou job externo), mas essa automacao fica fora do escopo
-- desta migration.
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
  -- perderam o REVOKE uma vez (ocorrencia 1, 20260813120000).
  -- has_function_privilege(role, ...) reflete tanto grant direto ao role
  -- quanto grant a PUBLIC (que todo role herda) -- checar so 'anon' ja
  -- cobre os dois casos.
  -- ============================================================
  FOR r IN
    SELECT * FROM (VALUES
      ('SEC-B1', 'public.set_user_role(uuid, public.app_role)'),
      ('SEC-B2', 'public.create_invitation(text, public.app_role, public.app_route[])'),
      ('SEC-B3', 'public.cancel_invitation(text)'),
      ('SEC-B4', 'public.handle_new_user()')
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

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_security_invariants() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.assert_security_invariants() TO service_role;
```

- [ ] **Step 2: Pedir ao usuário para aplicar a migration**

Mostrar o caminho do arquivo e o link do SQL Editor (`https://supabase.com/dashboard/project/nuvrdppxecbowxopbqcr/sql/new`). **Parar e aguardar confirmação explícita.** Não seguir para o Step 3 antes disso.

- [ ] **Step 3: Pedir ao usuário para confirmar o caminho positivo**

Pedir para colar e rodar `SELECT private.assert_security_invariants();` no SQL Editor (como `postgres`, que ignora o `REVOKE`/`GRANT` da função). Esperado: uma linha com `t` (true), sem `ERROR`. Se der `ERROR: INVARIANTE ...`, é porque o estado real do banco diverge do que este plano assumiu como vigente — reportar a mensagem completa antes de seguir, para eu ajustar a função à realidade em vez de ignorar o que ela achou.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260831160000_security_invariants_check.sql
git commit -m "feat(security): private.assert_security_invariants verifica triggers, ACLs e policies"
```

---

## Task 2: Smoke test — prova positiva e negativa do checker

**Files:**
- Create: `supabase/tests/security_invariants_smoke.sql`

**Interfaces:**
- Consumes: `private.assert_security_invariants()` da Task 1 — **precisa estar aplicada** antes deste arquivo ser rodado.
- Produces: nada consumido por outra task — é folha da árvore.

- [ ] **Step 1: Criar a suíte de smoke**

Arquivo `supabase/tests/security_invariants_smoke.sql`:

```sql
-- Suite de verificacao de private.assert_security_invariants() (issue #31,
-- migration 20260831160000_security_invariants_check.sql).
-- Prova o caminho positivo (estado atual intacto) e o negativo (o checker
-- realmente detecta cada categoria de regressao, nao so passa vazio) -- as
-- Secoes 2-6 quebram um invariante de proposito e o proprio EXCEPTION WHEN
-- desfaz a quebra antes da secao seguinte rodar.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Secao N OK' por secao.
-- Falha = ERROR: com a mensagem da secao que falhou.
BEGIN;

SET LOCAL plpgsql.check_asserts = on;

-- ============================================================
-- Secao 1 -- caminho positivo: o estado atual do banco esta intacto
-- ============================================================
DO $$
BEGIN
  PERFORM private.assert_security_invariants();
  RAISE NOTICE 'Secao 1 OK (invariantes intactos)';
END $$;

-- ============================================================
-- Secao 2 -- prova negativa: remove o trigger guard_last_admin (como a
-- ocorrencia 2 da #31, so que com outro trigger) e confirma que o checker
-- acusa SEC-A3
-- ============================================================
DO $$
BEGIN
  BEGIN
    DROP TRIGGER guard_last_admin ON public.user_roles;
    PERFORM private.assert_security_invariants();
    RAISE EXCEPTION 'Secao 2 FALHOU: assert_security_invariants nao detectou a remocao do trigger guard_last_admin';
  EXCEPTION WHEN sqlstate 'W5000' THEN
    RAISE NOTICE 'Secao 2 OK (checker detectou trigger guard_last_admin removido)';
  END;
END $$;

-- ============================================================
-- Secao 3 -- prova negativa: libera EXECUTE de create_invitation para anon
-- (como a ocorrencia 1 da #31) e confirma que o checker acusa SEC-B2
-- ============================================================
DO $$
BEGIN
  BEGIN
    GRANT EXECUTE ON FUNCTION public.create_invitation(text, public.app_role, public.app_route[]) TO anon;
    PERFORM private.assert_security_invariants();
    RAISE EXCEPTION 'Secao 3 FALHOU: assert_security_invariants nao detectou EXECUTE liberado para anon em create_invitation';
  EXCEPTION WHEN sqlstate 'W5000' THEN
    RAISE NOTICE 'Secao 3 OK (checker detectou EXECUTE liberado para anon)';
  END;
END $$;

-- ============================================================
-- Secao 4 -- prova negativa: desabilita RLS em devs e confirma que o
-- checker acusa SEC-D1
-- ============================================================
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.devs DISABLE ROW LEVEL SECURITY;
    PERFORM private.assert_security_invariants();
    RAISE EXCEPTION 'Secao 4 FALHOU: assert_security_invariants nao detectou RLS desabilitado em devs';
  EXCEPTION WHEN sqlstate 'W5000' THEN
    RAISE NOTICE 'Secao 4 OK (checker detectou RLS desabilitado)';
  END;
END $$;

-- ============================================================
-- Secao 5 -- prova negativa: enfraquece o USING de devs_select_route para
-- (true) -- nome da policy certo, condicao errada -- e confirma que o
-- checker acusa SEC-E1
-- ============================================================
DO $$
BEGIN
  BEGIN
    ALTER POLICY devs_select_route ON public.devs USING (true);
    PERFORM private.assert_security_invariants();
    RAISE EXCEPTION 'Secao 5 FALHOU: assert_security_invariants nao detectou USING enfraquecido em devs_select_route';
  EXCEPTION WHEN sqlstate 'W5000' THEN
    RAISE NOTICE 'Secao 5 OK (checker detectou USING enfraquecido)';
  END;
END $$;

-- ============================================================
-- Secao 6 -- prova negativa: substitui o corpo de guard_last_admin por um
-- que nunca bloqueia nada -- trigger continua existindo com o nome certo,
-- mas a logica sumiu -- e confirma que o checker acusa SEC-I1
-- ============================================================
DO $$
BEGIN
  BEGIN
    CREATE OR REPLACE FUNCTION private.guard_last_admin()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    BEGIN
      RETURN NEW;
    END $body$;

    PERFORM private.assert_security_invariants();
    RAISE EXCEPTION 'Secao 6 FALHOU: assert_security_invariants nao detectou o corpo de guard_last_admin alterado';
  EXCEPTION WHEN sqlstate 'W5000' THEN
    RAISE NOTICE 'Secao 6 OK (checker detectou corpo de guard_last_admin alterado)';
  END;
END $$;

ROLLBACK;
```

- [ ] **Step 2: Pedir ao usuário para rodar a suíte**

Colar `supabase/tests/security_invariants_smoke.sql` no SQL Editor e reportar a saída. Aguardar confirmação de que as 6 seções passaram (`Success. No rows returned`, sem `ERROR`). Se alguma seção 2-6 der `ERROR: Secao N FALHOU`, é um bug real no checker (não detectou uma regressão que deveria) — parar e investigar antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/security_invariants_smoke.sql
git commit -m "test(security): smoke prova deteccao positiva e negativa dos invariantes"
```

---

## Task 3: Seção nova nas suítes de smoke existentes

**Files:**
- Modify: `supabase/tests/rbac_smoke.sql`
- Modify: `supabase/tests/route_access_smoke.sql`

**Interfaces:**
- Consumes: `private.assert_security_invariants()` da Task 1.
- Produces: nada — folha da árvore.

- [ ] **Step 1: Adicionar a Seção 5 em `rbac_smoke.sql`**

O arquivo termina hoje em:
```sql
  RAISE NOTICE 'Seção 4 OK';
END $$;

ROLLBACK;
```

Trocar por:
```sql
  RAISE NOTICE 'Seção 4 OK';
END $$;

-- ============================================================
-- Seção 5 — invariantes de segurança (issue #31): reafirma existência e
-- definição dos objetos que já sumiram em silêncio 3 vezes neste projeto.
-- ============================================================
DO $$
BEGIN
  PERFORM private.assert_security_invariants();
  RAISE NOTICE 'Seção 5 OK';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Adicionar a Seção 7 em `route_access_smoke.sql`**

O arquivo termina hoje em:
```sql
  RAISE NOTICE 'Seção 6 OK';
END $$;

ROLLBACK;
```

Trocar por:
```sql
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
```

- [ ] **Step 3: Pedir ao usuário para rodar as duas suítes**

Colar `rbac_smoke.sql` e depois `route_access_smoke.sql`, completos, no SQL Editor. Aguardar confirmação de que ambos passaram com a nova seção incluída (5/5 e 7/7 respectivamente).

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/rbac_smoke.sql supabase/tests/route_access_smoke.sql
git commit -m "test(security): rbac_smoke e route_access_smoke chamam assert_security_invariants"
```

---

## Task 4: Fechamento

- [ ] **Step 1: Conferir o diff completo**

```bash
git status --short
```

`src/routeTree.gen.ts` e `src/components/compromisso/StatsCards.tsx` devem continuar como `M` **não commitados**. Se tiverem entrado em algum commit, parar e avisar o usuário.

- [ ] **Step 2: Conferir a issue ponta a ponta**

Reler a [issue #31](https://github.com/dbizfreitas/agile-assignment/issues/31) contra o que foi feito: `private.assert_security_invariants()` cobre triggers, ACLs, RLS habilitado e policies (incluindo o corpo de `guard_last_admin`, o ponto de atenção explícito); a suíte nova prova detecção positiva e negativa; as duas suítes existentes chamam o checker. `pg_cron` fica documentado como próximo passo, não implementado.

- [ ] **Step 3: Comentar na issue #31 o que foi entregue**

Resumir em português o que foi implementado (função + 2 suítes atualizadas + suíte nova), linkando os 3 commits, e registrar explicitamente que a automação via `pg_cron` (opção 3 da issue) ficou fora de escopo por decisão consciente — próximo passo natural, não esquecimento. Pedir confirmação antes de postar (comentário em issue pública é ação que fica visível para outros).

- [ ] **Step 4: Não fazer push**

Informar o usuário de que os commits estão locais e o push é decisão dele.
