# Cycle Time — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar a última feature do `jira-live` que ainda não tem equivalente aqui — quanto tempo cada demanda passou em cada status do fluxo, calculado a partir do changelog do Jira — numa rota `/cycle-time` sujeita ao mesmo RBAC do board, para que o serviço Windows da porta 8000 possa ser desligado.

**Architecture:** Um módulo server-only (`cycle-time.server.ts`) busca as issues abertas do projeto com `expand=changelog`, reduz o changelog a uma matriz *issue × status* e devolve só o contrato (`CycleTimeResponse`) — o dado cru nunca cruza a fronteira do RPC. A server function `getJiraCycleTime` faz auth + checagem de papel + tradução de `JiraError`. No cliente, duas queries do TanStack Query (uma por sub-visão) alimentam uma camada pura (`src/lib/cycle-time/calc.ts`) que decide colunas, ordenação e formatação, e uma tabela genérica renderiza a matriz. Cache em memória com TTL de 5 min mais coalescência de requisições concorrentes no servidor; nenhuma tabela nova no Supabase.

**Tech Stack:** TanStack Start + React 19, TanStack Router (route tree gerado), TanStack Query v5, shadcn/ui (Table, Tabs, Card, Select, Button), Tailwind v4, TypeScript 5.8 em modo `strict` com `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` e `noPropertyAccessFromIndexSignature`.

**Spec:** [`docs/superpowers/specs/2026-08-09-cycle-time-design.md`](../specs/2026-08-09-cycle-time-design.md)

## Global Constraints

- **Idioma da UI:** pt-BR em todo texto visível, com acentuação correta.
- **Port, não redesenho.** Divergência do original só quando há motivo escrito neste plano ou na spec. Toda correção já ganha em produção no `jira-live` (ordenação por instante, acúmulo em segundos, `ORDER BY created ASC`, "só a ausência de `nextPageToken` encerra o laço") vai junto.
- **Fora de escopo, decidido:** modo `extended` (código morto no original), exportar HTML, histórico/tendência de cycle time, auto-refresh periódico, search params na URL.
- **Autorização:** a página exige `canView` (não `canEdit`). O que protege de verdade é `assertCanViewBoard` dentro do handler; o `if (!canView)` na rota é conveniência visual.
- **Sem banco.** Nenhuma migration, nenhuma tabela, nenhuma RLS nova. O Supabase entra só via `assertCanViewBoard`.
- **Não introduzir test runner.** `package.json` não tem vitest/jest e esta demanda não adiciona um — mesma postura da spec de RBAC. As verificações são `npx tsc --noEmit`, `npm run lint`, scripts descartáveis rodados com o `jiti` que já está em `node_modules`, e o roteiro manual.
- **Não editar `src/routeTree.gen.ts` à mão.** É gerado pelo plugin do TanStack Router; regenera ao rodar `npm run build` ou `npm run dev`.
- **Não fazer `git push`.** O repositório sincroniza com o Lovable; publicar é decisão do usuário ao final.
- **Nunca reescrever histórico** (sem `rebase`, `amend` ou `squash` de commits publicados) — restrição do `AGENTS.md`.
- **Formatação:** `npm run lint` roda `prettier` como erro (`printWidth: 100`, aspas duplas, `trailingComma: all`). A formatação dos blocos de código deste plano é indicativa; se o lint acusar `prettier/prettier`, rodar `npx prettier --write <arquivo>` e seguir — o formatador é a autoridade, não este documento.

### Como rodar um script TypeScript avulso neste repositório

Não há `tsx`/`ts-node`, e o `node` puro não resolve os imports relativos sem extensão que o `src/` usa. O `jiti` já está instalado como dependência transitiva e resolve tudo (inclusive `import type` de `@/...`, que é apagado na transpilação). O comando, sempre a partir da raiz do repositório:

```bash
node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs ./nome-do-script.ts
```

`--env-file=.env` carrega `JIRA_EMAIL` / `JIRA_API_TOKEN` / `JIRA_BASE_URL` do `.env` da raiz. Verificado funcionando neste repositório.

Os scripts criados assim são **descartáveis e ficam na raiz** — cada task que cria um manda apagá-lo antes do commit. Nenhum deles entra em nenhum commit.

### Referência de paridade

O `jira-live` está de pé na porta 8000 e responde (`GET http://localhost:8000/api/cycle-time?project=PIM&mode=standard` → `{"statuses":[...],"issues":[...]}`, 200). Ele é o critério objetivo de "o port está certo" e some assim que o serviço for desligado — por isso a Task 6 vem **antes** de qualquer linha de React.

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/cycle-time/types.ts` | Contrato público (`CycleTimeMode`, `CycleTimeIssue`, `CycleTimeResponse`) |
| `src/integrations/jira/cycle-time.server.ts` | Conjuntos de exclusão, busca paginada, `buildCtPayload`, `fetchCycleTime` |
| `src/lib/cycle-time/calc.ts` | Camada pura: merge de variantes, ordem de colunas, ordenação, formatação, faixas |
| `src/components/cycle-time/CycleTimeTable.tsx` | Matriz issue × status, ordenável, paginação opcional |
| `src/components/cycle-time/CycleTimeView.tsx` | Header, seletor de projeto, sub-abas, queries, "Recalcular" |
| `src/routes/cycle-time.tsx` | Rota `/cycle-time` com guarda de sessão + `canView` |

**Modificar:**

| Arquivo | Mudança |
| --- | --- |
| `src/integrations/jira/cache.server.ts` | `+ withCacheCoalescing` (aditivo; não toca `getCache`/`setCache`) |
| `src/integrations/jira/server-fns.ts` | `+ getJiraCycleTime` com mapeamento de `JiraError` |
| `src/components/BoardGrid.tsx` | `+ <Link to="/cycle-time">` no header |
| `src/components/compromisso/CompromissoView.tsx` | `+ <Link to="/cycle-time">` no header |
| `src/routeTree.gen.ts` | Regenerado pelo plugin (não editar à mão) |

**Intocados de propósito:** `client.server.ts`, `concurrency-gate.server.ts`, `config.server.ts`, `issues.server.ts`, `projects.server.ts`, `sprints.server.ts`, e as quatro server functions já existentes (o mapeamento de `JiraError` que falta nelas é defeito preexistente — fica registrado, não é corrigido aqui).

---

## Task 1: Contrato do Cycle Time

**Files:**
- Create: `src/lib/cycle-time/types.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `type CycleTimeMode = "standard" | "full"`; `interface CycleTimeIssue { key: string; url: string; summary: string; type: string; assignee: string; current_status: string; fix_versions: string; status_days: Record<string, number>; total_days: number }`; `interface CycleTimeResponse { statuses: string[]; issues: CycleTimeIssue[] }`.

- [ ] **Step 1: Criar `src/lib/cycle-time/types.ts`**

```ts
/**
 * Contrato público do Cycle Time — compartilhado entre a server function e os
 * componentes React. Mesma disciplina de src/lib/compromisso/types.ts: nenhum
 * tipo interno do Jira (changelog, campos crus) aparece aqui. O dado bruto é
 * reduzido no servidor, em cycle-time.server.ts.
 *
 * Idêntico ao shared/types.ts do jira-live — o front portado consome sem
 * tradução, e a comparação de paridade contra a porta 8000 é campo a campo.
 */

/**
 * As duas sub-visões portadas do original: "Em Andamento" (`standard`, corte
 * de 200 itens no servidor) e "Histórico Completo" (`full`, sem corte).
 * O modo `extended` do original não tem chamador em lugar nenhum e não vem.
 */
export type CycleTimeMode = "standard" | "full";

export interface CycleTimeIssue {
  key: string;
  url: string;
  summary: string;
  type: string;
  assignee: string;
  current_status: string;
  fix_versions: string;
  /** Dias por status, arredondados a 1 casa decimal. */
  status_days: Record<string, number>;
  /** Soma de `status_days`, arredondada a 1 casa decimal. */
  total_days: number;
}

export interface CycleTimeResponse {
  /** Ordem de colunas vinda dos status do projeto; `[]` se a consulta falhar. */
  statuses: string[];
  /** Já ordenadas por `total_days` desc. */
  issues: CycleTimeIssue[];
}
```

- [ ] **Step 2: Verificar tipos e formatação**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sem erros. (`tsconfig.json` inclui `src/**/*.ts`, então o arquivo é checado mesmo sem nenhum importador ainda.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/cycle-time/types.ts
git commit -m "feat(cycle-time): add public contract types"
```

---

## Task 2: `withCacheCoalescing` em `cache.server.ts`

**Files:**
- Modify: `src/integrations/jira/cache.server.ts:38` (acrescentar ao fim; não alterar `getCache`/`setCache`)

**Interfaces:**
- Consumes: nada.
- Produces: `export async function withCacheCoalescing<T>(key: string, compute: () => Promise<T>): Promise<T>`.

- [ ] **Step 1: Acrescentar a função ao fim de `src/integrations/jira/cache.server.ts`**

O arquivo hoje termina na linha 38, no fechamento de `setCache`. Colar exatamente isto **depois** dessa linha, sem tocar em mais nada:

```ts

const pending = new Map<string, Promise<unknown>>();

// Deduplica requisições CONCORRENTES pra mesma chave (cache stampede): sem
// isso, duas abas de /cycle-time abertas no mesmo projeto — ou um "Recalcular"
// coincidindo com outra sessão — cada uma dispara seu próprio fan-out pro Jira
// em vez de esperar o resultado que já está a caminho. withConcurrencyGate
// limita o dano a quatro simultâneos; não evita o desperdício.
//
// A dedupe do TanStack Query não resolve isto: ela vale por instância de
// QueryClient, isto é, por aba. A coalescência aqui é do lado do servidor,
// entre sessões.
//
// A 2ª chamada em diante só entra na fila enquanto a 1ª está em voo (sucesso
// ou erro liberam a chave) — nunca fica presa a um resultado antigo.
export async function withCacheCoalescing<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const inFlight = pending.get(key) as Promise<T> | undefined;
  if (inFlight) return inFlight;
  const promise = compute().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
```

- [ ] **Step 2: Confirmar que `getCache`/`setCache` não mudaram**

```bash
git diff --stat src/integrations/jira/cache.server.ts
git diff src/integrations/jira/cache.server.ts | grep "^-" | grep -v "^---"
```

Esperado: o segundo comando não imprime nada — a mudança é puramente aditiva (nenhuma linha removida).

- [ ] **Step 3: Verificar tipos e formatação**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/jira/cache.server.ts
git commit -m "feat(jira): add withCacheCoalescing to dedupe concurrent fan-outs"
```

---

## Task 3: `cycle-time.server.ts` — exclusões, tipos crus e busca paginada

**Files:**
- Create: `src/integrations/jira/cycle-time.server.ts`

**Interfaces:**
- Consumes: `jiraGet<T>(path: string, params?: Record<string, string>): Promise<T>` (`client.server.ts`); `ALLOWED_PROJECTS: Set<string>` e `JIRA_BASE: string` (`config.server.ts`).
- Produces (internos ao módulo, usados pela Task 4): `interface CycleTimeIssueRaw`; `const EXCLUDE_FULL: Set<string>`; `const EXCLUDE_STANDARD: Set<string>`; `const JQL_EXCLUDE_FULL: string`; `const JQL_EXCLUDE_STANDARD: string`; `async function fetchCycleTimeIssues(project: string, jqlExclude: string, fullLoad: boolean): Promise<CycleTimeIssueRaw[]>`; `async function fetchProjectStatuses(project: string, excludeStatuses: Set<string>): Promise<string[]>`.

- [ ] **Step 1: Criar o arquivo com cabeçalho, imports e conjuntos de exclusão**

Criar `src/integrations/jira/cycle-time.server.ts` com:

```ts
// Server-only. Port de jira-live/server/routes/cycle-time.ts, menos o
// roteamento Hono. Mesma convenção de config.server.ts: só é seguro importar
// estaticamente a partir de outro "*.server.ts" — a partir de um arquivo
// isomórfico (rota, componente), só via import dinâmico dentro do handler.
import { jiraGet } from "./client.server";
import { getCache, setCache, withCacheCoalescing } from "./cache.server";
import { withConcurrencyGate } from "./concurrency-gate.server";
import { ALLOWED_PROJECTS, JIRA_BASE } from "./config.server";
import type { CycleTimeIssue, CycleTimeMode, CycleTimeResponse } from "@/lib/cycle-time/types";

// ── Bases compartilhadas para os Sets de exclusão ────────────────────────────
// Acrescentar um status terminal: editar apenas DONE_REJECTED.
// Acrescentar um status pré-workflow: editar apenas PRE_WORKFLOW.

const DONE_REJECTED = [
  "concluído",
  "concluido",
  "done",
  "rejeitada",
  "rejeitado",
  "rejected",
  "cancelada",
  "cancelado",
];

const PRE_WORKFLOW = [
  "to do",
  "todo",
  "backlog",
  "ready to specify",
  "to research",
  "to discover",
  "in discover",
];

// Modo full: só terminais + cancelled (permissivo — exibe todo o fluxo).
const EXCLUDE_FULL = new Set([...DONE_REJECTED, "cancelled"]);

// Modo standard: terminais + pré-workflow + os intermediários que a esteira de
// produção não considera "em andamento".
const EXCLUDE_STANDARD = new Set([
  ...DONE_REJECTED,
  ...PRE_WORKFLOW,
  "tarefas pendentes",
  "tarefas_pendentes",
  "ready to dev",
  "em análise",
  "em analise",
]);

// Os literais de JQL NÃO são derivados dos Sets acima: o JQL precisa dos nomes
// com acento e capitalização originais, o Set precisa de minúsculas
// normalizadas. Derivar um do outro exigiria uma tabela de tradução que é
// justamente o que estes dois literais já são.
const JQL_EXCLUDE_STANDARD =
  '"Concluído","Concluido","Done","Rejeitada","Rejeitado","Rejected",' +
  '"Cancelada","Cancelado","Cancelled","Tarefas Pendentes","Tarefas_Pendentes",' +
  '"To Do","Todo","Backlog","Ready to Dev","Em Análise","Em Analise",' +
  '"Ready to Specify","To Research","To Discover","In Discover"';

const JQL_EXCLUDE_FULL =
  '"Concluído","Concluido","Done","Rejeitada","Rejeitado","Rejected",' +
  '"Cancelada","Cancelado","Cancelled"';
```

> Aspas simples nos literais de JQL são intencionais: as strings contêm `"`, e o prettier escolhe a aspa que evita escapes. Não trocar por aspas duplas.

- [ ] **Step 2: Acrescentar os tipos crus do Jira**

Colar ao fim do arquivo:

```ts

// Tipos crus, locais a este módulo — não vão para src/lib. Só os campos que
// `fields=` pede, todos opcionais: o guard por issue em buildCtPayload existe
// justamente porque o Jira às vezes omite algum deles.
interface CycleTimeIssueRaw {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    issuetype?: { name?: string };
    assignee?: { displayName?: string } | null;
    created?: string;
    fixVersions?: Array<{ name?: string }>;
  };
  changelog?: {
    histories: Array<{
      created: string;
      items: Array<{ field: string; fromString?: string; toString?: string }>;
    }>;
  };
}

interface JiraSearchPage {
  issues: CycleTimeIssueRaw[];
  nextPageToken?: string;
}

interface JiraProjectStatusesEntry {
  statuses?: Array<{ name?: string }>;
}
```

- [ ] **Step 3: Acrescentar a busca paginada de issues**

Colar ao fim do arquivo:

```ts

// Guarda contra loop infinito — mesma razão de MAX_PAGES em projects.server.ts
// e sprints.server.ts. O laço do original é `while (true)`; aqui ganha teto
// porque o modo full é o único caminho sem o corte de 200 itens.
const MAX_PAGES = 200;

async function fetchCycleTimeIssues(
  project: string,
  jqlExclude: string,
  fullLoad: boolean,
): Promise<CycleTimeIssueRaw[]> {
  // ORDER BY created ASC (não updated DESC): fora do modo full, o corte de 200
  // itens abaixo precisa sobrar justamente pros itens mais ANTIGOS ainda
  // abertos — que são os "mais parados" que esta tela existe pra destacar.
  // Ordenar por updated DESC faria o corte descartar exatamente esses.
  const jql = `project = "${project}" AND status NOT IN (${jqlExclude}) ORDER BY created ASC`;
  const out: CycleTimeIssueRaw[] = [];
  let nextToken: string | undefined;

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const params: Record<string, string> = {
      jql,
      fields: "summary,status,issuetype,assignee,created,fixVersions",
      expand: "changelog",
      maxResults: "100",
    };
    if (nextToken) params["nextPageToken"] = nextToken;

    const page = await jiraGet<JiraSearchPage>("/rest/api/3/search/jql", params);
    out.push(...page.issues);
    nextToken = page.nextPageToken;

    // Só a AUSÊNCIA de nextPageToken encerra o laço de verdade — uma página
    // menor que maxResults ainda pode vir seguida de mais páginas sob carga
    // (mesma causa documentada em issues.server.ts/computePageStarts).
    if (!nextToken) break;
    if (!fullLoad && out.length >= 200) break;
    if (pageNum === MAX_PAGES - 1) {
      console.error(
        `[jira/cycle-time] fetchCycleTimeIssues("${project}") atingiu o limite de ${MAX_PAGES} páginas — resultado pode estar incompleto.`,
      );
    }
  }
  return out;
}
```

> `params["nextPageToken"]` com colchetes, não `params.nextPageToken`: `noPropertyAccessFromIndexSignature` está ligado no `tsconfig.json`.

- [ ] **Step 4: Acrescentar a listagem de status do projeto**

Colar ao fim do arquivo:

```ts

// Alimenta a ordem das colunas. `project` já passou pela validação contra
// ALLOWED_PROJECTS em fetchCycleTime antes de chegar aqui — é o que torna
// seguro interpolá-lo no caminho (jiraGet ainda barra ".." e caminhos fora
// de /rest/).
async function fetchProjectStatuses(
  project: string,
  excludeStatuses: Set<string>,
): Promise<string[]> {
  try {
    const data = await jiraGet<JiraProjectStatusesEntry[]>(
      `/rest/api/3/project/${project}/statuses`,
    );
    const seen = new Set<string>();
    const result: string[] = [];
    for (const itype of data) {
      for (const st of itype.statuses ?? []) {
        const name = (st.name ?? "").trim();
        if (name && !excludeStatuses.has(name.toLowerCase()) && !seen.has(name)) {
          seen.add(name);
          result.push(name);
        }
      }
    }
    return result;
  } catch (err) {
    // Falha aqui não derruba a resposta: sem a lista de status do projeto, a
    // ordem das colunas degrada para "ordem de aparição nas issues", que é o
    // fallback que buildStatusOrder já faz. Silenciosa para o cliente; o log
    // fica no servidor (o original engolia sem registrar nada).
    console.error(`[jira/cycle-time] Falha ao listar status de "${project}":`, err);
    return [];
  }
}
```

- [ ] **Step 5: Verificar tipos e formatação**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sem erros. `CycleTimeIssue`, `CycleTimeMode`, `CycleTimeResponse`, `getCache`, `setCache`, `withCacheCoalescing`, `withConcurrencyGate`, `ALLOWED_PROJECTS` e `JIRA_BASE` ainda não são usados neste ponto — o `tsconfig.json` tem `noUnusedLocals: false`, então isso não é erro. Eles entram na Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/jira/cycle-time.server.ts
git commit -m "feat(cycle-time): add exclusion sets and paginated Jira fetch"
```

---

## Task 4: `buildCtPayload` e `fetchCycleTime`

**Files:**
- Modify: `src/integrations/jira/cycle-time.server.ts` (acrescentar ao fim)

**Interfaces:**
- Consumes: `CycleTimeIssueRaw`, `EXCLUDE_FULL`, `EXCLUDE_STANDARD`, `JQL_EXCLUDE_FULL`, `JQL_EXCLUDE_STANDARD`, `fetchCycleTimeIssues`, `fetchProjectStatuses` (Task 3); `getCache`/`setCache`/`withCacheCoalescing` (Task 2); `CycleTimeResponse`/`CycleTimeMode`/`CycleTimeIssue` (Task 1).
- Produces: `export function buildCtPayload(issues: CycleTimeIssueRaw[], projectStatuses: string[], excludeStatuses: Set<string>): CycleTimeResponse`; `export async function fetchCycleTime(project: string, mode: CycleTimeMode, force: boolean): Promise<CycleTimeResponse>`.

- [ ] **Step 1: Acrescentar `buildCtPayload`**

Colar ao fim de `src/integrations/jira/cycle-time.server.ts`:

```ts

// Exportada para ser exercitada por script avulso (ver Step 3) — o cálculo é
// puro dado o `now` interno, e é o coração do port.
export function buildCtPayload(
  issues: CycleTimeIssueRaw[],
  projectStatuses: string[],
  excludeStatuses: Set<string>,
): CycleTimeResponse {
  // `now` capturado UMA vez por payload, não por issue: senão duas issues no
  // mesmo estado sairiam com totais ligeiramente diferentes só pela ordem em
  // que foram processadas.
  const now = new Date();

  // Acesso defensivo: uma issue com status ausente/malformado não pode
  // derrubar o filtro inteiro — trata como "sem status conhecido" e fica de
  // fora dos candidatos (o guard completo por issue está no flatMap abaixo).
  const candidates = issues.filter((i) => {
    const name = i.fields?.status?.name;
    return name != null && !excludeStatuses.has(name.toLowerCase().trim());
  });
  if (!candidates.length) return { statuses: projectStatuses, issues: [] };

  const output: CycleTimeIssue[] = candidates.flatMap((iss) => {
    try {
      const f = iss.fields;
      const createdDt = f.created ? new Date(f.created) : now;

      // Ordena por INSTANTE (Date), não pela string ISO crua: o changelog do
      // Jira nem sempre traz o mesmo número de casas decimais/offset, e a
      // comparação lexicográfica inverte a ordem real nesses casos.
      const histories = [...(iss.changelog?.histories ?? [])].sort(
        (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
      );
      const transitions: Array<{ from: string; to: string; at: Date }> = [];
      for (const h of histories) {
        for (const item of h.items) {
          if (item.field === "status") {
            transitions.push({
              from: item.fromString ?? "",
              to: item.toString ?? "",
              at: new Date(h.created),
            });
          }
        }
      }

      // Acumula em SEGUNDOS crus e converte/arredonda pra dias uma única vez
      // no fim — arredondar a cada transição somava erro em issues com idas e
      // vindas ao mesmo status (horas de distorção no total).
      const statusSeconds: Record<string, number> = {};
      const addTime = (status: string, seconds: number) => {
        if (seconds > 0) statusSeconds[status] = (statusSeconds[status] ?? 0) + seconds;
      };

      const first = transitions[0];
      const last = transitions[transitions.length - 1];
      if (first && last) {
        addTime(first.from, (first.at.getTime() - createdDt.getTime()) / 1000);
        for (let i = 0; i < transitions.length - 1; i++) {
          const cur = transitions[i];
          const next = transitions[i + 1];
          if (!cur || !next) continue;
          addTime(cur.to, (next.at.getTime() - cur.at.getTime()) / 1000);
        }
        addTime(last.to, (now.getTime() - last.at.getTime()) / 1000);
      } else {
        // Issue sem nenhuma transição de status: todo o tempo desde `created`
        // fica no status atual.
        const currentStatus = f.status?.name ?? "";
        if (currentStatus) {
          addTime(currentStatus, (now.getTime() - createdDt.getTime()) / 1000);
        }
      }

      const filteredDays: Record<string, number> = Object.fromEntries(
        Object.entries(statusSeconds)
          .filter(([st]) => !excludeStatuses.has(st.toLowerCase().trim()))
          .map(([st, seconds]): [string, number] => [st, Math.round((seconds / 86400) * 10) / 10]),
      );

      const versionNames = (f.fixVersions ?? []).map((v) => v.name ?? "").filter(Boolean);
      const fixVersions = versionNames.length > 0 ? versionNames.join(", ") : "—";

      return [
        {
          key: iss.key,
          url: `${JIRA_BASE}/browse/${iss.key}`,
          summary: f.summary ?? "",
          type: f.issuetype?.name ?? "—",
          assignee: f.assignee?.displayName ?? "—",
          current_status: f.status?.name ?? "—",
          fix_versions: fixVersions,
          status_days: filteredDays,
          total_days: Math.round(Object.values(filteredDays).reduce((s, v) => s + v, 0) * 10) / 10,
        },
      ];
    } catch (err) {
      // Um campo inesperado numa única issue não pode derrubar a resposta
      // inteira — pula só essa issue (mesma postura de fetchIssuesForSprint).
      console.error(`[jira/cycle-time] Falha ao processar ${iss.key}, issue ignorada:`, err);
      return [];
    }
  });

  output.sort((a, b) => b.total_days - a.total_days);
  return { statuses: projectStatuses, issues: output };
}
```

> **Limitação herdada, registrada e não corrigida aqui:** o Jira devolve inline apenas as entradas mais recentes do changelog. Numa issue com histórico muito longo, os primeiros status podem não aparecer. O original tem exatamente o mesmo comportamento.

- [ ] **Step 2: Acrescentar `fetchCycleTime`**

Colar ao fim do arquivo:

```ts

export async function fetchCycleTime(
  project: string,
  mode: CycleTimeMode,
  force: boolean,
): Promise<CycleTimeResponse> {
  // NÃO é redundante com o <Select> do cliente: `project` entra por
  // interpolação de string no JQL. Sem esta checagem, um cliente forjado
  // injeta JQL arbitrário e lê projetos fora da lista permitida. É controle de
  // segurança, não conveniência. Mesma mensagem de fetchSprintsForProject —
  // uma string, um significado.
  if (!ALLOWED_PROJECTS.has(project.toUpperCase())) {
    throw new Error("projeto inválido ou não permitido");
  }

  const full = mode === "full";
  const excludeStatuses = full ? EXCLUDE_FULL : EXCLUDE_STANDARD;
  const jqlExclude = full ? JQL_EXCLUDE_FULL : JQL_EXCLUDE_STANDARD;
  const cacheKey = full ? `ct:full:${project}` : `ct:std:${project}`;

  if (!force) {
    const cached = getCache<CycleTimeResponse>(cacheKey);
    if (cached) return cached;
  }

  // "Recalcular" (force) pula a LEITURA do cache, mas continua DENTRO da
  // coalescência: dois cliques simultâneos não viram dois fan-outs.
  return withCacheCoalescing(cacheKey, async () => {
    // withConcurrencyGate envolve o par inteiro, igual ao original: o limite
    // global também vale entre chaves diferentes.
    const [projectStatuses, rawIssues] = await withConcurrencyGate(() =>
      Promise.all([
        fetchProjectStatuses(project, excludeStatuses),
        fetchCycleTimeIssues(project, jqlExclude, full),
      ]),
    );
    const built = buildCtPayload(rawIssues, projectStatuses, excludeStatuses);
    setCache(cacheKey, built);
    return built;
  });
}
```

- [ ] **Step 3: Escrever o script descartável que exercita `buildCtPayload` offline**

Criar `ct-payload-check.ts` **na raiz do repositório** (temporário, apagado no Step 5, nunca commitado). Ele não passa pelo `tsc` (fora do `include` do `tsconfig.json`) e o `jiti` não faz typecheck — os literais abaixo são propositalmente crus.

```ts
// TEMPORÁRIO — apagar após rodar. Não commitar.
// node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs ./ct-payload-check.ts
import { buildCtPayload } from "./src/integrations/jira/cycle-time.server";

const now = Date.now();
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const issues = [
  {
    key: "X-1",
    fields: {
      summary: "com transições",
      status: { name: "PULL REQUEST" },
      issuetype: { name: "Bug" },
      assignee: { displayName: "dev" },
      created: iso(10 * DAY),
      fixVersions: [{ name: "1.0" }],
    },
    changelog: {
      histories: [
        // Fora de ordem DE PROPÓSITO: o cálculo tem que ordenar por instante.
        {
          created: iso(4 * DAY),
          items: [{ field: "status", fromString: "Em andamento", toString: "PULL REQUEST" }],
        },
        {
          created: iso(8 * DAY),
          items: [{ field: "status", fromString: "To Do", toString: "Em andamento" }],
        },
      ],
    },
  },
  {
    key: "X-2",
    fields: {
      summary: "sem transição nenhuma",
      status: { name: "Em andamento" },
      issuetype: { name: "Tarefa" },
      assignee: null,
      created: iso(3 * DAY),
      fixVersions: [],
    },
  },
];

const out = buildCtPayload(issues as never, ["Em andamento", "PULL REQUEST"], new Set(["to do"]));
for (const i of out.issues) {
  console.log(i.key, i.total_days, JSON.stringify(i.status_days), i.fix_versions, i.assignee);
}
console.log("statuses:", out.statuses.join("|"));
```

- [ ] **Step 4: Rodar o script e conferir a saída exata**

```bash
node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs ./ct-payload-check.ts
```

Esperado, literalmente:

```
X-1 8 {"Em andamento":4,"PULL REQUEST":4} 1.0 dev
X-2 3 {"Em andamento":3} — —
statuses: Em andamento|PULL REQUEST
```

O que cada pedaço prova:
- `X-1` antes de `X-2` → ordenação por `total_days` desc;
- `"Em andamento":4` → as histories foram ordenadas por instante (se fossem lidas na ordem crua do array, o intervalo daria negativo e sumiria);
- ausência da chave `"To Do"` (que recebeu 2 dias) → o filtro de exclusão roda sobre `status_days`, não só sobre a issue;
- `X-2` com 3 dias em "Em andamento" → issue sem transição acumula desde `created` no status atual;
- `1.0` e `—` → `fix_versions` com e sem versões;
- `dev` e `—` → `assignee` presente e nulo.

Se algum número vier `3.9`/`4.1`, é arredondamento de borda do relógio — só é problema se a diferença for maior que `0.1`.

- [ ] **Step 5: Apagar o script**

```bash
rm ./ct-payload-check.ts
```

- [ ] **Step 6: Verificar tipos e formatação**

```bash
npx tsc --noEmit && npm run lint
git status --short
```

Esperado: sem erros no primeiro comando; `git status` mostrando apenas `src/integrations/jira/cycle-time.server.ts` modificado (nenhum `ct-payload-check.ts` sobrando).

- [ ] **Step 7: Commit**

```bash
git add src/integrations/jira/cycle-time.server.ts
git commit -m "feat(cycle-time): compute per-status days from changelog with cache and coalescing"
```

---

## Task 5: Server function `getJiraCycleTime`

**Files:**
- Modify: `src/integrations/jira/server-fns.ts:9` (import de tipos), `src/integrations/jira/server-fns.ts:48` (acrescentar ao fim)

**Interfaces:**
- Consumes: `fetchCycleTime(project: string, mode: CycleTimeMode, force: boolean): Promise<CycleTimeResponse>` (Task 4); `requireSupabaseAuth`; `assertCanViewBoard(supabase, userId)`; `JiraError` (`client.server.ts`, com `.status`, `.message` e `.clientMessage`).
- Produces: `getJiraCycleTime` — chamável do cliente como `getJiraCycleTime({ data: { project: string; mode: CycleTimeMode; force?: boolean } })`, resolvendo em `CycleTimeResponse`.

- [ ] **Step 1: Acrescentar o import de tipos**

Em `src/integrations/jira/server-fns.ts`, logo abaixo da linha 9 (`import type { IssueResponse, JiraProject, SprintResponse } from "@/lib/compromisso/types";`), acrescentar:

```ts
import type { CycleTimeMode, CycleTimeResponse } from "@/lib/cycle-time/types";
```

- [ ] **Step 2: Acrescentar a server function ao fim do arquivo**

Colar depois da linha 48 (fechamento de `getJiraIssues`):

```ts

export const getJiraCycleTime = createServerFn({ method: "GET" })
  .validator((data: { project: string; mode: CycleTimeMode; force?: boolean }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<CycleTimeResponse> => {
    const { assertCanViewBoard } = await import("./access.server");
    await assertCanViewBoard(context.supabase, context.userId);
    const { fetchCycleTime } = await import("./cycle-time.server");
    try {
      return await fetchCycleTime(data.project, data.mode, data.force ?? false);
    } catch (err) {
      // Erro que cruza a fronteira do RPC é serializado por `message`. Sem
      // este mapeamento a UI mostraria o corpo cru da resposta do Jira; com
      // ele, mostra a tradução pt-BR de JiraError e o detalhe técnico fica só
      // no log do servidor. As quatro server functions acima têm o mesmo
      // defeito e NÃO são alteradas nesta demanda — fica registrado.
      const { JiraError } = await import("./client.server");
      if (err instanceof JiraError) {
        console.error("[jira/cycle-time]", err.status, err.message);
        throw new Error(err.clientMessage);
      }
      throw err;
    }
  });
```

> `canView`, não `canEdit`: a tela é leitura pura de dados do Jira que um `viewer` já enxerga em `/` e `/compromisso`.
> O `import` de `JiraError` é dinâmico pelo mesmo motivo dos demais — `client.server.ts` é server-only e este arquivo é importado por componentes React.

- [ ] **Step 3: Verificar tipos e formatação**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/jira/server-fns.ts
git commit -m "feat(cycle-time): expose getJiraCycleTime server function with role check"
```

---

## Task 6: Paridade contra o `jira-live` (porta 8000) — checkpoint antes da UI

Este é o último momento em que o original ainda está de pé para servir de referência. Se o payload estiver errado, nenhuma tela conserta.

**Files:**
- Create (temporário, apagado no fim da task, **não commitado**): `ct-parity.ts`

**Interfaces:**
- Consumes: `fetchCycleTime(project, mode, force)` (Task 4).
- Produces: nada em código. Produz a evidência de que o port está correto.

- [ ] **Step 1: Confirmar que o `jira-live` está no ar**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8000/api/projects" --max-time 15
```

Esperado: `200`. Se vier outra coisa, o serviço Windows do `jira-live` está parado — subir antes de continuar (é o único árbitro de paridade disponível).

Equivalente em PowerShell:

```powershell
(Invoke-WebRequest -Uri "http://localhost:8000/api/projects" -UseBasicParsing).StatusCode
```

- [ ] **Step 2: Escrever o script de comparação**

Criar `ct-parity.ts` na raiz do repositório:

```ts
// TEMPORÁRIO — apagar após rodar. Não commitar.
// node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs ./ct-parity.ts PIM standard
import { fetchCycleTime } from "./src/integrations/jira/cycle-time.server";

const project = process.argv[2] ?? "PIM";
const mode = process.argv[3] === "full" ? "full" : "standard";

// force=true dos dois lados: compara cálculo, não cache.
const novo = await fetchCycleTime(project, mode, true);
const res = await fetch(
  `http://localhost:8000/api/cycle-time?project=${project}&mode=${mode}&force=true`,
);
const velho = await res.json();

const topo = (r) =>
  r.issues
    .slice(0, 5)
    .map((i) => `${i.key}=${i.total_days}`)
    .join("  ");

console.log(`projeto=${project} modo=${mode}`);
console.log(`  itens        novo=${novo.issues.length}  jira-live=${velho.issues.length}`);
console.log(`  statuses  novo=${novo.statuses.join("|")}`);
console.log(`  statuses velho=${velho.statuses.join("|")}`);
console.log(`  topo  novo=${topo(novo)}`);
console.log(`  topo velho=${topo(velho)}`);

const porChave = new Map(velho.issues.map((i) => [i.key, i]));
let divergencias = 0;
let semTransicao = 0;

for (const n of novo.issues.slice(0, 20)) {
  const o = porChave.get(n.key);
  if (!o) {
    console.log(`  AUSENTE no jira-live: ${n.key}`);
    divergencias++;
    continue;
  }
  if (Object.keys(n.status_days).length === 1) semTransicao++;
  const chaves = new Set([...Object.keys(n.status_days), ...Object.keys(o.status_days)]);
  for (const st of chaves) {
    const dn = n.status_days[st] ?? 0;
    const dv = o.status_days[st] ?? 0;
    // Tolerância = arredondamento a 1 casa + o tempo decorrido entre as duas
    // chamadas. Nada além disso é aceitável.
    if (Math.abs(dn - dv) > 0.1) {
      console.log(`  DIVERGE ${n.key} "${st}": novo=${dn} jira-live=${dv}`);
      divergencias++;
    }
  }
}

console.log(`  issues com uma coluna só (candidatas a "sem transição"): ${semTransicao}`);
console.log(divergencias === 0 ? "PARIDADE OK (20 primeiras)" : `${divergencias} divergência(s)`);
```

- [ ] **Step 3: Rodar os quatro cenários**

```bash
node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs ./ct-parity.ts PIM standard
node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs ./ct-parity.ts PIM full
node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs ./ct-parity.ts INTFLOW standard
node --env-file=.env node_modules/jiti/lib/jiti-cli.mjs ./ct-parity.ts INTFLOW full
```

PIM e INTFLOW porque têm fluxos de status diferentes — um só projeto não exercita a montagem de colunas.

O que tem de ser verdade em cada execução:

1. `itens novo == itens jira-live` (no modo `standard` os dois devem bater em 200, que é o corte; no `full`, no número total de abertas do projeto);
2. as duas linhas `statuses` idênticas, na mesma ordem;
3. as duas linhas `topo` com as mesmas chaves na mesma ordem e totais dentro de `0.1`;
4. `PARIDADE OK (20 primeiras)` na última linha;
5. `issues com uma coluna só` maior que zero em pelo menos um cenário — é a evidência do caso "issue sem nenhuma transição de status leva todo o tempo para o status atual". Se der zero nos quatro, escolher manualmente uma issue recém-criada do projeto e conferir os dois lados à mão.

Se aparecer `DIVERGE`, **parar aqui** e corrigir `buildCtPayload`/`fetchCycleTimeIssues` na Task 4/3 antes de escrever qualquer UI.

- [ ] **Step 4: Registrar a evidência**

Colar a saída dos quatro comandos na conversa/PR. É o registro de que o port foi conferido enquanto o original ainda existia.

- [ ] **Step 5: Apagar o script**

```bash
rm ./ct-parity.ts
git status --short
```

Esperado: `git status` sem nenhum arquivo novo na raiz. Esta task **não tem commit** — não produziu código.

---

## Task 7: Camada pura `src/lib/cycle-time/calc.ts`

**Files:**
- Create: `src/lib/cycle-time/calc.ts`

**Interfaces:**
- Consumes: `CycleTimeIssue`, `CycleTimeMode` (Task 1).
- Produces:
  - `type SpeedTier = "rápido" | "médio" | "lento"`
  - `type CycleTimeFixedCol = "key" | "summary" | "current_status" | "fix_versions" | "total"`
  - `type CycleTimeSort = { kind: "fixed"; col: CycleTimeFixedCol; dir: 1 | -1 } | { kind: "status"; col: string; dir: 1 | -1 }`
  - `interface CycleTimeViewConfig { aliases: Record<string, string>; excludedCols: Set<string>; colOrder: string[]; requirePositive: boolean; fmt: (d: number | undefined) => string; pageSize: number | null }`
  - `fmtDays(d: number | undefined): string`, `fmtDays2(d: number | undefined): string`
  - `speedTier(d: number): SpeedTier`, `totalTier(d: number): SpeedTier`
  - `mergeStatusVariants(issues: CycleTimeIssue[], projectStatuses: string[], aliases: Record<string, string>): CycleTimeIssue[]`
  - `buildStatusOrder(projectStatuses: string[], issues: CycleTimeIssue[], excluded: Set<string>): string[]`
  - `buildColumns(issues: CycleTimeIssue[], projectStatuses: string[], config: CycleTimeViewConfig): string[]`
  - `sortIssues(issues: CycleTimeIssue[], sort: CycleTimeSort | null): CycleTimeIssue[]`
  - `CYCLE_TIME_CONFIG: Record<CycleTimeMode, CycleTimeViewConfig>`

- [ ] **Step 1: Criar o arquivo com cabeçalho e os conjuntos de coluna**

Criar `src/lib/cycle-time/calc.ts`:

```ts
/**
 * Camada pura do Cycle Time — sem DOM, sem HTML, isomórfica. Segue o
 * precedente de src/lib/compromisso/calc.ts e recebe o que em
 * jira-live/static/components/cycle-time.js estava misturado com geração de
 * innerHTML.
 *
 * Os conjuntos e ordens abaixo decidem QUAIS COLUNAS DESENHAR. São distintos,
 * de propósito, dos conjuntos de exclusão de cycle-time.server.ts, que decidem
 * QUAIS ISSUES BUSCAR E QUE TEMPO SOMAR. Fundir os dois trocaria dois
 * conceitos por um errado.
 *
 * O cálculo de tempo por status (buildCtPayload) NÃO vem para cá: depende do
 * changelog cru, que nunca cruza a fronteira — igual computeDoneAt fica em
 * issues.server.ts.
 */
import type { CycleTimeIssue, CycleTimeMode } from "./types";

const normKey = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/** Colunas escondidas na sub-visão "Em Andamento". */
const CT_EXCLUDED_COLS = new Set([
  "to do",
  "todo",
  "backlog",
  "tarefas pendentes",
  "tarefas_pendentes",
  "done",
  "concluído",
  "concluido",
  "rejeitada",
  "rejeitado",
  "rejected",
  "cancelada",
  "cancelado",
  "cancelled",
  "ready to dev",
  "em análise",
  "em analise",
  "ready to specify",
  "to research",
  "to discover",
  "in discover",
]);

/** Ordem preferida das colunas em "Em Andamento" (minúsculas). */
const CT_COL_ORDER = [
  "in progress",
  "em andamento",
  "pull request",
  "ready for test",
  "test",
  "qa blocked",
  "qa approved",
];

/** No "Histórico Completo" só os terminais somem — o resto do fluxo aparece. */
const CT_EXCLUDED_COLS2 = new Set([
  "done",
  "concluído",
  "concluido",
  "rejeitada",
  "rejeitado",
  "rejected",
  "cancelada",
  "cancelado",
  "cancelled",
]);

const CT_COL_ORDER2 = [
  "em análise",
  "em analise",
  "ready to dev",
  "todo",
  "to do",
  "backlog",
  "tarefas pendentes",
  "tarefas_pendentes",
  "to research",
  "to discover",
  "to discovery",
  "in discover",
  "in research",
  "in discovery",
  "blocked in discovery",
  "blocked in discover",
  "waiting priorization",
  "waiting prioritization",
  "blocked",
  "ready to specify",
  "doing",
  "in progress",
  "em andamento",
  "pull request",
  "ready for test",
  "test",
  "qa blocked",
  "qa approved",
];
```

- [ ] **Step 2: Acrescentar os formatadores de duração**

Colar ao fim do arquivo:

```ts

/**
 * "3d 4h". `—` quando não há valor.
 *
 * O original testa `if (!d && d !== 0)`; aqui a checagem é explícita por
 * `undefined`/`NaN` para que o TypeScript estreite o tipo — o resultado é o
 * mesmo em todos os valores possíveis (0 continua virando "0h").
 */
export function fmtDays(d: number | undefined): string {
  if (d === undefined || Number.isNaN(d)) return "—";
  const days = Math.floor(d);
  const hours = Math.round((d - days) * 24);
  if (days === 0) return `${hours}h`;
  if (hours === 0) return `${days}d`;
  return `${days}d ${hours}h`;
}

/** Igual a fmtDays, mas colapsa acima de 365 dias em "2a 130d". */
export function fmtDays2(d: number | undefined): string {
  if (d === undefined || Number.isNaN(d)) return "—";
  const totalDays = Math.floor(d);
  const hours = Math.round((d - totalDays) * 24);
  if (totalDays === 0) return `${hours}h`;
  if (totalDays < 365) return hours === 0 ? `${totalDays}d` : `${totalDays}d ${hours}h`;
  const years = Math.floor(totalDays / 365);
  const remDays = totalDays % 365;
  return remDays === 0 ? `${years}a` : `${years}a ${remDays}d`;
}
```

- [ ] **Step 3: Acrescentar as faixas de velocidade**

Colar ao fim do arquivo:

```ts

export type SpeedTier = "rápido" | "médio" | "lento";

/** Limiares de UMA CÉLULA — tempo parado num único status. */
export function speedTier(d: number): SpeedTier {
  return d <= 1 ? "rápido" : d <= 3 ? "médio" : "lento";
}

/**
 * Limiares do CICLO INTEIRO — diferentes dos da célula, de propósito: um é
 * tempo num status, o outro é o ciclo todo. (Também são diferentes dos de
 * DaysInStatus em IssuesTable, que mede "dias no status atual" — outra
 * grandeza.)
 *
 * Divergência deliberada do original: lá a COR do total usava estes limiares
 * mas o RÓTULO usava os da célula, então uma issue de 5 dias saía amarela
 * descrita como "lento". Cor e rótulo passam a concordar.
 */
export function totalTier(d: number): SpeedTier {
  return d <= 3 ? "rápido" : d <= 7 ? "médio" : "lento";
}
```

- [ ] **Step 4: Acrescentar `mergeStatusVariants`**

Colar ao fim do arquivo:

```ts

/**
 * Funde variantes do mesmo status numa coluna só ("Em andamento"/"In
 * Progress", "QA"/"In Test"). O nome canônico é o primeiro que aparecer,
 * varrendo os status do projeto antes dos que só existem nas issues.
 *
 * Divergência deliberada do original: lá a função MUTAVA `row.status_days` in
 * place. Aqui devolve issues novas — o array vem do cache do TanStack Query e
 * é compartilhado entre renders; mutá-lo faria a fusão rodar em cima de si
 * mesma a cada re-render.
 */
export function mergeStatusVariants(
  issues: CycleTimeIssue[],
  projectStatuses: string[],
  aliases: Record<string, string>,
): CycleTimeIssue[] {
  const resolve = (k: string) => aliases[k] ?? k;
  const canonical = new Map<string, string>();
  for (const st of [...projectStatuses, ...issues.flatMap((r) => Object.keys(r.status_days))]) {
    const k = resolve(normKey(st));
    if (k && !canonical.has(k)) canonical.set(k, st);
  }
  return issues.map((row) => {
    const merged: Record<string, number> = {};
    for (const [st, days] of Object.entries(row.status_days)) {
      const key = canonical.get(resolve(normKey(st))) ?? st;
      merged[key] = Math.round(((merged[key] ?? 0) + days) * 10) / 10;
    }
    return { ...row, status_days: merged };
  });
}
```

- [ ] **Step 5: Acrescentar `buildStatusOrder`, `CycleTimeViewConfig` e `buildColumns`**

Colar ao fim do arquivo:

```ts

/**
 * Ordem das colunas: status do projeto primeiro, depois os que só aparecem nas
 * issues. Quando a listagem de status do projeto falha e vem `[]`, este é o
 * fallback — "ordem de aparição nas issues".
 */
export function buildStatusOrder(
  projectStatuses: string[],
  issues: CycleTimeIssue[],
  excluded: Set<string>,
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const st of [...projectStatuses, ...issues.flatMap((r) => Object.keys(r.status_days))]) {
    if (!seen.has(st) && !excluded.has(st.toLowerCase().trim())) {
      seen.add(st);
      order.push(st);
    }
  }
  return order;
}

export interface CycleTimeViewConfig {
  /** Chave normalizada → chave canônica, para fundir variantes do mesmo status. */
  aliases: Record<string, string>;
  /** Colunas que nunca aparecem nesta sub-visão. */
  excludedCols: Set<string>;
  /** Ordem preferida (minúsculas); o que não estiver aqui vai para o fim. */
  colOrder: string[];
  /**
   * "Histórico Completo" só mostra coluna com algum valor > 0; "Em Andamento"
   * aceita a chave existir. É assim no original, e a diferença importa: com o
   * arredondamento a 1 casa, um status de poucos minutos vira 0.
   */
  requirePositive: boolean;
  fmt: (d: number | undefined) => string;
  /** `null` = sem paginação (no modo standard o servidor já corta em 200). */
  pageSize: number | null;
}

export function buildColumns(
  issues: CycleTimeIssue[],
  projectStatuses: string[],
  config: CycleTimeViewConfig,
): string[] {
  const active = new Set<string>();
  for (const row of issues) {
    for (const [st, days] of Object.entries(row.status_days)) {
      if (!config.requirePositive || days > 0) active.add(st);
    }
  }
  return buildStatusOrder(projectStatuses, issues, config.excludedCols)
    .filter((st) => active.has(st))
    .sort((a, b) => {
      const ia = config.colOrder.indexOf(a.toLowerCase().trim());
      const ib = config.colOrder.indexOf(b.toLowerCase().trim());
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
}
```

- [ ] **Step 6: Acrescentar a ordenação**

Colar ao fim do arquivo:

```ts

export type CycleTimeFixedCol = "key" | "summary" | "current_status" | "fix_versions" | "total";

/**
 * Coluna fixa ou coluna de status, discriminadas. O original guardava um único
 * `sortCol: string`, o que confundia um status chamado "Total" ou "Chave" com
 * a coluna homônima; o discriminante elimina a ambiguidade sem mudar
 * comportamento em nenhum dado real.
 */
export type CycleTimeSort =
  | { kind: "fixed"; col: CycleTimeFixedCol; dir: 1 | -1 }
  | { kind: "status"; col: string; dir: 1 | -1 };

export function sortIssues(
  issues: CycleTimeIssue[],
  sort: CycleTimeSort | null,
): CycleTimeIssue[] {
  if (!sort) return issues;
  const value = (i: CycleTimeIssue): string | number => {
    if (sort.kind === "status") return i.status_days[sort.col] ?? 0;
    if (sort.col === "key") return i.key;
    if (sort.col === "summary") return i.summary;
    if (sort.col === "current_status") return i.current_status;
    if (sort.col === "fix_versions") return i.fix_versions;
    return i.total_days;
  };
  return [...issues].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === "string") return sort.dir * va.localeCompare(String(vb), "pt-BR");
    return sort.dir * (va - Number(vb));
  });
}
```

- [ ] **Step 7: Acrescentar `CYCLE_TIME_CONFIG`**

Colar ao fim do arquivo (precisa vir depois de tudo que referencia — é avaliado na carga do módulo):

```ts

/**
 * Uma entrada por sub-visão. Os aliases são os mesmos do original: "Em
 * Andamento" funde pouca coisa; "Histórico Completo" colapsa toda a
 * pré-esteira ("Backlog", "To Research", "Blocked"…) numa coluna "todo" só,
 * senão a tabela ganharia quinze colunas quase vazias.
 */
export const CYCLE_TIME_CONFIG: Record<CycleTimeMode, CycleTimeViewConfig> = {
  standard: {
    aliases: { emandamento: "inprogress", intest: "test", qa: "test" },
    excludedCols: CT_EXCLUDED_COLS,
    colOrder: CT_COL_ORDER,
    requirePositive: false,
    fmt: fmtDays,
    pageSize: null,
  },
  full: {
    aliases: {
      tarefaspendentes: "todo",
      backlog: "todo",
      toresearch: "todo",
      todiscover: "todo",
      todiscovery: "todo",
      indiscover: "todo",
      inresearch: "todo",
      indiscovery: "todo",
      blockedindiscovery: "todo",
      blockedindiscover: "todo",
      waitingpriorization: "todo",
      waitingprioritization: "todo",
      blocked: "todo",
      readytospecify: "todo",
      readytoespecify: "todo",
      doing: "todo",
      emandamento: "inprogress",
      intest: "test",
      qa: "test",
    },
    excludedCols: CT_EXCLUDED_COLS2,
    colOrder: CT_COL_ORDER2,
    requirePositive: true,
    fmt: fmtDays2,
    pageSize: 100,
  },
};
```

- [ ] **Step 8: Escrever o script descartável que exercita a camada pura**

Criar `ct-calc-check.ts` na raiz do repositório (temporário, apagado no Step 10):

```ts
// TEMPORÁRIO — apagar após rodar. Não commitar.
// node node_modules/jiti/lib/jiti-cli.mjs ./ct-calc-check.ts
import {
  CYCLE_TIME_CONFIG,
  buildColumns,
  fmtDays,
  fmtDays2,
  mergeStatusVariants,
  sortIssues,
  speedTier,
  totalTier,
} from "./src/lib/cycle-time/calc";

const issues = [
  {
    key: "A-1",
    url: "",
    summary: "a",
    type: "Bug",
    assignee: "x",
    current_status: "Em andamento",
    fix_versions: "—",
    status_days: { "Em andamento": 2, "In Progress": 1, TEST: 0 },
    total_days: 3,
  },
  {
    key: "A-2",
    url: "",
    summary: "b",
    type: "Tarefa",
    assignee: "y",
    current_status: "PULL REQUEST",
    fix_versions: "—",
    status_days: { "PULL REQUEST": 10 },
    total_days: 10,
  },
];

const projectStatuses = ["Em andamento", "PULL REQUEST", "TEST"];
const cfg = CYCLE_TIME_CONFIG.standard;
const merged = mergeStatusVariants(issues, projectStatuses, cfg.aliases);

console.log("merge  :", JSON.stringify(merged[0].status_days));
console.log("cols   :", buildColumns(merged, projectStatuses, cfg).join(" | "));
console.log("naomuta:", JSON.stringify(issues[0].status_days));
console.log(
  "sort   :",
  sortIssues(merged, { kind: "fixed", col: "total", dir: -1 })
    .map((i) => i.key)
    .join(","),
);
console.log("fmt    :", fmtDays(3.5), fmtDays(0.25), fmtDays(undefined), fmtDays2(400.5));
console.log(
  "tier   :",
  speedTier(0.5),
  speedTier(2),
  speedTier(9),
  totalTier(2),
  totalTier(5),
  totalTier(9),
);
```

- [ ] **Step 9: Rodar e conferir a saída exata**

```bash
node node_modules/jiti/lib/jiti-cli.mjs ./ct-calc-check.ts
```

Esperado, literalmente:

```
merge  : {"Em andamento":3,"TEST":0}
cols   : Em andamento | PULL REQUEST | TEST
naomuta: {"Em andamento":2,"In Progress":1,"TEST":0}
sort   : A-2,A-1
fmt    : 3d 12h 6h — 1a 35d
tier   : rápido médio lento rápido médio lento
```

O que cada linha prova:
- `merge` → "In Progress" foi fundido em "Em andamento" (2+1=3) e "TEST" sobreviveu;
- `cols` → ordem veio de `CT_COL_ORDER` (em andamento < pull request < test), e "TEST" com 0 dias ainda aparece porque `requirePositive` é `false` no modo standard;
- `naomuta` → o array de entrada continua intacto (a divergência deliberada do Step 4 está valendo);
- `sort` → ordenação numérica descendente por total;
- `fmt` → `3d 12h`, `6h`, `—` e o colapso em anos do `fmtDays2`;
- `tier` → os dois conjuntos de limiares, célula e total.

- [ ] **Step 10: Apagar o script e verificar tipos e formatação**

```bash
rm ./ct-calc-check.ts
npx tsc --noEmit && npm run lint
git status --short
```

Esperado: sem erros; `git status` mostrando apenas `src/lib/cycle-time/calc.ts` como arquivo novo.

- [ ] **Step 11: Commit**

```bash
git add src/lib/cycle-time/calc.ts
git commit -m "feat(cycle-time): add pure layer for columns, sorting and duration formatting"
```

---

## Task 8: `CycleTimeTable.tsx`

**Files:**
- Create: `src/components/cycle-time/CycleTimeTable.tsx`

**Interfaces:**
- Consumes: `sortIssues`, `speedTier`, `totalTier`, `type CycleTimeFixedCol`, `type CycleTimeSort`, `type SpeedTier` (Task 7); `CycleTimeIssue` (Task 1); `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, `Button`.
- Produces: `export function CycleTimeTable(props: { title: string; subtitle: string | null; issues: CycleTimeIssue[]; columns: string[]; fmt: (d: number | undefined) => string; pageSize: number | null }): JSX.Element`.

- [ ] **Step 1: Criar o arquivo com imports, faixas de cor e a assinatura**

Criar `src/components/cycle-time/CycleTimeTable.tsx`:

```tsx
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  sortIssues,
  speedTier,
  totalTier,
  type CycleTimeFixedCol,
  type CycleTimeSort,
  type SpeedTier,
} from "@/lib/cycle-time/calc";
import type { CycleTimeIssue } from "@/lib/cycle-time/types";

// Limiares do original, tokens do destino — legíveis nos dois temas.
const TIER_CLASS: Record<SpeedTier, string> = {
  rápido: "text-green-600 dark:text-green-400",
  médio: "text-amber-600 dark:text-amber-400",
  lento: "text-red-600 dark:text-red-400",
};

export function CycleTimeTable({
  title,
  subtitle,
  issues,
  columns,
  fmt,
  pageSize,
}: {
  title: string;
  subtitle: string | null;
  issues: CycleTimeIssue[];
  columns: string[];
  fmt: (d: number | undefined) => string;
  /** `null` desliga a paginação — é o caso da sub-visão "Em Andamento". */
  pageSize: number | null;
}) {
  const [sort, setSort] = useState<CycleTimeSort | null>(null);
  const [page, setPage] = useState(0);

  // Ordena a lista INTEIRA e fatia depois, nunca o contrário: paginar antes de
  // ordenar faria a ordenação valer só para a página visível.
  const sorted = useMemo(() => sortIssues(issues, sort), [issues, sort]);

  const total = sorted.length;
  const paginated = pageSize != null && total > pageSize;
  const pages = paginated && pageSize != null ? Math.ceil(total / pageSize) : 1;
  const safePage = Math.min(page, pages - 1);
  const start = paginated && pageSize != null ? safePage * pageSize : 0;
  const rows = paginated && pageSize != null ? sorted.slice(start, start + pageSize) : sorted;
  const colCount = columns.length + 6;

  function toggleFixed(col: CycleTimeFixedCol) {
    // Trocar de coluna de ordenação volta para a página 1 — igual ao original.
    setPage(0);
    setSort((s) =>
      s && s.kind === "fixed" && s.col === col
        ? { kind: "fixed", col, dir: (s.dir * -1) as 1 | -1 }
        : { kind: "fixed", col, dir: 1 },
    );
  }

  function toggleStatus(col: string) {
    setPage(0);
    setSort((s) =>
      s && s.kind === "status" && s.col === col
        ? { kind: "status", col, dir: (s.dir * -1) as 1 | -1 }
        : { kind: "status", col, dir: 1 },
    );
  }

  const info = paginated
    ? `Página ${safePage + 1} de ${pages} · itens ${start + 1}–${Math.min(start + rows.length, total)} de ${total}`
    : "";

  return null; // substituído no Step 4
}
```

> O `return null` é provisório e some no Step 4. Ele existe só para que este passo termine compilando.

- [ ] **Step 2: Acrescentar os dois componentes auxiliares ao fim do arquivo**

```tsx

function SortHead({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  className?: string;
}) {
  const Icon = active ? (dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground"
      >
        {label}
        <Icon className={`size-3 ${active ? "text-primary" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}

function PaginationBar({
  info,
  atFirst,
  atLast,
  onPrev,
  onNext,
}: {
  info: string;
  atFirst: boolean;
  atLast: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Dois botões e um contador — não o primitivo @/components/ui/pagination,
  // que é feito para lista numerada de páginas com elipse e não é usado por
  // nenhuma outra tela desta aplicação.
  return (
    <div className="flex items-center justify-between gap-2 py-2 text-xs text-muted-foreground">
      <Button variant="outline" size="sm" onClick={onPrev} disabled={atFirst}>
        Anterior
      </Button>
      <span>{info}</span>
      <Button variant="outline" size="sm" onClick={onNext} disabled={atLast}>
        Próxima
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Acrescentar a célula de duração ao fim do arquivo**

```tsx

function DurationCell({
  days,
  fmt,
  tier,
  prefix,
  bold,
}: {
  days: number;
  fmt: (d: number | undefined) => string;
  tier: SpeedTier;
  prefix: string;
  bold: boolean;
}) {
  const text = fmt(days);
  // title + aria-label com duração e rótulo de velocidade: é o que dá leitura
  // acessível a uma matriz de números coloridos.
  return (
    <TableCell
      className={`text-center ${bold ? "font-bold" : "font-semibold"} ${TIER_CLASS[tier]}`}
      title={`${prefix}${text} — ${tier}`}
      aria-label={`${tier}: ${text}`}
    >
      {text}
    </TableCell>
  );
}
```

- [ ] **Step 4: Substituir o `return null` pelo JSX da tabela**

Em `CycleTimeTable`, trocar a linha `return null; // substituído no Step 4` por:

```tsx
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {subtitle ? <p className="text-[11px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {total} {total === 1 ? "item" : "itens"}
        </span>
      </CardHeader>
      <CardContent className="overflow-x-auto pt-0">
        {paginated ? (
          <PaginationBar
            info={info}
            atFirst={safePage === 0}
            atLast={safePage >= pages - 1}
            onPrev={() => setPage(Math.max(0, safePage - 1))}
            onNext={() => setPage(Math.min(pages - 1, safePage + 1))}
          />
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <SortHead
                label="Chave"
                active={sort?.kind === "fixed" && sort.col === "key"}
                dir={sort?.dir ?? 1}
                onClick={() => toggleFixed("key")}
              />
              <SortHead
                label="Resumo"
                active={sort?.kind === "fixed" && sort.col === "summary"}
                dir={sort?.dir ?? 1}
                onClick={() => toggleFixed("summary")}
              />
              <SortHead
                label="Status atual"
                active={sort?.kind === "fixed" && sort.col === "current_status"}
                dir={sort?.dir ?? 1}
                onClick={() => toggleFixed("current_status")}
              />
              <SortHead
                label="Versões corrigidas"
                active={sort?.kind === "fixed" && sort.col === "fix_versions"}
                dir={sort?.dir ?? 1}
                onClick={() => toggleFixed("fix_versions")}
              />
              {columns.map((st) => (
                <SortHead
                  key={st}
                  label={st}
                  active={sort?.kind === "status" && sort.col === st}
                  dir={sort?.dir ?? 1}
                  onClick={() => toggleStatus(st)}
                  className="text-center"
                />
              ))}
              <SortHead
                label="Total"
                active={sort?.kind === "fixed" && sort.col === "total"}
                dir={sort?.dir ?? 1}
                onClick={() => toggleFixed("total")}
                className="text-center"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">
                  Nenhum item em andamento
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => (
                <TableRow key={row.key}>
                  <TableCell className="text-xs text-muted-foreground">{start + idx + 1}</TableCell>
                  <TableCell>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 whitespace-nowrap underline-offset-2 hover:underline"
                    >
                      {row.key}
                      <ExternalLink className="size-2.5 opacity-50" />
                    </a>
                  </TableCell>
                  <TableCell className="max-w-xs truncate" title={row.summary}>
                    {row.summary}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {row.current_status}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                    {row.fix_versions}
                  </TableCell>
                  {columns.map((st) => {
                    const d = row.status_days[st];
                    if (d === undefined || d === 0) {
                      return (
                        <TableCell
                          key={st}
                          className="text-center text-muted-foreground"
                          aria-label="sem dados"
                        >
                          —
                        </TableCell>
                      );
                    }
                    return (
                      <DurationCell
                        key={st}
                        days={d}
                        fmt={fmt}
                        tier={speedTier(d)}
                        prefix=""
                        bold={false}
                      />
                    );
                  })}
                  <DurationCell
                    days={row.total_days}
                    fmt={fmt}
                    tier={totalTier(row.total_days)}
                    prefix="Total: "
                    bold
                  />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {paginated ? (
          <PaginationBar
            info={info}
            atFirst={safePage === 0}
            atLast={safePage >= pages - 1}
            onPrev={() => setPage(Math.max(0, safePage - 1))}
            onNext={() => setPage(Math.min(pages - 1, safePage + 1))}
          />
        ) : null}
      </CardContent>
    </Card>
  );
```

> As duas barras de paginação (acima e abaixo) só existem quando `total > pageSize` — é o comportamento de `updatePagination2` no original, que escondia `ctPagTop2`/`ctPagBot2` nesse caso.
> Diferença deliberada frente ao `IssuesTable`: lá a ordenação só liga com um status selecionado (`enabled={singleStatus}`); aqui é sempre ativa, como no original.

- [ ] **Step 5: Verificar tipos e formatação**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sem erros. Em particular, `row.status_days[st]` tem de ser tratado como `number | undefined` — é o que o `if (d === undefined || d === 0)` faz; sem ele o `noUncheckedIndexedAccess` acusa.

- [ ] **Step 6: Commit**

```bash
git add src/components/cycle-time/CycleTimeTable.tsx
git commit -m "feat(cycle-time): add sortable issue x status matrix table"
```

---

## Task 9: `CycleTimeView.tsx`

**Files:**
- Create: `src/components/cycle-time/CycleTimeView.tsx`

**Interfaces:**
- Consumes: `getJiraCycleTime`, `getJiraProjects` (Task 5 e existente); `CYCLE_TIME_CONFIG`, `buildColumns`, `mergeStatusVariants` (Task 7); `CycleTimeTable` (Task 8); `CycleTimeIssue`, `CycleTimeMode`, `CycleTimeResponse` (Task 1); `ThemeToggle`, `supabase`, `Tabs`, `Select`, `Button`, `toast`.
- Produces: `export function CycleTimeView({ email }: { email: string }): JSX.Element`.

- [ ] **Step 1: Criar o arquivo com imports, estado e helpers de localStorage**

Criar `src/components/cycle-time/CycleTimeView.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, LayoutGrid, LogOut, RefreshCw, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { getJiraCycleTime, getJiraProjects } from "@/integrations/jira/server-fns";
import { CYCLE_TIME_CONFIG, buildColumns, mergeStatusVariants } from "@/lib/cycle-time/calc";
import type { CycleTimeIssue, CycleTimeMode, CycleTimeResponse } from "@/lib/cycle-time/types";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CycleTimeTable } from "./CycleTimeTable";

/** Sub-visão ativa. Nomes do original (localStorage `ctView`). */
type CycleTimeSubView = "status" | "full";

const ls = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

// Chaves próprias, separadas das do Compromisso: são telas independentes, e
// olhar o Compromisso do PIM enquanto se analisa o Cycle Time do PH é um uso
// legítimo.
const LS_PROJECT = "cycleTimeLastProject";
const LS_VIEW = "cycleTimeView";

function prepare(
  resp: CycleTimeResponse | undefined,
  mode: CycleTimeMode,
): { issues: CycleTimeIssue[]; columns: string[] } {
  if (!resp) return { issues: [], columns: [] };
  const cfg = CYCLE_TIME_CONFIG[mode];
  const issues = mergeStatusVariants(resp.issues, resp.statuses, cfg.aliases);
  return { issues, columns: buildColumns(issues, resp.statuses, cfg) };
}
```

- [ ] **Step 2: Acrescentar o corpo do componente — estado e queries**

Colar ao fim do arquivo:

```tsx

export function CycleTimeView({ email }: { email: string }) {
  const qc = useQueryClient();
  const [project, setProject] = useState<string | null>(() => ls(LS_PROJECT));
  const [subView, setSubView] = useState<CycleTimeSubView>(() =>
    ls(LS_VIEW) === "full" ? "full" : "status",
  );
  const [recalculando, setRecalculando] = useState(false);

  const projectsQ = useQuery({ queryKey: ["jira", "projects"], queryFn: () => getJiraProjects() });

  useEffect(() => {
    const first = projectsQ.data?.[0];
    if (!project && first) setProject(first.key);
  }, [project, projectsQ.data]);

  // Duas queries separadas, não uma parametrizada pela aba ativa: alternar
  // entre as sub-visões passa a ser instantâneo (cache do Query) e é o
  // comportamento do original, cujo onProjectChange dispara loadCycleTime() e
  // loadCycleTime2() juntos. O prefixo ["jira", ...] casa o das outras queries.
  const stdQ = useQuery({
    queryKey: ["jira", "cycle-time", project, "standard"],
    queryFn: () => getJiraCycleTime({ data: { project: project ?? "", mode: "standard" } }),
    enabled: !!project,
  });

  const fullQ = useQuery({
    queryKey: ["jira", "cycle-time", project, "full"],
    queryFn: () => getJiraCycleTime({ data: { project: project ?? "", mode: "full" } }),
    enabled: !!project,
  });

  const std = useMemo(() => prepare(stdQ.data, "standard"), [stdQ.data]);
  const full = useMemo(() => prepare(fullQ.data, "full"), [fullQ.data]);

  function handleProjectChange(p: string) {
    setProject(p);
    save(LS_PROJECT, p);
  }

  function handleSubViewChange(v: string) {
    const next: CycleTimeSubView = v === "full" ? "full" : "status";
    setSubView(next);
    save(LS_VIEW, next);
  }

  async function handleRecalcular() {
    if (!project) return;
    setRecalculando(true);
    try {
      // `force` precisa chegar ao SERVIDOR: invalidateQueries sozinho só limpa
      // o cache do cliente, e o servidor devolveria o mesmo payload por até 5
      // min — o botão pareceria quebrado. Os dois modos recarregam juntos,
      // como no original.
      const [novoStd, novoFull] = await Promise.all([
        getJiraCycleTime({ data: { project, mode: "standard", force: true } }),
        getJiraCycleTime({ data: { project, mode: "full", force: true } }),
      ]);
      qc.setQueryData(["jira", "cycle-time", project, "standard"], novoStd);
      qc.setQueryData(["jira", "cycle-time", project, "full"], novoFull);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao recalcular o cycle time");
    } finally {
      setRecalculando(false);
    }
  }

  const carregando = stdQ.isFetching || fullQ.isFetching || recalculando;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Timer className="size-4" />
        </span>
        <div className="mr-auto">
          <h1 className="text-base font-semibold leading-tight">Cycle Time</h1>
          <p className="text-[11px] text-muted-foreground">
            Tempo por status, a partir do changelog do Jira
          </p>
        </div>

        <Select {...(project ? { value: project } : {})} onValueChange={handleProjectChange}>
          <SelectTrigger className="h-9 w-56">
            <SelectValue placeholder="Selecione um projeto…" />
          </SelectTrigger>
          <SelectContent>
            {(projectsQ.data ?? []).map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.key} — {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="secondary"
          onClick={handleRecalcular}
          disabled={!project || carregando}
        >
          <RefreshCw className={`size-4 ${carregando ? "animate-spin" : ""}`} /> Recalcular
        </Button>

        <Button size="sm" variant="ghost" asChild>
          <Link to="/">
            <LayoutGrid className="size-4" /> Quadro
          </Link>
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/compromisso">
            <ClipboardList className="size-4" /> Compromisso
          </Link>
        </Button>
        <ThemeToggle />
        <Button size="sm" variant="ghost" onClick={() => supabase.auth.signOut()} title={email}>
          <LogOut className="size-4" />
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        <Tabs value={subView} onValueChange={handleSubViewChange}>
          <TabsList>
            <TabsTrigger value="status">Em Andamento</TabsTrigger>
            <TabsTrigger value="full">Histórico Completo</TabsTrigger>
          </TabsList>

          <TabsContent value="status">
            <CycleTimePane
              project={project}
              isLoading={stdQ.isLoading}
              error={stdQ.error}
              issues={std.issues}
              columns={std.columns}
              mode="standard"
              title="Cycle Time da esteira de produção"
              subtitle={null}
            />
          </TabsContent>

          <TabsContent value="full">
            <CycleTimePane
              project={project}
              isLoading={fullQ.isLoading}
              error={fullQ.error}
              issues={full.issues}
              columns={full.columns}
              mode="full"
              title="Histórico Completo"
              subtitle="todos os statuses do projeto"
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
```

> Sem sidebar: a tela tem dois controles (projeto e sub-visão) e o conteúdo é a tabela mais larga da aplicação — 256px fixos de sidebar prejudicariam exatamente o que ela existe para mostrar.
> Sem search params na URL: nenhuma rota desta aplicação usa `validateSearch`/`useSearch`; a convenção estabelecida é `useState` + `localStorage`.

- [ ] **Step 3: Acrescentar o painel de cada aba ao fim do arquivo**

```tsx

function CycleTimePane({
  project,
  isLoading,
  error,
  issues,
  columns,
  mode,
  title,
  subtitle,
}: {
  project: string | null;
  isLoading: boolean;
  error: Error | null;
  issues: CycleTimeIssue[];
  columns: string[];
  mode: CycleTimeMode;
  title: string;
  subtitle: string | null;
}) {
  if (!project) {
    return <p className="py-20 text-center text-sm text-muted-foreground">Selecione um projeto.</p>;
  }
  if (error) {
    // error.message já vem traduzido pelo handler de getJiraCycleTime.
    return <p className="py-20 text-center text-sm text-destructive">{error.message}</p>;
  }
  if (isLoading) {
    return (
      <p className="py-20 text-center text-sm text-muted-foreground">Calculando cycle time…</p>
    );
  }
  const cfg = CYCLE_TIME_CONFIG[mode];
  // key={project}: trocar de projeto descarta ordenação e página da tabela em
  // vez de carregá-las para dados de outro projeto.
  return (
    <CycleTimeTable
      key={project}
      title={title}
      subtitle={subtitle}
      issues={issues}
      columns={columns}
      fmt={cfg.fmt}
      pageSize={cfg.pageSize}
    />
  );
}
```

- [ ] **Step 4: Verificar tipos e formatação**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/cycle-time/CycleTimeView.tsx
git commit -m "feat(cycle-time): add view with project selector, sub-tabs and recalculate"
```

---

## Task 10: Rota `/cycle-time`

**Files:**
- Create: `src/routes/cycle-time.tsx`
- Modify: `src/routeTree.gen.ts` (regenerado pelo plugin — não editar à mão)

**Interfaces:**
- Consumes: `useAuthorizedSession()` → `{ session, loading, canView }`; `AuthCard`; `AccessDenied`; `CycleTimeView` (Task 9).
- Produces: rota `/cycle-time` registrada em `routeTree.gen.ts`, o que habilita `<Link to="/cycle-time">` com tipagem na Task 11.

- [ ] **Step 1: Criar `src/routes/cycle-time.tsx`**

Mesma forma exata de `src/routes/compromisso.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useAuthorizedSession } from "@/hooks/use-authorized-session";
import { AuthCard } from "@/components/AuthCard";
import { AccessDenied } from "@/components/AccessDenied";
import { CycleTimeView } from "@/components/cycle-time/CycleTimeView";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/cycle-time")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cycle Time — Tempo por status no fluxo do Jira" },
      {
        name: "description",
        content:
          "Quanto tempo cada demanda passou em cada status do fluxo, calculado a partir do changelog do Jira.",
      },
    ],
  }),
  component: CycleTimePage,
});

function CycleTimePage() {
  const { session, loading, canView } = useAuthorizedSession();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!session) return <AuthCard />;

  if (!canView) {
    return (
      <AccessDenied
        title="Acesso ainda não liberado"
        description="Sua conta existe, mas nenhum papel foi atribuído. Peça acesso a um administrador da plataforma."
        action={
          <Button variant="outline" className="w-full" onClick={() => supabase.auth.signOut()}>
            Sair
          </Button>
        }
      />
    );
  }

  return <CycleTimeView email={session.user.email ?? ""} />;
}
```

- [ ] **Step 2: Regenerar o route tree**

`createFileRoute("/cycle-time")` só passa no typecheck depois que o plugin do TanStack Router escreve a entrada em `src/routeTree.gen.ts`. O plugin roda no `buildStart` do Vite:

```bash
npm run build
```

Esperado: build concluído sem erro.

- [ ] **Step 3: Confirmar que a rota entrou no route tree**

```bash
grep -n "cycle-time" src/routeTree.gen.ts | head
```

Esperado: várias linhas citando `/cycle-time` (import da rota, entrada em `FileRoutesByPath`, etc.). Se não aparecer nada, o plugin não rodou — repetir o Step 2.

- [ ] **Step 4: Verificar tipos e formatação**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sem erros.

- [ ] **Step 5: Abrir a rota e conferir**

Subir o servidor de desenvolvimento (`npm run dev`) e abrir `http://localhost:5173/cycle-time` logado como usuário com papel.

O que tem de acontecer:
1. o header aparece com o ícone de cronômetro, o seletor de projeto preenchido e as duas abas;
2. o projeto salvo em `localStorage.cycleTimeLastProject` (ou o primeiro da lista, na primeira visita) já vem selecionado;
3. "Em Andamento" mostra a matriz com colunas de status e a coluna Total colorida;
4. sem erro no console do navegador.

- [ ] **Step 6: Commit**

```bash
git add src/routes/cycle-time.tsx src/routeTree.gen.ts
git commit -m "feat(cycle-time): add /cycle-time route behind canView"
```

---

## Task 11: Links de navegação

**Files:**
- Modify: `src/components/BoardGrid.tsx:8-19` (import do lucide) e `src/components/BoardGrid.tsx:215-219` (header)
- Modify: `src/components/compromisso/CompromissoView.tsx:4` (import do lucide) e `src/components/compromisso/CompromissoView.tsx:265-267` (header)

**Interfaces:**
- Consumes: rota `/cycle-time` registrada (Task 10).
- Produces: nada em código — apenas a navegação. Padrão mantido: link no cabeçalho, sem menu global (`NavigationMenu` seria um padrão novo para três telas).

- [ ] **Step 1: Acrescentar `Timer` ao import do lucide em `BoardGrid.tsx`**

No bloco das linhas 8–19, inserir `Timer,` entre `Search,` e `UserPlus,` (a lista está em ordem alfabética):

```tsx
import {
  CalendarPlus,
  ClipboardList,
  ExternalLink,
  LayoutGrid,
  LogOut,
  Pencil,
  Plus,
  Search,
  Timer,
  UserPlus,
  Users,
} from "lucide-react";
```

- [ ] **Step 2: Acrescentar o link em `BoardGrid.tsx`**

Nas linhas 215–219 está o botão "Compromisso". Inserir o novo botão **imediatamente antes** dele, de modo que o trecho fique:

```tsx
            <Button size="sm" variant="ghost" asChild>
              <Link to="/cycle-time">
                <Timer className="size-4" /> Cycle Time
              </Link>
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/compromisso">
                <ClipboardList className="size-4" /> Compromisso
              </Link>
            </Button>
```

- [ ] **Step 3: Acrescentar `Timer` ao import do lucide em `CompromissoView.tsx`**

Trocar a linha 4:

```tsx
import { LayoutGrid, LogOut } from "lucide-react";
```

por:

```tsx
import { LayoutGrid, LogOut, Timer } from "lucide-react";
```

- [ ] **Step 4: Acrescentar o link em `CompromissoView.tsx`**

Nas linhas 265–267 está o botão "Quadro". Inserir o novo botão **imediatamente depois** dele, de modo que o trecho fique:

```tsx
          <Button size="sm" variant="ghost" asChild>
            <Link to="/">Quadro</Link>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/cycle-time">
              <Timer className="size-4" /> Cycle Time
            </Link>
          </Button>
```

- [ ] **Step 5: Verificar tipos e formatação**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sem erros. Se `Link to="/cycle-time"` acusar erro de tipo, o `routeTree.gen.ts` não foi regenerado — voltar ao Step 2 da Task 10.

- [ ] **Step 6: Conferir os três caminhos de navegação no navegador**

Com `npm run dev` no ar:
1. `/` → botão "Cycle Time" no header → abre `/cycle-time`;
2. `/compromisso` → botão "Cycle Time" no header → abre `/cycle-time`;
3. `/cycle-time` → "Quadro" volta para `/`, "Compromisso" vai para `/compromisso`.

- [ ] **Step 7: Commit**

```bash
git add src/components/BoardGrid.tsx src/components/compromisso/CompromissoView.tsx
git commit -m "feat(cycle-time): link to /cycle-time from board and compromisso headers"
```

---

## Task 12: Roteiro manual e fechamento

**Files:**
- Modify: `docs/superpowers/plans/2026-08-09-cycle-time.md` (marcar as caixas)

**Interfaces:**
- Consumes: tudo das tasks 1–11.
- Produces: nada em código. Produz a evidência de que a feature está pronta.

- [ ] **Step 1: Portões automáticos**

```bash
npm run lint && npx tsc --noEmit && npm run build
```

Esperado: os três sem erro.

- [ ] **Step 2: Papéis**

1. Logar como usuário com papel `viewer` → `/cycle-time` abre e mostra dados (é `canView`, não `canEdit`).
2. Logar como usuário **sem papel** → `AccessDenied` ("Acesso ainda não liberado").
3. Ainda sem papel, confirmar que a proteção é do servidor e não só da UI: no console do navegador, com a sessão sem papel ativa,

```js
await fetch("/_serverFn/getJiraCycleTime", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ data: { project: "PIM", mode: "standard" } }),
}).then((r) => r.status);
```

Esperado: status de erro (não `200` com payload). O nome exato da rota do RPC aparece na aba Network ao carregar `/cycle-time` com um usuário autorizado — usar o que aparecer ali. O ponto do teste é que a chamada direta falha **no servidor**.

- [ ] **Step 3: Troca de projeto**

Trocar o projeto no `<Select>` → as duas sub-visões recarregam e nada do projeto anterior permanece na tela (nem linhas, nem colunas, nem página/ordenação).

- [ ] **Step 4: "Recalcular" de verdade**

Clicar "Recalcular" duas vezes seguidas, com menos de 5 minutos entre elas. A segunda tem de trazer dados frescos — é a prova de que `force` chega ao servidor e pula o cache de 5 min. Conferir na aba Network que as duas chamadas saíram e que a segunda não voltou instantaneamente do cache do cliente.

Com o Jira momentaneamente inacessível (ou credenciais erradas no `.env`), o clique tem de produzir um `toast` de erro em pt-BR — nunca o corpo cru da resposta do Jira.

- [ ] **Step 5: Ordenação e paginação do "Histórico Completo"**

1. Abrir a aba "Histórico Completo" num projeto com mais de 100 itens → barras de paginação acima e abaixo, com o texto `Página 1 de N · itens 1–100 de T`.
2. Ordenar por uma coluna de status → a ordenação vale para os T itens (o topo muda, não só a ordem dentro da página) e volta para a página 1.
3. Ir para a última página → o botão "Próxima" desabilita.
4. Num projeto com menos de 100 itens → as barras somem.
5. A aba "Em Andamento" **não** pagina, em nenhum projeto.

- [ ] **Step 6: Persistência, tema e vazio**

1. Recarregar a página → projeto e sub-visão preservados (`cycleTimeLastProject`, `cycleTimeView`).
2. Alternar claro/escuro pelo `ThemeToggle` → verde/âmbar/vermelho das faixas legíveis nos dois temas.
3. Projeto sem itens abertos → mensagem "Nenhum item em andamento" na tabela, sem layout quebrado.
4. Passar o mouse numa célula de duração → `title` com a duração e o rótulo (`rápido`/`médio`/`lento`).

- [ ] **Step 7: Marcar o plano e commitar**

Marcar como concluídas as caixas deste arquivo e:

```bash
git add docs/superpowers/plans/2026-08-09-cycle-time.md
git commit -m "docs: mark cycle-time plan as completed"
```

---

## Encerramento

Ao fim da Task 12 o repositório tem 11 commits locais e nenhum `push` foi feito. Publicar para o Lovable é decisão do usuário:

```bash
git push origin main
```

**Follow-up fora do escopo deste plano, mas que é a razão dele existir:** com o Cycle Time portado, o `jira-live` não tem mais nenhuma aba sem equivalente aqui. Desligar o serviço Windows da porta 8000 (e com ele a segunda cópia das credenciais do Jira, sem autenticação nenhuma) é uma decisão operacional do usuário — não uma etapa de implementação. Fazer isso **depois** da Task 12, nunca antes: a Task 6 depende do original estar de pé.

**Registrado, não corrigido nesta rodada:**

- as quatro server functions existentes (`getJiraProjects`, `getJiraSprints`, `getJiraSprint`, `getJiraIssues`) não traduzem `JiraError` e vazam o corpo cru da resposta do Jira para a UI. É defeito preexistente; corrigi-las aqui ampliaria o escopo do port;
- o Jira devolve inline apenas as entradas mais recentes do changelog, então uma issue com histórico muito longo pode não mostrar os primeiros status. O original tem o mesmo comportamento.
