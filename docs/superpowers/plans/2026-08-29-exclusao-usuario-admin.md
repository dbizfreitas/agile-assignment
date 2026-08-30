# Exclusão de Usuário pela Tela /admin — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um administrador passa a excluir usuários pela tela `/admin` — o usuário some da lista, perde papel, rotas e convite pendente, e a exclusão fica registrada no Histórico com quem excluiu, quem foi excluído e quando.

**Architecture:** A operação tem duas metades, em sistemas diferentes, e a ordem entre elas não pode ser invertida. Primeiro a RPC `public.delete_platform_user` (SECURITY DEFINER, chamada com o client do **próprio usuário** para `auth.uid()` resolver o ator) valida as invariantes, apaga convite pendente, papel e rotas, e grava a auditoria. Só depois a server function chama `supabaseAdmin.auth.admin.deleteUser` com `service_role`. Se a ordem fosse invertida, o `ON DELETE CASCADE` de `user_roles`/`user_route_access` dispararia os triggers de auditoria com a linha de `auth.users` já apagada — e `(SELECT email FROM auth.users WHERE id = v_target)` gravaria `target_email` nulo, deixando o evento sem nenhuma forma de identificar quem foi excluído. Nenhuma tabela nova: só um valor de enum (`role_audit_action.delete`) e uma RPC.

**Tech Stack:** PostgreSQL 15 (Supabase), TanStack Start 1.168 + React 19, TanStack Query v5, shadcn/ui (Radix AlertDialog/Table), Tailwind, TypeScript 5.8 (`strict`), Node 24.

**Spec:** [`docs/superpowers/specs/2026-08-29-exclusao-usuario-admin-design.md`](../specs/2026-08-29-exclusao-usuario-admin-design.md)

**Issue:** [dbizfreitas/agile-assignment#11](https://github.com/dbizfreitas/agile-assignment/issues/11)

## Global Constraints

- **Idioma da UI:** pt-BR em todo texto visível, com acentuação correta.
- **Ordem RPC → `deleteUser` é inegociável.** Nenhuma task pode inverter, paralelizar ou fundir os dois passos. O motivo está na seção "Por que a RPC vem antes" da spec.
- **`service_role` só no passo 3.** A RPC é chamada com `context.supabase` (client do usuário autenticado), nunca com `supabaseAdmin` — é o que faz `auth.uid()` resolver o ator dentro da função. Chamar com `supabaseAdmin` faria `auth.uid()` retornar `NULL` e a RPC levantar `W2001`.
- **Nenhuma tabela nova, nenhuma coluna nova.** Se a implementação parecer precisar de uma, parar e revisar a spec.
- **`guard_last_admin` não é tocado.** `W2003` é inalcançável por esta RPC (ver spec, "Invariantes e onde cada uma mora"); o trigger continua como rede para caminhos fora dela.
- **Migrations são aplicadas MANUALMENTE pelo usuário, no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr`** (`https://supabase.com/dashboard/project/nuvrdppxecbowxopbqcr/sql/new`) — esse é o projeto real, o mesmo do `.env`/`supabase/config.toml` deste repositório. **A ferramenta MCP `query_database` do Lovable NÃO deve ser usada** para aplicar ou verificar estas migrations: ela aponta para um banco Postgres diferente (confirmado na prática na issue #23). O agente cria o arquivo `.sql`, pede ao usuário para colar no SQL Editor, e **aguarda a confirmação explícita** ("apliquei, deu sucesso" ou a mensagem de erro) antes de seguir para qualquer step que dependa do schema.
- **Os dois arquivos de migration da Task 1 são aplicados em execuções SEPARADAS.** O SQL Editor do Supabase envolve o script inteiro numa transação, e um valor de enum recém-adicionado não pode ser referenciado na mesma transação em que foi criado. Colar os dois juntos falha com `unsafe use of new value "delete" of enum type role_audit_action`.
- **`src/integrations/supabase/types.ts` é editado à mão** — mesma convenção já usada para `invitations`, `role_audit_log`, `user_route_access`.
- **Sem test runner.** `package.json` tem só `dev`, `build`, `build:dev`, `preview`, `lint`, `format` — esta demanda não introduz um. Verificação: smoke SQL (roda em `BEGIN…ROLLBACK`, sem resíduo) para o banco; `prettier`/`eslint`/`tsc` para o TypeScript; roteiro manual para a UI.
- **Não fazer `git push`.** O repositório sincroniza com o Lovable; o push é decisão do usuário ao final.
- **Nunca reescrever histórico** (sem `rebase`, `amend` ou `squash` de commits publicados) — restrição do `AGENTS.md`.
- **Não commitar `src/routeTree.gen.ts` nem `src/components/compromisso/StatsCards.tsx`.** Já chegam modificados no working tree e não são desta frente. Todo `git add` é por caminho explícito, **nunca** `git add -A`.
- **Mensagens de commit em ASCII** (sem acentos), seguindo o padrão dos commits recentes do repositório.

### Verificação de código: sempre nesta ordem, só nos arquivos tocados

```bash
npx prettier --write <arquivos tocados>
```

```bash
npx eslint <arquivos tocados>
```

```bash
npx tsc --noEmit
```

**Nunca rodar `npm run lint` sem escopo** — o checkout usa `core.autocrlf=true`, então arquivos não tocados por esta demanda reprovam a regra `prettier/prettier` por causa de CRLF pré-existente.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `supabase/migrations/20260829120000_user_delete_audit_enum.sql` | **Criar.** Só o `ALTER TYPE … ADD VALUE 'delete'`. Isolado pela trava de transação do Postgres. | 1 |
| `supabase/migrations/20260829121000_user_delete_rpc.sql` | **Criar.** `public.delete_platform_user(uuid)` + `REVOKE`/`GRANT`. | 1 |
| `supabase/tests/user_delete_smoke.sql` | **Criar.** Suíte em `BEGIN…ROLLBACK`, 6 seções. | 1 |
| `src/integrations/supabase/types.ts` | **Modificar** em 3 pontos: enum `role_audit_action` (tipo), `Constants.public.Enums.role_audit_action` (runtime), `Functions.delete_platform_user`. | 1 |
| `src/lib/admin.ts` | **Modificar.** `PlatformUser.name`, `AuditEntry.action` ganha `"delete"`, `ACTION_LABELS.delete`. | 2 |
| `src/lib/admin-errors.ts` | **Modificar.** `W2005`. | 2 |
| `src/integrations/supabase/admin.server.ts` | **Modificar.** `fetchPlatformUsers` preenche `name` (Task 2); `deleteAuthUser` (Task 3). | 2, 3 |
| `src/integrations/supabase/admin-fns.ts` | **Modificar.** Server fn `deletePlatformUser`. | 3 |
| `src/components/admin/UserTable.tsx` | **Modificar.** Coluna de ação + `AlertDialog` + mutation. | 4 |

`src/components/admin/AuditLog.tsx` **não muda** — ver Task 4, Step 1.

---

## Task 1: Banco — enum, RPC e suíte de verificação

**Files:**
- Create: `supabase/migrations/20260829120000_user_delete_audit_enum.sql`
- Create: `supabase/migrations/20260829121000_user_delete_rpc.sql`
- Create: `supabase/tests/user_delete_smoke.sql`
- Modify: `src/integrations/supabase/types.ts` (3 pontos)

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: RPC `public.delete_platform_user(_target uuid) RETURNS void`, chamável de `supabase.rpc("delete_platform_user", { _target: string })`. Levanta `W2001` (não-admin), `W2005` (autoexclusão), `W2004` (uuid inexistente). Valor `'delete'` no enum `public.role_audit_action`.

- [ ] **Step 1: Criar a migration do enum**

Arquivo `supabase/migrations/20260829120000_user_delete_audit_enum.sql`:

```sql
-- Isolado em migration própria: um valor de enum recém-criado não pode ser
-- usado (comparado/castado) na mesma transação em que foi adicionado. A RPC
-- da próxima migration referencia 'delete' — mesma restrição já documentada
-- em 20260828132000_route_access_audit_enum.sql.
ALTER TYPE public.role_audit_action ADD VALUE 'delete';
```

- [ ] **Step 2: Criar a migration da RPC**

Arquivo `supabase/migrations/20260829121000_user_delete_rpc.sql`:

```sql
-- Exclusão de usuário pela tela /admin (issue #11).
--
-- Esta função é a PRIMEIRA metade da operação. A segunda
-- (supabaseAdmin.auth.admin.deleteUser) roda na server function
-- src/integrations/supabase/admin-fns.ts, DEPOIS desta retornar sem erro.
--
-- A ordem não pode ser invertida: private.audit_user_roles e
-- private.audit_user_route_access resolvem o e-mail do alvo com
-- (SELECT email FROM auth.users WHERE id = v_target) no momento do INSERT na
-- auditoria. Apagar auth.users primeiro faria o ON DELETE CASCADE de
-- user_roles/user_route_access disparar esses triggers com a linha já
-- removida — as linhas de auditoria sairiam com target_email nulo e
-- target_user_id apontando para um uuid inexistente, ou seja, sem nenhuma
-- forma de identificar quem foi excluído.
CREATE OR REPLACE FUNCTION public.delete_platform_user(_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_role public.app_role;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF v_actor = _target THEN
    RAISE EXCEPTION 'Você não pode excluir a própria conta' USING ERRCODE = 'W2005';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = _target;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado' USING ERRCODE = 'W2004';
  END IF;

  SELECT role INTO v_role FROM public.user_roles WHERE user_id = _target;

  -- Um convite pendente ainda não expirado recadastraria o usuário com o
  -- papel e as rotas ORIGINAIS no próximo clique no magic link — o link já
  -- está na caixa de entrada dele e não é revogável pela exclusão da conta.
  DELETE FROM public.invitations
   WHERE email = lower(v_email) AND consumed_at IS NULL;

  PERFORM set_config('app.actor_id', v_actor::text, true);

  IF v_role IS NOT NULL THEN
    -- O override faz private.audit_user_roles gravar 'delete' em vez do
    -- 'revoke' padrão, preservando previous_role. Mesmo mecanismo que
    -- 'bootstrap' já usa em 20260808122000_rbac_bootstrap_admin.sql.
    PERFORM set_config('app.audit_action', 'delete', true);
    DELETE FROM public.user_roles WHERE user_id = _target;
    -- Desliga o override (o trigger lê com nullif(..., '')) antes do DELETE
    -- seguinte. private.audit_user_route_access não lê este setting hoje,
    -- mas deixá-lo ligado além do statement que ele qualifica é armadilha
    -- para quem mexer no trigger depois.
    PERFORM set_config('app.audit_action', '', true);
  ELSE
    -- Sem papel não há DELETE, logo o trigger não dispara e a exclusão
    -- passaria sem registro nenhum. previous_role/new_role ficam nulos: a
    -- coluna "Mudança" da UI já trata esse par como "—".
    INSERT INTO public.role_audit_log (
      action, target_user_id, target_email, actor_user_id, actor_email
    ) VALUES (
      'delete', _target, v_email, v_actor,
      (SELECT email FROM auth.users WHERE id = v_actor)
    );
  END IF;

  DELETE FROM public.user_route_access WHERE user_id = _target;
END $$;

REVOKE ALL ON FUNCTION public.delete_platform_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_platform_user(uuid) TO authenticated;
```

- [ ] **Step 3: Pedir ao usuário para aplicar as DUAS migrations, em execuções separadas**

Mensagem para o usuário (não prosseguir sem resposta):

> Aplique no SQL Editor de `nuvrdppxecbowxopbqcr`, em **duas execuções separadas** (o editor envolve o script numa transação, e um valor de enum novo não pode ser referenciado na mesma transação em que foi criado):
>
> 1. cole e rode `supabase/migrations/20260829120000_user_delete_audit_enum.sql` sozinho;
> 2. depois cole e rode `supabase/migrations/20260829121000_user_delete_rpc.sql`.
>
> Me confirme quando as duas passarem, ou me mande a mensagem de erro.

Se o passo 2 falhar com `unsafe use of new value "delete"`, o passo 1 não foi executado numa transação separada — pedir para rodar de novo.

- [ ] **Step 4: Escrever a suíte smoke**

Arquivo `supabase/tests/user_delete_smoke.sql`:

```sql
-- Suíte de verificação da exclusão de usuário pela tela /admin (issue #11).
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
-- Falha = ERROR: com a mensagem da asserção.
--
-- Escopo: esta suíte exercita a RPC public.delete_platform_user, que é a
-- PRIMEIRA metade da operação. A remoção da linha em auth.users é feita pelo
-- GoTrue (auth.admin.deleteUser) a partir da server function e fica para o
-- roteiro manual — não há como chamá-la de dentro do SQL Editor.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'role_audit_action' AND e.enumlabel = 'delete'
  ) THEN
    RAISE EXCEPTION 'FALHA 1.1: valor delete ausente no enum role_audit_action';
  END IF;

  IF to_regprocedure('public.delete_platform_user(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.2: função public.delete_platform_user(uuid) não existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'public.delete_platform_user(uuid)'::regprocedure
       AND prosecdef
  ) THEN
    RAISE EXCEPTION 'FALHA 1.3: delete_platform_user não é SECURITY DEFINER';
  END IF;

  -- anon herda PUBLIC, então esta única checagem cobre os dois furos: o
  -- REVOKE ALL FROM PUBLIC não ter sido aplicado, e um GRANT direto a anon.
  IF has_function_privilege('anon', 'public.delete_platform_user(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA 1.4: anon tem EXECUTE em delete_platform_user';
  END IF;
  IF NOT has_function_privilege(
       'authenticated', 'public.delete_platform_user(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA 1.5: authenticated não tem EXECUTE em delete_platform_user';
  END IF;

  -- Rede de segurança para caminhos FORA desta RPC (DELETE manual, cascade
  -- do painel do Supabase). W2003 é inalcançável pela RPC — o ator sempre é
  -- um admin diferente do alvo, então guard_last_admin nunca chega a zero.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.user_roles'::regclass AND tgname = 'guard_last_admin'
  ) THEN
    RAISE EXCEPTION 'FALHA 1.6: trigger guard_last_admin ausente';
  END IF;

  RAISE NOTICE 'Seção 1 OK';
END $$;

-- ============================================================
-- Seção 2 — Invariantes (todas levantam ANTES de qualquer escrita)
-- ============================================================
DO $$
DECLARE
  v_admin  uuid := 'd1111111-1111-1111-1111-111111111111';
  v_editor uuid := 'd2222222-2222-2222-2222-222222222222';
  v_target uuid := 'd3333333-3333-3333-3333-333333333333';
  v_ghost  uuid := 'd9999999-9999-9999-9999-999999999999';
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'del-smoke-admin@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_editor, 'authenticated', 'authenticated',
     'del-smoke-editor@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_target, 'authenticated', 'authenticated',
     'del-smoke-target@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_admin, 'admin'), (v_editor, 'editor'), (v_target, 'viewer');

  -- 2.1 — sem sessão nenhuma
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.delete_platform_user(v_target);
    RAISE EXCEPTION 'FALHA 2.1: anônimo conseguiu excluir usuário';
  EXCEPTION WHEN sqlstate 'W2001' THEN NULL;
  END;

  -- 2.2 — editor não exclui
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.delete_platform_user(v_target);
    RAISE EXCEPTION 'FALHA 2.2: editor conseguiu excluir usuário';
  EXCEPTION WHEN sqlstate 'W2001' THEN NULL;
  END;

  -- 2.3 — admin não exclui a si mesmo. Este é o caso que cumpre o critério
  -- "impedir a exclusão do último administrador": o último admin só poderia
  -- ser excluído por ele mesmo, e é isto que bloqueia.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.delete_platform_user(v_admin);
    RAISE EXCEPTION 'FALHA 2.3: admin excluiu a própria conta';
  EXCEPTION WHEN sqlstate 'W2005' THEN NULL;
  END;

  -- 2.4 — mesma trava valendo quando ele é o ÚNICO admin da plataforma.
  -- Remove os demais admins primeiro (a transação faz ROLLBACK), no mesmo
  -- idioma da Seção 2.5 de rbac_smoke.sql.
  DELETE FROM public.user_roles
   WHERE role = 'admin'::public.app_role AND user_id <> v_admin;
  BEGIN
    PERFORM public.delete_platform_user(v_admin);
    RAISE EXCEPTION 'FALHA 2.4: último admin da plataforma excluiu a si mesmo';
  EXCEPTION WHEN sqlstate 'W2005' THEN NULL;
  END;

  -- 2.5 — uuid que não existe em auth.users
  BEGIN
    PERFORM public.delete_platform_user(v_ghost);
    RAISE EXCEPTION 'FALHA 2.5: uuid inexistente foi aceito';
  EXCEPTION WHEN sqlstate 'W2004' THEN NULL;
  END;

  -- 2.6 — nenhuma das tentativas acima deixou rastro
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_target) THEN
    RAISE EXCEPTION 'FALHA 2.6: papel do alvo sumiu numa tentativa que deveria falhar';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.role_audit_log
     WHERE action = 'delete' AND target_user_id IN (v_admin, v_target, v_ghost)
  ) THEN
    RAISE EXCEPTION 'FALHA 2.7: tentativa recusada gravou linha delete na auditoria';
  END IF;

  RAISE NOTICE 'Seção 2 OK';
END $$;

-- ============================================================
-- Seção 3 — Caminho feliz: usuário COM papel e rotas
-- ============================================================
DO $$
DECLARE
  v_admin  uuid := 'd4444444-4444-4444-4444-444444444444';
  v_target uuid := 'd5555555-5555-5555-5555-555555555555';
  v_count  int;
  v_prev   public.app_role;
  v_email  text;
  v_actor  uuid;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'del-smoke-admin2@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_target, 'authenticated', 'authenticated',
     'del-smoke-viewer@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_admin, 'admin'), (v_target, 'viewer');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.set_user_routes(v_target,
    ARRAY['alocacoes', 'compromisso']::public.app_route[]);

  PERFORM public.delete_platform_user(v_target);

  -- 3.1 — papel removido
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_target) THEN
    RAISE EXCEPTION 'FALHA 3.1: papel do usuário excluído permaneceu';
  END IF;

  -- 3.2 — rotas removidas
  SELECT count(*) INTO v_count
    FROM public.user_route_access WHERE user_id = v_target;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 3.2: % rota(s) sobraram para o usuário excluído', v_count;
  END IF;

  -- 3.3 — exatamente uma linha delete, com ator, e-mail e papel anterior
  SELECT count(*) INTO v_count
    FROM public.role_audit_log
   WHERE action = 'delete' AND target_user_id = v_target;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 3.3: esperava 1 linha delete na auditoria, achou %', v_count;
  END IF;

  SELECT previous_role, target_email, actor_user_id
    INTO v_prev, v_email, v_actor
    FROM public.role_audit_log
   WHERE action = 'delete' AND target_user_id = v_target;

  IF v_prev <> 'viewer'::public.app_role THEN
    RAISE EXCEPTION 'FALHA 3.4: previous_role da exclusão é % (esperava viewer)', v_prev;
  END IF;
  IF v_email <> 'del-smoke-viewer@test.local' THEN
    RAISE EXCEPTION 'FALHA 3.5: target_email da exclusão é % (esperava o e-mail do alvo)', v_email;
  END IF;
  IF v_actor <> v_admin THEN
    RAISE EXCEPTION 'FALHA 3.6: actor_user_id da exclusão é % (esperava o admin)', v_actor;
  END IF;

  -- 3.7 — o override desligou o 'revoke' padrão: a exclusão não pode gerar
  -- as duas linhas para o mesmo evento
  SELECT count(*) INTO v_count
    FROM public.role_audit_log
   WHERE action = 'revoke' AND target_user_id = v_target;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 3.7: exclusão gerou % linha(s) revoke além da delete', v_count;
  END IF;

  -- 3.8 — uma linha route_revoke por rota que existia
  SELECT count(*) INTO v_count
    FROM public.role_audit_log
   WHERE action = 'route_revoke' AND target_user_id = v_target;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FALHA 3.8: esperava 2 linhas route_revoke, achou %', v_count;
  END IF;

  RAISE NOTICE 'Seção 3 OK';
END $$;

-- ============================================================
-- Seção 4 — Caminho feliz: usuário SEM papel ("Sem acesso")
-- ============================================================
-- Sem linha em user_roles o trigger de auditoria não dispara. Se a RPC não
-- inserisse a linha explicitamente, excluir um "Sem acesso" passaria em
-- branco no Histórico.
DO $$
DECLARE
  v_admin  uuid := 'd6666666-6666-6666-6666-666666666666';
  v_target uuid := 'd7777777-7777-7777-7777-777777777777';
  v_count  int;
  v_prev   public.app_role;
  v_new    public.app_role;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'del-smoke-admin3@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_target, 'authenticated', 'authenticated',
     'del-smoke-norole@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  PERFORM public.delete_platform_user(v_target);

  SELECT count(*) INTO v_count
    FROM public.role_audit_log
   WHERE action = 'delete' AND target_user_id = v_target;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 4.1: usuário sem papel gerou % linha(s) delete (esperava 1)', v_count;
  END IF;

  SELECT previous_role, new_role INTO v_prev, v_new
    FROM public.role_audit_log
   WHERE action = 'delete' AND target_user_id = v_target;
  IF v_prev IS NOT NULL OR v_new IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 4.2: exclusão de usuário sem papel gravou papel (% → %)', v_prev, v_new;
  END IF;

  RAISE NOTICE 'Seção 4 OK';
END $$;

-- ============================================================
-- Seção 5 — Convite pendente
-- ============================================================
DO $$
DECLARE
  v_admin    uuid := 'd8888888-8888-8888-8888-888888888888';
  v_pending  uuid := 'da111111-1111-1111-1111-111111111111';
  v_consumed uuid := 'da222222-2222-2222-2222-222222222222';
  v_count    int;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'del-smoke-admin4@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_pending, 'authenticated', 'authenticated',
     'del-smoke-pending@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_consumed, 'authenticated', 'authenticated',
     'del-smoke-consumed@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');

  INSERT INTO public.invitations (email, role, routes, invited_by, consumed_at) VALUES
    ('del-smoke-pending@test.local', 'viewer',
     ARRAY['alocacoes']::public.app_route[], v_admin, NULL),
    ('del-smoke-consumed@test.local', 'editor',
     ARRAY['alocacoes']::public.app_route[], v_admin, now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  PERFORM public.delete_platform_user(v_pending);
  SELECT count(*) INTO v_count FROM public.invitations
   WHERE email = 'del-smoke-pending@test.local';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 5.1: convite pendente sobreviveu à exclusão (achou %)', v_count;
  END IF;

  -- Convite já consumido é histórico, não é caminho de volta: não se apaga.
  PERFORM public.delete_platform_user(v_consumed);
  SELECT count(*) INTO v_count FROM public.invitations
   WHERE email = 'del-smoke-consumed@test.local' AND consumed_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 5.2: convite já consumido foi apagado pela exclusão';
  END IF;

  RAISE NOTICE 'Seção 5 OK';
END $$;

-- ============================================================
-- Seção 6 — Nada fora do escopo é tocado
-- ============================================================
-- O quadro de alocação não referencia auth.users (public.devs é cadastro
-- próprio, allocations.dev_id aponta para devs) — esta seção fixa esse fato
-- como asserção para que uma FK futura não passe despercebida.
DO $$
DECLARE
  v_admin  uuid := 'da333333-3333-3333-3333-333333333333';
  v_target uuid := 'da444444-4444-4444-4444-444444444444';
  v_devs_antes int;
  v_devs_depois int;
  v_hist int;
BEGIN
  SELECT count(*) INTO v_devs_antes FROM public.devs;

  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'del-smoke-admin5@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_target, 'authenticated', 'authenticated',
     'del-smoke-hist@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_admin, 'admin'), (v_target, 'editor');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- Histórico anterior do alvo (a concessão do papel acima)
  SELECT count(*) INTO v_hist FROM public.role_audit_log
   WHERE target_user_id = v_target AND action = 'grant';
  IF v_hist = 0 THEN
    RAISE EXCEPTION 'FALHA 6.1: fixture não gerou histórico anterior para o alvo';
  END IF;

  PERFORM public.delete_platform_user(v_target);

  SELECT count(*) INTO v_devs_depois FROM public.devs;
  IF v_devs_antes <> v_devs_depois THEN
    RAISE EXCEPTION 'FALHA 6.2: public.devs mudou de % para % durante a exclusão',
      v_devs_antes, v_devs_depois;
  END IF;

  SELECT count(*) INTO v_hist FROM public.role_audit_log
   WHERE target_user_id = v_target AND action = 'grant';
  IF v_hist = 0 THEN
    RAISE EXCEPTION 'FALHA 6.3: histórico anterior do usuário foi apagado pela exclusão';
  END IF;

  RAISE NOTICE 'Seção 6 OK';
END $$;

ROLLBACK;
```

- [ ] **Step 5: Pedir ao usuário para rodar a suíte**

Mensagem para o usuário (não prosseguir sem resposta):

> Cole `supabase/tests/user_delete_smoke.sql` inteiro no SQL Editor e rode.
> Esperado: `Success. No rows returned` + os NOTICEs `Seção 1 OK` … `Seção 6 OK`.
> Qualquer `ERROR: FALHA N.M` é uma falha real — me mande a mensagem.

Se alguma seção falhar, corrigir a migration (via `CREATE OR REPLACE`, em arquivo novo se a original já foi aplicada) antes de seguir.

- [ ] **Step 6: Atualizar `src/integrations/supabase/types.ts` (3 pontos)**

Ponto 1 — bloco `Functions` (por volta da linha 320), inserir em ordem alfabética, **antes** de `set_user_role`:

```ts
      delete_platform_user: { Args: { _target: string }; Returns: undefined };
```

Ponto 2 — bloco `Enums` (por volta da linha 350), acrescentar `"delete"` ao fim da união:

```ts
      role_audit_action:
        | "invite"
        | "grant"
        | "revoke"
        | "bootstrap"
        | "cancel"
        | "route_grant"
        | "route_revoke"
        | "delete";
```

Ponto 3 — `Constants.public.Enums` (por volta da linha 477), acrescentar `"delete"` ao fim do array:

```ts
      role_audit_action: [
        "invite",
        "grant",
        "revoke",
        "bootstrap",
        "cancel",
        "route_grant",
        "route_revoke",
        "delete",
      ],
```

A ordem no array de `Constants` espelha a ordem física do enum no Postgres (`ALTER TYPE … ADD VALUE` sem `BEFORE`/`AFTER` acrescenta no fim) — `delete` vai por último nos dois.

- [ ] **Step 7: Verificar o TypeScript**

```bash
npx prettier --write src/integrations/supabase/types.ts
```

```bash
npx eslint src/integrations/supabase/types.ts
```

```bash
npx tsc --noEmit
```

Esperado: os três sem saída de erro. `tsc` ainda não conhece `delete_platform_user` em nenhum call site — isso é esperado, a chamada entra na Task 3.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260829120000_user_delete_audit_enum.sql supabase/migrations/20260829121000_user_delete_rpc.sql supabase/tests/user_delete_smoke.sql src/integrations/supabase/types.ts
```

```bash
git commit -m "feat(admin): RPC delete_platform_user com auditoria e trava de autoexclusao

Primeira metade da exclusao de usuario (issue #11). A RPC revoga convite
pendente, papel e rotas, e grava a auditoria ANTES de qualquer remocao em
auth.users -- os triggers resolvem o e-mail do alvo em auth.users no momento
do INSERT, entao apagar a conta primeiro geraria linhas sem identificacao.

W2003 (ultimo admin) e inalcancavel por esta RPC: o ator sempre e um admin
diferente do alvo. O criterio de aceite e cumprido pelo W2005 (autoexclusao);
guard_last_admin fica como rede para caminhos fora da RPC.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Contratos no cliente — tipos, rótulos e erro

**Files:**
- Modify: `src/lib/admin.ts`
- Modify: `src/lib/admin-errors.ts`
- Modify: `src/integrations/supabase/admin.server.ts` (só `fetchPlatformUsers`)

**Interfaces:**
- Consumes: enum `'delete'` do banco (Task 1).
- Produces: `PlatformUser.name: string | null`; `AuditEntry["action"]` inclui `"delete"`; `ACTION_LABELS.delete === "Exclusão"`; `adminErrorMessage` traduz `W2005`.

- [ ] **Step 1: Acrescentar `name` a `PlatformUser` em `src/lib/admin.ts`**

Substituir o tipo existente por:

```ts
export type PlatformUser = {
  id: string;
  email: string;
  // Só existe para quem entrou por um provedor que envia o nome (SSO). Usado
  // apenas na confirmação de exclusão — a listagem continua identificando
  // pelo e-mail.
  name: string | null;
  role: AppRole | null;
  routes: AppRoute[];
  createdAt: string;
  lastSignInAt: string | null;
  pendingInvite: boolean;
};
```

- [ ] **Step 2: Acrescentar `"delete"` a `AuditEntry` e a `ACTION_LABELS` no mesmo arquivo**

Na união de `AuditEntry["action"]`:

```ts
  action:
    | "invite"
    | "grant"
    | "revoke"
    | "bootstrap"
    | "cancel"
    | "route_grant"
    | "route_revoke"
    | "delete";
```

E em `ACTION_LABELS`, ao fim do objeto:

```ts
  delete: "Exclusão",
```

`ACTION_LABELS` é um `Record<AuditEntry["action"], string>`, então esquecer esta linha vira erro de `tsc` — não é possível deixar o rótulo faltando por engano.

- [ ] **Step 3: Acrescentar `W2005` a `src/lib/admin-errors.ts`**

No objeto `MESSAGES`, depois de `W2003`:

```ts
  W2005: "Você não pode excluir a própria conta.",
```

- [ ] **Step 4: Preencher `name` em `fetchPlatformUsers`**

Em `src/integrations/supabase/admin.server.ts`, no `.map((u) => ({ ... }))` final, acrescentar o campo logo depois de `email`:

```ts
      email: u.email ?? "",
      // full_name é o que o Azure/Microsoft manda; name é o fallback de
      // outros provedores. Quem entrou por convite por e-mail não tem
      // nenhum dos dois — a UI cai para o e-mail sozinho.
      name:
        (u.user_metadata?.["full_name"] as string | undefined) ??
        (u.user_metadata?.["name"] as string | undefined) ??
        null,
```

**Acesso por colchete, não por ponto.** `UserMetadata` do supabase-js é uma index signature, e o `tsconfig` do projeto tem `noPropertyAccessFromIndexSignature` — `u.user_metadata?.full_name` reprova com `TS4111`.

- [ ] **Step 5: Verificar**

```bash
npx prettier --write src/lib/admin.ts src/lib/admin-errors.ts src/integrations/supabase/admin.server.ts
```

```bash
npx eslint src/lib/admin.ts src/lib/admin-errors.ts src/integrations/supabase/admin.server.ts
```

```bash
npx tsc --noEmit
```

Esperado: os três sem erro. `TS4111` em `full_name`/`name` significa que o acesso ficou por ponto em vez de colchete — ver a nota do Step 4.

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin.ts src/lib/admin-errors.ts src/integrations/supabase/admin.server.ts
```

```bash
git commit -m "feat(admin): contratos de exclusao no cliente (nome, rotulo, W2005)

PlatformUser ganha name (user_metadata.full_name ?? name), usado so na
confirmacao de exclusao -- a listagem continua identificando pelo e-mail.
AuditEntry aceita a acao delete e ACTION_LABELS a rotula como Exclusao.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Server function de exclusão

**Files:**
- Modify: `src/integrations/supabase/admin.server.ts` (acrescentar `deleteAuthUser`)
- Modify: `src/integrations/supabase/admin-fns.ts` (acrescentar `deletePlatformUser`)

**Interfaces:**
- Consumes: RPC `delete_platform_user` (Task 1); `assertAdmin` e `supabaseAdmin`, já existentes em `admin.server.ts`.
- Produces: `deletePlatformUser({ data: { userId: string } }): Promise<void>` — server fn importável de `@/integrations/supabase/admin-fns`.

- [ ] **Step 1: Acrescentar `deleteAuthUser` a `src/integrations/supabase/admin.server.ts`**

Ao fim do arquivo, depois de `createInviteLink`:

```ts
// SEGUNDA metade da exclusão. Só pode rodar DEPOIS de a RPC
// public.delete_platform_user ter retornado sem erro — os triggers de
// auditoria resolvem o e-mail do alvo em auth.users, então apagar a conta
// antes deixaria o evento sem identificação. Ver a migration
// 20260829121000_user_delete_rpc.sql.
export async function deleteAuthUser(targetId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(targetId);
  if (error) {
    console.error("[admin] deleteUser falhou:", error);
    // A mensagem descreve o estado real: a RPC já comitou, então o acesso
    // está revogado mesmo com a conta ainda listada. Dizer só "não foi
    // possível excluir" faria o admin achar que nada aconteceu.
    throw new Error("O acesso foi revogado, mas a conta não pôde ser removida. Tente novamente.");
  }
}
```

- [ ] **Step 2: Acrescentar a server fn a `src/integrations/supabase/admin-fns.ts`**

Ao fim do arquivo, depois de `generateInviteLink`:

```ts
export const deletePlatformUser = createServerFn({ method: "POST" })
  .validator((data: { userId: string }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<void> => {
    const { assertAdmin, deleteAuthUser } = await import("./admin.server");
    await assertAdmin(context.supabase, context.userId);

    // A RPC roda com o client do PRÓPRIO usuário, não com supabaseAdmin: é o
    // que faz auth.uid() resolver o ator dentro da função (com service_role
    // ela levantaria W2001). Ela valida as invariantes, apaga convite
    // pendente, papel e rotas, e grava a auditoria.
    const { error } = await context.supabase.rpc("delete_platform_user", {
      _target: data.userId,
    });
    if (error) throw error;

    // Só depois de a auditoria estar gravada. Não inverter.
    await deleteAuthUser(data.userId);
  });
```

- [ ] **Step 3: Verificar**

```bash
npx prettier --write src/integrations/supabase/admin.server.ts src/integrations/supabase/admin-fns.ts
```

```bash
npx eslint src/integrations/supabase/admin.server.ts src/integrations/supabase/admin-fns.ts
```

```bash
npx tsc --noEmit
```

Esperado: os três sem erro. Se `tsc` reclamar que `"delete_platform_user"` não existe em `Functions`, a Task 1 Step 6 (ponto 1) não foi aplicada.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/admin.server.ts src/integrations/supabase/admin-fns.ts
```

```bash
git commit -m "feat(admin): server function de exclusao de usuario

Orquestra as duas metades na ordem correta: RPC delete_platform_user com o
client do proprio usuario (para auth.uid() resolver o ator), e so depois
auth.admin.deleteUser com service_role. Se a segunda falhar, o estado e
seguro -- acesso revogado, linha ainda listada -- e a mensagem de erro diz
exatamente isso.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Ação de exclusão na tabela de `/admin`

**Files:**
- Modify: `src/components/admin/UserTable.tsx`

**Interfaces:**
- Consumes: `deletePlatformUser` (Task 3); `PlatformUser.name` (Task 2); `adminErrorMessage` com `W2005` (Task 2).
- Produces: nada — é a ponta da cadeia.

- [ ] **Step 1: Confirmar que `AuditLog.tsx` não precisa mudar**

Ler `src/components/admin/AuditLog.tsx` e verificar que:

- `ACTION_LABELS[e.action]` cobre `"delete"` automaticamente (é um `Record` sobre a união, já estendida na Task 2);
- `changeLabel` decide pelo **dado** (`if (!entry.previous_role && !entry.new_role) return "—"`), não pelo tipo de ação — então a exclusão de um `viewer` renderiza `"Leitor → —"` e a de um usuário sem papel renderiza `"—"`. Os dois estão corretos.

Nenhuma edição neste arquivo. Registrar a conferência e seguir.

- [ ] **Step 2: Acrescentar os imports em `src/components/admin/UserTable.tsx`**

No import de `lucide-react`, acrescentar `Trash2`:

```ts
import { Link2, Trash2 } from "lucide-react";
```

Acrescentar `useState` do React (o arquivo hoje não importa nada de `react`), como primeira linha do arquivo:

```ts
import { useState } from "react";
```

No import de `admin-fns`, acrescentar a server fn:

```ts
import {
  deletePlatformUser,
  generateInviteLink,
  listPlatformUsers,
} from "@/integrations/supabase/admin-fns";
```

E acrescentar o import do `AlertDialog`, junto dos demais imports de `@/components/ui/*`:

```ts
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
```

Acrescentar também o import do tipo, junto do import existente de `@/lib/admin`:

```ts
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type AppRole,
  type PlatformUser,
} from "@/lib/admin";
```

- [ ] **Step 3: Acrescentar o estado e a mutation de exclusão**

Dentro de `UserTable`, logo depois de `const qc = useQueryClient();`:

```tsx
  // Guarda o usuário ALVO (não só o id): o diálogo continua exibindo nome e
  // e-mail durante a exclusão, e a linha some da lista no invalidate.
  const [target, setTarget] = useState<PlatformUser | null>(null);
```

E depois da mutation `newLink`, acrescentar:

```tsx
  const removeUser = useMutation({
    mutationFn: async (userId: string) => {
      await deletePlatformUser({ data: { userId } });
    },
    onSuccess: () => {
      toast.success("Usuário excluído");
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ["platform-users"] });
      void qc.invalidateQueries({ queryKey: ["role-audit"] });
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });
```

O `setTarget(null)` fica só no `onSuccess`: numa falha o diálogo permanece aberto com o alvo à vista, e o `toast` de erro explica o que aconteceu.

- [ ] **Step 4: Acrescentar a coluna no cabeçalho**

Depois de `<TableHead className="w-32">Situação</TableHead>`:

```tsx
            <TableHead className="w-12">
              <span className="sr-only">Ações</span>
            </TableHead>
```

- [ ] **Step 5: Acrescentar a célula de ação em cada linha**

Depois da `<TableCell>` de "Situação", ainda dentro do `users.map`:

```tsx
              <TableCell>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={u.id === currentUserId || removeUser.isPending}
                  title={
                    u.id === currentUserId
                      ? "Você não pode excluir a própria conta"
                      : "Excluir usuário"
                  }
                  aria-label={`Excluir ${u.email}`}
                  onClick={() => setTarget(u)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </TableCell>
```

O `disabled` na própria linha é cortesia — a trava real é o `W2005` da RPC, que roda no servidor e não depende do cliente.

- [ ] **Step 6: Acrescentar o diálogo de confirmação**

O diálogo não pode ficar dentro da `<Table>`, então o `return` passa a devolver um fragmento com dois irmãos: o container da tabela (inalterado) e o `AlertDialog`. São **duas edições cirúrgicas**, sem reescrever o corpo da tabela.

**Edição A — abertura.** Trocar estas duas linhas:

```tsx
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
```

por estas três:

```tsx
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
```

**Edição B — fechamento.** No fim do componente, trocar estas três linhas:

```tsx
    </div>
  );
}
```

por este bloco:

```tsx
      </div>

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              {target?.name ? `${target.name} (${target.email})` : target?.email} perde o acesso
              imediatamente e sai desta lista. O histórico de alterações dele é mantido. Para
              voltar, precisará de um acesso concedido de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeUser.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeUser.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                // Sem isto o Radix fecha o diálogo no clique, e uma falha na
                // exclusão viraria um toast sem contexto nenhum na tela.
                event.preventDefault();
                if (target) removeUser.mutate(target.id);
              }}
            >
              {removeUser.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

A indentação do corpo da tabela fica desalinhada por 2 espaços depois da edição A — o `npx prettier --write` do step seguinte reindenta o arquivo inteiro. Não corrigir à mão.

A frase final do diálogo é deliberadamente genérica em vez de "só volta com um convite novo": hoje o convite é o único caminho, mas a #3 vai acrescentar o login SSO como segundo, e o texto não deve virar mentira quando ela entrar.

- [ ] **Step 7: Verificar**

```bash
npx prettier --write src/components/admin/UserTable.tsx
```

```bash
npx eslint src/components/admin/UserTable.tsx
```

```bash
npx tsc --noEmit
```

Esperado: os três sem erro. Erro de JSX não balanceado aqui aponta para o Step 6 — conferir que a edição A abriu o `<>` e a edição B fechou, nesta ordem, `</AlertDialogFooter>`, `</AlertDialogContent>`, `</AlertDialog>`, `</>`.

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/UserTable.tsx
```

```bash
git commit -m "feat(admin): acao de excluir usuario na listagem com confirmacao nominal

Botao de lixeira por linha, desabilitado na propria linha do admin logado
(a trava real e o W2005 da RPC). A confirmacao usa AlertDialog -- primeiro
consumidor do componente no projeto -- e nomeia o alvo com nome e e-mail.
O dialogo so fecha no sucesso: numa falha o alvo continua a vista.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Verificação manual e fechamento

**Files:** nenhum alterado — esta task é execução e relato.

**Interfaces:**
- Consumes: tudo das Tasks 1-4.
- Produces: confirmação de que os 7 critérios de aceite da issue estão cumpridos.

- [ ] **Step 1: Subir o app**

Usar a ferramenta de preview do harness com a configuração `.claude/launch.json` do projeto. **Não** rodar o dev server pelo Bash.

- [ ] **Step 2: Roteiro, com um administrador logado em `/admin`**

Executar na ordem e anotar o resultado de cada item:

1. **Botão presente e restrito.** A coluna de ação aparece na listagem. Na própria linha (marcada com "(você)") o botão está desabilitado, com o `title` "Você não pode excluir a própria conta".
2. **Confirmação nominal.** Clicar na lixeira de um leitor comum abre o diálogo com nome e e-mail do alvo. Clicar fora **não** fecha (é `AlertDialog`, não `Dialog`). "Cancelar" fecha sem excluir e a linha continua na lista.
3. **Exclusão de usuário com papel.** Confirmar. Esperado: toast "Usuário excluído", a linha some da listagem sem recarregar a página, e a aba **Histórico** mostra uma linha "Exclusão" com o e-mail do alvo, o e-mail do admin e "Leitor → —".
4. **Exclusão de usuário "Sem acesso".** Repetir com um usuário cujo papel esteja em "Sem acesso". Esperado: some da lista, e o Histórico mostra "Exclusão" com a coluna "Mudança" em "—" (não "— → —").
5. **Convite pendente.** Excluir um usuário com situação "Pendente". Depois, abrir o magic link antigo desse usuário. Esperado: ele entra como usuário novo **sem papel nenhum** — o convite foi apagado, então `handle_new_user` não concede nada.
6. **Tema.** Reabrir o diálogo nos temas claro e escuro (`ThemeToggle` no cabeçalho). É o primeiro uso de `AlertDialog` no projeto — conferir contraste do botão destrutivo e do overlay.
7. **Erro traduzido.** Opcional, exige DevTools: chamar `supabase.rpc("delete_platform_user", { _target: "<id do próprio admin>" })` pelo console. Esperado: a UI, se receber esse erro, mostra "Você não pode excluir a própria conta." — confirmando que o `code` `W2005` sobrevive ao transporte. Se o `code` **não** sobreviver pela server function, aplicar o fallback documentado na spec (traduzir no servidor e relançar `new Error(mensagem)`).

- [ ] **Step 3: Conferir os critérios de aceite da issue**

| Critério | Onde está cumprido |
|---|---|
| Ação de excluir na listagem de `/admin` | Task 4, Step 5 |
| Visível e executável só para administrador | Rota `/admin` já gateada + `assertAdmin` (Task 3) + `W2001` (Task 1) |
| Confirmação explícita com nome e e-mail | Task 4, Step 6 |
| Administrador não exclui a própria conta | `W2005` (Task 1) + `disabled` (Task 4, Step 5) |
| Último administrador protegido | Transitivamente pelo `W2005` — ver spec, "Invariantes e onde cada uma mora" |
| Perde o acesso imediatamente | Papel e rotas apagados na RPC; sessões revogadas pelo `deleteUser`. Ressalva do JWT já emitido: spec, "Acesso imediato: o que 'imediatamente' significa" |
| Exclusão registrada no log de auditoria | Ação `delete` (Task 1) + rótulo "Exclusão" (Task 2), verificado nos itens 3 e 4 do roteiro |

- [ ] **Step 4: Relatar ao usuário**

Resumir: o que foi verificado, o que passou, qualquer desvio encontrado. **Não** fazer `git push` — a sincronização com o Lovable é decisão do usuário.
