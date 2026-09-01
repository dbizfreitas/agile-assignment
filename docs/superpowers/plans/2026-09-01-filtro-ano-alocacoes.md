# Filtro de Ano no Board de Alocações — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um dropdown de ano na toolbar do board de Alocações restringe as sprints exibidas (e, por consequência, as alocações delas) às que caem no ano escolhido, sem tocar em `quarter` nem introduzir agrupamento visual.

**Architecture:** Uma função pura nova em `src/lib/board.ts` (`getSprintYear`) extrai o ano de `start_date` por fatiamento de string. `BoardGrid` guarda o ano escolhido em `useState` (default: ano corrente do relógio), calcula a lista de anos disponíveis e a lista de sprints filtradas com `useMemo`, e troca `sprints` por essa lista filtrada só nos dois pontos que desenham a grade (`gridTemplateRows` e o `.map(SprintRow)`). Nenhuma query muda — sprints e allocations continuam vindo inteiros do Supabase, como hoje; o filtro atua inteiramente sobre o array já carregado no cliente, no mesmo padrão dos filtros de busca/status/tipo que já existem no componente.

**Tech Stack:** TanStack Start + React 19, TanStack Query v5, shadcn/ui (Radix Select), Tailwind v4, TypeScript 5.8 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Node 24 (para a verificação da Task 1).

**Spec:** [`docs/superpowers/specs/2026-09-01-filtro-ano-alocacoes-design.md`](../specs/2026-09-01-filtro-ano-alocacoes-design.md)

**Issue:** [#35 — Board de Alocações: agrupar sprints por ano e quarter (Q1–Q4)](https://github.com/dbizfreitas/agile-assignment/issues/35)

## Global Constraints

- **Idioma da UI:** pt-BR em todo texto visível, com acentuação correta.
- **Ano da sprint = ano do `start_date`, sempre.** Sem regra de "mais dias sobrepostos" para sprint que atravessa a virada — decisão explícita da spec.
- **`quarter` não muda.** Continua texto livre, editável em `SprintDialog`, exibido como badge por linha exatamente como hoje. Este plano **não toca** em `src/components/SprintDialog.tsx`.
- **Sem agrupamento visual por ano/quarter.** Isto diverge do texto literal da issue #35 (que pedia seções agrupadas) — divergência já registrada na spec e que precisa virar comentário na issue antes de fechá-la (Task 3).
- **Lista de anos do dropdown:** anos distintos entre as sprints do projeto **+ o ano corrente do relógio**, sempre incluído mesmo vazio.
- **Ano padrão ao abrir:** o ano corrente do relógio (`new Date().getFullYear()`), não o da sprint mais próxima.
- **O dropdown de ano é visível independente de `canEdit`.** Filtrar por ano é ação de visualização, não de edição.
- **Sem persistência do ano escolhido** (nem URL, nem `localStorage`). Reseta para o ano corrente a cada carregamento, igual aos filtros de busca/status/tipo já existentes.
- **Nenhuma query muda.** `sprintsQ` e `allocQ` continuam carregando tudo do projeto; o filtro é só sobre o array em memória.
- **Sem test runner.** `package.json` só traz `dev`, `build`, `build:dev`, `preview`, `lint`, `format`, e esta demanda não introduz um (decisão da spec). A verificação é: script descartável rodado com `node --experimental-strip-types` para a função pura, `tsc`/`eslint`/`build` para o resto, e roteiro manual para a UI.
- **Não fazer `git push`.** O repositório sincroniza com o Lovable; o push é decisão do usuário ao final (Task 3).
- **Nunca reescrever histórico** (sem `rebase`, `amend` ou `squash` de commits publicados) — restrição do `AGENTS.md`.
- **`git add` sempre por caminho explícito, nunca `git add -A` nem `git add .`** — o working tree já tem `src/components/compromisso/StatsCards.tsx` modificado por outra frente, e não deve entrar em nenhum commit deste plano.

### Verificação de código: sempre nesta ordem

```bash
npx prettier --write <arquivos tocados>
npx eslint <arquivos tocados>
npx tsc --noEmit
```

**Nunca rodar `npm run lint` sem escopo.** O checkout tem `core.autocrlf=true`, então todo arquivo do repositório chega com CRLF e a regra `prettier/prettier` reprova centenas de linhas em arquivos que a task não tocou. É ruído pré-existente, não é desta demanda. `npx prettier --write` nos arquivos tocados normaliza para LF e resolve; como o git normaliza CRLF↔LF na comparação, isso **não** gera diff espúrio.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/lib/board.ts` | **Modificar.** Nova função pura `getSprintYear`. | 1 |
| `src/components/BoardGrid.tsx` | **Modificar.** Estado do filtro de ano, `useMemo` de anos disponíveis e de sprints filtradas, dropdown na toolbar, mensagem de "ano sem sprint", grid desenhado a partir da lista filtrada. | 2 |

---

## Task 1: `getSprintYear` como função pura

**Files:**
- Modify: `src/lib/board.ts:148-151` (logo após `formatRange`)
- Temp: `verificacao-ano-sprint.ts` na raiz do repo — **criado e apagado dentro desta task, nunca commitado**

**Interfaces:**
- Consumes: o tipo `Sprint` já existente (`src/lib/board.ts:36-45`), especificamente o campo `start_date: string`.
- Produces: `getSprintYear(sprint: Pick<Sprint, "start_date">): number`. A Task 2 usa essa função com esse nome e assinatura exatos.

**Por que a verificação é um script descartável:** o projeto não tem test runner e a spec decidiu não introduzir um. `src/lib/board.ts` tem uma única importação e ela é `import type` (`import type { JiraProjectKey } from "@/lib/projects";`), que o type-stripping do Node 24 remove por completo — o Node consegue importar o módulo direto, sem bundler, sem resolver o alias `@/`. Isso dá um ciclo vermelho/verde de verdade com zero dependência nova. O script é apagado no Step 5, antes do commit.

- [ ] **Step 1: Escrever o script de verificação (deve falhar)**

Criar `verificacao-ano-sprint.ts` na **raiz do repositório**:

```ts
import assert from "node:assert/strict";
import { getSprintYear } from "./src/lib/board.ts";

// Sprint comum, contida num único ano.
assert.equal(getSprintYear({ start_date: "2026-08-01" }), 2026);

// Início perto do fim do ano: o ano é sempre o do início, mesmo que a sprint
// termine no ano seguinte (isso é decidido só pelo `start_date`, o `end_date`
// nem entra na conta).
assert.equal(getSprintYear({ start_date: "2026-12-20" }), 2026);

// Início em 1º de janeiro: nenhuma superfície especial na virada.
assert.equal(getSprintYear({ start_date: "2027-01-01" }), 2027);

// Ano arbitrário de quatro dígitos, para garantir que não há hardcode de década.
assert.equal(getSprintYear({ start_date: "2031-06-15" }), 2031);

console.log("OK — 4 asserções de getSprintYear passaram");
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --experimental-strip-types verificacao-ano-sprint.ts
```

Esperado: erro de importação — `SyntaxError: The requested module './src/lib/board.ts' does not provide an export named 'getSprintYear'`.

- [ ] **Step 3: Implementar em `src/lib/board.ts`**

Localizar o `formatRange` atual (linhas 148-151):

```ts
export function formatRange(start: string, end: string) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}
```

Inserir a função nova **logo depois**, antes do comentário de `isDevAvailableInSprint`:

```ts
export function formatRange(start: string, end: string) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/**
 * Ano da sprint = ano do início, por fatiamento de string — mesmo cuidado de
 * `formatDate`: `new Date("2026-08-15")` é meia-noite UTC e pode virar o dia
 * (e, na virada do ano, o próprio ano) anterior em fusos negativos.
 */
export function getSprintYear(sprint: Pick<Sprint, "start_date">): number {
  return Number(sprint.start_date.slice(0, 4));
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --experimental-strip-types verificacao-ano-sprint.ts
```

Esperado: `OK — 4 asserções de getSprintYear passaram`.

- [ ] **Step 5: Apagar o script descartável**

```bash
rm verificacao-ano-sprint.ts
```

Confirmar que sumiu:

```bash
git status --short
```

Esperado: `verificacao-ano-sprint.ts` **não** aparece na saída, e `src/lib/board.ts` aparece modificado.

- [ ] **Step 6: Verificar formatação e tipos**

```bash
npx prettier --write src/lib/board.ts
npx eslint src/lib/board.ts
npx tsc --noEmit
```

Esperado: `eslint` sem saída; `tsc` sem erro.

- [ ] **Step 7: Commit**

```bash
git add src/lib/board.ts
git commit -m "feat(alocacoes): getSprintYear deriva o ano da sprint do start_date (#35)"
```

---

## Task 2: Filtro de ano no `BoardGrid`

**Files:**
- Modify: `src/components/BoardGrid.tsx` — imports (linhas 1-35), estado (linha 66), dados derivados (após linha 152), toolbar (linhas 215-239), render condicional (linhas 281-386), componente novo `EmptyYearState` (após `EmptyState`, linha 663)

**Interfaces:**
- Consumes: `getSprintYear` (Task 1).
- Produces: nada que outra task consuma — é a ponta visual.

- [ ] **Step 1: Importar `getSprintYear` e o `Select`**

No import de `@/lib/board` (linhas 8-27), acrescentar `getSprintYear` mantendo a ordem alfabética (entre `formatRange` e `isDevAvailableInSprint`):

```ts
import {
  accentClassFor,
  chipClassFor,
  formatAvailability,
  formatRange,
  getSprintYear,
  isDevAvailableInSprint,
  sanitizeTickets,
  statusInfo,
  tipoInfo,
  washClassFor,
  STATUS_LIST,
  TIPO_LIST,
  type Allocation,
  type AllocationStatus,
  type AllocationTicket,
  type AllocationTipo,
  type Dev,
  type Sprint,
  type Team,
} from "@/lib/board";
```

Logo depois do `import { Input } from "@/components/ui/input";` (linha 5), acrescentar:

```ts
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

- [ ] **Step 2: Rodar e confirmar que ainda compila (sanidade antes de mexer em estado)**

```bash
npx tsc --noEmit
```

Esperado: nenhum erro novo (os dois imports ainda não são usados — `noUnusedLocals` não está ligado neste `tsconfig`, então isso não quebra; se quebrar, é sinal de que o import foi digitado errado).

- [ ] **Step 3: Estado do filtro de ano**

Depois de `const [dragOver, setDragOver] = useState<string | null>(null);` (linha 66):

```ts
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Ano corrente do relógio, não o da sprint mais próxima — decisão da spec.
  // Filtro local, sem persistência: reseta a cada carregamento, igual aos
  // filtros de busca/status/tipo já existentes neste componente.
  const [yearFilter, setYearFilter] = useState<number>(() => new Date().getFullYear());
```

- [ ] **Step 4: Anos disponíveis e sprints filtradas**

Depois de `const sprints = sprintsQ.data ?? [];` (linha 152):

```ts
  const sprints = sprintsQ.data ?? [];

  // Anos com pelo menos uma sprint, mais o ano corrente sempre presente — sem
  // isso, o valor padrão do dropdown (ano corrente) poderia não ter opção
  // correspondente na lista se nenhuma sprint cair nele.
  const years = useMemo(() => {
    const set = new Set(sprints.map(getSprintYear));
    set.add(new Date().getFullYear());
    return Array.from(set).sort((a, b) => a - b);
  }, [sprints]);

  const sprintsInYear = useMemo(
    () => sprints.filter((s) => getSprintYear(s) === yearFilter),
    [sprints, yearFilter],
  );
```

- [ ] **Step 5: Dropdown na toolbar**

Localizar o fim do bloco condicional de botões de edição (linhas 215-239):

```tsx
            {canEdit ? (
              <>
                {/* Times primeiro: … */}
                <Button size="sm" variant="secondary" onClick={() => setTeamsDialog(true)}>
                  <Users className="size-4" /> Times
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSprintDialog({ open: true, sprint: null })}
                >
                  <CalendarPlus className="size-4" /> Sprint
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDevDialog({ open: true, dev: null })}
                >
                  <UserPlus className="size-4" /> Pessoa
                </Button>
              </>
            ) : null}
          </div>
```

Acrescentar o `Select` **depois** do `{canEdit ? (…) : null}`, ainda dentro da mesma `<div>` da toolbar, para renderizar independente de `canEdit`:

```tsx
            {canEdit ? (
              <>
                {/* Times primeiro: … */}
                <Button size="sm" variant="secondary" onClick={() => setTeamsDialog(true)}>
                  <Users className="size-4" /> Times
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSprintDialog({ open: true, sprint: null })}
                >
                  <CalendarPlus className="size-4" /> Sprint
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDevDialog({ open: true, dev: null })}
                >
                  <UserPlus className="size-4" /> Pessoa
                </Button>
              </>
            ) : null}

            {/* Fora do bloco `canEdit`: filtrar por ano é ação de
                visualização, não de edição, e vale para leitor e editor. */}
            <Select value={String(yearFilter)} onValueChange={(v) => setYearFilter(Number(v))}>
              <SelectTrigger className="h-9 w-24" aria-label="Ano">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
```

- [ ] **Step 6: Componente `EmptyYearState`**

Depois da função `EmptyState` inteira (termina na linha 663, logo antes do `}` final do arquivo), acrescentar:

```tsx
/** Projeto tem sprint/pessoa cadastrada, só não nenhuma sprint no ano filtrado. */
function EmptyYearState({
  year,
  canEdit,
  onAddSprint,
}: {
  year: number;
  canEdit: boolean;
  onAddSprint: () => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed border-grid-line bg-surface p-10 text-center">
      <h2 className="text-lg font-semibold">Nenhuma sprint cadastrada em {year}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Troque o ano no filtro acima ou cadastre uma sprint com datas dentro de {year}.
      </p>
      {canEdit ? (
        <div className="mt-6 flex justify-center">
          <Button onClick={onAddSprint}>
            <CalendarPlus className="size-4" /> Adicionar sprint
          </Button>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: Usar `sprintsInYear` no render e acrescentar o ramo de ano vazio**

Localizar o bloco `<main>` (linhas 281-386):

```tsx
        <main className="min-h-0 flex-1 p-4">
          {loading ? (
            <p className="py-20 text-center text-sm text-muted-foreground">Carregando alocações…</p>
          ) : sprints.length === 0 || devs.length === 0 ? (
            canEdit ? (
              <EmptyState
                project={project}
                hasDevs={devs.length > 0}
                onAddSprint={() => setSprintDialog({ open: true, sprint: null })}
                onAddDev={() => setDevDialog({ open: true, dev: null })}
              />
            ) : (
              <p className="py-20 text-center text-sm text-muted-foreground">
                As alocações do {project} ainda não foram montadas.
              </p>
            )
          ) : (
            <div className="h-full w-full overflow-x-hidden overflow-y-auto rounded-xl border border-grid-line bg-surface shadow-card board-scroll">
              <div
                className="grid w-full"
                style={{
                  gridTemplateColumns: `minmax(0, 1fr) repeat(${devs.length}, minmax(0, 1fr))`,
                  gridTemplateRows: [
                    "auto",
                    ...sprints.map((s) =>
                      sprintsWithCards.has(s.id) ? "minmax(104px, auto)" : "auto",
                    ),
                  ].join(" "),
                }}
              >
```

Substituir por (dois pontos mudam: um novo `else if` para `sprintsInYear.length === 0`, e `sprints` → `sprintsInYear` dentro do `gridTemplateRows`):

```tsx
        <main className="min-h-0 flex-1 p-4">
          {loading ? (
            <p className="py-20 text-center text-sm text-muted-foreground">Carregando alocações…</p>
          ) : sprints.length === 0 || devs.length === 0 ? (
            canEdit ? (
              <EmptyState
                project={project}
                hasDevs={devs.length > 0}
                onAddSprint={() => setSprintDialog({ open: true, sprint: null })}
                onAddDev={() => setDevDialog({ open: true, dev: null })}
              />
            ) : (
              <p className="py-20 text-center text-sm text-muted-foreground">
                As alocações do {project} ainda não foram montadas.
              </p>
            )
          ) : sprintsInYear.length === 0 ? (
            <EmptyYearState
              year={yearFilter}
              canEdit={canEdit}
              onAddSprint={() => setSprintDialog({ open: true, sprint: null })}
            />
          ) : (
            <div className="h-full w-full overflow-x-hidden overflow-y-auto rounded-xl border border-grid-line bg-surface shadow-card board-scroll">
              <div
                className="grid w-full"
                style={{
                  gridTemplateColumns: `minmax(0, 1fr) repeat(${devs.length}, minmax(0, 1fr))`,
                  gridTemplateRows: [
                    "auto",
                    ...sprintsInYear.map((s) =>
                      sprintsWithCards.has(s.id) ? "minmax(104px, auto)" : "auto",
                    ),
                  ].join(" "),
                }}
              >
```

- [ ] **Step 8: Trocar `sprints` por `sprintsInYear` no `.map(SprintRow)`**

Localizar (linha 355):

```tsx
                {sprints.map((s) => (
                  <SprintRow
```

Substituir por:

```tsx
                {sprintsInYear.map((s) => (
                  <SprintRow
```

O resto das props de `SprintRow` não muda.

- [ ] **Step 9: Verificar formatação e tipos**

```bash
npx prettier --write src/components/BoardGrid.tsx
npx eslint src/components/BoardGrid.tsx
npx tsc --noEmit
```

Esperado: `eslint` sem saída; `tsc` sem erro.

- [ ] **Step 10: Verificar no navegador**

```bash
npm run dev
```

Abrir `/alocacoes` e confirmar:

1. O dropdown de ano aparece na toolbar, à direita de onde ficam os botões de ação, com o ano corrente selecionado.
2. Trocando o ano para um que tenha sprint cadastrada: a grade troca para as sprints daquele ano; as alocações continuam nas células certas.
3. Trocando para um ano sem nenhuma sprint (ex.: um ano futuro distante): aparece "Nenhuma sprint cadastrada em {ano}" com o botão "Adicionar sprint" (se `canEdit`).
4. O badge de `quarter` na linha da sprint continua idêntico a antes.
5. Papel leitor (`canEdit === false`, testável abrindo com outro usuário ou temporariamente forçando a prop): dropdown aparece e funciona igual, sem os botões "Times"/"Sprint"/"Pessoa" nem o botão "Adicionar sprint" na mensagem de ano vazio.

- [ ] **Step 11: Commit**

```bash
git add src/components/BoardGrid.tsx
git commit -m "feat(alocacoes): filtro de ano no board, com mensagem para ano vazio (#35)"
```

---

## Task 3: Verificação de ponta a ponta

**Files:** nenhum arquivo novo. Esta task é o portão final antes de considerar a issue #35 pronta.

**Interfaces:**
- Consumes: tudo das Tasks 1-2.
- Produces: o build verde e o roteiro manual da spec percorrido.

- [ ] **Step 1: Build de produção**

```bash
npm run build
```

Esperado: build concluído sem erro. Se o TanStack Router regravar `src/routeTree.gen.ts`, **não commitar** — o arquivo não é desta frente.

- [ ] **Step 2: Roteiro manual completo, em `/alocacoes`**

```bash
npm run dev
```

Percorrer os sete casos da spec:

1. Abrir o board: dropdown mostra o ano corrente selecionado; sprints exibidas são só as desse ano.
2. Trocar de ano no dropdown: a grade troca para as sprints daquele ano; as alocações de cada sprint continuam corretas nas células (nenhuma "some" nem aparece na sprint errada).
3. Ano sem nenhuma sprint: mensagem "Nenhuma sprint cadastrada em {ano}" no lugar da grade, com botão "Adicionar sprint" quando `canEdit`; sem esse botão para papel leitor.
4. Projeto sem nenhuma sprint/pessoa em lugar nenhum: `EmptyState` geral continua aparecendo como hoje, não a mensagem de "ano sem sprint".
5. Sprint com `start_date` em um ano e `end_date` no ano seguinte: aparece no ano do `start_date`, não no do `end_date`. Criar uma sprint de teste com datas `2026-12-28` a `2027-01-10` e confirmar que ela só aparece filtrando por 2026.
6. Badge de `quarter` e campo do `SprintDialog`: idênticos ao comportamento atual, sem nenhuma mudança visual ou de validação.
7. Papel leitor (`canEdit === false`): dropdown de ano aparece e funciona igual, sem os botões de edição ao lado.

- [ ] **Step 3: Repetir os casos 1, 2 e 3 na rota de embed**

Abrir `http://localhost:3000/embed/alocacoes?project=PIM` (ou o projeto configurado) e confirmar o mesmo comportamento. É o mesmo componente `BoardGrid`, então a expectativa é comportamento idêntico — a checagem existe para pegar regressão de layout na versão sem casca.

- [ ] **Step 4: Confirmar que nada indesejado entrou no diff**

```bash
git status --short
git log --oneline -3
```

Esperado em `git status`: no máximo `M src/components/compromisso/StatsCards.tsx` (pré-existente, não desta frente) e possivelmente `M src/routeTree.gen.ts` (regenerado pelo build). Nenhum `verificacao-ano-sprint.ts`.

Esperado em `git log`: os dois commits das Tasks 1-2 no topo.

- [ ] **Step 5: Registrar a divergência de escopo na issue #35**

O combinado é mais enxuto do que o texto original da issue: só filtro de ano, sem seções agrupadas por ano/quarter, sem regra para sprint na virada de quarter. Isso precisa ficar registrado para quem abriu a demanda.

**Perguntar ao usuário antes de postar** — comentar numa issue é ação visível para terceiros e não está pré-autorizada. Texto sugerido, sujeito à aprovação dele:

> Implementado com escopo reduzido em relação ao texto original: um dropdown de ano no board de Alocações filtra as sprints exibidas por ano (derivado do `start_date`), mas não há agrupamento visual por quarter dentro do ano, nem regra especial para sprint que atravessa virada de quarter/ano — o `quarter` continua exatamente como hoje (texto livre, badge por linha, editável no cadastro da sprint). Se o agrupamento por quarter ainda for necessário, é uma frente separada, ver [spec](../../docs/superpowers/specs/2026-09-01-filtro-ano-alocacoes-design.md) para o racional completo.

- [ ] **Step 6: Decidir sobre o `git push`**

O repositório sincroniza com o Lovable. **Não fazer `push` por conta própria** — perguntar ao usuário se ele quer publicar agora ou revisar antes.

---

## Fora deste plano

- **Agrupamento visual por ano → quarter (o pedido literal da issue #35).** Escopo reduzido para o filtro de ano a pedido do usuário durante o brainstorming — ver "Alternativas descartadas" na spec.
- **Regra para sprint que atravessa virada de quarter.** Sem objeto: não há agrupamento por quarter nesta frente.
- **Mudança na coluna `quarter` ou no `SprintDialog`.** Continua texto livre, editável, sem derivação automática.
- **Persistir o ano escolhido na URL.** Cogitado e descartado explicitamente na spec (Proposta B) — se a necessidade de link/embed fixo por ano aparecer, a migração de `useState` para `validateSearch` é direta.
