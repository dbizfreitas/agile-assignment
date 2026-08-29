# Permissões por Rota — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um admin passa a conceder, por usuário, quais das 4 guias (Compromisso, Cycle Time, Retrospectivas, Alocações) ele acessa — com o bloqueio valendo de verdade em Alocações (RLS) e em Compromisso/Cycle Time (server function), não só escondendo botão.

**Architecture:** Tabela nova `public.user_route_access (user_id, route)`, aditiva a `user_roles` — papel continua global, rota é um eixo independente. `private.has_route(uid, route)` é o helper de leitura, usado tanto pelas policies de RLS de `devs/teams/sprints/allocations` quanto pela função `assertRouteAccess` que substitui `assertCanViewBoard` nas 5 server functions de Jira. No cliente, `_shell.tsx` ganha um guard central por rota antes do `<Outlet/>` (em vez de duplicar o check em 4 rotas-filha), e `AppShell.tsx` filtra a navegação pela mesma fonte. A UI de concessão é uma coluna nova (`ToggleGroup` de 4 ícones) na tabela `/admin` já existente — sem aba nova.

**Tech Stack:** PostgreSQL 15 (Supabase), TanStack Start 1.168 + React 19, TanStack Query v5, shadcn/ui (Radix ToggleGroup/Table/Select), Tailwind, TypeScript 5.8 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Node 24.

**Spec:** [`docs/superpowers/specs/2026-08-28-permissoes-por-rota-design.md`](../specs/2026-08-28-permissoes-por-rota-design.md)

**Issue:** [dbizfreitas/agile-assignment#23](https://github.com/dbizfreitas/agile-assignment/issues/23)

## Global Constraints

- **Idioma da UI:** pt-BR em todo texto visível, com acentuação correta.
- **Papel global não muda.** `user_roles` (`admin/editor/viewer`) permanece intocado. Rota é um eixo novo e independente — nunca combine os dois num único campo.
- **Fora de escopo (decidido na spec, não implementar aqui):** proteção real do dado de Retrospectivas (rastreado em [#24](https://github.com/dbizfreitas/agile-assignment/issues/24)); provisionamento automático via SSO sem convite prévio (rastreado em [#3](https://github.com/dbizfreitas/agile-assignment/issues/3)); nível de acesso por rota (ex.: "editor só de Alocações"); `/admin` como rota da grade — continua derivada de `role = 'admin'`.
- **`src/routes/_shell/index.tsx` não muda.** Continua redirecionando para `/alocacoes`; se o usuário não tiver essa rota, o guard central de `_shell.tsx` cobre o caso (ver Task 7). Calcular "primeira rota acessível" não foi pedido pelos critérios de aceite.
- **Sem test runner.** `package.json` só tem `dev`, `build`, `build:dev`, `preview`, `lint`, `format` — esta demanda não introduz um. Verificação: smoke SQL (roda em `BEGIN...ROLLBACK`, sem resíduo) para o banco; `tsc`/`eslint` para o TypeScript; roteiro manual para UI e para os 5 endpoints Jira (não há como testar RLS de server function sem sessão real).
- **Migrations são aplicadas MANUALMENTE pelo usuário, no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr`** (`https://supabase.com/dashboard/project/nuvrdppxecbowxopbqcr/sql/new`) — esse é o projeto real, o mesmo do `.env`/`supabase/config.toml` deste repositório. **A ferramenta MCP `query_database` do Lovable (`project_id ec89b9ca-8900-4590-a9be-687542db3778`) NÃO deve ser usada para aplicar ou verificar estas migrations** — ela aponta para um banco Postgres diferente (provisionado separadamente pelo Lovable), confirmado na prática: uma migration aplicada por ela não apareceu no banco real (`user_route_access` ausente via `GET .../rest/v1/user_route_access` → `PGRST205`, enquanto `user_roles`, que existe de verdade, respondeu normalmente). O subagente cria o arquivo `.sql` e o `.md` do report pedindo para o usuário colar o conteúdo no SQL Editor, aguarda a confirmação do usuário ("apliquei, deu sucesso" ou a mensagem de erro) antes de seguir para os próximos steps que dependem do schema (ex.: o smoke test).
- **`src/integrations/supabase/types.ts` é editado à mão** — mesma convenção já usada para `invitations`, `role_audit_log`, `allocations.tickets`.
- **`set_user_routes` substitui a lista inteira, não faz delta.** O cliente sempre manda o array completo de rotas que o usuário deve ter ao final — mesmo padrão de `ToggleGroup` controlado (o componente já entrega o array final em `onValueChange`).
- **Não fazer `git push`.** O repositório sincroniza com o Lovable; o push é decisão do usuário ao final.
- **Nunca reescrever histórico** (sem `rebase`, `amend` ou `squash` de commits publicados) — restrição do `AGENTS.md`.
- **Não commitar `src/routeTree.gen.ts`.** Já chega modificado no working tree e não é desta frente. Todo `git add` é por caminho explícito, nunca `git add -A`.

### Verificação de código: sempre nesta ordem, só nos arquivos tocados

```bash
npx prettier --write <arquivos tocados>
npx eslint <arquivos tocados>
npx tsc --noEmit
```

**Nunca rodar `npm run lint` sem escopo** — o checkout usa `core.autocrlf=true`, então arquivos não tocados por esta demanda reprovam a regra `prettier/prettier` por causa de CRLF pré-existente. `npx eslint <arquivo>` isolado evita esse ruído.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `supabase/migrations/20260828130000_route_access_foundation.sql` | **Criar.** Enum `app_route`, tabela `user_route_access` + backfill, `private.has_route`, RPC `set_user_routes`. | 1 |
| `supabase/tests/route_access_smoke.sql` | **Criar**, depois **modificar** (Tasks 2-4 acrescentam seções). | 1-4 |
| `src/integrations/supabase/types.ts` | **Modificar** em 4 pontos (Tasks 1, 3, 4). | 1, 3, 4 |
| `supabase/migrations/20260828131000_route_access_rls.sql` | **Criar.** RLS de `devs/teams/sprints/allocations` ciente de rota. | 2 |
| `supabase/migrations/20260828132000_route_access_audit_enum.sql` | **Criar.** Só os 2 `ALTER TYPE ADD VALUE` — isolados por causa da trava de transação do Postgres. | 3 |
| `supabase/migrations/20260828132500_route_access_audit_trigger.sql` | **Criar.** Coluna `route` em `role_audit_log` + trigger `audit_user_route_access`. | 3 |
| `supabase/migrations/20260828133000_route_access_invitations.sql` | **Criar.** `invitations.routes`, `create_invitation` e `handle_new_user` atualizados. | 4 |
| `src/integrations/jira/access.server.ts` | **Reescrever.** `assertRouteAccess` + `assertAnyRouteAccess` no lugar de `assertCanViewBoard`. | 5 |
| `src/integrations/jira/server-fns.ts` | **Modificar.** 5 call sites passam a rota exigida. | 5 |
| `src/components/shell/tabs.ts` | **Modificar.** Exporta `AppRoute` derivado de `TABS`. | 6 |
| `src/hooks/use-routes.ts` | **Criar.** `{ routes: Set<AppRoute>, loading }`. | 6 |
| `src/hooks/use-authorized-session.ts` | **Modificar.** Agrega `routes`. | 6 |
| `src/components/shell/shell-context.tsx` | **Modificar.** `ShellContextValue.routes`. | 7 |
| `src/routes/_shell.tsx` | **Modificar.** Guard central por rota antes do `<Outlet/>`. | 7 |
| `src/components/shell/AppShell.tsx` | **Modificar.** Filtra `TABS` por `routes`. | 7 |
| `src/routes/embed.alocacoes.tsx` | **Modificar.** Gate ganha `routes.has('alocacoes')`. | 7 |
| `src/lib/admin.ts` | **Modificar.** `PlatformUser.routes`, `AuditEntry.route`, `ACTION_LABELS`. | 8 |
| `src/integrations/supabase/admin.server.ts` | **Modificar.** `fetchPlatformUsers` inclui rotas por usuário. | 8 |
| `src/components/admin/UserTable.tsx` | **Modificar.** Coluna `ToggleGroup` de rotas. | 9 |
| `src/components/admin/InviteDialog.tsx` | **Modificar.** Default de rotas no convite. | 10 |
| `src/components/admin/AuditLog.tsx` | **Modificar.** Coluna "Rota" no histórico. | 11 |

---

## Task 1: Fundação do banco — enum, tabela, helper, RPC

**Files:**
- Create: `supabase/migrations/20260828130000_route_access_foundation.sql`
- Create: `supabase/tests/route_access_smoke.sql`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes: `private.has_role(uuid, app_role)` e `public.user_roles` (já existentes).
- Produces: enum `public.app_route` (`'compromisso' | 'cycle-time' | 'retrospectivas' | 'alocacoes'`); tabela `public.user_route_access(user_id, route, granted_by, created_at)`; função `private.has_route(_user_id uuid, _route public.app_route) RETURNS boolean`; RPC `public.set_user_routes(_target uuid, _routes public.app_route[]) RETURNS void`. As Tasks 2-11 dependem desses nomes exatos.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260828130000_route_access_foundation.sql`:

```sql
-- ============================================================
-- 1. Enum de rotas — os 4 valores são os mesmos `id` de src/components/shell/tabs.ts
-- ============================================================
CREATE TYPE public.app_route AS ENUM
  ('compromisso', 'cycle-time', 'retrospectivas', 'alocacoes');

-- ============================================================
-- 2. Tabela de rotas por usuário — aditiva a user_roles, eixo independente
-- ============================================================
CREATE TABLE public.user_route_access (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route public.app_route NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route)
);

GRANT SELECT ON public.user_route_access TO authenticated;
ALTER TABLE public.user_route_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY route_access_select_own ON public.user_route_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY route_access_select_admin ON public.user_route_access
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));
-- Sem policy de INSERT/UPDATE/DELETE: só a RPC SECURITY DEFINER abaixo escreve.

-- ============================================================
-- 3. Backfill — ninguém perde acesso no deploy: todo usuário com papel hoje
-- recebe as 4 rotas.
-- ============================================================
INSERT INTO public.user_route_access (user_id, route)
SELECT ur.user_id, r.route
  FROM public.user_roles ur
 CROSS JOIN unnest(enum_range(NULL::public.app_route)) AS r(route)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. Helper de leitura — mesmo padrão de private.can_view_board
-- ============================================================
CREATE OR REPLACE FUNCTION private.has_route(_user_id uuid, _route public.app_route)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_route_access
     WHERE user_id = _user_id AND route = _route
  )
$$;

REVOKE ALL ON FUNCTION private.has_route(uuid, public.app_route) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.has_route(uuid, public.app_route)
  TO authenticated, service_role;

-- ============================================================
-- 5. RPC de mutação — só admin, substituição pela lista completa
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_user_routes(_target uuid, _routes public.app_route[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  PERFORM set_config('app.actor_id', v_actor::text, true);

  DELETE FROM public.user_route_access
   WHERE user_id = _target AND route <> ALL(_routes);

  INSERT INTO public.user_route_access (user_id, route, granted_by)
  SELECT _target, r, v_actor FROM unnest(_routes) AS r
  ON CONFLICT (user_id, route) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.set_user_routes(uuid, public.app_route[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_routes(uuid, public.app_route[]) TO authenticated;
```

- [ ] **Step 2: Aplicar a migration**

Pedir ao usuário para colar o conteúdo integral do arquivo no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr` e executar. Aguardar a confirmação do usuário (sucesso ou a mensagem de erro) antes de seguir para o Step 3.

- [ ] **Step 3: Escrever o smoke test (Seção 1)**

Criar `supabase/tests/route_access_smoke.sql`:

```sql
-- Suíte de verificação de permissões por rota (issue #23).
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
BEGIN;

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

  RAISE NOTICE 'Seção 1 OK';
END $$;

ROLLBACK;
```

- [ ] **Step 4: Rodar o smoke test**

Pedir ao usuário para colar o conteúdo de `route_access_smoke.sql` no mesmo SQL Editor e executar. Esperado: `NOTICE: Seção 1 OK`, sem `ERROR`. Aguardar a confirmação do usuário antes de seguir.

- [ ] **Step 5: Editar `src/integrations/supabase/types.ts` — tabela nova**

Localizar o bloco `user_roles: { ... }` (termina com `Relationships: []\n      }` logo antes de `\n    }\n    Views: {`). Inserir imediatamente depois desse bloco, ainda dentro de `Tables: {`:

```ts
      user_route_access: {
        Row: {
          created_at: string
          granted_by: string | null
          route: Database["public"]["Enums"]["app_route"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          route: Database["public"]["Enums"]["app_route"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          route?: Database["public"]["Enums"]["app_route"]
          user_id?: string
        }
        Relationships: []
      }
```

- [ ] **Step 6: Editar `types.ts` — função nova**

Localizar `set_user_role: { Args: { ... }; Returns: undefined }` dentro de `Functions: {`. Inserir logo depois:

```ts
      set_user_routes: {
        Args: {
          _routes: Database["public"]["Enums"]["app_route"][]
          _target: string
        }
        Returns: undefined
      }
```

- [ ] **Step 7: Editar `types.ts` — enum novo**

Localizar a linha `app_role: "admin" | "editor" | "viewer"` dentro de `Enums: {`. Inserir logo depois:

```ts
      app_route: "compromisso" | "cycle-time" | "retrospectivas" | "alocacoes"
```

- [ ] **Step 8: Editar `types.ts` — `Constants`**

Localizar `app_role: ["admin", "editor", "viewer"],` dentro de `export const Constants = { public: { Enums: {`. Inserir logo depois:

```ts
      app_route: ["compromisso", "cycle-time", "retrospectivas", "alocacoes"],
```

- [ ] **Step 9: Verificar o TypeScript**

```bash
npx prettier --write src/integrations/supabase/types.ts
npx eslint src/integrations/supabase/types.ts
npx tsc --noEmit
```

Esperado: sem erros novos (`tsc --noEmit` pode listar erros pré-existentes em outros arquivos — só os deste arquivo importam aqui).

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260828130000_route_access_foundation.sql supabase/tests/route_access_smoke.sql src/integrations/supabase/types.ts
git commit -m "feat(rbac): adiciona user_route_access, has_route e set_user_routes"
```

---

## Task 2: RLS de Alocações ciente de rota

**Files:**
- Create: `supabase/migrations/20260828131000_route_access_rls.sql`
- Modify: `supabase/tests/route_access_smoke.sql`

**Interfaces:**
- Consumes: `private.has_route` (Task 1), `private.can_edit_board` (já existe).
- Produces: policies `devs_select_route`, `teams_select_route`, `sprints_select_route`, `allocations_select_route` (leitura) e as 12 policies de escrita (`*_insert_editors`, `*_update_editors`, `*_delete_editors`) recriadas exigindo `has_route`. Nenhuma função ou tipo novo — Tasks seguintes não dependem de nomes daqui além dos já existentes.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260828131000_route_access_rls.sql`:

```sql
-- ============================================================
-- 1. Leitura — troca can_view_board (qualquer papel) por has_route (a rota
-- específica de Alocações)
-- ============================================================
DROP POLICY devs_select_viewers ON public.devs;
CREATE POLICY devs_select_route ON public.devs
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'alocacoes'::public.app_route));

DROP POLICY teams_select_viewers ON public.teams;
CREATE POLICY teams_select_route ON public.teams
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'alocacoes'::public.app_route));

DROP POLICY sprints_select_viewers ON public.sprints;
CREATE POLICY sprints_select_route ON public.sprints
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'alocacoes'::public.app_route));

DROP POLICY allocations_select_viewers ON public.allocations;
CREATE POLICY allocations_select_route ON public.allocations
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'alocacoes'::public.app_route));

-- ============================================================
-- 2. Escrita — exige as duas coisas: papel editor/admin E a rota
-- ============================================================
DROP POLICY devs_insert_editors ON public.devs;
CREATE POLICY devs_insert_editors ON public.devs
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY devs_update_editors ON public.devs;
CREATE POLICY devs_update_editors ON public.devs
  FOR UPDATE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  )
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY devs_delete_editors ON public.devs;
CREATE POLICY devs_delete_editors ON public.devs
  FOR DELETE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY teams_insert_editors ON public.teams;
CREATE POLICY teams_insert_editors ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY teams_update_editors ON public.teams;
CREATE POLICY teams_update_editors ON public.teams
  FOR UPDATE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  )
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY teams_delete_editors ON public.teams;
CREATE POLICY teams_delete_editors ON public.teams
  FOR DELETE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY sprints_insert_editors ON public.sprints;
CREATE POLICY sprints_insert_editors ON public.sprints
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY sprints_update_editors ON public.sprints;
CREATE POLICY sprints_update_editors ON public.sprints
  FOR UPDATE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  )
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY sprints_delete_editors ON public.sprints;
CREATE POLICY sprints_delete_editors ON public.sprints
  FOR DELETE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY allocations_insert_editors ON public.allocations;
CREATE POLICY allocations_insert_editors ON public.allocations
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY allocations_update_editors ON public.allocations;
CREATE POLICY allocations_update_editors ON public.allocations
  FOR UPDATE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  )
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY allocations_delete_editors ON public.allocations;
CREATE POLICY allocations_delete_editors ON public.allocations
  FOR DELETE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
```

- [ ] **Step 2: Aplicar a migration**

Pedir ao usuário para colar o conteúdo integral do arquivo no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr` e executar. Aguardar confirmação antes de seguir.

- [ ] **Step 3: Acrescentar a Seção 2 ao smoke test**

Adicionar ao final de `supabase/tests/route_access_smoke.sql`, **antes** da linha `ROLLBACK;`:

```sql
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

  RAISE NOTICE 'Seção 2 OK';
END $$;
```

- [ ] **Step 4: Rodar o smoke test completo**

Pedir ao usuário para colar o arquivo inteiro (Seções 1 e 2) no SQL Editor e executar. Esperado: `Seção 1 OK`, `Seção 2 OK`, sem `ERROR`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260828131000_route_access_rls.sql supabase/tests/route_access_smoke.sql
git commit -m "feat(rbac): RLS de Alocacoes passa a exigir a rota, nao so o papel"
```

---

## Task 3: Auditoria de concessão/revogação de rota

**Files:**
- Create: `supabase/migrations/20260828132000_route_access_audit_enum.sql`
- Create: `supabase/migrations/20260828132500_route_access_audit_trigger.sql`
- Modify: `supabase/tests/route_access_smoke.sql`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes: `role_audit_log` (existe), `app_route` (Task 1), `set_config('app.actor_id', ...)` (já usado por `audit_user_roles`).
- Produces: valores de enum `role_audit_action` `'route_grant'` e `'route_revoke'`; coluna `public.role_audit_log.route public.app_route`; trigger `audit_user_route_access` em `user_route_access`. Task 11 (`AuditLog.tsx`) depende da coluna `route` e dos dois valores de ação.

- [ ] **Step 1: Escrever e aplicar a migration do enum (isolada)**

Criar `supabase/migrations/20260828132000_route_access_audit_enum.sql`:

```sql
-- Isolado em migration própria: um valor de enum recém-criado não pode ser
-- usado (comparado/castado) na mesma transação em que foi adicionado. A
-- trigger da próxima migration referencia estes dois valores.
ALTER TYPE public.role_audit_action ADD VALUE 'route_grant';
ALTER TYPE public.role_audit_action ADD VALUE 'route_revoke';
```

Pedir ao usuário para colar o conteúdo integral do arquivo no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr` e executar. Aguardar confirmação **antes** de seguir para o Step 2 — os dois `ALTER TYPE ADD VALUE` precisam commitar em transações separadas do que os usa.

- [ ] **Step 2: Escrever e aplicar a migration da coluna e do trigger**

Criar `supabase/migrations/20260828132500_route_access_audit_trigger.sql`:

```sql
-- ============================================================
-- 1. Coluna de rota na auditoria — NULL para eventos do eixo de papel
-- ============================================================
ALTER TABLE public.role_audit_log ADD COLUMN route public.app_route;

-- ============================================================
-- 2. Trigger — mesma forma de private.audit_user_roles
-- ============================================================
CREATE OR REPLACE FUNCTION private.audit_user_route_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_target uuid;
  v_route public.app_route;
  v_action public.role_audit_action;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_target := NEW.user_id; v_route := NEW.route; v_action := 'route_grant';
  ELSE
    v_target := OLD.user_id; v_route := OLD.route; v_action := 'route_revoke';
  END IF;

  INSERT INTO public.role_audit_log (
    action, target_user_id, target_email,
    actor_user_id, actor_email, route
  ) VALUES (
    v_action,
    v_target,
    (SELECT email FROM auth.users WHERE id = v_target),
    v_actor,
    (SELECT email FROM auth.users WHERE id = v_actor),
    v_route
  );

  RETURN NULL;
END $$;

CREATE TRIGGER audit_user_route_access
AFTER INSERT OR DELETE ON public.user_route_access
FOR EACH ROW EXECUTE FUNCTION private.audit_user_route_access();
```

Pedir ao usuário para colar o conteúdo integral deste segundo arquivo no SQL Editor e executar. Aguardar confirmação.

- [ ] **Step 3: Acrescentar a Seção 3 ao smoke test**

Adicionar ao final de `supabase/tests/route_access_smoke.sql`, **antes** de `ROLLBACK;`:

```sql
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
```

- [ ] **Step 4: Rodar o smoke test completo**

Pedir ao usuário para colar o conteúdo integral de `route_access_smoke.sql` (Seções 1-3) no SQL Editor e executar. Esperado: `Seção 1 OK`, `Seção 2 OK`, `Seção 3 OK`, sem `ERROR`.

- [ ] **Step 5: Editar `types.ts` — enum `role_audit_action` e coluna `route`**

Localizar `role_audit_action: "invite" | "grant" | "revoke" | "bootstrap" | "cancel"` (dentro de `Enums:`) e substituir por:

```ts
      role_audit_action: "invite" | "grant" | "revoke" | "bootstrap" | "cancel" | "route_grant" | "route_revoke"
```

Localizar o bloco `role_audit_log: { Row: { ... } ... }` (as três seções `Row`/`Insert`/`Update`) e adicionar `route` em cada uma, junto das demais colunas opcionais (ordem alfabética, entre `previous_role` e `target_email`):

```ts
        Row: {
          action: Database["public"]["Enums"]["role_audit_action"]
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          id: string
          new_role: Database["public"]["Enums"]["app_role"] | null
          previous_role: Database["public"]["Enums"]["app_role"] | null
          route: Database["public"]["Enums"]["app_route"] | null
          target_email: string | null
          target_user_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["role_audit_action"]
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          new_role?: Database["public"]["Enums"]["app_role"] | null
          previous_role?: Database["public"]["Enums"]["app_role"] | null
          route?: Database["public"]["Enums"]["app_route"] | null
          target_email?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["role_audit_action"]
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          id?: string
          new_role?: Database["public"]["Enums"]["app_role"] | null
          previous_role?: Database["public"]["Enums"]["app_role"] | null
          route?: Database["public"]["Enums"]["app_route"] | null
          target_email?: string | null
          target_user_id?: string | null
        }
```

- [ ] **Step 6: Editar `types.ts` — `Constants.role_audit_action`**

Localizar `role_audit_action: ["invite", "grant", "revoke", "bootstrap", "cancel"],` e substituir por:

```ts
      role_audit_action: ["invite", "grant", "revoke", "bootstrap", "cancel", "route_grant", "route_revoke"],
```

- [ ] **Step 7: Verificar o TypeScript**

```bash
npx prettier --write src/integrations/supabase/types.ts
npx eslint src/integrations/supabase/types.ts
npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260828132000_route_access_audit_enum.sql supabase/migrations/20260828132500_route_access_audit_trigger.sql supabase/tests/route_access_smoke.sql src/integrations/supabase/types.ts
git commit -m "feat(rbac): audita concessao e revogacao de rota em role_audit_log"
```

---

## Task 4: Convite e provisionamento com rota padrão

**Files:**
- Create: `supabase/migrations/20260828133000_route_access_invitations.sql`
- Modify: `supabase/tests/route_access_smoke.sql`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes: `public.invitations`, `public.create_invitation`, `public.handle_new_user` (existentes), `app_route` (Task 1).
- Produces: `invitations.routes public.app_route[] DEFAULT ARRAY['alocacoes']`; `create_invitation(_email text, _role app_role, _routes app_route[] DEFAULT ARRAY['alocacoes']::app_route[])`; `handle_new_user` grava rotas junto do papel. Task 10 (`InviteDialog.tsx`) depende do parâmetro `_routes` da RPC.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260828133000_route_access_invitations.sql`:

```sql
-- ============================================================
-- 1. Coluna de rotas no convite — default alocacoes, mesmo padrão do
-- critério de aceite para usuário novo
-- ============================================================
ALTER TABLE public.invitations
  ADD COLUMN routes public.app_route[] NOT NULL DEFAULT ARRAY['alocacoes']::public.app_route[];

-- ============================================================
-- 2. create_invitation ganha o parâmetro (mesma assinatura + um argumento
-- com default — chamadas existentes sem _routes continuam válidas)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_invitation(
  _email text,
  _role public.app_role,
  _routes public.app_route[] DEFAULT ARRAY['alocacoes']::public.app_route[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := lower(trim(_email));
  v_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'E-mail inválido' USING ERRCODE = 'W2004';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'Já existe um usuário com este e-mail' USING ERRCODE = 'W2004';
  END IF;

  IF EXISTS (SELECT 1 FROM public.invitations
              WHERE email = v_email AND consumed_at IS NULL AND expires_at > now()) THEN
    RAISE EXCEPTION 'Já existe um convite pendente para este e-mail' USING ERRCODE = 'W2004';
  END IF;

  DELETE FROM public.invitations WHERE email = v_email AND consumed_at IS NULL;

  INSERT INTO public.invitations (email, role, routes, invited_by)
  VALUES (v_email, _role, _routes, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.role_audit_log (action, target_email, actor_user_id, actor_email, new_role)
  VALUES ('invite', v_email, v_actor, (SELECT email FROM auth.users WHERE id = v_actor), _role);

  RETURN v_id;
END $$;

-- ============================================================
-- 3. handle_new_user grava as rotas do convite junto do papel
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.invitations%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM public.invitations
   WHERE email = lower(NEW.email)
     AND consumed_at IS NULL
     AND expires_at > now()
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    PERFORM set_config('app.actor_id', inv.invited_by::text, true);
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, inv.role)
      ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.user_route_access (user_id, route, granted_by)
    SELECT NEW.id, r, inv.invited_by FROM unnest(inv.routes) AS r
      ON CONFLICT DO NOTHING;
    UPDATE public.invitations SET consumed_at = now() WHERE id = inv.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user falhou para %: %', NEW.email, SQLERRM;
  RETURN NEW;
END $$;
```

- [ ] **Step 2: Aplicar a migration**

Pedir ao usuário para colar o conteúdo integral do arquivo no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr` e executar. Aguardar confirmação.

- [ ] **Step 3: Acrescentar a Seção 4 ao smoke test**

Adicionar ao final de `supabase/tests/route_access_smoke.sql`, **antes** de `ROLLBACK;`:

```sql
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

ROLLBACK;
```

(A linha `ROLLBACK;` do final do arquivo se move para depois desta seção — remover a duplicata deixada pelas Tasks anteriores.)

- [ ] **Step 4: Rodar o smoke test completo**

Pedir ao usuário para colar o conteúdo integral de `route_access_smoke.sql` (Seções 1-4) no SQL Editor e executar. Esperado: `Seção 1 OK` a `Seção 4 OK`, sem `ERROR`.

- [ ] **Step 5: Editar `types.ts` — `invitations.routes` e `create_invitation`**

No bloco `invitations: { Row: {...} Insert: {...} Update: {...} }`, adicionar `routes` (ordem alfabética, entre `role` e — não há próxima chave, é a última — mantém `role` antes de `routes`):

```ts
      invitations: {
        Row: {
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          routes: Database["public"]["Enums"]["app_route"][]
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          routes?: Database["public"]["Enums"]["app_route"][]
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          routes?: Database["public"]["Enums"]["app_route"][]
        }
        Relationships: []
      }
```

Localizar `create_invitation: { Args: { _email: string; _role: ... }; Returns: string }` dentro de `Functions:` e adicionar o parâmetro opcional:

```ts
      create_invitation: {
        Args: {
          _email: string
          _role: Database["public"]["Enums"]["app_role"]
          _routes?: Database["public"]["Enums"]["app_route"][]
        }
        Returns: string
      }
```

- [ ] **Step 6: Verificar o TypeScript**

```bash
npx prettier --write src/integrations/supabase/types.ts
npx eslint src/integrations/supabase/types.ts
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260828133000_route_access_invitations.sql supabase/tests/route_access_smoke.sql src/integrations/supabase/types.ts
git commit -m "feat(rbac): convite carrega rotas padrao e propaga no provisionamento"
```

---

## Task 5: Enforcement por rota nas server functions do Jira

**Files:**
- Modify: `src/integrations/jira/access.server.ts`
- Modify: `src/integrations/jira/server-fns.ts`

**Interfaces:**
- Consumes: `user_route_access` (Task 1), tipo `AppRoute` — **ainda não existe**; esta task o declara localmente em `access.server.ts` até a Task 6 promover para `tabs.ts` (ver Step 4).
- Produces: `assertRouteAccess(client, userId, route)` e `assertAnyRouteAccess(client, userId, routes)`, ambas lançando `Error("Sem permissão")` quando a rota não está liberada. Task 6 reexporta o tipo `AppRoute` de `tabs.ts` — este arquivo é atualizado no Step 4 daquela task para importar de lá em vez de declarar localmente.

- [ ] **Step 1: Reescrever `access.server.ts`**

Substituir o conteúdo integral de `src/integrations/jira/access.server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Provisório: promovido para src/components/shell/tabs.ts na Task 6 desta
// mesma frente (permissões por rota), que é a fonte única dos 4 ids de guia.
type AppRoute = Database["public"]["Enums"]["app_route"];

// Mesmo padrão de src/integrations/supabase/admin.server.ts::assertAdmin —
// usa o client do PRÓPRIO usuário (sob RLS), nunca a service_role — mas
// mira uma rota específica em vez de "algum papel".
export async function assertRouteAccess(
  client: SupabaseClient<Database>,
  userId: string,
  route: AppRoute,
): Promise<void> {
  const { data, error } = await client
    .from("user_route_access")
    .select("route")
    .eq("user_id", userId)
    .eq("route", route)
    .maybeSingle();

  if (error) throw new Error("Não foi possível validar suas permissões");
  if (!data) throw new Error("Sem permissão");
}

// getJiraProjects alimenta tanto Compromisso quanto Cycle Time — basta UMA
// das rotas estar liberada.
export async function assertAnyRouteAccess(
  client: SupabaseClient<Database>,
  userId: string,
  routes: readonly AppRoute[],
): Promise<void> {
  const { data, error } = await client
    .from("user_route_access")
    .select("route")
    .eq("user_id", userId)
    .in("route", routes);

  if (error) throw new Error("Não foi possível validar suas permissões");
  if (!data || data.length === 0) throw new Error("Sem permissão");
}
```

- [ ] **Step 2: Atualizar os 5 call sites em `server-fns.ts`**

Em `src/integrations/jira/server-fns.ts`, trocar cada handler:

```ts
export const getJiraProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JiraProject[]> => {
    const { assertAnyRouteAccess } = await import("./access.server");
    await assertAnyRouteAccess(context.supabase, context.userId, ["compromisso", "cycle-time"]);
    const { fetchAllowedProjects } = await import("./projects.server");
    return mapJiraError("projects", () => fetchAllowedProjects());
  });

export const getJiraSprints = createServerFn({ method: "GET" })
  .validator((data: { project: string }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<SprintResponse[]> => {
    const { assertRouteAccess } = await import("./access.server");
    await assertRouteAccess(context.supabase, context.userId, "compromisso");
    const { fetchSprintsForProject } = await import("./sprints.server");
    return mapJiraError("sprints", () => fetchSprintsForProject(data.project));
  });

export const getJiraSprint = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<SprintResponse> => {
    const { assertRouteAccess } = await import("./access.server");
    await assertRouteAccess(context.supabase, context.userId, "compromisso");
    const { fetchSprintById } = await import("./sprints.server");
    return mapJiraError("sprint", () => fetchSprintById(data.id));
  });

export const getJiraIssues = createServerFn({ method: "GET" })
  .validator((data: { sprintId: number }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<IssueResponse[]> => {
    const { assertRouteAccess } = await import("./access.server");
    await assertRouteAccess(context.supabase, context.userId, "compromisso");
    const { fetchIssuesForSprint } = await import("./issues.server");
    return mapJiraError("issues", () => fetchIssuesForSprint(data.sprintId));
  });

export const getJiraCycleTime = createServerFn({ method: "GET" })
  .validator((data: { project: string; mode: CycleTimeMode; force?: boolean }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<CycleTimeResponse> => {
    const { assertRouteAccess } = await import("./access.server");
    await assertRouteAccess(context.supabase, context.userId, "cycle-time");
    const { fetchCycleTime } = await import("./cycle-time.server");
    return mapJiraError("cycle-time", () =>
      fetchCycleTime(data.project, data.mode, data.force ?? false),
    );
  });
```

(Só as linhas de `import("./access.server")` e a chamada de assert mudam em cada handler — o resto do arquivo, incluindo `mapJiraError` e os imports do topo, fica igual.)

- [ ] **Step 3: Verificar o TypeScript**

```bash
npx prettier --write src/integrations/jira/access.server.ts src/integrations/jira/server-fns.ts
npx eslint src/integrations/jira/access.server.ts src/integrations/jira/server-fns.ts
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/integrations/jira/access.server.ts src/integrations/jira/server-fns.ts
git commit -m "feat(rbac): server functions do Jira exigem a rota especifica"
```

---

## Task 6: Tipo `AppRoute` e hook de leitura no cliente

**Files:**
- Modify: `src/components/shell/tabs.ts`
- Modify: `src/integrations/jira/access.server.ts` (troca o `type AppRoute` provisório da Task 5 pela importação daqui)
- Create: `src/hooks/use-routes.ts`
- Modify: `src/hooks/use-authorized-session.ts`

**Interfaces:**
- Consumes: `TABS` (existente em `tabs.ts`), `useRole`/`useSession` (existentes).
- Produces: `export type AppRoute = (typeof TABS)[number]["id"]` em `tabs.ts` — importado por Tasks 7-11; `useRoutes(userId): { routes: Set<AppRoute>, loading: boolean }`; `useAuthorizedSession()` passa a devolver também `routes: Set<AppRoute>`.

- [ ] **Step 1: Exportar `AppRoute` em `tabs.ts`**

Em `src/components/shell/tabs.ts`, adicionar logo após a declaração de `TABS`:

```ts
export const TABS = [
  { id: "compromisso", to: "/compromisso", label: "Compromisso", icon: ClipboardList },
  { id: "cycle-time", to: "/cycle-time", label: "Cycle Time", icon: Timer },
  { id: "retrospectivas", to: "/retrospectivas", label: "Retrospectivas", icon: Dices },
  { id: "alocacoes", to: "/alocacoes", label: "Alocações", icon: LayoutGrid },
] as const satisfies readonly TabDef[];

// Os 4 ids de TABS, na mesma ordem — é o mesmo conjunto de valores do enum
// public.app_route (supabase/migrations/20260828130000_route_access_foundation.sql).
// Derivado em vez de redeclarado: TABS já é a fonte única da lista de guias.
export type AppRoute = (typeof TABS)[number]["id"];
```

- [ ] **Step 2: Trocar o `AppRoute` provisório em `access.server.ts`**

Em `src/integrations/jira/access.server.ts`, remover:

```ts
// Provisório: promovido para src/components/shell/tabs.ts na Task 6 desta
// mesma frente (permissões por rota), que é a fonte única dos 4 ids de guia.
type AppRoute = Database["public"]["Enums"]["app_route"];
```

E adicionar no topo do arquivo, junto dos demais imports:

```ts
import type { AppRoute } from "@/components/shell/tabs";
```

O `import type { Database } from "@/integrations/supabase/types";` já existente continua — ainda é usado por `SupabaseClient<Database>`.

- [ ] **Step 3: Criar `use-routes.ts`**

Criar `src/hooks/use-routes.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRoute } from "@/components/shell/tabs";

// Lê as rotas liberadas para o próprio usuário — permitido pela policy
// route_access_select_own. Mesmo staleTime de useRole: as duas convivem no
// boot de useAuthorizedSession.
export function useRoutes(userId: string | undefined) {
  const q = useQuery({
    queryKey: ["user-routes", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Set<AppRoute>> => {
      const { data, error } = await supabase
        .from("user_route_access")
        .select("route")
        .eq("user_id", userId!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.route as AppRoute));
    },
  });

  return {
    routes: q.data ?? new Set<AppRoute>(),
    loading: q.isLoading,
  };
}
```

- [ ] **Step 4: Agregar `routes` em `use-authorized-session.ts`**

Substituir o conteúdo integral de `src/hooks/use-authorized-session.ts`:

```ts
import { useSession } from "./use-session";
import { useRole } from "./use-role";
import { useRoutes } from "./use-routes";

// Consolida o preâmbulo repetido em toda rota autenticada: sessão + papel +
// rotas liberadas. loading cobre a resolução da sessão e, uma vez logado, a
// do papel e a das rotas.
export function useAuthorizedSession() {
  const { session, loading: sessionLoading } = useSession();
  const { role, isAdmin, canEdit, canView, loading: roleLoading } = useRole(session?.user.id);
  const { routes, loading: routesLoading } = useRoutes(session?.user.id);

  return {
    session,
    role,
    isAdmin,
    canEdit,
    canView,
    routes,
    loading: sessionLoading || (Boolean(session) && (roleLoading || routesLoading)),
  };
}
```

- [ ] **Step 5: Verificar o TypeScript**

```bash
npx prettier --write src/components/shell/tabs.ts src/integrations/jira/access.server.ts src/hooks/use-routes.ts src/hooks/use-authorized-session.ts
npx eslint src/components/shell/tabs.ts src/integrations/jira/access.server.ts src/hooks/use-routes.ts src/hooks/use-authorized-session.ts
npx tsc --noEmit
```

Esperado: sem erros. Se `tsc` reclamar de `Database` não usado em `access.server.ts`, confirme que a linha `SupabaseClient<Database>` nas duas assinaturas de função continua presente — só o `type AppRoute = Database[...]` local é removido, o import de `Database` permanece.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/tabs.ts src/integrations/jira/access.server.ts src/hooks/use-routes.ts src/hooks/use-authorized-session.ts
git commit -m "feat(rbac): expoe AppRoute e hook use-routes para o cliente"
```

---

## Task 7: Guard central por rota e navegação filtrada

**Files:**
- Modify: `src/components/shell/shell-context.tsx`
- Modify: `src/routes/_shell.tsx`
- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/routes/embed.alocacoes.tsx`

**Interfaces:**
- Consumes: `useAuthorizedSession().routes` (Task 6), `TABS`/`AppRoute` (Task 6).
- Produces: `ShellContextValue.routes: Set<AppRoute>`; `AppShell` aceita a prop `routes` e filtra a navegação; `_shell.tsx` bloqueia o conteúdo da rota ativa quando `!routes.has(activeTab.id)`; `embed.alocacoes.tsx` bloqueia quando falta `alocacoes`. Nenhuma task posterior depende de nomes daqui.

- [ ] **Step 1: `shell-context.tsx` — adicionar `routes`**

Em `src/components/shell/shell-context.tsx`, adicionar o import e o campo:

```ts
import { createContext, useContext, type ReactNode } from "react";
import type { JiraProjectKey } from "@/lib/projects";
import type { AppRoute } from "./tabs";

export type ShellContextValue = {
  email: string;
  canEdit: boolean;
  isAdmin: boolean;
  project: JiraProjectKey;
  routes: Set<AppRoute>;
};
```

(O restante do arquivo — `ShellContext`, `ShellProvider`, `useShell` — não muda.)

- [ ] **Step 2: `AppShell.tsx` — prop `routes` e navegação filtrada**

Em `src/components/shell/AppShell.tsx`, adicionar `routes` à assinatura de props e filtrar `TABS` antes do `.map`:

```tsx
import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { LayoutGrid, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectSelect, type ProjectOption } from "@/components/ProjectSelect";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { TABS, type AppRoute } from "./tabs";

const TAB_BASE =
  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors";

export function AppShell({
  email,
  isAdmin,
  project,
  options,
  routes,
  onProjectChange,
  children,
}: {
  email: string;
  isAdmin: boolean;
  project: string;
  options: readonly ProjectOption[];
  routes: Set<AppRoute>;
  onProjectChange: (key: string) => void;
  children: ReactNode;
}) {
  const pathname = useLocation({ select: (l) => l.pathname });
  const activeTab = TABS.find((t) => pathname.startsWith(t.to));
  const visibleTabs = TABS.filter((t) => routes.has(t.id));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-header text-header-foreground">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <LayoutGrid className="size-4" />
          </span>
          <h1 className="mr-auto text-base font-semibold leading-tight">Sprint Board</h1>

          <ProjectSelect value={project} options={options} onChange={onProjectChange} />

          {isAdmin ? (
            <Button size="sm" variant="ghost" asChild>
              <Link to="/admin">
                <Users className="size-4" /> Usuários
              </Link>
            </Button>
          ) : null}
          <ThemeToggle />
          <Button size="sm" variant="ghost" onClick={() => supabase.auth.signOut()} title={email}>
            <LogOut className="size-4" />
          </Button>
        </div>

        <nav
          role="tablist"
          aria-label="Navegação principal"
          className="flex flex-wrap items-center gap-1 border-t border-border px-4 py-1.5"
        >
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                key={tab.id}
                id={`tab-${tab.id}`}
                role="tab"
                to={tab.to}
                activeOptions={{ exact: true }}
                activeProps={{
                  "aria-selected": true,
                  className: `${TAB_BASE} bg-primary/15 text-foreground`,
                }}
                inactiveProps={{
                  "aria-selected": false,
                  className: `${TAB_BASE} text-muted-foreground hover:bg-accent hover:text-foreground`,
                }}
              >
                <Icon className="size-4" /> {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div
        role="tabpanel"
        {...(activeTab ? { "aria-labelledby": `tab-${activeTab.id}` } : {})}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {children}
      </div>
    </div>
  );
}
```

(Só `visibleTabs` é novo; o `role="tabpanel"` continua usando `activeTab` — vindo de `TABS` cheio — porque o `aria-labelledby` deve apontar para a guia realmente aberta, mesmo que o guard da Task 7/Step 3 esteja bloqueando o conteúdo dela.)

- [ ] **Step 3: `_shell.tsx` — guard central antes do `<Outlet/>`**

Em `src/routes/_shell.tsx`, adicionar os imports de `useLocation` e `TABS`, capturar `routes` de `useAuthorizedSession()`, passar para `ShellProvider`/`AppShell`, e trocar `<Outlet />` por um bloco condicional:

```tsx
import { useMemo, useState } from "react";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuthorizedSession } from "@/hooks/use-authorized-session";
import { AuthCard } from "@/components/AuthCard";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getJiraProjects } from "@/integrations/jira/server-fns";
import { JIRA_PROJECTS, isJiraProjectKey, type JiraProjectKey } from "@/lib/projects";
import type { ProjectOption } from "@/components/ProjectSelect";
import { AppShell } from "@/components/shell/AppShell";
import { TABS } from "@/components/shell/tabs";
import { ShellProvider } from "@/components/shell/shell-context";
```

(Os comentários e o restante do topo do arquivo — `LS_PROJECT`, `ls`, `save`, `resolveProject`, `Route` — não mudam.)

Dentro de `function Shell()`, logo após `const [project, setProject] = useState<JiraProjectKey | null>(() => resolveProject());`, adicionar:

```tsx
  const { session, loading, canEdit, isAdmin, canView, routes } = useAuthorizedSession();
  const pathname = useLocation({ select: (l) => l.pathname });
  const activeTab = TABS.find((t) => pathname.startsWith(t.to));
```

(A linha `const { session, loading, canEdit, isAdmin, canView } = useAuthorizedSession();` já existente é **substituída** pela acima, que só acrescenta `routes` — a ordem de declaração das outras variáveis no arquivo continua a mesma.)

No JSX de retorno, trocar:

```tsx
  return (
    <ShellProvider value={{ email, canEdit, isAdmin, project }}>
      <AppShell
        email={email}
        isAdmin={isAdmin}
        project={project}
        options={options}
        onProjectChange={handleProjectChange}
      >
        <Outlet />
      </AppShell>
    </ShellProvider>
  );
```

por:

```tsx
  return (
    <ShellProvider value={{ email, canEdit, isAdmin, project, routes }}>
      <AppShell
        email={email}
        isAdmin={isAdmin}
        project={project}
        options={options}
        routes={routes}
        onProjectChange={handleProjectChange}
      >
        {activeTab && !routes.has(activeTab.id) ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              Você não tem acesso a esta guia. Peça a um administrador para liberar.
            </p>
          </div>
        ) : (
          <Outlet />
        )}
      </AppShell>
    </ShellProvider>
  );
```

- [ ] **Step 4: `embed.alocacoes.tsx` — gate ganha a rota**

Em `src/routes/embed.alocacoes.tsx`, trocar:

```tsx
  const { project: fromUrl } = Route.useSearch();
  const { session, loading, canEdit, canView } = useAuthorizedSession();
```

por:

```tsx
  const { project: fromUrl } = Route.useSearch();
  const { session, loading, canEdit, canView, routes } = useAuthorizedSession();
```

E, logo após o bloco `if (!canView) { return <AccessDenied ... />; }` já existente, adicionar:

```tsx
  if (!routes.has("alocacoes")) {
    return (
      <AccessDenied
        title="Acesso não liberado"
        description="Você não tem acesso à guia Alocações. Peça a um administrador para liberar."
        action={
          <Button variant="outline" className="w-full" onClick={() => supabase.auth.signOut()}>
            Sair
          </Button>
        }
      />
    );
  }
```

- [ ] **Step 5: Verificar o TypeScript**

```bash
npx prettier --write src/components/shell/shell-context.tsx src/components/shell/AppShell.tsx src/routes/_shell.tsx src/routes/embed.alocacoes.tsx
npx eslint src/components/shell/shell-context.tsx src/components/shell/AppShell.tsx src/routes/_shell.tsx src/routes/embed.alocacoes.tsx
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/shell-context.tsx src/components/shell/AppShell.tsx src/routes/_shell.tsx src/routes/embed.alocacoes.tsx
git commit -m "feat(rbac): navegacao e conteudo das guias respeitam a rota liberada"
```

---

## Task 8: Rotas no `PlatformUser` e na auditoria (tipos + agregação no servidor)

**Files:**
- Modify: `src/lib/admin.ts`
- Modify: `src/integrations/supabase/admin.server.ts`

**Interfaces:**
- Consumes: `AppRoute` (Task 6), `user_route_access` (Task 1), `role_audit_log.route` (Task 3).
- Produces: `PlatformUser.routes: AppRoute[]`; `AuditEntry.route: AppRoute | null`; `AuditEntry["action"]` inclui `"route_grant" | "route_revoke"`; `ACTION_LABELS` com os dois rótulos novos; `fetchPlatformUsers()` popula `routes` por usuário. Tasks 9 e 11 consomem esses campos.

- [ ] **Step 1: `src/lib/admin.ts` — tipos e rótulos**

Substituir o conteúdo integral de `src/lib/admin.ts`:

```ts
import type { AppRoute } from "@/components/shell/tabs";

export type AppRole = "admin" | "editor" | "viewer";

export type PlatformUser = {
  id: string;
  email: string;
  role: AppRole | null;
  routes: AppRoute[];
  createdAt: string;
  lastSignInAt: string | null;
  pendingInvite: boolean;
};

export type AuditEntry = {
  id: string;
  action: "invite" | "grant" | "revoke" | "bootstrap" | "cancel" | "route_grant" | "route_revoke";
  target_email: string | null;
  actor_email: string | null;
  previous_role: AppRole | null;
  new_role: AppRole | null;
  route: AppRoute | null;
  created_at: string;
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  editor: "Editor",
  viewer: "Leitor",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "Gerencia usuários e edita as alocações",
  editor: "Edita as alocações",
  // Não "visualiza as alocações": can_view_board também libera as server
  // functions do Jira (Compromisso e Cycle Time), então restringir a frase às
  // alocações descreveria um papel mais estreito do que o que existe.
  viewer: "Apenas visualiza, não edita",
};

export const ACTION_LABELS: Record<AuditEntry["action"], string> = {
  invite: "Convite",
  grant: "Concessão",
  revoke: "Revogação",
  bootstrap: "Bootstrap",
  cancel: "Convite cancelado",
  route_grant: "Rota concedida",
  route_revoke: "Rota revogada",
};
```

- [ ] **Step 2: `admin.server.ts` — agregar rotas em `fetchPlatformUsers`**

Em `src/integrations/supabase/admin.server.ts`, adicionar o import de `AppRoute` e, dentro de `fetchPlatformUsers`, buscar `user_route_access` do mesmo jeito que já busca `user_roles`:

```ts
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./client.server";
import type { Database } from "./types";
import type { AppRole, PlatformUser } from "@/lib/admin";
import type { AppRoute } from "@/components/shell/tabs";

export async function assertAdmin(client: SupabaseClient<Database>, userId: string): Promise<void> {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Não foi possível validar suas permissões");
  if (data?.role !== "admin") throw new Error("Sem permissão");
}

const PER_PAGE = 200;

export async function fetchPlatformUsers(): Promise<PlatformUser[]> {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: PER_PAGE,
  });
  if (error) {
    console.error("[admin] listUsers falhou:", error);
    throw new Error("Não foi possível carregar a lista de usuários");
  }

  if (data.users.length === PER_PAGE) {
    console.warn(
      `[admin] listUsers retornou ${PER_PAGE} usuários — pode existir mais de uma página. Implementar paginação.`,
    );
  }

  const { data: roles, error: rolesError } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role");
  if (rolesError) {
    console.error("[admin] leitura de user_roles falhou:", rolesError);
    throw new Error("Não foi possível carregar os papéis dos usuários");
  }

  const { data: routeRows, error: routesError } = await supabaseAdmin
    .from("user_route_access")
    .select("user_id, route");
  if (routesError) {
    console.error("[admin] leitura de user_route_access falhou:", routesError);
    throw new Error("Não foi possível carregar as rotas dos usuários");
  }

  const roleByUser = new Map<string, AppRole>(roles.map((r) => [r.user_id, r.role as AppRole]));

  const routesByUser = new Map<string, AppRoute[]>();
  for (const r of routeRows) {
    const list = routesByUser.get(r.user_id) ?? [];
    list.push(r.route as AppRoute);
    routesByUser.set(r.user_id, list);
  }

  return data.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      role: roleByUser.get(u.id) ?? null,
      routes: routesByUser.get(u.id) ?? [],
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      pendingInvite: !u.last_sign_in_at,
    }))
    .sort((a, b) => a.email.localeCompare(b.email, "pt-BR"));
}

export async function createInviteLink(input: {
  email: string;
  kind: "invite" | "magiclink";
}): Promise<{ link: string }> {
  const origin = getRequest()?.headers.get("origin");
  if (!origin) throw new Error("Origem da requisição não identificada");

  const email = input.email.toLowerCase().trim();
  const options = { redirectTo: `${origin}/aceitar-convite` };

  const { data, error } =
    input.kind === "invite"
      ? await supabaseAdmin.auth.admin.generateLink({ type: "invite", email, options })
      : await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email, options });

  if (error) {
    console.error("[admin] generateLink falhou:", error);
    throw new Error("Não foi possível gerar o link de convite");
  }

  const link = data.properties?.action_link;
  if (!link) throw new Error("O Supabase não retornou o link de convite");

  return { link };
}
```

- [ ] **Step 3: Verificar o TypeScript**

```bash
npx prettier --write src/lib/admin.ts src/integrations/supabase/admin.server.ts
npx eslint src/lib/admin.ts src/integrations/supabase/admin.server.ts
npx tsc --noEmit
```

Esperado: `tsc` pode acusar erro em `UserTable.tsx`/`AuditLog.tsx`/`InviteDialog.tsx` neste ponto (ainda não usam `routes`/`route`) — isso é esperado até as Tasks 9-11; confirme que os únicos erros novos são exatamente `Property 'route' is missing` (ou similares) nesses três arquivos, não em outros.

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin.ts src/integrations/supabase/admin.server.ts
git commit -m "feat(rbac): PlatformUser e AuditEntry carregam rotas"
```

---

## Task 9: Coluna de rotas em `UserTable.tsx`

**Files:**
- Modify: `src/components/admin/UserTable.tsx`

**Interfaces:**
- Consumes: `PlatformUser.routes` (Task 8), `TABS`/`AppRoute` (Task 6), RPC `set_user_routes` (Task 1).
- Produces: coluna "Rotas" com `ToggleGroup` por linha, mutação `setRoutes` chamando `supabase.rpc("set_user_routes", ...)`.

- [ ] **Step 1: Editar `UserTable.tsx`**

Substituir o conteúdo integral de `src/components/admin/UserTable.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateInviteLink, listPlatformUsers } from "@/integrations/supabase/admin-fns";
import { adminErrorMessage } from "@/lib/admin-errors";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type AppRole } from "@/lib/admin";
import { TABS, type AppRoute } from "@/components/shell/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const NO_ROLE = "__sem_papel__";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function UserTable({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();

  const usersQ = useQuery({
    queryKey: ["platform-users"],
    queryFn: () => listPlatformUsers(),
  });

  const setRole = useMutation({
    mutationFn: async (vars: { userId: string; role: AppRole | null }) => {
      const { error } = await supabase.rpc("set_user_role", {
        _target: vars.userId,
        _role: vars.role as AppRole,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Papel atualizado");
      void qc.invalidateQueries({ queryKey: ["platform-users"] });
      void qc.invalidateQueries({ queryKey: ["role-audit"] });
      void qc.invalidateQueries({ queryKey: ["user-role"] });
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  const setRoutes = useMutation({
    mutationFn: async (vars: { userId: string; routes: AppRoute[] }) => {
      const { error } = await supabase.rpc("set_user_routes", {
        _target: vars.userId,
        _routes: vars.routes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rotas atualizadas");
      void qc.invalidateQueries({ queryKey: ["platform-users"] });
      void qc.invalidateQueries({ queryKey: ["role-audit"] });
      void qc.invalidateQueries({ queryKey: ["user-routes"] });
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  const newLink = useMutation({
    mutationFn: async (email: string): Promise<string> => {
      const result = await generateInviteLink({ data: { email, kind: "magiclink" } });
      return result.link;
    },
    onSuccess: async (link) => {
      await navigator.clipboard.writeText(link);
      toast.success("Novo link copiado");
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  if (usersQ.isLoading) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Carregando usuários...</p>
    );
  }

  if (usersQ.isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {adminErrorMessage(usersQ.error)}
      </p>
    );
  }

  const users = usersQ.data ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>E-mail</TableHead>
            <TableHead className="w-40">Papel</TableHead>
            <TableHead className="w-44">Rotas</TableHead>
            <TableHead className="w-32">Último acesso</TableHead>
            <TableHead className="w-32">Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">
                {u.email}
                {u.id === currentUserId ? (
                  <span className="ml-2 text-[10px] text-muted-foreground">(você)</span>
                ) : null}
              </TableCell>
              <TableCell>
                <Select
                  value={u.role ?? NO_ROLE}
                  disabled={setRole.isPending}
                  onValueChange={(value) =>
                    setRole.mutate({
                      userId: u.id,
                      role: value === NO_ROLE ? null : (value as AppRole),
                    })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        <span className="flex flex-col">
                          <span>{ROLE_LABELS[r]}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {ROLE_DESCRIPTIONS[r]}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={NO_ROLE}>
                      <span className="flex flex-col">
                        <span>Sem acesso</span>
                        <span className="text-[10px] text-muted-foreground">
                          Não enxerga a plataforma
                        </span>
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <ToggleGroup
                  type="multiple"
                  size="sm"
                  value={u.routes}
                  disabled={setRoutes.isPending || u.role === null}
                  onValueChange={(next) =>
                    setRoutes.mutate({ userId: u.id, routes: next as AppRoute[] })
                  }
                >
                  {TABS.map((tab) => (
                    <ToggleGroupItem key={tab.id} value={tab.id} title={tab.label} aria-label={tab.label}>
                      <tab.icon className="size-4" />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(u.lastSignInAt)}
              </TableCell>
              <TableCell>
                {u.pendingInvite ? (
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                      Pendente
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Gerar e copiar um novo link de acesso"
                      disabled={newLink.isPending}
                      onClick={() => newLink.mutate(u.email)}
                    >
                      <Link2 className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Ativo</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Verificar o TypeScript**

```bash
npx prettier --write src/components/admin/UserTable.tsx
npx eslint src/components/admin/UserTable.tsx
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/UserTable.tsx
git commit -m "feat(rbac): admin concede rotas por usuario na tela /admin"
```

---

## Task 10: Default de rotas no convite (`InviteDialog.tsx`)

**Files:**
- Modify: `src/components/admin/InviteDialog.tsx`

**Interfaces:**
- Consumes: `TABS`/`AppRoute` (Task 6), RPC `create_invitation(_email, _role, _routes)` (Task 4).
- Produces: nenhuma interface nova consumida por outra task — é a ponta final do fluxo de convite.

- [ ] **Step 1: Editar `InviteDialog.tsx`**

Substituir o conteúdo integral de `src/components/admin/InviteDialog.tsx`:

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateInviteLink } from "@/integrations/supabase/admin-fns";
import { adminErrorMessage } from "@/lib/admin-errors";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type AppRole } from "@/lib/admin";
import { TABS, type AppRoute } from "@/components/shell/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const DEFAULT_ROUTES: AppRoute[] = ["alocacoes"];

export function InviteDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("editor");
  const [routes, setRoutes] = useState<AppRoute[]>(DEFAULT_ROUTES);
  const [link, setLink] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: async (): Promise<string> => {
      const { error } = await supabase.rpc("create_invitation", {
        _email: email,
        _role: role,
        _routes: routes,
      });
      if (error) throw error;

      try {
        const result = await generateInviteLink({
          data: { email, kind: "invite" },
        });
        return result.link;
      } catch (linkError) {
        try {
          const { error: cancelError } = await supabase.rpc("cancel_invitation", {
            _email: email,
          });
          if (cancelError) {
            console.error("[admin] rollback do convite falhou:", cancelError);
          }
        } catch (cancelException) {
          console.error("[admin] rollback do convite falhou:", cancelException);
        }
        throw linkError;
      }
    },
    onSuccess: (value) => {
      setLink(value);
      toast.success("Convite criado. Copie o link e envie para a pessoa.");
      void qc.invalidateQueries({ queryKey: ["platform-users"] });
      void qc.invalidateQueries({ queryKey: ["role-audit"] });
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  function reset() {
    setEmail("");
    setRole("editor");
    setRoutes(DEFAULT_ROUTES);
    setLink(null);
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success("Link copiado");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-4" /> Convidar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar pessoa</DialogTitle>
          <DialogDescription>
            O convite gera um link válido por 7 dias. Copie e envie pelo Teams.
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="space-y-3">
            <Label htmlFor="invite-link">Link de convite</Label>
            <div className="flex gap-2">
              <Input id="invite-link" readOnly value={link} className="font-mono text-xs" />
              <Button type="button" variant="secondary" onClick={copy}>
                <Copy className="size-4" />
              </Button>
            </div>
            <Button type="button" variant="ghost" className="w-full" onClick={reset}>
              Convidar outra pessoa
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pessoa@way2.com.br"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Papel</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      <span className="flex flex-col">
                        <span>{ROLE_LABELS[r]}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {ROLE_DESCRIPTIONS[r]}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rotas liberadas</Label>
              <ToggleGroup
                type="multiple"
                value={routes}
                onValueChange={(next) => setRoutes(next as AppRoute[])}
              >
                {TABS.map((tab) => (
                  <ToggleGroupItem key={tab.id} value={tab.id} title={tab.label} aria-label={tab.label}>
                    <tab.icon className="size-4" />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <Button type="submit" className="w-full" disabled={invite.isPending}>
              {invite.isPending ? "Gerando convite..." : "Gerar link de convite"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar o TypeScript**

```bash
npx prettier --write src/components/admin/InviteDialog.tsx
npx eslint src/components/admin/InviteDialog.tsx
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/InviteDialog.tsx
git commit -m "feat(rbac): convite passa a definir as rotas padrao do usuario novo"
```

---

## Task 11: Coluna de rota no histórico de auditoria (`AuditLog.tsx`)

**Files:**
- Modify: `src/components/admin/AuditLog.tsx`

**Interfaces:**
- Consumes: `AuditEntry.route`/`ACTION_LABELS` (Task 8), `TABS` (Task 6).
- Produces: nenhuma interface nova — é a última peça do fluxo de auditoria.

- [ ] **Step 1: Editar `AuditLog.tsx`**

Substituir o conteúdo integral de `src/components/admin/AuditLog.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminErrorMessage } from "@/lib/admin-errors";
import { ACTION_LABELS, ROLE_LABELS, type AppRole, type AuditEntry } from "@/lib/admin";
import { TABS } from "@/components/shell/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function roleLabel(role: AppRole | null): string {
  return role ? ROLE_LABELS[role] : "—";
}

function routeLabel(entry: AuditEntry): string {
  if (!entry.route) return "—";
  return TABS.find((t) => t.id === entry.route)?.label ?? entry.route;
}

export function AuditLog() {
  const q = useQuery({
    queryKey: ["role-audit"],
    queryFn: async (): Promise<AuditEntry[]> => {
      const { data, error } = await supabase
        .from("role_audit_log")
        .select("id, action, target_email, actor_email, previous_role, new_role, route, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as AuditEntry[];
    },
  });

  if (q.isLoading) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Carregando histórico...</p>
    );
  }

  if (q.isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">{adminErrorMessage(q.error)}</p>
    );
  }

  const entries = q.data ?? [];

  if (entries.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nenhuma alteração registrada.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Quando</TableHead>
            <TableHead className="w-28">Ação</TableHead>
            <TableHead>Alvo</TableHead>
            <TableHead>Responsável</TableHead>
            <TableHead className="w-44">Mudança</TableHead>
            <TableHead className="w-32">Rota</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(e.created_at).toLocaleString("pt-BR")}
              </TableCell>
              <TableCell className="text-sm">{ACTION_LABELS[e.action]}</TableCell>
              <TableCell className="text-sm">{e.target_email ?? "—"}</TableCell>
              <TableCell className="text-sm">
                {e.actor_email ?? <span className="text-muted-foreground">fora da aplicação</span>}
              </TableCell>
              <TableCell className="text-sm">
                {roleLabel(e.previous_role)} → {roleLabel(e.new_role)}
              </TableCell>
              <TableCell className="text-sm">{routeLabel(e)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

(A mensagem de lista vazia mudou de "Nenhuma alteração de papel registrada." para "Nenhuma alteração registrada." — o histórico agora cobre os dois eixos.)

- [ ] **Step 2: Verificar o TypeScript**

```bash
npx prettier --write src/components/admin/AuditLog.tsx
npx eslint src/components/admin/AuditLog.tsx
npx tsc --noEmit
```

Esperado: `tsc --noEmit` limpo em todo o projeto neste ponto — é a última peça de TypeScript do plano.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AuditLog.tsx
git commit -m "feat(rbac): historico de auditoria exibe a rota de cada evento"
```

---

## Task 12: Roteiro manual de verificação

**Files:** nenhum (task de verificação, sem código).

**Interfaces:**
- Consumes: tudo das Tasks 1-11.
- Produces: confirmação de que os 7 critérios de aceite da issue #23 estão satisfeitos.

- [ ] **Step 1: Subir o dev server**

```bash
npm run dev
```

- [ ] **Step 2: Revogar uma rota e checar navegação + URL direta**

Como admin, em `/admin`, desmarcar "Compromisso" de um usuário de teste. Logar como esse usuário (ou usar uma segunda aba/sessão):
- A guia "Compromisso" não aparece mais na navegação do `AppShell`.
- Acessar `/compromisso` direto pela URL mostra a mensagem "Você não tem acesso a esta guia..." em vez do painel — o cabeçalho e a navegação continuam visíveis, e clicar em outra guia (que a pessoa ainda tem) funciona normalmente.

- [ ] **Step 3: Checar `/embed/alocacoes`**

Revogar "Alocações" do mesmo usuário de teste e acessar `/embed/alocacoes` diretamente. Esperado: tela de "Acesso não liberado", não o quadro.

- [ ] **Step 4: Checar `getJiraProjects` com acesso parcial**

Conceder só "Cycle Time" (sem "Compromisso") a um usuário de teste. Acessar a guia Cycle Time: o seletor de projeto deve carregar normalmente (prova que `assertAnyRouteAccess` aceita "cycle-time" sozinha). Acessar `/compromisso` direto pela URL: deve cair no bloqueio da Task 7 antes mesmo de chamar a server function.

- [ ] **Step 5: Convidar pessoa nova**

Usar "Convidar" em `/admin` sem mexer no `ToggleGroup` de rotas (fica no default). Aceitar o convite com uma conta de teste nova. Esperado: a pessoa nasce com papel Leitor e só a guia Alocações visível — as outras 3 não aparecem na navegação.

- [ ] **Step 6: Conferir o histórico de auditoria**

Em `/admin` → aba "Histórico", confirmar que as concessões/revogações das Steps 2-5 aparecem com a ação ("Rota concedida"/"Rota revogada") e a rota certa na coluna nova.

- [ ] **Step 7: Regressão do fluxo existente**

Trocar o papel de um usuário (Select existente) e confirmar que continua funcionando exatamente como antes — esta frente não deveria mudar nada no eixo de papel.

- [ ] **Step 8: Rodar a suíte de smoke SQL uma última vez, do zero**

Colar `supabase/tests/route_access_smoke.sql` inteiro no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr` e executar. Esperado: `Seção 1 OK` a `Seção 4 OK`, sem `ERROR`, confirmando que nada das Tasks 5-11 exigiu mudança no banco que o smoke test não cubra.

---

## Self-Review

**Cobertura da spec:** os 7 critérios de aceite da issue #23 mapeiam para tasks — multi-seleção de rotas (Task 9), guia oculta na nav e por URL direta (Task 7), botões dependentes de rota (a escrita de Alocações já herda o bloqueio via RLS na Task 2, não há botão de escrita nas guias Jira hoje), usuário novo com leitor+alocações (Task 4/10), reflexo sem novo login (herdado do padrão de `staleTime` + `invalidateQueries` já existente, sem task própria — está documentado como limitação aceita na spec), auditoria (Task 3/11), autoexclusão de admin (já implementada em `set_user_role`/`guard_last_admin`, fora de escopo desta frente — nenhuma mudança toca `/admin`).

**Placeholders:** nenhum "TBD"/"implementar depois" — toda migration, componente e smoke test têm código completo.

**Consistência de tipos:** `AppRoute` é declarado uma vez (Task 6, `tabs.ts`) e importado do mesmo lugar em `access.server.ts`, `use-routes.ts`, `admin.ts`, `admin.server.ts`, `UserTable.tsx`, `InviteDialog.tsx`. `assertRouteAccess`/`assertAnyRouteAccess` (Task 5) são os únicos nomes usados em `server-fns.ts` — não há resquício de `assertCanViewBoard`. `set_user_routes` (RPC, Task 1) é o único nome usado no client (Task 9) e no `types.ts` (Task 1) — grafia consistente em todos os pontos.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-28-permissoes-por-rota.md`.** Duas opções de execução:

**1. Subagent-Driven (recomendado)** — despacho um subagente novo por task, com revisão entre elas, iteração rápida.

**2. Inline Execution** — executo as tasks nesta sessão via executing-plans, em lote com checkpoints.

Qual abordagem?
