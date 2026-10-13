# Remover retro-types.ts e exports locais (#110) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apagar o overlay `withRetroTypes`/`RetroDatabase` (redundante com `types.ts`) e tirar o `export` de 22 símbolos usados só no próprio arquivo, sem mudar comportamento.

**Architecture:** Refactor puro de tipagem e visibilidade. Nada muda em runtime: `withRetroTypes` era só um cast (`client as SupabaseClient<RetroDatabase>`), e tirar `export` não altera o código gerado. A verificação é `tsc` + `build`, porque o projeto não tem testes automatizados.

**Tech Stack:** TypeScript (strict), Vite, Supabase JS, TanStack Start.

## Global Constraints

- Repositório conectado ao Lovable: **não** fazer force push, rebase, amend ou squash de commits já publicados. **Não** fazer push: quem executa só commita, e o push/PR fica com a sessão principal.
- **Não** tocar em `.env` (é versionado de propósito).
- **Não** mexer em `src/integrations/supabase/types.ts` (é gerado).
- Commits no padrão do repo, em português, com `(#110)` no fim do assunto e terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Não há suíte de testes, então a etapa de TDD não se aplica. O gate de cada task é `npx tsc --noEmit` (exit 0) e, no fim, `npm run build`.
- Não reformate arquivos nem mexa em nada fora das linhas indicadas. Comentários que citam os símbolos (por exemplo, `src/lib/cycle-time/calc.ts:12-13`) ficam como estão.

---

### Task 0: Branch

- [ ] **Step 1:** A partir de `main` limpa, crie a branch:

```bash
git checkout main
git checkout -b refactor/retro-types-exports-110
```

- [ ] **Step 2:** Rode a verificação de base e confirme exit 0 (já confirmado no planejamento):

```bash
npx tsc --noEmit
```

---

### Task 1: Remover `withRetroTypes` e apagar `retro-types.ts`

**Files:**
- Modify: `src/hooks/use-retro-participants.ts:3,6` (e usos de `retroSupabase`)
- Modify: `src/hooks/use-roulette.ts:5,9` (e usos de `retroSupabase`)
- Modify: `src/integrations/ms-graph/photos.server.ts:8,66-83`
- Modify: `src/integrations/ms-graph/token.server.ts:8,26` (e usos de `retroAdmin`)
- Delete: `src/integrations/supabase/retro-types.ts`

- [ ] **Step 1: `use-retro-participants.ts`.** Remova a linha do import:

```ts
import { withRetroTypes } from "@/integrations/supabase/retro-types";
```

Remova a linha (e a linha em branco que sobrar depois dela, se ficarem duas seguidas):

```ts
const retroSupabase = withRetroTypes(supabase);
```

Depois troque todas as ocorrências de `retroSupabase` por `supabase` no arquivo (`grep -n retroSupabase src/hooks/use-retro-participants.ts` precisa voltar vazio).

- [ ] **Step 2: `use-roulette.ts`.** Faça o mesmo: remova o import de `withRetroTypes`, remova `const retroSupabase = withRetroTypes(supabase);` e troque todo `retroSupabase` por `supabase`.

- [ ] **Step 3: `token.server.ts`.** Remova o import de `withRetroTypes`. Troque:

```ts
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const retroAdmin = withRetroTypes(supabaseAdmin);
```

por:

```ts
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
```

Depois troque todo `retroAdmin` por `supabaseAdmin` no arquivo.

- [ ] **Step 4: `photos.server.ts`.** Remova o import de `withRetroTypes`. Troque a assinatura e os retornos de `getCacheWriter`, mantendo o comentário acima dela:

```ts
async function getCacheWriter(userClient: SupabaseClient<Database>): Promise<SupabaseClient<Database>> {
  // Checa o env antes de tocar no supabaseAdmin: o Proxy de
  // client.server.ts lança (e loga) a cada acesso quando a chave falta.
  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
    return userClient;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
```

O tipo de retorno explícito é intencional. Antes, o cast unificava os dois clients num tipo só; sem ele, a função poderia inferir uma união e o `writer.from(...)` deixaria de ser chamável.

Em `getCachedOrFetchPhoto`, remova a linha:

```ts
  const retroClient = withRetroTypes(client);
```

e troque `retroClient` por `client` (`.from("retro_participants")` passa a ser chamado em `client`).

- [ ] **Step 5:** Apague o arquivo:

```bash
git rm src/integrations/supabase/retro-types.ts
```

- [ ] **Step 6: Verificar.**

```bash
grep -rn "withRetroTypes\|RetroDatabase\|retro-types\|retroSupabase\|retroAdmin\|retroClient" src
npx tsc --noEmit
```

Esperado: o grep não encontra nada e o `tsc` sai com exit 0.

Se o `tsc` acusar erro em `getCacheWriter` (incompatibilidade entre `ReturnType<typeof createSupabaseAdminClient>` e `SupabaseClient<Database>`), **não** use `as any`. Pare e reporte o erro exato.

- [ ] **Step 7: Commit.**

```bash
git add -A src
git commit -m "refactor(retro): remover withRetroTypes, types.ts já cobre a retro (#110)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tirar `export` de símbolos usados só no próprio arquivo

Na fase de planejamento, um grep em `src`, `scripts` e `supabase` confirmou que nenhum destes símbolos é importado por outro arquivo. Não há testes, então nenhum deles é API usada por testes. Em cada caso, troque só a palavra `export ` no início da declaração (por exemplo, `export function x` vira `function x`, `export interface X` vira `interface X`, `export const X` vira `const X`). Se `export` aparecer junto de `async`, mantenha o `async`.

**Files / linhas (declarações):**

| Arquivo | Linha | Declaração atual |
|---|---|---|
| `src/integrations/jira/cycle-time.server.ts` | 176 | `export function buildCtPayload(` |
| `src/integrations/jira/issues.server.ts` | 15 | `export interface JiraIssueRaw {` |
| `src/integrations/jira/issues.server.ts` | 86 | `export function computeDoneAt(` |
| `src/integrations/jira/issues.server.ts` | 142 | `export function computeCommitmentAt(iss: JiraIssueRaw): string \| null {` |
| `src/integrations/jira/sprints.server.ts` | 7 | `export interface JiraSprintRaw {` |
| `src/integrations/ms-graph/photos.server.ts` | ~34 | `export async function fetchParticipantPhoto(email: string): Promise<string> {` |
| `src/integrations/ms-graph/token.server.ts` | ~18 | `export class MsGraphAuthError extends Error {}` |
| `src/lib/board.ts` | 166 | `export function formatDate(iso: string) {` |
| `src/lib/compromisso/burndown.ts` | 15 | `export interface BurndownKey {` |
| `src/lib/compromisso/burndown.ts` | 21 | `export interface BurndownPoint {` |
| `src/lib/compromisso/calc.ts` | 72 | `export const SPRINT_COMMITMENT_OVERRIDES: Record<number, string[]> = {` |
| `src/lib/compromisso/calc.ts` | 108 | `export function sprintVersionOf(name: string \| null \| undefined): number[] \| null {` |
| `src/lib/compromisso/calc.ts` | 114 | `export function compareVersions(a: number[], b: number[]): number {` |
| `src/lib/compromisso/calc.ts` | 198 | `export interface SPSummaryRow {` |
| `src/lib/cycle-time/calc.ts` | 107 | `export function fmtDays(d: number \| undefined): string {` |
| `src/lib/cycle-time/calc.ts` | 117 | `export function fmtDays2(d: number \| undefined): string {` |
| `src/lib/cycle-time/calc.ts` | 185 | `export function buildStatusOrder(` |
| `src/lib/error-capture.ts` | 18 | `export function describeError(error: unknown): string {` |
| `src/lib/retrospectivas/participants.ts` | 10 | `export const AVATAR_COLORS: readonly string[] = [` |
| `src/lib/retrospectivas/participants.ts` | 40 | `export function paletteColor(index: number): string {` |
| `src/lib/tickets.ts` | 18 | `export function isJiraUrl(url: string): boolean {` |
| `src/lib/tickets.ts` | 95 | `export function parseTicketToken(token: string): AllocationTicket {` |

As linhas de `photos.server.ts` e `token.server.ts` podem ter mudado com a Task 1. Localize essas declarações pelo texto.

Atenção: `src/components/admin/UserTable.tsx` tem um `formatDate` **local e diferente**. Não mexa nele.

- [ ] **Step 1:** Antes de editar, confirme mais uma vez que nenhum desses nomes é importado em outro lugar:

```bash
grep -rnE "import[^;]*\b(buildCtPayload|JiraIssueRaw|computeDoneAt|computeCommitmentAt|JiraSprintRaw|fetchParticipantPhoto|MsGraphAuthError|formatDate|BurndownKey|BurndownPoint|SPRINT_COMMITMENT_OVERRIDES|sprintVersionOf|compareVersions|SPSummaryRow|fmtDays|fmtDays2|buildStatusOrder|describeError|AVATAR_COLORS|paletteColor|isJiraUrl|parseTicketToken)\b" src scripts
```

Esperado: nenhuma linha. Se aparecer alguma (import multilinha também conta, confira com `grep -rn "<nome>" src scripts`), **não** tire o export daquele símbolo e anote no relatório.

- [ ] **Step 2:** Faça as 22 edições da tabela.

- [ ] **Step 3: Verificar.**

```bash
grep -rnE "^export (async )?(function|const|interface|class|type) (buildCtPayload|JiraIssueRaw|computeDoneAt|computeCommitmentAt|JiraSprintRaw|fetchParticipantPhoto|MsGraphAuthError|formatDate|BurndownKey|BurndownPoint|SPRINT_COMMITMENT_OVERRIDES|sprintVersionOf|compareVersions|SPSummaryRow|fmtDays|fmtDays2|buildStatusOrder|describeError|AVATAR_COLORS|paletteColor|isJiraUrl|parseTicketToken)\b" src
npx tsc --noEmit
git diff --stat
```

Esperado: o grep não encontra nada, o `tsc` sai com exit 0 e o diff mostra exatamente 12 arquivos com 22 linhas trocadas (`22 insertions(+), 22 deletions(-)`).

- [ ] **Step 4: Commit.**

```bash
git add -A src
git commit -m "refactor: tirar export de símbolos usados só no próprio arquivo (#110)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Verificação final

- [ ] **Step 1:**

```bash
grep -rn "withRetroTypes\|RetroDatabase" src
npx tsc --noEmit
npm run build
npm run lint
git status
git log --oneline main..HEAD
```

Esperado:
- O grep não encontra nada.
- `tsc` e `build` saem com exit 0.
- O `lint` não ganha erros novos. Se houver erros pré-existentes, compare com `git stash; npm run lint; git stash pop`, ou simplesmente reporte o número.
- O working tree está limpo e há 2 commits na branch.

- [ ] **Step 2:** **Não** faça push. Reporte: os hashes dos commits, a saída final do `tsc`/`build`, a contagem do lint e qualquer símbolo que tenha ficado exportado, com o motivo.

O critério "roleta da retro funciona no app publicado" só pode ser validado depois do merge e da publicação no Lovable. Fica com o Diego.
