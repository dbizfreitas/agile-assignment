# Participantes e sorteio de Retrospectivas no banco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover `PARTICIPANTS` e o estado do sorteio de Retrospectivas do bundle/localStorage para tabelas Supabase protegidas por RLS (`has_route(uid, 'retrospectivas')`), e trazer fotos corporativas via Microsoft Graph adaptado ao runtime serverless do projeto.

**Architecture:** Duas tabelas novas (`retro_participants`, `retro_roulette_state`) com RLS de leitura por rota e mutações via RPC `SECURITY DEFINER`; um módulo `src/integrations/ms-graph/` seguindo a convenção `*-fns.ts`/`*.server.ts` já usada por `src/integrations/jira/`, com token OAuth persistido em `public.ms_graph_token` (RLS sem policies) e autorização inicial via script local (`scripts/ms-graph-auth.ts`), não via UI.

**Tech Stack:** TanStack Start (`createServerFn`), Supabase (Postgres + RLS + `supabase-js`), React Query, Bun (runtime/package manager).

## Global Constraints

- Toda migration segue o nome `YYYYMMDDHHMMSS_slug_descritivo.sql` em `supabase/migrations/`.
- RLS: nenhuma tabela nova fica sem `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
- Toda RPC `SECURITY DEFINER` que muta dado de Retrospectivas chama `private.can_edit_retrospectivas(auth.uid())` — nunca só `has_route` ou só o papel, seguindo a lição documentada em `20260831140000_alocacoes_auth_helpers.sql`.
- `src/integrations/supabase/types.ts` é editado à mão (convenção já usada para `invitations`, `role_audit_log`, `allocations.tickets`, `user_route_access` — ver `docs/superpowers/plans/2026-08-28-permissoes-por-rota.md`), nunca regenerado automaticamente.
- Arquivos `*.server.ts` só são importados estaticamente por outro `*.server.ts`; de `*-fns.ts`/componentes React, sempre `await import(...)` dinâmico dentro do handler.
- Sem test runner no projeto: verificação de SQL é por smoke test em `supabase/tests/*_smoke.sql` (bloco `BEGIN; ... ROLLBACK;`, `DO $$ ... ASSERT ...`), colado manualmente no SQL Editor do Supabase pelo usuário — todo step que aplica migration ou smoke test termina pedindo confirmação do usuário antes de seguir.
- Package manager do projeto é Bun (`bunfig.toml` na raiz, `bun.lock` versionado) — não editar `bun.lock` manualmente. O script standalone da Task 5 (`scripts/ms-graph-auth.ts`) roda via `tsx` (Node) em vez de `bun run`, para não depender de Bun estar no PATH de todo ambiente — ver decisão registrada na Task 5.
- Comentários em português, só quando o "porquê" não é óbvio (convenção observada em todo o código existente).

---

## Mapa de arquivos

| Arquivo | Ação |
| --- | --- |
| `supabase/migrations/20260902180000_retro_participants_foundation.sql` | Criar — tabelas `retro_participants`/`retro_roulette_state` + RLS + seed |
| `supabase/migrations/20260902181000_retro_ms_graph_token.sql` | Criar — `ms_graph_token` + helpers `can_view_retrospectivas`/`can_edit_retrospectivas` |
| `supabase/migrations/20260902182000_retro_roulette_rpcs.sql` | Criar — `spin_roulette`, `skip_participant`, `unskip_participant`, `unmark_participant`, `reset_roulette` |
| `supabase/tests/retro_participants_smoke.sql` | Criar |
| `src/integrations/supabase/types.ts` | Modificar — 2 tabelas, 5 funções, nenhum enum novo |
| `src/integrations/ms-graph/config.server.ts` | Criar |
| `src/integrations/ms-graph/token.server.ts` | Criar |
| `src/integrations/ms-graph/photos.server.ts` | Criar |
| `src/integrations/ms-graph/server-fns.ts` | Criar |
| `scripts/ms-graph-auth.ts` | Criar |
| `package.json` | Modificar — script `ms-graph:auth` |
| `src/hooks/use-retro-participants.ts` | Criar |
| `src/hooks/use-retro-photos.ts` | Criar |
| `src/hooks/use-roulette.ts` | Reescrever |
| `src/lib/retrospectivas/participants.ts` | Modificar — remove `PARTICIPANTS`, ajusta `type Participant` |
| `src/lib/retrospectivas/photos.ts` | Remover |
| `src/lib/retrospectivas/storage.ts` | Remover |
| `src/components/retrospectivas/RouletteView.tsx` | Modificar |
| `src/components/retrospectivas/ParticipantCard.tsx` | Modificar (prop de foto passa a vir de fora) |
| `src/routes/_shell/retrospectivas.tsx` | Modificar (comentário desatualizado — a proteção agora vale para o dado) |

---

### Task 1: Migration — tabelas de participantes e estado do sorteio

**Files:**
- Create: `supabase/migrations/20260902180000_retro_participants_foundation.sql`
- Test: `supabase/tests/retro_participants_smoke.sql` (seção 1, criada nesta task e completada nas Tasks 2–3)

**Interfaces:**
- Produces: tabela `public.retro_participants` (`id uuid`, `name text`, `email text unique`, `color text|null`, `sort_order int`, `photo_data_url text|null`, `photo_fetched_at timestamptz|null`, `created_at timestamptz`); tabela `public.retro_roulette_state` (`id boolean` singleton, `drawn_emails text[]`, `skipped_emails text[]`, `last_winner_email text|null`, `updated_at timestamptz`); policies `retro_participants_select_route` e `retro_roulette_state_select_route`.

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260902180000_retro_participants_foundation.sql
-- Issue #24: participantes e estado do sorteio de Retrospectivas saem do
-- bundle JS (src/lib/retrospectivas/participants.ts) e do localStorage
-- (src/hooks/use-roulette.ts) para tabelas protegidas por RLS na mesma
-- linha da #23: has_route(uid, 'retrospectivas'). sort_order existe porque
-- a cor de cada pessoa hoje deriva da posição no array
-- (AVATAR_COLORS[index % 21]) — sem essa coluna a cor mudaria conforme o
-- Postgres decidisse devolver as linhas.
CREATE TABLE public.retro_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  color text,
  sort_order int NOT NULL,
  photo_data_url text,
  photo_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.retro_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_participants_select_route ON public.retro_participants
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'retrospectivas'::public.app_route));
-- Sem policy de INSERT/UPDATE/DELETE para authenticated: gestão de
-- participantes é manual (SQL/editor Supabase), decisão explícita do
-- escopo da issue #24. A única escrita automática (cache de foto) usa
-- supabaseAdmin (service role), que bypassa RLS.

-- Linha única (singleton): hoje existe um sorteio só, sem conceito de
-- retros paralelas. `id boolean CHECK (id)` é o truque padrão para travar
-- a tabela em exatamente uma linha.
CREATE TABLE public.retro_roulette_state (
  id boolean PRIMARY KEY DEFAULT true,
  drawn_emails text[] NOT NULL DEFAULT '{}',
  skipped_emails text[] NOT NULL DEFAULT '{}',
  last_winner_email text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retro_roulette_state_singleton CHECK (id)
);

INSERT INTO public.retro_roulette_state (id) VALUES (true);

ALTER TABLE public.retro_roulette_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_roulette_state_select_route ON public.retro_roulette_state
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'retrospectivas'::public.app_route));
-- Sem policy de escrita: só as RPCs SECURITY DEFINER da Task 3 gravam.

-- Seed: os 20 participantes hoje hardcoded em
-- src/lib/retrospectivas/participants.ts, na mesma ordem (sort_order
-- preserva a cor de cada pessoa para quem já está acostumado com ela).
INSERT INTO public.retro_participants (name, email, color, sort_order) VALUES
  ('André Secco', 'andre.secco@way2.com.br', NULL, 0),
  ('Bruno Shippit', 'bruno@shippit.app', '#0ea5e9', 1),
  ('Christian Leonardo Chiavelli', 'christian.chiavelli@way2.com.br', NULL, 2),
  ('Daniel Alves', 'daniel.alves@way2.com.br', NULL, 3),
  ('Daniel Heler Pohlmann', 'daniel.heler@way2.com.br', NULL, 4),
  ('Diego Freitas', 'diego.freitas@way2.com.br', NULL, 5),
  ('Diego Martini Longhi', 'diego.longhi@way2.com.br', NULL, 6),
  ('Fábio Meira de Almeida', 'fabio.almeida@way2.com.br', NULL, 7),
  ('Fernando Gaio', 'fernando.gaio@way2.com.br', NULL, 8),
  ('Francisco das Chagas', 'francisco.chagas@way2.com.br', NULL, 9),
  ('Gilcelaine Portela da Luz', 'gilcelaine.luz@way2.com.br', NULL, 10),
  ('Guilherme de Oliveira França', 'guilherme.franca@way2.com.br', NULL, 11),
  ('Jaicon Algir Marmitt', 'jaicon.marmitt@way2.com.br', NULL, 12),
  ('José Shippit', 'jose@shippit.app', '#0ea5e9', 13),
  ('Lais Caroline Ortiz', 'lais.ortiz@way2.com.br', NULL, 14),
  ('Luiz Berti', 'luizberti@shippit.app', '#0ea5e9', 15),
  ('Rafaello Valladares Bertolini', 'rafaello.bertolini@way2.com.br', NULL, 16),
  ('Rinaldo Ferreira Junior', 'rinaldo.junior@way2.com.br', NULL, 17),
  ('Vitor Junior de Oliveira Souza', 'vitor.souza@way2.com.br', NULL, 18),
  ('Warley Thales da Silva Lopes', 'warley.lopes@way2.com.br', NULL, 19);
```

- [ ] **Step 2: Pedir ao usuário para aplicar a migration**

Pedir ao usuário para colar o conteúdo do arquivo no SQL Editor do Supabase (projeto `nuvrdppxecbowxopbqcr`) e executar. Esperado: `Success. No rows returned`. Aguardar confirmação antes de seguir.

- [ ] **Step 3: Escrever a Seção 1 do smoke test**

```sql
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

ROLLBACK;
```

- [ ] **Step 4: Pedir ao usuário para rodar o smoke test**

Pedir ao usuário para colar o conteúdo de `retro_participants_smoke.sql` no SQL Editor e executar. Esperado: `NOTICE: Seção 1 OK`, sem `ERROR`. Aguardar confirmação antes de seguir.

- [ ] **Step 5: Editar `src/integrations/supabase/types.ts` — tabelas novas**

Localizar o bloco `role_audit_log: { ... }` (termina com `Relationships: []\n      };` antes de `sprints: {`). Inserir imediatamente depois, ainda dentro de `Tables: {`, em ordem alfabética (entre `role_audit_log` e `sprints`):

```ts
      retro_participants: {
        Row: {
          color: string | null;
          created_at: string;
          email: string;
          id: string;
          name: string;
          photo_data_url: string | null;
          photo_fetched_at: string | null;
          sort_order: number;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          name: string;
          photo_data_url?: string | null;
          photo_fetched_at?: string | null;
          sort_order: number;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          name?: string;
          photo_data_url?: string | null;
          photo_fetched_at?: string | null;
          sort_order?: number;
        };
        Relationships: [];
      };
      retro_roulette_state: {
        Row: {
          drawn_emails: string[];
          id: boolean;
          last_winner_email: string | null;
          skipped_emails: string[];
          updated_at: string;
        };
        Insert: {
          drawn_emails?: string[];
          id?: boolean;
          last_winner_email?: string | null;
          skipped_emails?: string[];
          updated_at?: string;
        };
        Update: {
          drawn_emails?: string[];
          id?: boolean;
          last_winner_email?: string | null;
          skipped_emails?: string[];
          updated_at?: string;
        };
        Relationships: [];
      };
```

- [ ] **Step 6: Verificar e commitar**

```bash
npx prettier --write src/integrations/supabase/types.ts
npx eslint src/integrations/supabase/types.ts
npx tsc --noEmit
```

Esperado: sem erros novos neste arquivo.

```bash
git add supabase/migrations/20260902180000_retro_participants_foundation.sql supabase/tests/retro_participants_smoke.sql src/integrations/supabase/types.ts
git commit -m "feat(retrospectivas): adiciona retro_participants e retro_roulette_state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — token do Microsoft Graph e helpers de autorização

**Files:**
- Create: `supabase/migrations/20260902181000_retro_ms_graph_token.sql`
- Modify: `supabase/tests/retro_participants_smoke.sql` (adiciona Seção 2)

**Interfaces:**
- Consumes: `private.can_view_board(uuid)`, `private.can_edit_board(uuid)`, `private.has_route(uuid, app_route)` (já existentes, de `20260804121648_...sql`/`20260808120000_rbac_foundation.sql`/`20260828130000_route_access_foundation.sql`).
- Produces: tabela `public.ms_graph_token` (singleton, sem policies); funções `private.can_view_retrospectivas(uuid) returns boolean` e `private.can_edit_retrospectivas(uuid) returns boolean`.

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260902181000_retro_ms_graph_token.sql
-- Token OAuth do Microsoft Graph (issue #24, fotos de participantes),
-- persistido no Supabase porque o runtime é Cloudflare Workers via
-- Nitro (serverless) — sem disco persistente, diferente do processo Node
-- de vida longa do jira-live original (.ms-token-cache.json em arquivo).
--
-- Fica no schema public (não em private) porque supabaseAdmin
-- (src/integrations/supabase/client.server.ts) é um client supabase-js
-- comum: só consulta tabelas expostas via PostgREST no schema public sem
-- configuração adicional de API, e nenhum código do projeto hoje acessa
-- outro schema a partir do service-role client. A proteção não vem do
-- isolamento de schema, vem de RLS habilitado SEM NENHUMA policy — só
-- service_role (que bypassa RLS) consegue ler ou escrever.
CREATE TABLE public.ms_graph_token (
  id boolean PRIMARY KEY DEFAULT true,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ms_graph_token_singleton CHECK (id)
);

INSERT INTO public.ms_graph_token (id) VALUES (true);

ALTER TABLE public.ms_graph_token ENABLE ROW LEVEL SECURITY;
-- De propósito: zero CREATE POLICY aqui.

-- Helpers de autorização para as RPCs do sorteio (Task 3), mesmo padrão de
-- private.can_view_alocacoes/can_edit_alocacoes
-- (20260831140000_alocacoes_auth_helpers.sql) — existe para que a próxima
-- RPC SECURITY DEFINER tenha UMA função para chamar, em vez de reconstruir
-- o AND papel+rota de memória (a lição documentada naquela migration: um
-- esquecimento assim já virou escalada de privilégio real em produção).
CREATE OR REPLACE FUNCTION private.can_view_retrospectivas(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.can_view_board(_user_id)
     AND private.has_route(_user_id, 'retrospectivas'::public.app_route)
$$;

CREATE OR REPLACE FUNCTION private.can_edit_retrospectivas(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.can_edit_board(_user_id)
     AND private.has_route(_user_id, 'retrospectivas'::public.app_route)
$$;

REVOKE ALL ON FUNCTION private.can_view_retrospectivas(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION private.can_edit_retrospectivas(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.can_view_retrospectivas(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_edit_retrospectivas(uuid) TO authenticated, service_role;
```

- [ ] **Step 2: Pedir ao usuário para aplicar a migration**

Colar no SQL Editor e executar. Esperado: `Success. No rows returned`. Aguardar confirmação.

- [ ] **Step 3: Adicionar a Seção 2 ao smoke test**

Editar `supabase/tests/retro_participants_smoke.sql`, inserindo antes do `ROLLBACK;` final:

```sql
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
```

- [ ] **Step 4: Pedir ao usuário para rodar o smoke test completo**

Colar o arquivo inteiro (Seções 1 e 2) no SQL Editor. Esperado: `Seção 1 OK`, `Seção 2 OK`, sem `ERROR`. Aguardar confirmação.

- [ ] **Step 5: Editar `types.ts` — nenhuma tabela nova exposta**

`ms_graph_token` **não precisa** entrar em `types.ts` para este plano funcionar: nenhum código client-safe consulta essa tabela — só `token.server.ts` (Task 4), que usa `supabaseAdmin.from("ms_graph_token")`. Sem tipagem gerada, o TypeScript infere `any` para essa chamada especificamente; para manter tipagem completa, adicionar mesmo assim (consistente com a convenção "editar à mão"). Localizar o bloco `role_audit_log: { ... }` — como `ms_graph_token` vem alfabeticamente antes de `retro_participants`, inserir o bloco entre `invitations` e `retro_participants` (ou seja, imediatamente antes do bloco `retro_participants` inserido na Task 1, movendo-o para depois de `ms_graph_token` para manter ordem alfabética):

```ts
      ms_graph_token: {
        Row: {
          access_token: string | null;
          expires_at: string | null;
          id: boolean;
          refresh_token: string | null;
          updated_at: string;
        };
        Insert: {
          access_token?: string | null;
          expires_at?: string | null;
          id?: boolean;
          refresh_token?: string | null;
          updated_at?: string;
        };
        Update: {
          access_token?: string | null;
          expires_at?: string | null;
          id?: boolean;
          refresh_token?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
```

- [ ] **Step 6: Verificar e commitar**

```bash
npx prettier --write src/integrations/supabase/types.ts
npx eslint src/integrations/supabase/types.ts
npx tsc --noEmit
```

```bash
git add supabase/migrations/20260902181000_retro_ms_graph_token.sql supabase/tests/retro_participants_smoke.sql src/integrations/supabase/types.ts
git commit -m "feat(retrospectivas): adiciona ms_graph_token e helpers can_(view|edit)_retrospectivas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Migration — RPCs do sorteio

**Files:**
- Create: `supabase/migrations/20260902182000_retro_roulette_rpcs.sql`
- Modify: `supabase/tests/retro_participants_smoke.sql` (adiciona Seção 3)

**Interfaces:**
- Consumes: `private.can_edit_retrospectivas(uuid)` (Task 2).
- Produces: `public.spin_roulette() returns text`; `public.skip_participant(_email text) returns void`; `public.unskip_participant(_email text) returns void`; `public.unmark_participant(_email text) returns void`; `public.reset_roulette() returns void`. Erro `W2001` ("Sem permissão") em qualquer chamada sem `can_edit_retrospectivas`; erro `W2402` em `spin_roulette()` sem participante elegível.

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260902182000_retro_roulette_rpcs.sql
-- RPCs do sorteio de Retrospectivas (issue #24). O vencedor é sorteado NO
-- SERVIDOR — se o client escolhesse e só enviasse o resultado para
-- persistir, qualquer usuário poderia forjar quem "ganhou" chamando a RPC
-- direto. A animação visual de 18 flashes (use-roulette.ts, puramente
-- estética) continua rodando no client depois que o servidor já decidiu.
CREATE OR REPLACE FUNCTION public.spin_roulette()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_winner text;
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  SELECT p.email INTO v_winner
    FROM public.retro_participants p, public.retro_roulette_state s
   WHERE NOT (p.email = ANY(s.drawn_emails))
     AND NOT (p.email = ANY(s.skipped_emails))
   ORDER BY random()
   LIMIT 1;

  IF v_winner IS NULL THEN
    RAISE EXCEPTION 'Nenhum participante elegível' USING ERRCODE = 'W2402';
  END IF;

  UPDATE public.retro_roulette_state
     SET drawn_emails = array_append(drawn_emails, v_winner),
         last_winner_email = v_winner,
         updated_at = now();

  RETURN v_winner;
END;
$$;

CREATE OR REPLACE FUNCTION public.skip_participant(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  UPDATE public.retro_roulette_state
     SET skipped_emails = array_append(skipped_emails, _email), updated_at = now()
   WHERE NOT (_email = ANY(skipped_emails)) AND NOT (_email = ANY(drawn_emails));
END;
$$;

CREATE OR REPLACE FUNCTION public.unskip_participant(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  UPDATE public.retro_roulette_state
     SET skipped_emails = array_remove(skipped_emails, _email), updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.unmark_participant(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  UPDATE public.retro_roulette_state
     SET drawn_emails = array_remove(drawn_emails, _email),
         last_winner_email = CASE WHEN last_winner_email = _email THEN NULL ELSE last_winner_email END,
         updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_roulette()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  UPDATE public.retro_roulette_state
     SET drawn_emails = '{}', skipped_emails = '{}', last_winner_email = NULL, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.spin_roulette() FROM public, anon;
REVOKE ALL ON FUNCTION public.skip_participant(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unskip_participant(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unmark_participant(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.reset_roulette() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.spin_roulette() TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_participant(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unskip_participant(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmark_participant(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_roulette() TO authenticated;
```

- [ ] **Step 2: Pedir ao usuário para aplicar a migration**

Colar no SQL Editor e executar. Esperado: `Success. No rows returned`. Aguardar confirmação.

- [ ] **Step 3: Adicionar a Seção 3 ao smoke test**

Editar `supabase/tests/retro_participants_smoke.sql`, inserindo antes do `ROLLBACK;` final:

```sql
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
```

- [ ] **Step 4: Pedir ao usuário para rodar o smoke test completo**

Colar o arquivo inteiro (Seções 1–3) no SQL Editor. Esperado: `Seção 1 OK`, `Seção 2 OK`, `Seção 3 OK`, sem `ERROR`. Aguardar confirmação.

- [ ] **Step 5: Editar `types.ts` — funções novas**

Localizar `set_user_routes: { ... }` dentro de `Functions: {`. Inserir depois (ordem alfabética: `reset_roulette`, `set_user_role`, `set_user_routes`, `skip_participant`, `spin_roulette`, `unmark_participant`, `unskip_participant` — os já existentes `set_user_role`/`set_user_routes` ficam entre `reset_roulette` e `skip_participant`, então dividir a inserção em dois pontos):

Antes de `set_user_role: { ... }`:
```ts
      reset_roulette: { Args: Record<PropertyKey, never>; Returns: undefined };
```

Depois de `set_user_routes: { ... }`:
```ts
      skip_participant: { Args: { _email: string }; Returns: undefined };
      spin_roulette: { Args: Record<PropertyKey, never>; Returns: string };
      unmark_participant: { Args: { _email: string }; Returns: undefined };
      unskip_participant: { Args: { _email: string }; Returns: undefined };
```

- [ ] **Step 6: Verificar e commitar**

```bash
npx prettier --write src/integrations/supabase/types.ts
npx eslint src/integrations/supabase/types.ts
npx tsc --noEmit
```

```bash
git add supabase/migrations/20260902182000_retro_roulette_rpcs.sql supabase/tests/retro_participants_smoke.sql src/integrations/supabase/types.ts
git commit -m "feat(retrospectivas): adiciona RPCs do sorteio (spin/skip/reset)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Integração Microsoft Graph — config, token e busca de foto

**Files:**
- Create: `src/integrations/ms-graph/config.server.ts`
- Create: `src/integrations/ms-graph/token.server.ts`
- Create: `src/integrations/ms-graph/photos.server.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` de `src/integrations/supabase/client.server.ts` (import dinâmico); tabela `public.ms_graph_token` (Task 2); tabela `public.retro_participants` (Task 1, colunas `photo_data_url`/`photo_fetched_at`).
- Produces: `getAccessToken(): Promise<string>` (`token.server.ts`); `fetchParticipantPhoto(email: string): Promise<{ dataUrl: string; contentType: string } | null>` (`photos.server.ts`); `getCachedOrFetchPhoto(email: string): Promise<string | null>` (`photos.server.ts`).

- [ ] **Step 1: Criar `config.server.ts`**

```ts
// src/integrations/ms-graph/config.server.ts
// Server-only: nunca importar no topo de um arquivo isomórfico (route
// files, componentes) — só dentro de handlers de createServerFn, via
// import dinâmico. Mesma convenção de src/integrations/jira/config.server.ts.
//
// Mesmas credenciais do app registration já aprovado no Entra ID para o
// projeto jira-live (server/routes/photos.ts) — evita repetir o processo
// de admin consent para um app novo.
export const MS_TENANT_ID = process.env["MS_TENANT_ID"]?.trim();
export const MS_CLIENT_ID = process.env["MS_CLIENT_ID"]?.trim();
export const MS_GRAPH_SCOPE = "https://graph.microsoft.com/User.ReadBasic.All offline_access";

// Mesma allowlist do jira-live: sem isso, buscar foto por e-mail vira um
// proxy autenticado para consultar QUALQUER e-mail via Graph API.
const ALLOWED_EMAIL_DOMAINS = new Set(["way2.com.br", "shippit.app"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isAllowedEmail(email: string): boolean {
  if (!EMAIL_RE.test(email)) return false;
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && ALLOWED_EMAIL_DOMAINS.has(domain);
}
```

- [ ] **Step 2: Criar `token.server.ts`**

```ts
// src/integrations/ms-graph/token.server.ts
// Server-only. Token OAuth do Microsoft Graph, persistido em
// public.ms_graph_token (não em arquivo — o runtime é Cloudflare Workers
// via Nitro, sem disco persistente). getAccessToken() só faz REFRESH em
// runtime; o device-code flow inicial roda fora daqui, em
// scripts/ms-graph-auth.ts (rodado localmente uma vez).
import { MS_TENANT_ID, MS_CLIENT_ID, MS_GRAPH_SCOPE } from "./config.server";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class MsGraphAuthError extends Error {}

export async function getAccessToken(): Promise<string> {
  if (!MS_TENANT_ID || !MS_CLIENT_ID) {
    throw new MsGraphAuthError("MS_TENANT_ID/MS_CLIENT_ID não configurados no ambiente");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("ms_graph_token")
    .select("access_token, refresh_token, expires_at")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;

  const now = Date.now();
  if (data?.access_token && data.expires_at && new Date(data.expires_at).getTime() > now) {
    return data.access_token;
  }

  if (!data?.refresh_token) {
    throw new MsGraphAuthError(
      "Sem token do Microsoft Graph configurado. Rode `npm run ms-graph:auth` localmente.",
    );
  }

  const res = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
      scope: MS_GRAPH_SCOPE,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new MsGraphAuthError(
      `Falha ao renovar token do Microsoft Graph: ${json.error ?? res.status} — rode npm run ms-graph:auth novamente`,
    );
  }

  const expiresAt = new Date(now + (json.expires_in ?? 3600) * 1000 - 60_000).toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("ms_graph_token")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? data.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (updateError) throw updateError;

  return json.access_token;
}
```

- [ ] **Step 3: Criar `photos.server.ts`**

```ts
// src/integrations/ms-graph/photos.server.ts
// Server-only. Cache de foto em coluna de public.retro_participants (não
// em memória do processo — o runtime é serverless, sem garantia de
// memória compartilhada entre invocações, diferente do processo Node de
// vida longa do jira-live original).
import { isAllowedEmail } from "./config.server";

const PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias: fotos corporativas mudam raramente

export async function fetchParticipantPhoto(email: string): Promise<string | null> {
  if (!isAllowedEmail(email)) return null;

  const { getAccessToken } = await import("./token.server");
  const token = await getAccessToken();

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/photo/$value`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) return null;

  const buf = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const base64 = Buffer.from(buf).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

export async function getCachedOrFetchPhoto(email: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("retro_participants")
    .select("photo_data_url, photo_fetched_at")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const isFresh =
    data.photo_fetched_at !== null && Date.now() - new Date(data.photo_fetched_at).getTime() < PHOTO_TTL_MS;
  if (isFresh && data.photo_data_url) return data.photo_data_url;

  let dataUrl: string | null;
  try {
    dataUrl = await fetchParticipantPhoto(email);
  } catch (err) {
    console.error(`[ms-graph/photos] falha ao buscar foto de ${email}`, err);
    return data.photo_data_url; // mantém o que já havia em cache, se houver
  }

  const { error: updateError } = await supabaseAdmin
    .from("retro_participants")
    .update({ photo_data_url: dataUrl, photo_fetched_at: new Date().toISOString() })
    .eq("email", email);
  if (updateError) throw updateError;

  return dataUrl;
}
```

- [ ] **Step 4: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Esperado: sem erros novos nestes 3 arquivos (erros pré-existentes em outros arquivos não importam aqui).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/ms-graph/config.server.ts src/integrations/ms-graph/token.server.ts src/integrations/ms-graph/photos.server.ts
git commit -m "feat(retrospectivas): integração Microsoft Graph para fotos (config/token/fetch)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Server function `getParticipantPhoto` e script local de autorização

**Files:**
- Create: `src/integrations/ms-graph/server-fns.ts`
- Create: `scripts/ms-graph-auth.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `getCachedOrFetchPhoto(email)` (Task 4); `requireSupabaseAuth` de `src/integrations/supabase/auth-middleware.ts`; `assertRouteAccess` de `src/integrations/jira/access.server.ts`.
- Produces: `getParticipantPhoto` — `createServerFn` client-safe, `(data: string) => Promise<string | null>`.

- [ ] **Step 1: Criar `server-fns.ts`**

```ts
// src/integrations/ms-graph/server-fns.ts
// Stub de RPC client-safe — só o createServerFn fica exposto aqui, mesma
// convenção de src/integrations/jira/server-fns.ts. A lógica real
// (photos.server/token.server) é importada dinamicamente dentro do
// handler.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getParticipantPhoto = createServerFn({ method: "GET" })
  .validator((email: string) => email)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data: email }): Promise<string | null> => {
    const { assertRouteAccess } = await import("@/integrations/jira/access.server");
    await assertRouteAccess(context.supabase, context.userId, "retrospectivas");

    const { getCachedOrFetchPhoto } = await import("./photos.server");
    return getCachedOrFetchPhoto(email);
  });
```

- [ ] **Step 2: Criar `scripts/ms-graph-auth.ts`**

```ts
// scripts/ms-graph-auth.ts
// Script local, rodado manualmente uma vez (`npm run ms-graph:auth`, via
// tsx): faz o device-code flow completo do Microsoft
// Graph (com polling real, sem a limitação de timeout de uma invocação
// serverless) e grava o token resultante em public.ms_graph_token via
// service role. Depois disso o app em produção só faz refresh automático
// (src/integrations/ms-graph/token.server.ts).
//
// Pré-requisitos no .env local: MS_TENANT_ID, MS_CLIENT_ID (mesmos valores
// do app registration usado pelo jira-live), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (pegar no painel do Supabase, projeto
// nuvrdppxecbowxopbqcr, em Project Settings > API > service_role — NUNCA
// commitar esse valor).
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = process.env["MS_TENANT_ID"]?.trim();
const CLIENT_ID = process.env["MS_CLIENT_ID"]?.trim();
const SUPABASE_URL = process.env["SUPABASE_URL"]?.trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
const SCOPE = "https://graph.microsoft.com/User.ReadBasic.All offline_access";

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function main(): Promise<void> {
  const missing = [
    ...(!TENANT_ID ? ["MS_TENANT_ID"] : []),
    ...(!CLIENT_ID ? ["MS_CLIENT_ID"] : []),
    ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
    ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
  ];
  if (missing.length > 0) {
    console.error(`Variável(is) de ambiente ausente(s) no .env: ${missing.join(", ")}`);
    process.exit(1);
  }

  const dcRes = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID!, scope: SCOPE }),
  });
  const dc = (await dcRes.json()) as DeviceCodeResponse;
  if (dc.error || !dc.verification_uri || !dc.user_code || !dc.device_code) {
    console.error(`Erro ao pedir device code: ${dc.error ?? "resposta incompleta"} — ${dc.error_description ?? ""}`);
    process.exit(1);
  }

  console.log("\n=== Autenticação Microsoft necessária ===");
  console.log(`1. Acesse: ${dc.verification_uri}`);
  console.log(`2. Código: ${dc.user_code}`);
  console.log("Aguardando autorização...\n");

  const interval = (dc.interval ?? 5) * 1000;
  const deadline = Date.now() + (dc.expires_in ?? 900) * 1000;
  let token: TokenResponse | null = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const tr = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID!,
        grant_type: "urn:ietf:params:oauth2:grant-type:device_code",
        device_code: dc.device_code,
      }),
    });
    const tj = (await tr.json()) as TokenResponse;
    if (tj.access_token) {
      token = tj;
      break;
    }
    if (tj.error !== "authorization_pending" && tj.error !== "slow_down") {
      console.error(`Autenticação falhou: ${tj.error} — ${tj.error_description}`);
      process.exit(1);
    }
  }

  if (!token?.access_token || !token.refresh_token) {
    console.error("Timeout esperando autorização.");
    process.exit(1);
  }

  const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000 - 60_000).toISOString();
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await supabase
    .from("ms_graph_token")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) {
    console.error("Falha ao gravar token no Supabase:", error.message);
    process.exit(1);
  }

  console.log("✓ Token gravado em public.ms_graph_token. As fotos já podem ser buscadas pelo app.");
}

void main();
```

- [ ] **Step 3: Adicionar `tsx` como devDependency**

`bun` não está garantido no PATH de todo ambiente que for rodar este script (decisão registrada durante a execução do plano) — usar `tsx` (roda em Node puro) em vez de `bun run` para este script standalone.

```bash
npm install --save-dev tsx
```

- [ ] **Step 4: Adicionar o script ao `package.json`**

Localizar o bloco `"scripts": { ... }` e adicionar, depois de `"format"`:

```json
    "ms-graph:auth": "tsx scripts/ms-graph-auth.ts"
```

- [ ] **Step 5: Verificar TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/integrations/ms-graph/server-fns.ts scripts/ms-graph-auth.ts package.json package-lock.json
git commit -m "feat(retrospectivas): getParticipantPhoto e script local de autorização OAuth

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Nota: este `npm install` cria/atualiza `package-lock.json` no worktree, ainda que o projeto normalmente use `bun.lock`. Incluir o `package-lock.json` neste commit é aceitável (registra a devDependency nova de forma reproduzível fora do Bun); não editar `bun.lock` manualmente.

- [ ] **Step 6: Pedir ao usuário para rodar a autorização**

Instruir o usuário a:
1. Adicionar ao `.env` local: `MS_TENANT_ID` e `MS_CLIENT_ID` (mesmos valores usados pelo `jira-live`, em `server/routes/photos.ts` — hoje `cdc5aeea-15c5-4db6-b079-fcadd2505dc2` e `d3590ed6-52b3-4102-aeff-aad2292ab01c` como default, confirmar se são os que devem ser usados aqui também), e `SUPABASE_SERVICE_ROLE_KEY` (painel do Supabase, projeto `nuvrdppxecbowxopbqcr` → Project Settings → API → service_role).
2. Rodar `npm run ms-graph:auth`, acessar o link mostrado, digitar o código.
3. Confirmar a mensagem `✓ Token gravado em public.ms_graph_token.`

Aguardar confirmação antes de seguir — a Task 8 (roteiro manual) depende do token já estar gravado para testar fotos de verdade, embora o app funcione com fallback de iniciais mesmo sem isso.

---

### Task 6: Hooks client — participantes e sorteio via Supabase

**Files:**
- Create: `src/hooks/use-retro-participants.ts`
- Create: `src/hooks/use-retro-photos.ts`
- Modify: `src/hooks/use-roulette.ts`
- Modify: `src/lib/retrospectivas/participants.ts`
- Remove: `src/lib/retrospectivas/storage.ts`

**Interfaces:**
- Consumes: `supabase` de `@/integrations/supabase/client`; `getParticipantPhoto` de `@/integrations/ms-graph/server-fns` (Task 5).
- Produces: `useRetroParticipants(): { participants: RetroParticipant[], loading: boolean }` onde `RetroParticipant = { id: string, name: string, email: string, color: string | null, sortOrder: number }`; `useRetroPhotos(emails: readonly string[]): Record<string, string | undefined>`; `useRoulette(participants: readonly RetroParticipant[]): RouletteApi` (mesma forma pública de hoje, mas agora recebe a lista de participantes como argumento em vez de importar `PARTICIPANTS` estaticamente).

- [ ] **Step 1: Editar `participants.ts` — remove o array estático**

```ts
// src/lib/retrospectivas/participants.ts
// Funções puras de apresentação da retro — nome, cor, iniciais. Os dados
// (nome/e-mail/cor/ordem) vêm de public.retro_participants via
// use-retro-participants.ts (issue #24); este arquivo não conhece mais o
// Supabase, só sabe formatar o que chega.
export type Participant = { name: string; email: string; color?: string | null };

// As mesmas 21 cores do legado, na mesma ordem: a cor de cada pessoa é
// AVATAR_COLORS[i % 21]. Mudar a ordem da lista abaixo muda a cor de todo
// mundo — é feio, mas é o comportamento que o time já conhece.
export const AVATAR_COLORS: readonly string[] = [
  "#4f46e5",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#d97706",
  "#059669",
  "#0891b2",
  "#1d4ed8",
  "#be185d",
  "#9333ea",
  "#0d9488",
  "#b45309",
  "#16a34a",
  "#e11d48",
  "#6d28d9",
  "#0369a1",
  "#c2410c",
  "#15803d",
  "#7e22ce",
  "#0e7490",
  "#b91c1c",
];

// Cores de estado do avatar, iguais às do legado.
export const DRAWN_COLOR = "#9ca3af";
export const SKIPPED_COLOR = "#d97706";

// noUncheckedIndexedAccess torna o acesso indexado `string | undefined`; o `??`
// devolve um string de verdade sem precisar de `!`.
export function paletteColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length] ?? "#4f46e5";
}

// Cor base do avatar: o `color` explícito (marcador de pessoal externo) tem
// precedência sobre a paleta. Vale no grid E no card de vencedor.
export function avatarColor(p: Participant, index: number): string {
  return p.color ?? paletteColor(index);
}

// Primeira + última inicial; nome de uma palavra só usa os 2 primeiros caracteres.
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0] ?? "";
    const last = parts[parts.length - 1] ?? "";
    return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Nome exibido no card do grid.
export function firstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
}

// Nome exibido no card de vencedor: as duas primeiras palavras, como no legado.
export function shortName(fullName: string): string {
  return fullName.split(" ").slice(0, 2).join(" ");
}
```

- [ ] **Step 2: Criar `use-retro-participants.ts`**

```ts
// src/hooks/use-retro-participants.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RetroParticipant = {
  id: string;
  name: string;
  email: string;
  color: string | null;
  sortOrder: number;
};

// Lê os participantes protegidos por has_route(uid, 'retrospectivas') —
// policy retro_participants_select_route. staleTime alto: a lista muda por
// edição manual no banco, não por ação do usuário durante a sessão.
export function useRetroParticipants() {
  const q = useQuery({
    queryKey: ["retro-participants"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<RetroParticipant[]> => {
      const { data, error } = await supabase
        .from("retro_participants")
        .select("id, name, email, color, sort_order")
        .order("sort_order");
      if (error) throw error;
      return data.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        color: p.color,
        sortOrder: p.sort_order,
      }));
    },
  });

  return { participants: q.data ?? [], loading: q.isLoading };
}
```

- [ ] **Step 3: Criar `use-retro-photos.ts`**

```ts
// src/hooks/use-retro-photos.ts
import { useQueries } from "@tanstack/react-query";
import { getParticipantPhoto } from "@/integrations/ms-graph/server-fns";

// Uma query por e-mail (cacheada individualmente pelo react-query,
// staleTime alto complementar ao cache em coluna do banco — Task 4) em vez
// de uma chamada em lote: assim cada foto aparece assim que chega, sem
// esperar a mais lenta do grupo, e falhas isoladas (pessoa sem foto no
// Graph) não derrubam as demais.
export function useRetroPhotos(emails: readonly string[]): Record<string, string | undefined> {
  const results = useQueries({
    queries: emails.map((email) => ({
      queryKey: ["retro-photo", email],
      staleTime: 12 * 60 * 60 * 1000,
      queryFn: () => getParticipantPhoto({ data: email }),
    })),
  });

  const photos: Record<string, string | undefined> = {};
  emails.forEach((email, i) => {
    photos[email] = results[i]?.data ?? undefined;
  });
  return photos;
}
```

- [ ] **Step 4: Reescrever `use-roulette.ts`**

```ts
// src/hooks/use-roulette.ts
import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RetroParticipant } from "./use-retro-participants";

// 18 flashes de 80 ms ≈ 1,44 s — os mesmos números do legado. Puramente
// estético: o vencedor real já foi decidido pelo servidor (spin_roulette)
// antes da animação começar — ver comentário na migration das RPCs.
const FLASH_MS = 80;
const TOTAL_FLASHES = 18;
const SLOWDOWN_FROM = TOTAL_FLASHES - 4;
const DISCARD_CHANCE = 0.6;

export type RouletteApi = {
  drawn: ReadonlySet<string>;
  skipped: ReadonlySet<string>;
  lastWinner: string | null;
  highlight: string | null;
  spinning: boolean;
  availableCount: number;
  spin(): void;
  reset(): void;
  unmark(email: string): void;
  skip(email: string): void;
  unskip(email: string): void;
};

type RouletteState = {
  drawnEmails: string[];
  skippedEmails: string[];
  lastWinnerEmail: string | null;
};

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pickRandom(pool: readonly string[]): string | undefined {
  return pool[Math.floor(Math.random() * pool.length)];
}

export function useRoulette(participants: readonly RetroParticipant[]): RouletteApi {
  const qc = useQueryClient();
  const [highlight, setHighlight] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stateQ = useQuery({
    queryKey: ["retro-roulette-state"],
    queryFn: async (): Promise<RouletteState> => {
      const { data, error } = await supabase
        .from("retro_roulette_state")
        .select("drawn_emails, skipped_emails, last_winner_email")
        .eq("id", true)
        .single();
      if (error) throw error;
      return {
        drawnEmails: data.drawn_emails,
        skippedEmails: data.skipped_emails,
        lastWinnerEmail: data.last_winner_email,
      };
    },
  });

  const drawn = useMemo(
    () => new Set(stateQ.data?.drawnEmails ?? []),
    [stateQ.data?.drawnEmails],
  );
  const skipped = useMemo(
    () => new Set(stateQ.data?.skippedEmails ?? []),
    [stateQ.data?.skippedEmails],
  );
  const lastWinner = stateQ.data?.lastWinnerEmail ?? null;

  const available = useMemo(
    () => participants.filter((p) => !drawn.has(p.email) && !skipped.has(p.email)).map((p) => p.email),
    [participants, drawn, skipped],
  );

  const invalidateState = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["retro-roulette-state"] });
  }, [qc]);

  const spinMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("spin_roulette");
      if (error) throw error;
      return data;
    },
  });

  const skipMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.rpc("skip_participant", { _email: email });
      if (error) throw error;
    },
    onSuccess: invalidateState,
  });

  const unskipMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.rpc("unskip_participant", { _email: email });
      if (error) throw error;
    },
    onSuccess: invalidateState,
  });

  const unmarkMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.rpc("unmark_participant", { _email: email });
      if (error) throw error;
    },
    onSuccess: invalidateState,
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reset_roulette");
      if (error) throw error;
    },
    onSuccess: invalidateState,
  });

  const spin = useCallback(() => {
    if (spinning || available.length === 0) return;
    setSpinning(true);

    spinMutation.mutate(undefined, {
      onSuccess: (winner) => {
        if (prefersReducedMotion()) {
          invalidateState();
          setSpinning(false);
          return;
        }

        if (timerRef.current !== null) clearInterval(timerRef.current);
        let flashes = 0;
        timerRef.current = setInterval(() => {
          flashes += 1;
          const roundPool =
            flashes > SLOWDOWN_FROM
              ? available.filter((email) => email === winner || Math.random() > DISCARD_CHANCE)
              : available;
          setHighlight(pickRandom(roundPool) ?? winner);

          if (flashes >= TOTAL_FLASHES) {
            if (timerRef.current !== null) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setHighlight(null);
            setSpinning(false);
            invalidateState();
          }
        }, FLASH_MS);
      },
      onError: () => setSpinning(false),
    });
  }, [available, invalidateState, spinMutation, spinning]);

  const reset = useCallback(() => {
    if (spinning) return;
    resetMutation.mutate();
  }, [resetMutation, spinning]);

  const unmark = useCallback(
    (email: string) => {
      if (spinning) return;
      unmarkMutation.mutate(email);
    },
    [spinning, unmarkMutation],
  );

  const skip = useCallback(
    (email: string) => {
      if (spinning || drawn.has(email)) return;
      skipMutation.mutate(email);
    },
    [drawn, skipMutation, spinning],
  );

  const unskip = useCallback(
    (email: string) => {
      if (spinning) return;
      unskipMutation.mutate(email);
    },
    [spinning, unskipMutation],
  );

  return {
    drawn,
    skipped,
    lastWinner,
    highlight,
    spinning,
    availableCount: available.length,
    spin,
    reset,
    unmark,
    skip,
    unskip,
  };
}
```

- [ ] **Step 5: Remover `storage.ts`**

```bash
git rm src/lib/retrospectivas/storage.ts
```

- [ ] **Step 6: Verificar TypeScript**

```bash
npx tsc --noEmit
```

Esperado: erros apontando para `RouletteView.tsx`/`ParticipantCard.tsx` ainda usando a API antiga (`PARTICIPANTS`, `getPhoto` síncrono) — corrigidos na Task 7. Confirmar que não há erro nos arquivos desta task.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-retro-participants.ts src/hooks/use-retro-photos.ts src/hooks/use-roulette.ts src/lib/retrospectivas/participants.ts
git commit -m "feat(retrospectivas): hooks de participantes/fotos/sorteio via Supabase

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: UI — `RouletteView` e `ParticipantCard` consumindo os hooks novos

**Files:**
- Modify: `src/components/retrospectivas/RouletteView.tsx`
- Modify: `src/components/retrospectivas/ParticipantCard.tsx`
- Remove: `src/lib/retrospectivas/photos.ts`

**Interfaces:**
- Consumes: `useRetroParticipants()` (Task 6); `useRetroPhotos(emails)` (Task 6); `useRoulette(participants)` (Task 6, assinatura nova).
- Produces: `ParticipantCardProps` ganha `photoUrl: string | undefined` no lugar de resolver a foto internamente.

- [ ] **Step 1: Editar `ParticipantCard.tsx` — foto vem por prop**

```tsx
// src/components/retrospectivas/ParticipantCard.tsx
import { Ban, CirclePause, Undo2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  avatarColor,
  firstName,
  getInitials,
  DRAWN_COLOR,
  SKIPPED_COLOR,
  type Participant,
} from "@/lib/retrospectivas/participants";
import { cn } from "@/lib/utils";

export type ParticipantCardProps = {
  participant: Participant;
  index: number;
  photoUrl: string | undefined;
  drawn: boolean;
  skipped: boolean;
  highlighted: boolean;
  disabled: boolean;
  onUnmark: () => void;
  onSkip: () => void;
  onUnskip: () => void;
};

const OVERLAY_BUTTON =
  "absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring disabled:pointer-events-none";

export function ParticipantCard({
  participant,
  index,
  photoUrl,
  drawn,
  skipped,
  highlighted,
  disabled,
  onUnmark,
  onSkip,
  onUnskip,
}: ParticipantCardProps) {
  const color = drawn ? DRAWN_COLOR : skipped ? SKIPPED_COLOR : avatarColor(participant, index);

  return (
    <div
      className={cn(
        "group relative flex flex-col items-center gap-2 rounded-lg border bg-card p-3 transition",
        drawn && "opacity-40 [&_img]:grayscale",
        skipped && "border-amber-500/60 bg-amber-500/10",
        highlighted && "bg-primary/15 ring-2 ring-primary",
      )}
    >
      <Avatar className="size-12">
        <AvatarImage src={photoUrl} alt="" />
        <AvatarFallback
          style={{ backgroundColor: color }}
          className="text-sm font-semibold text-white"
        >
          {getInitials(participant.name)}
        </AvatarFallback>
      </Avatar>

      <span
        className={cn(
          "max-w-full truncate text-xs font-medium",
          skipped && "text-amber-600 dark:text-amber-400",
        )}
      >
        {firstName(participant.name)}
      </span>

      {drawn ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onUnmark}
          aria-label={`Desmarcar ${participant.name} como sorteado`}
          className={OVERLAY_BUTTON}
        >
          <Undo2 aria-hidden className="absolute right-1 top-1 size-3.5 text-muted-foreground" />
        </button>
      ) : null}

      {skipped ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onUnskip}
          aria-label={`Reincluir ${participant.name} no sorteio`}
          className={OVERLAY_BUTTON}
        >
          <CirclePause
            aria-hidden
            className="absolute right-1 top-1 size-3.5 text-amber-600 dark:text-amber-400"
          />
        </button>
      ) : null}

      {!drawn && !skipped ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onSkip}
          aria-label={`Marcar ${participant.name} como ausente`}
          className={cn(
            "absolute right-1 top-1 rounded-full p-0.5 text-muted-foreground opacity-0",
            "transition hover:text-amber-600 focus-visible:opacity-100 group-hover:opacity-100",
            "disabled:pointer-events-none dark:hover:text-amber-400",
          )}
        >
          <Ban aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Editar `RouletteView.tsx`**

```tsx
// src/components/retrospectivas/RouletteView.tsx
import { RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { useRoulette } from "@/hooks/use-roulette";
import { useRetroParticipants } from "@/hooks/use-retro-participants";
import { useRetroPhotos } from "@/hooks/use-retro-photos";
import { avatarColor, getInitials, shortName } from "@/lib/retrospectivas/participants";
import { ParticipantCard } from "./ParticipantCard";

export function RouletteView() {
  const { participants } = useRetroParticipants();
  const roulette = useRoulette(participants);
  const photos = useRetroPhotos(participants.map((p) => p.email));

  const drawnCount = roulette.drawn.size;
  const skippedCount = roulette.skipped.size;
  const plural = skippedCount > 1 ? "s" : "";
  const counter =
    skippedCount > 0
      ? `${drawnCount} / ${participants.length} sorteados · ${skippedCount} ausente${plural}`
      : `${drawnCount} / ${participants.length} sorteados`;

  const winnerIndex = participants.findIndex((p) => p.email === roulette.lastWinner);
  const winner = winnerIndex === -1 ? undefined : participants[winnerIndex];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4">
        <p className="text-[11px] text-muted-foreground">{counter}</p>

        <Card className="flex flex-col items-center gap-4 p-6">
          <div aria-live="polite" className="flex min-h-[7rem] items-center justify-center">
            {winner ? (
              <div
                key={winner.email}
                className="flex animate-in flex-col items-center gap-1 duration-300 zoom-in-95"
              >
                <Avatar className="size-16 ring-2 ring-primary">
                  <AvatarImage src={photos[winner.email]} alt="" />
                  <AvatarFallback
                    style={{ backgroundColor: avatarColor(winner, winnerIndex) }}
                    className="text-lg font-semibold text-white"
                  >
                    {getInitials(winner.name)}
                  </AvatarFallback>
                </Avatar>
                <p className="text-base font-semibold">{shortName(winner.name)}</p>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  sorteado!
                </p>
              </div>
            ) : null}
          </div>

          <Button
            size="lg"
            onClick={roulette.spin}
            disabled={roulette.spinning || roulette.availableCount === 0}
          >
            <Shuffle className="size-5" /> Sortear
          </Button>

          {drawnCount > 0 || skippedCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={roulette.reset} disabled={roulette.spinning}>
              <RotateCcw className="size-4" /> Reiniciar
            </Button>
          ) : null}
        </Card>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3">
          {participants.map((p, i) => (
            <ParticipantCard
              key={p.email}
              participant={p}
              index={i}
              photoUrl={photos[p.email]}
              drawn={roulette.drawn.has(p.email)}
              skipped={roulette.skipped.has(p.email)}
              highlighted={roulette.highlight === p.email}
              disabled={roulette.spinning}
              onUnmark={() => roulette.unmark(p.email)}
              onSkip={() => roulette.skip(p.email)}
              onUnskip={() => roulette.unskip(p.email)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Remover `photos.ts`**

```bash
git rm src/lib/retrospectivas/photos.ts
```

- [ ] **Step 4: Atualizar o comentário desatualizado em `retrospectivas.tsx`**

O comentário deste arquivo documenta exatamente o gap que esta issue fecha — precisa deixar de descrever um problema resolvido como se ainda existisse.

Editar `src/routes/_shell/retrospectivas.tsx`, trocando o comentário (linhas 4–18) por:

```tsx
// src/routes/_shell/retrospectivas.tsx
import { createFileRoute } from "@tanstack/react-router";
import { RouletteView } from "@/components/retrospectivas/RouletteView";

// A guia fica escondida da nav e do acesso direto por URL para quem não tem
// a rota `retrospectivas` — checagem central em `_shell.tsx`, que bloqueia o
// conteúdo de cada guia via `routes.has(activeTab.id)` (não um único
// `canView` uniforme para as quatro).
//
// Desde a issue #24, essa proteção também vale para o DADO, não só para a
// navegação: `retro_participants`/`retro_roulette_state`
// (supabase/migrations/20260902180000_retro_participants_foundation.sql)
// são protegidas por RLS exigindo has_route(uid, 'retrospectivas') — quem
// não tem a rota não lê nome/e-mail de ninguém via API do Supabase, mesmo
// com o bundle JS em mãos. Mutações do sorteio passam por RPCs
// SECURITY DEFINER que exigem papel editor/admin além da rota
// (private.can_edit_retrospectivas).
export const Route = createFileRoute("/_shell/retrospectivas")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Retrospectivas — Roleta de sorteio do time" },
      {
        name: "description",
        content: "Sorteia quem conduz a próxima retro, com estado que sobrevive ao refresh.",
      },
    ],
  }),
  component: RetrospectivasPage,
});

function RetrospectivasPage() {
  return <RouletteView />;
}
```

- [ ] **Step 5: Verificar TypeScript e lint**

```bash
npx tsc --noEmit
npx eslint src/components/retrospectivas/RouletteView.tsx src/components/retrospectivas/ParticipantCard.tsx src/hooks/use-roulette.ts src/lib/retrospectivas/participants.ts src/routes/_shell/retrospectivas.tsx
```

Esperado: nenhum erro. Se `tsc --noEmit` apontar erro em algum arquivo fora desta lista, investigar antes de seguir — pode ser um resíduo de import de `PARTICIPANTS`/`getPhoto` em outro lugar do código não mapeado neste plano.

- [ ] **Step 6: Commit**

```bash
git add src/components/retrospectivas/RouletteView.tsx src/components/retrospectivas/ParticipantCard.tsx src/routes/_shell/retrospectivas.tsx
git commit -m "feat(retrospectivas): RouletteView e ParticipantCard consomem dados do banco

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Verificação manual end-to-end

**Files:** nenhum (task de verificação, sem código novo)

**Interfaces:**
- Consumes: app rodando localmente (`npm run dev` ou equivalente), usuário com papel `editor`/`admin` e rota `retrospectivas`.

- [ ] **Step 1: Rodar o app localmente**

```bash
npm run dev
```

- [ ] **Step 2: Verificar carregamento da lista de participantes**

Abrir `/retrospectivas` autenticado com um usuário que tenha `has_route(uid, 'retrospectivas')`. Esperado: os 20 participantes aparecem no grid, na mesma ordem de antes, com as mesmas cores (em particular os 3 da Shippit em azul `#0ea5e9`).

- [ ] **Step 3: Verificar sorteio**

Clicar "Sortear". Esperado: animação de ~1,4s, um vencedor aparece no card superior, contador atualiza (`1 / 20 sorteados`). Recarregar a página (F5). Esperado: o estado (sorteado, contador, vencedor) persiste — prova de que veio do banco, não de `localStorage`.

- [ ] **Step 4: Verificar "marcar ausente" e "reiniciar"**

Marcar um participante não sorteado como ausente (ícone de proibido ao passar o mouse). Esperado: card fica âmbar, contador mostra "X ausente(s)". Clicar "Reiniciar". Esperado: todos os cards voltam ao normal, contador zera.

- [ ] **Step 5: Verificar enforcement de rota**

Como admin, revogar a rota `retrospectivas` de um usuário de teste em `/admin`. Autenticar como esse usuário. Esperado: guia "Retrospectivas" não aparece na navegação, e acessar `/retrospectivas` direto pela URL mostra a tela de acesso negado (`<AccessDenied>`, já existente desde a #23) — sem precisar de mudança nesta issue.

- [ ] **Step 6: Verificar fotos (se o script de autorização já rodou — Task 5, Step 6)**

Esperado: participantes com e-mail `@way2.com.br`/`@shippit.app` que tenham foto de perfil no Microsoft 365 mostram a foto real em vez de iniciais, tanto no grid quanto no card de vencedor.

- [ ] **Step 7: Verificar fallback sem foto configurada**

Se o script de autorização (Task 5) ainda não rodou (sem token em `public.ms_graph_token`), confirmar que a tela funciona normalmente com iniciais em vez de foto, sem erro visível na UI (checar console do navegador: nenhum erro não tratado, no máximo um log de aviso do servidor).

- [ ] **Step 8: Rodar a suíte de smoke test completa uma última vez**

Colar `supabase/tests/retro_participants_smoke.sql` (Seções 1–3) inteiro no SQL Editor do Supabase. Esperado: `Seção 1 OK`, `Seção 2 OK`, `Seção 3 OK`, sem `ERROR`.

- [ ] **Step 9: Relatar ao usuário**

Resumir o que foi verificado e pedir confirmação de que o comportamento está de acordo antes de considerar a issue #24 pronta para revisão/fechamento.

---

## Fora de escopo (não implementar neste plano)

- UI de administração de participantes (adicionar/remover/editar continua manual, via SQL/editor Supabase).
- UI para reautorizar o Microsoft Graph (reautorização futura é `npm run ms-graph:auth` de novo).
- Supabase Realtime / sincronização ao vivo do sorteio entre abas.
- Migração de fotos hoje em `photos-cache.ts` (gitignored) — a tabela nasce sem foto, populada sob demanda pelo Graph.
- Extensão de `security_invariants_check.sql` com invariantes para as tabelas novas — não foi pedido no spec; pode ser sugerido como melhoria futura, não bloqueia esta issue.
