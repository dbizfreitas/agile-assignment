# Helpers de Autorização para o Quadro de Alocação — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Duas funções SQL (`private.can_view_alocacoes`, `private.can_edit_alocacoes`) substituem a checagem `can_edit_board(...) AND has_route(...,'alocacoes')` escrita à mão em `delete_team`, e viram a convenção documentada para toda RPC `SECURITY DEFINER` futura sobre `teams`/`devs`/`sprints`/`allocations`.

**Architecture:** Duas migrations SQL, nada em TypeScript. A primeira cria os dois helpers (mesmo padrão de `can_edit_board`/`has_route`: `STABLE SECURITY DEFINER SET search_path = public`). A segunda faz `CREATE OR REPLACE FUNCTION public.delete_team(...)` trocando só a linha da guarda de permissão pelo novo helper — o corpo inteiro da função, fora essa linha, é copiado ao pé da letra da versão já aplicada em produção (`20260830130000_team_delete_route_guard.sql`). As 20 policies de RLS existentes não são tocadas — decisão de escopo já registrada na spec.

**Tech Stack:** PostgreSQL 15 (Supabase). Nenhuma dependência de TypeScript/React.

**Spec:** [`docs/superpowers/specs/2026-08-31-helper-autorizacao-alocacoes-design.md`](../specs/2026-08-31-helper-autorizacao-alocacoes-design.md)

**Issue de origem:** achado de altitude do code review do [PR #33](https://github.com/dbizfreitas/agile-assignment/pull/33).

## Global Constraints

- **A rota é fixa em `'alocacoes'`** nos dois helpers — sem parâmetro de rota. Nenhum outro lugar do código combina papel+rota para nenhuma outra rota hoje.
- **As 20 policies de RLS existentes (`teams`/`devs`/`sprints`/`allocations`) NÃO são tocadas.** Se alguma task parecer precisar reescrevê-las, parar e revisar a spec — isso é escopo fora de propósito, não uma omissão.
- **A migration já aplicada `supabase/migrations/20260830130000_team_delete_route_guard.sql` NÃO é editada.** Ela registra o que está rodando em produção agora. O retrofit é um `CREATE OR REPLACE` numa migration NOVA.
- **O corpo de `delete_team` fora da guarda de permissão é copiado byte a byte** da versão em `20260830130000_team_delete_route_guard.sql` — mesmo lock (`ORDER BY id FOR UPDATE`), mesma estrutura de validação de destino, mesmas duas CTEs de renumeração, mesmo `REVOKE`/`GRANT`. A assinatura `(_team uuid, _target uuid DEFAULT NULL) RETURNS void` não muda.
- **SQL em ASCII, sem acentos** — nos comentários e nas mensagens de `RAISE EXCEPTION`, mesmo padrão das migrations existentes.
- **Migrations são aplicadas MANUALMENTE pelo usuário**, no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr` (`https://supabase.com/dashboard/project/nuvrdppxecbowxopbqcr/sql/new`). A ferramenta MCP `query_database` do Lovable **não** deve ser usada — aponta para outro banco (confirmado na issue #23 da mesma base). O agente cria o `.sql`, pede a aplicação e **aguarda confirmação explícita** antes de qualquer step dependente do schema.
- **Nenhuma tabela nova, nenhuma coluna nova, nenhuma policy nova ou alterada.**
- **Não fazer `git push`.** Push é decisão do usuário ao final.
- **Nunca reescrever histórico** (sem `rebase`, `amend`, `squash` de commits publicados).
- **Não commitar `src/routeTree.gen.ts` nem `src/components/compromisso/StatsCards.tsx`** — modificados no working tree por outra frente. Todo `git add` é por caminho explícito, nunca `git add -A`.
- **Mensagens de commit em ASCII** (sem acentos), seguindo o padrão dos commits recentes.
- **Sem test runner neste repositório.** Verificação é smoke SQL em `BEGIN…ROLLBACK`, aplicado manualmente pelo usuário.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `supabase/migrations/20260831140000_alocacoes_auth_helpers.sql` | **Criar.** `private.can_view_alocacoes`, `private.can_edit_alocacoes` + `REVOKE`/`GRANT`. | 1 |
| `supabase/tests/alocacoes_auth_helpers_smoke.sql` | **Criar.** 4 casos de comportamento dos dois helpers. | 1 |
| `supabase/migrations/20260831150000_team_delete_use_auth_helper.sql` | **Criar.** `CREATE OR REPLACE` de `delete_team`, só a guarda muda. | 2 |

Nenhum arquivo TypeScript é tocado nesta frente.

---

## Task 1: Os dois helpers de autorização + smoke test

**Files:**
- Create: `supabase/migrations/20260831140000_alocacoes_auth_helpers.sql`
- Create: `supabase/tests/alocacoes_auth_helpers_smoke.sql`

**Interfaces:**
- Consumes: `private.can_edit_board(uuid)`, `private.can_view_board(uuid)`, `private.has_route(uuid, public.app_route)` — já existentes, não mudam.
- Produces: `private.can_view_alocacoes(_user_id uuid) RETURNS boolean` e `private.can_edit_alocacoes(_user_id uuid) RETURNS boolean`, ambos `SECURITY DEFINER`, chamáveis de dentro de qualquer função `SECURITY DEFINER` ou policy de RLS futura sobre `teams`/`devs`/`sprints`/`allocations`.

- [ ] **Step 1: Criar a migration dos helpers**

Arquivo `supabase/migrations/20260831140000_alocacoes_auth_helpers.sql`:

```sql
-- Helpers de autorizacao para o quadro de alocacao (teams/devs/sprints/
-- allocations), achado de altitude do code review do PR #33.
--
-- O predicado real de acesso a estas quatro tabelas sempre foi "tem o papel
-- certo E tem a rota alocacoes" -- papel sozinho nunca bastou desde que
-- 20260828131000_route_access_rls.sql exigiu as duas coisas. Mas nao havia
-- uma funcao para esse predicado: ele era reescrito a mao em 20+ lugares (16
-- policies de escrita + 4 de leitura + a RPC delete_team), cada um repetindo
-- as mesmas duas linhas.
--
-- A prova de que isso e perigoso, nao so repetitivo: a primeira versao de
-- delete_team (20260830120000_team_delete_rpc.sql) escreveu so a metade —
-- can_edit_board, sem has_route — e produziu uma escalada de privilegio real
-- em producao, corrigida em 20260830130000_team_delete_route_guard.sql.
-- delete_team e SECURITY DEFINER: contorna a RLS por completo, entao nada no
-- Postgres obriga uma checagem escrita a mao ali a bater com o que a RLS ja
-- exige em todo o resto do sistema. Um esquecimento e invisivel ate alguem
-- explorar.
--
-- Estes dois helpers existem para que a proxima RPC SECURITY DEFINER sobre
-- estas quatro tabelas tenha UMA funcao para chamar, em vez de reconstruir o
-- AND de memoria. 'alocacoes' fica fixo no corpo, nao como parametro: e a
-- unica rota que ja combina papel e rota neste sistema hoje, e generalizar
-- agora seria construir para um caso que nao existe.
--
-- As 20 policies de RLS existentes NAO chamam estes helpers e continuam com
-- a checagem inline, de proposito: RLS e declarativa e o Postgres a aplica
-- sempre, sem depender de alguem lembrar de chama-la -- o risco real e
-- exclusivo de codigo SECURITY DEFINER escrito a mao, que e exatamente o que
-- isto endereca. Reescrever as 20 policies por DRY trocaria uma duplicacao
-- inerte por uma migration de 20 DROP+CREATE POLICY, para um ganho so
-- estetico.
CREATE OR REPLACE FUNCTION private.can_view_alocacoes(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.can_view_board(_user_id)
     AND private.has_route(_user_id, 'alocacoes'::public.app_route)
$$;

CREATE OR REPLACE FUNCTION private.can_edit_alocacoes(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.can_edit_board(_user_id)
     AND private.has_route(_user_id, 'alocacoes'::public.app_route)
$$;

REVOKE ALL ON FUNCTION private.can_view_alocacoes(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION private.can_edit_alocacoes(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.can_view_alocacoes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_edit_alocacoes(uuid) TO authenticated, service_role;
```

- [ ] **Step 2: Criar a suíte de smoke**

Arquivo `supabase/tests/alocacoes_auth_helpers_smoke.sql`:

```sql
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
```

- [ ] **Step 3: Pedir ao usuário para aplicar a migration**

Mostrar o caminho do arquivo e o link do SQL Editor (`https://supabase.com/dashboard/project/nuvrdppxecbowxopbqcr/sql/new`). **Parar e aguardar confirmação explícita.** Não seguir para o Step 4 antes disso.

- [ ] **Step 4: Pedir ao usuário para rodar a suíte de smoke**

Colar `supabase/tests/alocacoes_auth_helpers_smoke.sql` no SQL Editor e reportar a saída. Aguardar confirmação de que as 5 seções passaram (`Success. No rows returned`, sem `ERROR`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260831140000_alocacoes_auth_helpers.sql supabase/tests/alocacoes_auth_helpers_smoke.sql
git commit -m "feat(board): helpers can_view_alocacoes e can_edit_alocacoes"
```

---

## Task 2: Retrofit de `delete_team`

**Files:**
- Create: `supabase/migrations/20260831150000_team_delete_use_auth_helper.sql`

**Interfaces:**
- Consumes: `private.can_edit_alocacoes(uuid)` da Task 1 — **precisa estar aplicada em produção antes desta migration ser aplicada**, ou `delete_team` vai falhar com "function private.can_edit_alocacoes(uuid) does not exist" em toda chamada.
- Produces: `public.delete_team(_team uuid, _target uuid DEFAULT NULL) RETURNS void` — mesma assinatura, mesmo contrato de erros (`W4001`–`W4006`) já usado por `src/components/TeamsDialog.tsx` e mapeado em `src/lib/board-errors.ts`. Nenhum dos dois arquivos TypeScript muda.

- [ ] **Step 1: Ler a versão atualmente aplicada**

Abrir `supabase/migrations/20260830130000_team_delete_route_guard.sql` e copiar o corpo inteiro da função — é a fonte da verdade do que está rodando em produção agora. Não editar esse arquivo.

- [ ] **Step 2: Criar a migration do retrofit**

Arquivo `supabase/migrations/20260831150000_team_delete_use_auth_helper.sql`. O corpo é idêntico ao de `20260830130000_team_delete_route_guard.sql`, trocando **só** o bloco da guarda de permissão:

```sql
-- Troca a checagem inline de delete_team pelo helper compartilhado
-- (private.can_edit_alocacoes), criado em
-- 20260831140000_alocacoes_auth_helpers.sql. Nenhum outro comportamento
-- muda -- o corpo abaixo, fora da guarda, e identico ao de
-- 20260830130000_team_delete_route_guard.sql.
CREATE OR REPLACE FUNCTION public.delete_team(_team uuid, _target uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_project text;
  v_target_project text;
  v_people int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida' USING ERRCODE = 'W4001';
  END IF;

  IF NOT private.can_edit_alocacoes(v_actor) THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = 'W4002';
  END IF;

  PERFORM 1 FROM public.teams
   WHERE id IN (_team, _target)
   ORDER BY id
     FOR UPDATE;

  SELECT jira_project INTO v_project FROM public.teams WHERE id = _team;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'Time nao encontrado' USING ERRCODE = 'W4003';
  END IF;

  SELECT count(*) INTO v_people FROM public.devs WHERE team_id = _team;

  IF _target IS NOT NULL THEN
    IF _target = _team THEN
      RAISE EXCEPTION 'Destino igual a origem' USING ERRCODE = 'W4005';
    END IF;

    SELECT jira_project INTO v_target_project FROM public.teams WHERE id = _target;
    IF v_target_project IS NULL THEN
      RAISE EXCEPTION 'Time de destino nao encontrado' USING ERRCODE = 'W4003';
    END IF;

    IF v_target_project IS DISTINCT FROM v_project THEN
      RAISE EXCEPTION 'Destino em outro projeto' USING ERRCODE = 'W4006';
    END IF;
  ELSIF v_people > 0 THEN
    RAISE EXCEPTION 'Time com pessoas exige destino' USING ERRCODE = 'W4004';
  END IF;

  IF v_people > 0 THEN
    UPDATE public.devs SET team_id = _target WHERE team_id = _team;
  END IF;

  DELETE FROM public.teams WHERE id = _team;

  IF v_people > 0 THEN
    WITH ord AS (
      SELECT id, (row_number() OVER (ORDER BY position, name)) - 1 AS pos
        FROM public.devs WHERE team_id = _target
    )
    UPDATE public.devs d SET position = ord.pos
      FROM ord
     WHERE d.id = ord.id AND d.position IS DISTINCT FROM ord.pos;
  END IF;

  WITH ord AS (
    SELECT id, (row_number() OVER (ORDER BY position, name)) - 1 AS pos
      FROM public.teams WHERE jira_project = v_project
  )
  UPDATE public.teams t SET position = ord.pos
    FROM ord
   WHERE t.id = ord.id AND t.position IS DISTINCT FROM ord.pos;
END $$;

REVOKE ALL ON FUNCTION public.delete_team(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_team(uuid, uuid) TO authenticated, service_role;
```

**Antes de prosseguir:** confira este corpo contra `supabase/migrations/20260830130000_team_delete_route_guard.sql` linha a linha. A única diferença permitida é o bloco `IF NOT private.can_edit_alocacoes(v_actor) THEN … END IF;` no lugar de `IF NOT (private.can_edit_board(v_actor) AND private.has_route(...)) THEN … END IF;`. Qualquer outra diferença é um erro de transcrição — pare e corrija antes do Step 3.

- [ ] **Step 3: Pedir ao usuário para aplicar a migration**

**Só depois que a Task 1 estiver aplicada e confirmada** (os helpers precisam existir antes desta migration rodar). Mostrar o caminho do arquivo e o link do SQL Editor. Aguardar confirmação explícita.

- [ ] **Step 4: Pedir ao usuário para rodar a suíte de regressão de `delete_team`**

Arquivo **já existente**, sem nenhuma modificação: `supabase/tests/team_delete_smoke.sql` (7 seções). Pedir para colar e rodar no mesmo SQL Editor. O objetivo é provar que `delete_team` se comporta exatamente igual a antes — a Seção 7 em particular (editor sem a rota `alocacoes`) precisa continuar levantando `W4002`, agora através do novo helper em vez da checagem inline. Aguardar confirmação de que as 7 seções passaram.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260831150000_team_delete_use_auth_helper.sql
git commit -m "fix(board): delete_team usa o helper can_edit_alocacoes"
```

---

## Task 3: Fechamento

- [ ] **Step 1: Conferir o diff completo**

```bash
git status --short
```

`src/routeTree.gen.ts` e `src/components/compromisso/StatsCards.tsx` devem continuar como `M` **não commitados**. Se tiverem entrado em algum commit, parar e avisar o usuário.

- [ ] **Step 2: Conferir a spec ponta a ponta**

Reler `docs/superpowers/specs/2026-08-31-helper-autorizacao-alocacoes-design.md` contra o que foi feito: os dois helpers existem e têm o comportamento dos 5 casos da Task 1; `delete_team` usa `can_edit_alocacoes` e passa nas 7 seções da suíte já existente; nenhuma policy de RLS foi tocada; nenhum arquivo TypeScript mudou.

- [ ] **Step 3: Não fazer push**

Informar o usuário de que os commits estão locais e o push é decisão dele.
