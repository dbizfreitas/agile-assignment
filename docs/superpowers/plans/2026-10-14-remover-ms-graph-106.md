# Remover a integração com o Microsoft Graph (#106) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar a decisão A da #106: o Microsoft Graph foi abandonado. Sai todo o código, script, dependência, tipo, documentação e tabela da busca automática de fotos. As fotos da roleta continuam vindo de `retro_participants.photo_data_url`, gravado à mão (Outlook Web → SQL Editor).

**Architecture:** A pasta `src/integrations/ms-graph/` deixa de existir. O único ponto vivo dela, a server function `getParticipantPhoto`, vai para `src/integrations/retro/server-fns.ts` e passa a só **ler** `photo_data_url` com o client do próprio usuário (RLS já libera `SELECT` para quem tem a rota `retrospectivas`). Sem TTL, sem escrita, sem service role. O contrato com o client não muda: `string | null`, e `""` continua sendo o marcador de "sem foto" gravado à mão. A tabela `ms_graph_token` sai por uma migration nova, aplicada pelo SQL Editor **depois** do deploy do front. A coluna `photo_fetched_at` fica: o processo manual a preenche e ela desempata a ordenação.

**Tech Stack:** TanStack Start (createServerFn), Supabase JS, Vite, npm + bun.lock.

## Global Constraints

- Repositório conectado ao Lovable: **não** fazer force push, rebase, amend ou squash. **Não** fazer push: quem executa só commita; push e PR ficam com a sessão principal.
- Branch: `chore/remover-ms-graph-106`, já criada a partir de `main` atualizada. Trabalhe nela.
- **Não** tocar em `.env`, `.env.local`, `.env.production`, nem em migrations antigas de `supabase/migrations/`. Não aplicar nada no banco: a migration nova só é escrita.
- **Não** mudar `private.can_view_retrospectivas` nem `private.can_edit_retrospectivas`, criadas na mesma migration antiga do Graph: são helpers de autorização e continuam em uso.
- `npm run lint` já falha na linha de base por CRLF (`prettier/prettier: Delete '␍'`). Não é deste plano. Nos `.ts` tocados, rode `npx prettier --write <arquivo>` antes de commitar.
- Não há suíte de testes. Os gates são `grep`, `npx tsc --noEmit` e `npm run build`.
- Commits no padrão do repo, em português, com `(#106)` no fim do assunto, terminando com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: Server function só de leitura

**Files:**
- Create: `src/integrations/retro/server-fns.ts`
- Modify: `src/hooks/use-retro-photos.ts`
- Delete: `src/integrations/ms-graph/` inteira (`config.server.ts`, `photos.server.ts`, `server-fns.ts`, `token.server.ts`)

- [ ] **Step 1:** Crie `src/integrations/retro/server-fns.ts` com exatamente:

```ts
// src/integrations/retro/server-fns.ts
// Stub de RPC client-safe, mesma convenção de src/integrations/jira/server-fns.ts.
//
// A foto de cada participante é gravada à mão em
// retro_participants.photo_data_url (Outlook Web → SQL Editor). A busca
// automática pelo Microsoft Graph foi removida na #106: o login entre
// tenants é bloqueado (AADSTS500213) e o token nunca chegou a existir.
// "" é o marcador de "sabidamente sem foto"; null, de "ainda não gravada".
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getParticipantPhoto = createServerFn({ method: "GET" })
  .validator((email: string) => email)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data: email }): Promise<string | null> => {
    const { assertRouteAccess } = await import("@/integrations/jira/access.server");
    await assertRouteAccess(context.supabase, context.userId, "retrospectivas");

    // A mesma pessoa pode estar na retro de mais de um projeto (uma linha
    // por projeto): a foto é da pessoa, então vale a gravação mais recente.
    const { data, error } = await context.supabase
      .from("retro_participants")
      .select("photo_data_url")
      .eq("email", email)
      .not("photo_data_url", "is", null)
      .order("photo_fetched_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.photo_data_url ?? null;
  });
```

- [ ] **Step 2:** Em `src/hooks/use-retro-photos.ts`:
  - Troque o import para `import { getParticipantPhoto } from "@/integrations/retro/server-fns";`.
  - No comentário acima de `useRetroPhotos`, troque `staleTime alto complementar ao cache em coluna do banco — Task 4` por `staleTime alto: a foto só muda quando alguém grava outra à mão` e `(pessoa sem foto no Graph)` por `(pessoa sem foto gravada)`.
  - Troque o comentário dentro do `forEach` por:

```ts
    // "" é o marcador de "sabidamente sem foto" gravado à mão (ver
    // src/integrations/retro/server-fns.ts): trata igual a null/undefined,
    // já que pra UI as duas coisas significam "mostra as iniciais".
```

- [ ] **Step 3:** Apague a pasta antiga:

```bash
git rm -r src/integrations/ms-graph
```

- [ ] **Step 4:** Gate:

```bash
npx tsc --noEmit
```

Expected: sem erros. (`types.ts` ainda tem `ms_graph_token`; isso sai na Task 2.)

- [ ] **Step 5:** Commit:

```bash
npx prettier --write src/integrations/retro/server-fns.ts src/hooks/use-retro-photos.ts
git add src/integrations/retro/server-fns.ts src/hooks/use-retro-photos.ts
git commit -m "refactor(retro): ler foto só do banco e remover a cadeia do Graph (#106)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Script, dependência `tsx` e tipos

**Files:**
- Delete: `scripts/ms-graph-auth.ts` (a pasta `scripts/` fica vazia e some)
- Modify: `package.json`, `package-lock.json`, `bun.lock`, `src/integrations/supabase/types.ts`

- [ ] **Step 1:** `git rm scripts/ms-graph-auth.ts`.

- [ ] **Step 2:** No `package.json`, remova a linha `"ms-graph:auth": "tsx scripts/ms-graph-auth.ts"` (cuide da vírgula da linha anterior). Depois:

```bash
npm uninstall tsx
```

Isso tira `tsx` de `devDependencies` e atualiza o `package-lock.json`. Confira com `git diff --stat package-lock.json` que só sumiram entradas do `tsx` e das dependências exclusivas dele (ex.: `get-tsconfig`, `resolve-pkg-maps`). Se aparecerem mudanças de versão em outros pacotes, **pare e reporte**.

- [ ] **Step 3:** `bun` não está instalado na máquina. Edite o `bun.lock` à mão, removendo só estas duas linhas:
  - a de `devDependencies` do workspace: `"tsx": "^4.23.13",`
  - a do pacote: a linha que começa com `    "tsx": ["tsx@4.23.13",`

  **Não** mexa na menção a `tsx` dentro de `optionalPeers`/`peerDependencies` do `vite`. Se `get-tsconfig` ou `resolve-pkg-maps` tiverem linha própria no `bun.lock` e nenhum outro pacote os listar em `dependencies` (confira com `grep -n "get-tsconfig\|resolve-pkg-maps" bun.lock`), remova também. `esbuild` fica: o `vite` usa.

- [ ] **Step 4:** Em `src/integrations/supabase/types.ts`, remova o bloco `ms_graph_token: { Row … Insert … Update … Relationships: [] }` inteiro (hoje perto das linhas 184-210), sem tocar nos blocos vizinhos.

- [ ] **Step 5:** Gates:

```bash
npx tsc --noEmit
npm run build
```

Expected: ambos passam.

- [ ] **Step 6:** Commit:

```bash
git add -A scripts package.json package-lock.json bun.lock src/integrations/supabase/types.ts
git commit -m "chore(retro): remover script ms-graph:auth, tsx e tipos de ms_graph_token (#106)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration e smoke test

**Files:**
- Create: `supabase/migrations/20261014180000_drop_ms_graph_token.sql`
- Modify: `supabase/tests/retro_participants_smoke.sql`

- [ ] **Step 1:** Crie a migration com exatamente:

```sql
-- supabase/migrations/20261014180000_drop_ms_graph_token.sql
-- #106: a busca de fotos pelo Microsoft Graph foi abandonada. O login por
-- device code é bloqueado entre tenants (AADSTS500213) e a tabela nunca
-- recebeu refresh token (produção, 08/10/2026: 1 linha, sem token).
--
-- Aplicar pelo SQL Editor DEPOIS do deploy do front que deixou de ler a
-- tabela. As funções private.can_view_retrospectivas e
-- private.can_edit_retrospectivas, criadas na mesma migration da tabela
-- (20260902181000_retro_ms_graph_token.sql), continuam em uso e ficam.
DROP TABLE IF EXISTS public.ms_graph_token;
```

- [ ] **Step 2:** Em `supabase/tests/retro_participants_smoke.sql`, Seção 2:
  - No cabeçalho, troque `-- Seção 2 — helpers can_view_retrospectivas / can_edit_retrospectivas e` + `-- isolamento de ms_graph_token (mesmo padrão de` + `-- alocacoes_auth_helpers_smoke.sql)` por `-- Seção 2 — helpers can_view_retrospectivas / can_edit_retrospectivas` + `-- (mesmo padrão de alocacoes_auth_helpers_smoke.sql)`.
  - Remova o bloco que começa em `-- ms_graph_token: RLS ligado, zero policies` e termina no `END IF;` do `FALHA 2.1` (inclui `SET LOCAL ROLE`, `set_config`, `SELECT count(*) … ms_graph_token`, `RESET ROLE`).
  - Remova `v_count int;` do `DECLARE` da Seção 2 **só se** não sobrar outro uso de `v_count` nela.

- [ ] **Step 3:** Confira: `grep -n "ms_graph" supabase/tests/retro_participants_smoke.sql` não acha nada.

- [ ] **Step 4:** Commit:

```bash
git add supabase/migrations/20261014180000_drop_ms_graph_token.sql supabase/tests/retro_participants_smoke.sql
git commit -m "feat(db): migration que remove a tabela ms_graph_token (#106)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: README e inventário

**Files:**
- Modify: `README.md`, `docs/saneamento/2026-10-08-inventario.md`

- [ ] **Step 1:** No `README.md`:
  - Na frase "**Nunca coloque em `.env`:** …", remova `` `MS_TENANT_ID`, `MS_CLIENT_ID`, ``.
  - Na tabela de segredos de runtime, remova a linha `| \`MS_TENANT_ID\` + \`MS_CLIENT_ID\` | Fotos da roleta …`.
  - Substitua o parágrafo "**Retrospectivas (participantes/sorteio no banco, issue #24):** …" e a lista numerada 1-3 que o segue (até "…cai no fallback de iniciais).") por:

```markdown
**Retrospectivas (participantes/sorteio no banco, issue #24):** aplicar
`supabase/migrations/20260902180000_retro_participants_foundation.sql`,
`20260902181000_retro_ms_graph_token.sql` e `20260902182000_retro_roulette_rpcs.sql`
(nessa ordem), depois rodar `supabase/tests/retro_participants_smoke.sql`.
A tabela criada pela segunda é removida mais tarde por
`20261014180000_drop_ms_graph_token.sql` (#106); aplique essa depois do
deploy do front.

**Fotos da roleta:** são gravadas à mão em
`retro_participants.photo_data_url`, como data-URI JPEG 120×120. A foto de
cada pessoa sai do Outlook Web (outlook.office.com/people), e o `UPDATE` roda
no SQL Editor:

    UPDATE public.retro_participants
    SET photo_data_url = 'data:image/jpeg;base64,...', photo_fetched_at = now()
    WHERE email = 'pessoa@way2.com.br';

Quem não tem foto no diretório recebe `''`, o marcador de "sem foto".
Enquanto ninguém grava, a pessoa aparece com as iniciais. A busca automática
pelo Microsoft Graph foi removida na #106: o login entre tenants é
bloqueado (AADSTS500213).
```

  Mantenha o resto do README como está e confira a formatação Markdown ao redor.

- [ ] **Step 2:** Em `docs/saneamento/2026-10-08-inventario.md`, registre a decisão como foi feito para a #107 em `c5e509b`:
  - Tabela "Resumo", linha "Integração MS Graph": a coluna "Ação sugerida" vira `Removida (decisão de 14/10/2026, #106)`.
  - Tabela detalhada, linhas "Cadeia do MS Graph…", "`scripts/ms-graph-auth.ts`…" e "Tabela `public.ms_graph_token`": a última coluna vira `Removida (#106)`; na da tabela, `Removida (#106); DROP por migration aplicada após o deploy`.
  - Lista final de próximos passos, item 2: `MS Graph: abandonado e removido (#106). A migration de DROP é aplicada pelo SQL Editor depois do deploy.`
  - Depois rode `npx prettier --write docs/saneamento/2026-10-08-inventario.md` para realinhar as tabelas.

- [ ] **Step 3:** Commit:

```bash
git add README.md docs/saneamento/2026-10-08-inventario.md
git commit -m "docs: trocar passos do Graph pelo processo manual de fotos (#106)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verificação final

- [ ] **Step 1:** Critério de aceite da issue:

```bash
grep -rn "ms_graph_token\|getAccessToken\|ms-graph:auth" src scripts package.json README.md
```

Expected: a única ocorrência permitida é o nome de arquivo `20260902181000_retro_ms_graph_token.sql` e `20261014180000_drop_ms_graph_token.sql` citados no README (são nomes de migrations reais). Nada em `src`, `package.json` ou `scripts`.

- [ ] **Step 2:** `grep -rn "ms-graph\|MS_TENANT_ID\|MS_CLIENT_ID\|MS_GRAPH" src package.json README.md` não acha nada.

- [ ] **Step 3:** `npx tsc --noEmit` e `npm run build` passam.

- [ ] **Step 4:** `git status` limpo e `git log --oneline main..HEAD` mostra os commits das Tasks 1-4.

Fica para depois do merge, fora deste plano: conferir as fotos de PIM e PDC no app publicado, aplicar a migration pelo SQL Editor e checar `SELECT to_regclass('public.ms_graph_token');` → `NULL`. Opcional: remover `MS_TENANT_ID`/`MS_CLIENT_ID` do painel do Lovable e do `.env.local`.
