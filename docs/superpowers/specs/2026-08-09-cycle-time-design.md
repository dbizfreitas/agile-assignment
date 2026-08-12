# Cycle Time — tempo por status a partir do changelog do Jira

**Data:** 2026-08-09
**Status:** aprovado para planejamento

## Problema

O `jira-live` (Node + Hono + JS vanilla, em descontinuação) tem uma aba **Cycle
Time** que responde a uma pergunta que nenhuma tela desta aplicação responde:
*quanto tempo cada demanda passou em cada status do fluxo*. O cálculo sai do
`changelog` do Jira — mede o intervalo entre transições de status e monta uma
matriz *issue × status*, com o total por linha.

Essa é a última feature do `jira-live` sem equivalente aqui. Board de alocação
(`BoardGrid`/`AllocationDialog`), Compromisso (`/compromisso`) e admin/RBAC
(`/admin`) já foram portados. Enquanto o Cycle Time não vier, o serviço Windows
do `jira-live` na porta 8000 precisa continuar de pé por causa de uma aba só —
com uma segunda cópia das credenciais do Jira, um segundo host para manter e
nenhuma das garantias que o RBAC trouxe: o `jira-live` não tem autenticação
alguma, quem alcança a porta 8000 lê tudo.

## Objetivo

Trazer o Cycle Time para esta aplicação preservando o cálculo e as duas
sub-visões do original, reaproveitando a infraestrutura de Jira que já existe em
`src/integrations/jira/` e sujeitando a página ao mesmo controle de acesso do
board — para que o `jira-live` possa ser desligado.

## Escopo

**Dentro:** rota `/cycle-time`, server function de cálculo, duas sub-visões
("Em Andamento" e "Histórico Completo"), tabela ordenável, paginação no
histórico, seleção de projeto, botão de recálculo que realmente ignora o cache
do servidor.

**Fora (decidido explicitamente):**

| Item                              | Por quê                                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modo `extended`                   | É código morto no original — ver *Achados de leitura do original*, item 1.                                                                                                                                |
| Exportar HTML                     | Nenhuma tela desta aplicação exporta nada, e `_exportCycleTimeHTMLBase` gera HTML com cores fixas (`#f8fafc`, `#0f172a`) que ignoram o tema claro/escuro daqui. Se for requisito, vira uma rodada própria. |
| Histórico/tendência de cycle time | Exigiria persistência e captura periódica. É outra feature, não o port desta — ver *Persistência*.                                                                                                        |
| Auto-refresh periódico            | O original não tem: recarrega só na troca de projeto e no "Recalcular". Não inventar comportamento novo num port.                                                                                          |

## Princípios

1. **Port, não redesenho.** Divergência do original só quando há motivo escrito
   aqui. Todo comentário de correção do `jira-live` (ordenação por instante,
   acúmulo em segundos, `ORDER BY created ASC`) é regra ganha em produção e vai
   junto.
2. **Reusar a camada de Jira como está.** `client.server.ts`,
   `concurrency-gate.server.ts` e `config.server.ts` não mudam. Só `cache.server.ts`
   ganha uma função — e por um motivo específico (ver *Cache e coalescência*).
3. **Autorização no servidor.** A server function checa papel; o gating de UI é
   conveniência.
4. **Changelog não cruza a fronteira.** O dado cru do Jira é reduzido no servidor,
   igual `computeDoneAt` em `issues.server.ts`. O cliente recebe só o contrato.
5. **Sem banco.** Ver *Persistência*.

---

## Achados de leitura do original

Três coisas que a leitura do código contradiz e que mudam o escopo:

1. **O modo `extended` nunca é chamado.** `server/routes/cycle-time.ts` aceita
   `standard`, `extended` e `full`, e `static/api.js` repassa o parâmetro. Mas
   `static/app.js` só produz dois chamadores: `loadCycleTime()` usa
   `mode: "standard"` (sub-visão "Em Andamento") e `loadCycleTime2()` usa
   `mode: "full"` (sub-visão "Histórico Completo"). `extended` não tem chamador
   em lugar nenhum. **Portamos dois modos.**
2. **A paginação do original é só do "Histórico Completo".** `cycleTimeState`
   não tem `page`/`pageSize`; `cycleTimeFullState` tem, com `pageSize: 100`. A
   sub-visão "Em Andamento" renderiza tudo — e cabe, porque o modo `standard`
   corta em 200 itens no servidor.
3. **O corte de 200 itens só vale fora do modo full.** `fetchCycleTimeIssues`
   quebra o laço em `out.length >= 200` apenas quando `fullLoad` é falso. Por
   isso a ordenação é `ORDER BY created ASC`: o corte precisa sobrar para os
   itens **mais antigos ainda abertos**, que são exatamente os que a tela existe
   para destacar. Inverter para `updated DESC` descartaria os itens parados.

---

## Navegação e rota

Rota nova `src/routes/cycle-time.tsx`, irmã de `index.tsx` e `compromisso.tsx`.
Mesma forma das duas: `ssr: false`, `head()` com `title`/`description` em
pt-BR, e o preâmbulo de autorização idêntico:

```tsx
const { session, loading, canView } = useAuthorizedSession();
if (loading) return <p>Carregando...</p>;
if (!session) return <AuthCard />;
if (!canView) return <AccessDenied title="Acesso ainda não liberado" ... />;
return <CycleTimeView email={session.user.email ?? ""} />;
```

`src/routeTree.gen.ts` é **gerado** pelo plugin do TanStack Router — o arquivo
novo faz a entrada aparecer sozinha. Não editar à mão.

### Como se navega até lá

O padrão atual é link no cabeçalho, sem menu global: `BoardGrid` tem
`<Link to="/compromisso">` e `<Link to="/admin">` (este só para admin);
`CompromissoView` tem `<Link to="/">Quadro</Link>`; `admin.tsx` tem
`<Link to="/">Voltar ao quadro</Link>`. Replicamos:

| Tela            | Ganha                                                          |
| --------------- | -------------------------------------------------------------- |
| `BoardGrid`     | `<Link to="/cycle-time">` com ícone `Timer` (lucide), ao lado de "Compromisso" |
| `CompromissoView` | mesmo link, ao lado de "Quadro"                                |
| `/cycle-time`   | links "Quadro" e "Compromisso", `ThemeToggle` e botão de sair — igual ao header do Compromisso |

Nada de `NavigationMenu` ou barra global: seriam um padrão novo para três telas.

---

## Backend

### `src/integrations/jira/cycle-time.server.ts` (novo)

Port de `server/routes/cycle-time.ts`, menos o roteamento Hono. Exporta uma
função só: `fetchCycleTime(project: string, mode: CycleTimeMode, force: boolean)`.

**Conjuntos de exclusão.** Mantidos como no original, incluindo a decomposição
em bases compartilhadas — acrescentar um status terminal continua sendo editar
um array só:

```ts
const DONE_REJECTED = ["concluído", "concluido", "done", "rejeitada", ...];
const PRE_WORKFLOW  = ["to do", "todo", "backlog", "ready to specify", ...];

const EXCLUDE_FULL     = new Set([...DONE_REJECTED, "cancelled"]);
const EXCLUDE_STANDARD = new Set([...DONE_REJECTED, ...PRE_WORKFLOW,
  "tarefas pendentes", "tarefas_pendentes", "ready to dev", "em análise", "em analise"]);
```

Os literais de JQL correspondentes (`JQL_EXCLUDE_STANDARD`, `JQL_EXCLUDE_FULL`)
vão junto. Eles **não** são derivados dos Sets: o JQL precisa dos nomes com
acento e capitalização originais, o Set precisa de minúsculas normalizadas.
Derivar um do outro exigiria uma tabela de tradução que é justamente o que os
dois literais já são.

**Busca.** `/rest/api/3/search/jql` com `expand=changelog`,
`fields=summary,status,issuetype,assignee,created,fixVersions`, `maxResults=100`,
paginado por `nextPageToken`. Duas regras preservadas do original:

- `ORDER BY created ASC` (motivo no *Achado* 3);
- **só a ausência de `nextPageToken` encerra o laço** — uma página menor que
  `maxResults` ainda pode ter continuação sob carga. Mesma causa já documentada
  em `issues.server.ts`/`computePageStarts`.

Uma divergência deliberada: o laço do original é `while (true)`. Aqui ganha teto
de páginas com log de erro ao estourar, igual `MAX_PAGES` em `projects.server.ts`
e `sprints.server.ts`. É o padrão desta base e o modo `full` é o único caminho
sem o corte de 200 itens.

**Status do projeto.** `/rest/api/3/project/{key}/statuses` alimenta a ordem das
colunas. Falha ali devolve `[]` e não derruba a resposta — a ordem das colunas
degrada para "ordem de aparição nas issues", que é o fallback que
`buildStatusOrder` já faz.

**Cálculo.** Port literal de `buildCtPayload`, com todas as travas:

- transições ordenadas por **instante** (`new Date(x).getTime()`), nunca pela
  string ISO — o Jira varia casas decimais e offset entre entradas;
- tempo acumulado em **segundos**, convertido e arredondado para dias uma única
  vez no fim (arredondar por transição somava erro em issues com idas e vindas);
- issue sem nenhuma transição de status → todo o tempo desde `created` no status
  atual;
- `now` capturado uma vez por payload, não por issue;
- `try/catch` por issue: campo inesperado numa issue vira `console.error` e a
  issue é pulada, nunca um erro de resposta inteira (mesma postura de
  `fetchIssuesForSprint`);
- filtro defensivo de `fields.status.name` ausente antes do map.

**Limitação herdada:** o Jira devolve inline apenas as entradas mais recentes do
changelog. Para uma issue com histórico muito longo, os primeiros status podem
não aparecer. O original tem o mesmo comportamento — registrado aqui como
limitação conhecida, não como regressão a corrigir nesta rodada.

### Filtro de projeto permitido

Não existe `ALLOWED_PROJECTS` novo. Reusamos o de `src/integrations/jira/config.server.ts`
(`PIM`, `PH`, `INTFLOW`, `PDC`), que é o mesmo mecanismo por trás de
`fetchAllowedProjects` e `fetchSprintsForProject`:

```ts
if (!ALLOWED_PROJECTS.has(project.toUpperCase())) {
  throw new Error("projeto inválido ou não permitido");
}
```

Mesma mensagem já usada em `fetchSprintsForProject` — uma string, um significado.

Essa validação **não é redundante** com o `<Select>` do cliente: `project` entra
por interpolação de string no JQL (`project = "${project}"`). Sem a checagem, um
cliente forjado injeta JQL arbitrário e lê projetos fora da lista. É controle de
segurança, não conveniência.

O cliente popula o seletor com `getJiraProjects()`, que já devolve só os quatro.

### Cache e coalescência

`getCache`/`setCache` de `cache.server.ts` são usados como estão, com o TTL
padrão de 5 min e chaves `ct:std:<PROJECT>` / `ct:full:<PROJECT>`.
`withConcurrencyGate` também entra sem alteração, envolvendo o par
`Promise.all([statuses, issues])` — igual ao original.

**Ajuste necessário:** `withCacheCoalescing` existe em `jira-live/server/cache.ts`
mas **não foi portado** para `src/integrations/jira/cache.server.ts` (que só tem
`getCache`/`setCache`). Esta demanda porta as ~12 linhas que faltam, sem tocar no
resto do arquivo.

Por quê: o modo `full` é o fan-out mais caro da aplicação inteira — changelog de
todas as issues abertas de um projeto, sem o corte de 200. Duas abas do
`/cycle-time` abertas, ou um "Recalcular" coincidindo com uma segunda sessão,
disparam dois fan-outs completos para o mesmo resultado. `withConcurrencyGate`
limita o dano a quatro simultâneos, não evita o desperdício.

A dedupe do TanStack Query não resolve: ela vale por instância de `QueryClient`,
isto é, por aba. A coalescência aqui é do lado do servidor, entre sessões.

Vale registrar o que já está escrito em `cache.server.ts`: o cache é por isolate
do processo, então em runtime serverless o hit-rate não é garantido. Ele nunca é
fonte de verdade — só reduz chamadas ao Jira quando o isolate está quente.

### `force` — o botão "Recalcular"

O original passa `force=true` na query string para pular o `getCache`. Aqui o
`force` entra no payload da server function e faz a mesma coisa: pula a leitura
do cache, mas **continua dentro da coalescência** — dois "Recalcular"
simultâneos não viram dois fan-outs.

Isso é necessário porque `queryClient.invalidateQueries` sozinho só limpa o cache
do cliente: sem `force`, o servidor devolveria o mesmo payload por até 5 min e o
botão pareceria quebrado.

### `src/integrations/jira/server-fns.ts` (alterado)

Mesma forma exata das quatro server functions existentes — middleware de auth,
checagem de papel, import dinâmico do módulo `.server`:

```ts
export const getJiraCycleTime = createServerFn({ method: "GET" })
  .validator((data: { project: string; mode: CycleTimeMode; force?: boolean }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<CycleTimeResponse> => {
    const { assertCanViewBoard } = await import("./access.server");
    await assertCanViewBoard(context.supabase, context.userId);
    const { fetchCycleTime } = await import("./cycle-time.server");
    return fetchCycleTime(data.project, data.mode, data.force ?? false);
  });
```

O import dinâmico não é estilo: `server-fns.ts` é importado por componentes
React, e `*.server.ts` só pode ser importado estaticamente por outro
`*.server.ts` — a convenção já está escrita no topo do arquivo.

### Autorização: `canView`

A página exige `canView` — o mesmo do board e do Compromisso, não `canEdit`.

Justificativa: a tela é leitura pura de dados do Jira que um `viewer` já enxerga
em `/` e `/compromisso`; exigir `canEdit` esconderia informação sem proteger nada
novo. E o modelo de RBAC já decidiu que "sem papel" não vê uma linha sequer.

O que efetivamente protege é `assertCanViewBoard(context.supabase, context.userId)`
dentro do handler, que consulta `user_roles` com o client **do próprio usuário**
(sob RLS). O `if (!canView)` na rota é conveniência visual — um cliente forjado
bate no servidor.

---

## Persistência

**Nenhuma tabela nova.** Confirmado nos dois lados: o `jira-live` não tem banco
algum, e aqui o Supabase entra nesta feature exclusivamente para autorização
(`user_roles`, via `assertCanViewBoard`).

Não criamos tabela porque:

- o payload é **derivado** do changelog do Jira e muda a cada transição. Uma
  cópia em Postgres seria uma segunda fonte de verdade, desatualizada por
  construção, com invalidação para inventar;
- o único ganho de gravar seria histórico/tendência ("o cycle time do PIM
  melhorou?"), que exige captura periódica e um modelo de snapshot — feature
  diferente, explicitamente fora do escopo;
- cache em memória com TTL de 5 min já resolve o custo, sem migration, sem RLS
  nova, sem backfill.

Se a tendência histórica virar requisito, o desenho volta com tabela de
snapshots e um job — e nada do que está aqui precisa mudar para isso acontecer.

---

## Contrato

`src/lib/cycle-time/types.ts` (novo), mesma disciplina de
`src/lib/compromisso/types.ts`: nenhum tipo interno do Jira aparece.

```ts
export type CycleTimeMode = "standard" | "full";

export interface CycleTimeIssue {
  key: string; url: string; summary: string; type: string; assignee: string;
  current_status: string; fix_versions: string;
  status_days: Record<string, number>;  // dias por status, 1 casa decimal
  total_days: number;
}

export interface CycleTimeResponse {
  statuses: string[];          // ordem de colunas vinda do projeto
  issues: CycleTimeIssue[];    // já ordenadas por total_days desc
}
```

Idêntico ao `shared/types.ts` do original — o front portado consome sem tradução.

---

## Camada de cálculo pura

`src/lib/cycle-time/calc.ts` (novo), seguindo o precedente de
`src/lib/compromisso/calc.ts`: lógica sem DOM, sem HTML, testável e isomórfica.
Recebe o que hoje está misturado com geração de `innerHTML` em
`static/components/cycle-time.js`:

| Função                | Origem                     | O que faz                                                                              |
| --------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `mergeStatusVariants` | `cycle-time.js:333`        | funde variantes do mesmo status ("Em Andamento"/"In Progress", "QA"/"In Test") numa coluna só |
| `buildStatusOrder`    | `cycle-time.js:351`        | ordem das colunas: status do projeto primeiro, depois os que só aparecem nas issues     |
| `sortIssues`          | `cycle-time.js:363`        | ordenação por coluna fixa ou por coluna de status                                       |
| `fmtDays` / `fmtDays2`| `utils.js:11` e `utils.js:20` | `"3d 4h"`; a variante 2 colapsa acima de 365 dias em `"2a 130d"`                     |
| `speedTier`           | `_ctSpeedLabel`            | `rápido` / `médio` / `lento` a partir dos limiares                                       |

Os dois conjuntos de exclusão de **coluna** (`CT_EXCLUDED_COLS`,
`CT_EXCLUDED_COLS2`) e as duas ordens preferidas (`CT_COL_ORDER`,
`CT_COL_ORDER2`) vêm junto. Eles são distintos dos conjuntos do servidor de
propósito: o servidor decide **quais issues buscar e que tempo somar**; estes
decidem **quais colunas desenhar**. Fundir os dois trocaria dois conceitos por um
errado.

O cálculo de tempo por status (`buildCtPayload`) **não** vem para cá: depende do
changelog cru, que nunca cruza a fronteira. Fica em `cycle-time.server.ts`, igual
`computeDoneAt`/`computeCommitmentAt` ficam em `issues.server.ts`.

---

## Frontend

| Arquivo                                            | Mudança                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `src/routes/cycle-time.tsx` **(novo)**             | rota; sessão + `canView`; renderiza `CycleTimeView`                |
| `src/components/cycle-time/CycleTimeView.tsx` **(novo)** | header, seletor de projeto, sub-abas, queries                 |
| `src/components/cycle-time/CycleTimeTable.tsx` **(novo)** | matriz issue × status, ordenável, paginação opcional         |
| `src/lib/cycle-time/types.ts` **(novo)**           | contrato                                                          |
| `src/lib/cycle-time/calc.ts` **(novo)**            | camada pura                                                       |
| `src/integrations/jira/cycle-time.server.ts` **(novo)** | busca + cálculo                                               |
| `src/integrations/jira/server-fns.ts`              | `+ getJiraCycleTime`                                              |
| `src/integrations/jira/cache.server.ts`            | `+ withCacheCoalescing`                                           |
| `src/components/BoardGrid.tsx`                     | `+ <Link to="/cycle-time">`                                       |
| `src/components/compromisso/CompromissoView.tsx`   | `+ <Link to="/cycle-time">`                                       |

### Layout: header, não sidebar

O Compromisso tem sidebar de 256px porque tem seis grupos de controle (projeto,
sprint, visão, status, responsável, refresh). O Cycle Time tem dois: projeto e
sub-visão. E o conteúdo é o oposto — uma coluna por status do fluxo, a tabela
mais larga da aplicação. Gastar 256px de largura fixa aqui prejudica exatamente o
que a tela existe para mostrar.

Então: `<Select>` de projeto e botão "Recalcular" no cabeçalho, conteúdo em
largura cheia, `overflow-x-auto` no container da tabela (mesmo recurso que
`IssuesTable` já usa em `CardContent`).

### Estado e queries

Uma query por modo, ambas com `enabled: !!project`:

```ts
const stdQ  = useQuery({ queryKey: ["jira", "cycle-time", project, "standard"], ... });
const fullQ = useQuery({ queryKey: ["jira", "cycle-time", project, "full"], ... });
```

Duas queries separadas em vez de uma parametrizada pela aba ativa: alternar entre
"Em Andamento" e "Histórico Completo" passa a ser instantâneo (cache do Query),
e é o comportamento do original — `onProjectChange` dispara `loadCycleTime()` e
`loadCycleTime2()` juntos. O prefixo `["jira", ...]` casa o das outras queries.

Estado local com `useState`, nada mais:

| Estado             | Escopo                    | Persistência                     |
| ------------------ | ------------------------- | -------------------------------- |
| `project`          | view                      | `localStorage: cycleTimeLastProject` |
| `view`             | view (`status` \| `full`) | `localStorage: cycleTimeView` (era `ctView`) |
| `sort {col, dir}`  | por tabela                | —                                |
| `page`             | só a tabela `full`        | — (volta a 0 ao reordenar, igual ao original) |

Chave de `localStorage` própria, separada de `compromissoLastProject`: são telas
independentes e olhar o Compromisso do PIM enquanto se analisa o Cycle Time do PH
é um uso legítimo.

**Sem query params na URL.** Verificado: nenhuma rota desta aplicação usa
`validateSearch`/`useSearch` — a convenção estabelecida é `useState` +
`localStorage` (`compromissoLastProject`, `compromissoAssignee:<proj>`). Adotar
search params só nesta tela criaria um segundo padrão de navegação para três
telas. Se links compartilháveis virarem requisito, as três migram na mesma
rodada.

### Sub-abas

`Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` de `@/components/ui/tabs` — o
primitivo já está instalado (`@radix-ui/react-tabs` está no `package.json`) e
ainda não é usado em lugar nenhum. Ele entrega `role="tablist"`, `aria-selected`
e navegação por teclado, que o original monta à mão em `switchCtView`.

Rótulos idênticos aos do original: **Em Andamento** e **Histórico Completo**
(este com o subtítulo "todos os statuses do projeto").

### Tabela

`Table` de `@/components/ui/table`, dentro de `Card`/`CardHeader`/`CardContent`,
com o contador em pílula no header — mesma composição de `IssuesTable`.

Cabeçalhos ordenáveis reusam a forma de `SortableHead` (`ArrowUp`/`ArrowDown`/
`ArrowUpDown` do lucide), inclusive nas colunas dinâmicas de status. Diferença
frente ao `IssuesTable`: lá a ordenação só liga com um status selecionado
(`enabled={singleStatus}`); aqui é sempre ativa, como no original.

Cores por faixa de tempo — limiares do original, tokens do destino:

| Faixa (dias)   | Célula de status  | Total          | Classe                                    |
| -------------- | ----------------- | -------------- | ----------------------------------------- |
| rápido         | `≤ 1`             | `≤ 3`          | `text-green-600 dark:text-green-400`      |
| médio          | `≤ 3`             | `≤ 7`          | `text-amber-600 dark:text-amber-400`      |
| lento          | `> 3`             | `> 7`          | `text-red-600 dark:text-red-400`          |
| sem dado       | —                 | —              | `text-muted-foreground`, célula `—`        |

Os limiares por célula e por total são diferentes de propósito: um é tempo num
status, o outro é o ciclo inteiro. É assim no original. (Nota: são também
diferentes dos de `DaysInStatus` em `IssuesTable`, que mede "dias no status
atual" — outra grandeza.)

`title` e `aria-label` em cada célula com a duração formatada e o rótulo de
velocidade, como no original — é o que dá leitura acessível a uma matriz de
números coloridos.

### Paginação do "Histórico Completo"

Client-side, `pageSize = 100`, exatamente como `cycleTimeFullState`. Ordenação
roda sobre a lista inteira e a página é uma fatia do resultado ordenado — nunca
o contrário. Trocar de coluna de ordenação volta para a página 1.

Barras acima e abaixo da tabela, escondidas quando `total <= pageSize`, com o
texto do original: `Página 2 de 5 · itens 101–200 de 437`.

Controles com `Button variant="outline" size="sm"` em vez do primitivo
`@/components/ui/pagination`: o `Pagination` do shadcn é feito para lista
numerada de páginas com elipse, e aqui são dois botões e um contador. Nenhuma
outra tela usa o `Pagination` — não é o padrão estabelecido.

A sub-visão "Em Andamento" **não** pagina (o servidor já corta em 200).

---

## Tratamento de erros

`JiraError` (`client.server.ts`) já separa `message` — texto cru do Jira, para
log — de `clientMessage`, seguro para exibição, com mapeamento pt-BR por status
(401/403, 404, 429, 5xx, credenciais ausentes).

O handler de `getJiraCycleTime` fecha o único ponto onde isso hoje vaza: erro que
cruza a fronteira do RPC é serializado por `message`, então sem tratamento a UI
mostraria o corpo cru da resposta do Jira.

```ts
catch (err) {
  if (err instanceof JiraError) {
    console.error("[jira/cycle-time]", err.status, err.message);
    throw new Error(err.clientMessage);
  }
  throw err;
}
```

As quatro server functions existentes têm o mesmo comportamento e **não são
alteradas nesta demanda** — é defeito preexistente e mexer nelas amplia o
escopo do port. Fica registrado.

Na UI, o mesmo padrão do `CompromissoView`:

| Situação                       | Comportamento                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Nenhum projeto escolhido       | `Selecione um projeto.` em `text-muted-foreground`                                  |
| Carregando                     | `Calculando cycle time…`                                                            |
| Erro de fetch                  | `<p className="text-destructive">` com `error.message` (já traduzido pelo handler)   |
| Erro no "Recalcular"           | `toast.error(...)` via `sonner`, além do estado de erro da query                     |
| Projeto sem itens              | `Nenhum item em andamento` na célula vazia da tabela (texto do original)             |
| Issue individual malformada    | pulada com `console.error` no servidor; não aparece e não derruba a resposta         |
| Falha ao listar status         | silenciosa: colunas caem para a ordem de aparição                                    |

Sem `src/lib/cycle-time/errors.ts`: `admin-errors.ts` existe porque traduz
SQLSTATE customizados do Postgres. Aqui a tradução já está em `JiraError`.

---

## Verificação

O projeto continua sem *test runner* (`package.json` não tem vitest/jest) e esta
demanda **não introduz um** — mesma postura da spec de RBAC.

**Automático:**

```
npm run lint
npx tsc --noEmit
```

**Paridade com o original** — é o critério objetivo de "o port está certo". Com o
`jira-live` ainda de pé na porta 8000, para o mesmo projeto (PIM e INTFLOW, que
têm fluxos diferentes):

1. `GET localhost:8000/api/cycle-time?project=PIM&mode=standard` × aba "Em
   Andamento" da tela nova: mesma contagem de itens, mesmo topo da lista
   (ordenada por `total_days` desc);
2. o mesmo com `mode=full` × "Histórico Completo";
3. escolher três issues quaisquer e comparar `status_days` campo a campo — a
   tolerância é o tempo decorrido entre as duas chamadas, não mais que isso;
4. uma issue sem nenhuma transição de status deve aparecer com todo o tempo no
   status atual, nos dois lados.

**Roteiro manual:**

- login como `viewer` → a página abre e mostra dados (é `canView`);
- usuário sem papel → `AccessDenied`, e a chamada direta à server function falha
  no servidor, não só na UI;
- trocar de projeto → as duas sub-visões recarregam; nada do projeto anterior
  permanece na tela;
- "Recalcular" duas vezes seguidas em menos de 5 min → a segunda traz dados
  frescos (prova que `force` chega ao servidor);
- ordenar por uma coluna de status no "Histórico Completo" → a ordenação vale
  para os 437 itens, não só para a página visível, e volta para a página 1;
- recarregar a página → projeto e sub-visão preservados;
- alternar claro/escuro → cores de faixa legíveis nos dois temas;
- projeto sem itens abertos → mensagem de vazio, sem tabela quebrada.

---

## Ordem de implementação

1. `src/lib/cycle-time/types.ts` — contrato, sem dependência de nada
2. `withCacheCoalescing` em `cache.server.ts` (aditivo; não altera `getCache`/`setCache`)
3. `cycle-time.server.ts` — busca paginada + `buildCtPayload` + validação de projeto
4. `getJiraCycleTime` em `server-fns.ts`, com o mapeamento de `JiraError`
5. Verificação de paridade contra a porta 8000 **antes de escrever UI** — se o
   payload estiver errado, nenhuma tela conserta
6. `src/lib/cycle-time/calc.ts` — ordem de colunas, merge de variantes, ordenação, formatação
7. `CycleTimeTable.tsx` — tabela ordenável com paginação opcional
8. `CycleTimeView.tsx` — header, seletor de projeto, sub-abas, queries, "Recalcular"
9. `src/routes/cycle-time.tsx` + links em `BoardGrid` e `CompromissoView`
10. Roteiro manual e `npm run lint` / `tsc --noEmit`

Os passos 1–5 entregam a feature verificável sem uma linha de React. O passo 5 é
um checkpoint de verdade: é o último momento em que o original ainda está de pé
para servir de referência.
