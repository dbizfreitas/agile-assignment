# Navegação unificada em guias

**Data:** 2026-08-10
**Status:** aprovado para planejamento

## Problema

O `jira-live` era **uma página**: uma sidebar fixa com o seletor de projeto e uma
barra de guias (`static/index.html` linhas 116-120) sobre painéis que trocavam
por CSS. Ao ser portado para o lovable, cada guia virou uma **rota
independente**, e o custo aparece em cinco lugares concretos:

1. **Quatro cabeçalhos, quatro navegações.** `BoardGrid.tsx` (linhas 172-236),
   `CompromissoView.tsx` (257-277), `CycleTimeView.tsx` (127-174) e
   `RouletteView.tsx` (36-52) têm cada um o seu `<header>` com logo,
   `ThemeToggle`, botão de logout e links para as outras telas. São quatro
   listas de links que precisam ser mantidas em sincronia à mão — e já não
   estão: `RouletteView` só linka para `/`, `CompromissoView` não linka para
   Retrospectivas, e o link "Usuários" (admin) existe apenas em `BoardGrid`.
2. **Dois seletores de projeto, duas listas.** `CompromissoView` (linha 59) e
   `CycleTimeView` (linha 65) chamam `getJiraProjects()` cada um e mantêm cada um
   o seu estado `project`, com o seu efeito "se não tem projeto, pega o
   primeiro" (61-64 e 67-70) e a sua chave de `localStorage`
   (`compromissoLastProject`, `cycleTimeLastProject`). Trocar de projeto numa
   tela não troca na outra.
3. **O preâmbulo de sessão repetido quatro vezes.** O bloco
   `loading` → `!session` → `AuthCard` → `!canView` → `AccessDenied` está
   copiado literalmente em `routes/index.tsx` (35-57), `routes/compromisso.tsx`
   (26-48), `routes/cycle-time.tsx` (27-49) e `routes/retrospectivas.tsx`
   (26-51) — quatro cópias do mesmo `AccessDenied` com o mesmo texto.
4. **O quadro não sabe que é uma guia.** Ele se chama "Quadro" nos links das
   outras telas e "Sprint Board" no próprio cabeçalho; o pedido é que passe a se
   chamar **Alocações** em todo lugar visível.
5. **Nada depende de projeto onde deveria.** Retrospectivas e o quadro ignoram
   projeto por completo — o quadro é o assunto da spec
   `2026-08-10-alocacoes-projeto-design.md`; a **estrutura** que faz todas as
   guias dependerem de projeto é o assunto desta.

O pedido do usuário é literal: *"Verifique em Live_jira como cada funcionalidade
estava disposta no projeto em guias e realoque todas no projeto lovable conforme
estavam dispostas no live jira, inclusive o Quadro que agora deve se chamar
Alocações. A tela de cadastro de usuários é a única que deve ficar independente
de seleção de projeto, todas as demais dependem de projeto selecionado para
apresentar as informações."*

## Objetivo

Uma casca só: um cabeçalho, um seletor de projeto, uma barra de guias na ordem
do `jira-live`, e o preâmbulo de sessão rodando uma vez. Trocar de guia troca o
painel — não o projeto, não a sessão, não o tema, não o cabeçalho.

## Escopo

**Dentro:** casca compartilhada (cabeçalho + tablist + gate de projeto);
seletor de projeto único; remoção dos quatro cabeçalhos e dos dois seletores
próprios; preâmbulo de sessão uma vez; colapso das chaves de `localStorage` de
projeto; renomeação Quadro → Alocações em todo texto visível; `/compromisso`,
`/cycle-time` e `/retrospectivas` continuam URLs válidas.

**Fora (decidido explicitamente):**

- **`/admin` e `/aceitar-convite`.** Ficam fora da casca, com os cabeçalhos que
  já têm, e **não ganham seletor de projeto** — é exatamente o que o usuário
  pediu ("a tela de cadastro de usuários é a única que deve ficar independente
  de seleção de projeto"). Detalhado adiante.
- **Filtrar as Retrospectivas por projeto.** A guia passa a viver sob um projeto
  selecionado (gate estrutural), mas `PARTICIPANTS`
  (`src/lib/retrospectivas/participants.ts`) continua sendo uma lista única. Ver
  "Riscos", item 5.
- **A sidebar única do `jira-live`.** No original, projeto, sprint, visão e
  chips moravam todos na mesma `<nav class="sidebar">`, mesmo que sprint/visão/
  chips só afetassem a guia Compromisso. Aqui **só o projeto** sobe para a
  casca; o resto continua na `CompromissoSidebar`, dentro do painel dela.
- **Um botão global "Atualizar dados".** No `jira-live` era um só, na sidebar.
  Aqui `Compromisso` (`handleRefresh`) e `Cycle Time` (`handleRecalcular`)
  atualizam coisas diferentes por caminhos diferentes (o segundo precisa mandar
  `force` ao servidor) e continuam separados, cada um no seu painel.
- **O `switchIndicator`** do original (barra discreta que mantinha os dados
  antigos na tela durante a troca de projeto). Os painéis continuam trocando
  para o texto "Carregando…" que já usam hoje.
- **Filtro/permissão por projeto.** Nada de RLS muda; é a mesma decisão da spec
  de Alocações ("Projeto não é fronteira de permissão").

## Princípios

1. **Uma guia é uma URL.** O roteador do projeto já sabe qual guia está ativa;
   um `useState` de aba paralelo à URL seria uma segunda fonte de verdade sobre
   a mesma coisa.
2. **A casca elimina estados, não os empurra para baixo.** Se a casca já decidiu
   que há sessão, que há papel e que há projeto, os painéis recebem esses fatos
   como **tipos não anuláveis** — e os quatro ramos `!project` de hoje viram
   código morto, não código duplicado.
3. **A lista de projetos não depende do Jira estar no ar.** O planejamento
   (Alocações) é dado próprio, no Supabase. Herdado da spec de Alocações e
   respeitado aqui por construção, não por um `catch`.
4. **Fidelidade ao `jira-live` onde ela custa nada.** Ordem das guias, nomes,
   projeto na URL: copiados. O gate por sprint e a sidebar global: não — ver
   "Divergências deliberadas".
5. **O rename é de texto, não de identificadores.** `BoardGrid`, `src/lib/board.ts`,
   as `queryKey` `["board", …]` e `private.can_view_board` continuam com os
   nomes que têm.

---

## Como o `jira-live` estava disposto

Confirmado no código, não no resumo:

| Fato | Onde |
| ---- | ---- |
| Uma página só, sidebar fixa + área principal | `static/index.html` 16-306 |
| Barra de guias com `role="tablist"` | `static/index.html` 116 |
| Ordem **Compromisso → Cycle Time → Retrospectivas → Alocação**, Compromisso ativa por padrão | `git show 7d6b618:static/index.html` 112-115 |
| "Alocação" era a **última** guia e foi removida depois | só existe em `7d6b618`; `git log -S"Aloca" -- static/index.html` devolve apenas o commit inicial |
| Trocar de guia é só trocar o painel visível — nenhuma guia recarrega dado | `static/app.js` `switchTab()` 140-160 |
| Guia ativa persistida (`activeTab`) e refletida em `?tab=` | `app.js` 158, 88-101, 252-253 |
| Projeto na URL (`?project=`) com `localStorage.lastProject` como fallback — **uma** chave, global | `app.js` 207-216, 264 |
| `?project=`/`?sprint=`/`?tab=` escritos com `history.replaceState` para poder mandar link no Teams | `app.js` 84-101 (o comentário diz isso literalmente) |
| Guias só apareciam com **projeto e sprint** carregados | `app.js` `hideLoading()` 511-520: `if (!sprintState.sprintData) { mainContent → none; emptyState → visível }` |
| A roleta era importada dinamicamente na primeira abertura da guia | `app.js` 149-157 |

Duas coisas desse levantamento mudam o desenho: **o projeto sempre esteve na
URL com uma chave única de `localStorage`** (o que sustenta as decisões 3 e 8
adiante), e **o gate original era projeto + sprint** — que é onde divergimos.

---

## Decisão: guia = rota

### As três opções avaliadas

| Opção | Como | Por que não / por que sim |
| ----- | ---- | ------------------------- |
| (a) rota única `/` + `useState` de aba | as quatro rotas antigas passam a redirecionar para `/?tab=…`; os quatro painéis montados de uma vez com `forceMount`/`hidden` | É a cópia literal do `jira-live` e preserva todo estado local dos painéis. **Custo real:** abrir as Alocações passa a disparar as duas chamadas pesadas de Cycle Time (`standard` + `full`), a cadeia do Compromisso (projects → sprints → sprint → issues) e o módulo de fotos da retro. Hoje abrir `/` custa quatro queries no Supabase. Além disso `?tab=`, `<title>` por guia e o redirect das três URLs antigas passam a ser código nosso. |
| (b) rota única `/` + aba em search param | idem (a), com a aba validada em `validateSearch` | Mesmo custo de montagem de (a) sem o ganho de simplicidade: continua exigindo redirects e um `head()` condicional para o título mudar por guia. |
| (c) **rota de layout sem caminho** | `src/routes/_shell.tsx` renderiza a casca e um `<Outlet/>`; as quatro telas passam a ser `src/routes/_shell/{index,compromisso,cycle-time,retrospectivas}.tsx` | **Escolhida.** O `_` faz o segmento não existir na URL: `/`, `/compromisso`, `/cycle-time` e `/retrospectivas` continuam exatamente as URLs de hoje. O componente do layout **não é desmontado** ao navegar entre filhos — é o roteador que dá "trocar o painel sem desmontar o resto". |

### O que fica decidido

Opção (c), por quatro razões em ordem de peso:

1. **Deep link de graça, e sem quebrar nada.** As três URLs já existem e já
   foram compartilhadas; mantê-las vivas custa zero linha, enquanto (a) e (b)
   exigem uma camada de redirect só para chegar ao mesmo lugar. O
   `syncUrl()` do `jira-live` existia porque não havia roteador; aqui há.
2. **`head()` por rota continua sendo o mecanismo do `<title>`.** É onde o
   rename para "Alocações" deve acontecer, e é o padrão que as seis specs
   anteriores já usam.
3. **Primeira pintura barata.** Só o painel da guia aberta monta. Quem abre as
   Alocações não paga as duas idas ao Jira do Cycle Time.
4. **`scrollRestoration: true`** já está ligado em `src/router.tsx` — com guia =
   rota, a posição de rolagem por guia volta sozinha.

Custo aceito, com mitigação, na seção "Remontagem dos painéis".

### Estrutura de arquivos

```
src/routes/
  __root.tsx              (intocado)
  _shell.tsx              NOVO  — casca: preâmbulo, projeto, header, tablist, <Outlet/>
  _shell/
    index.tsx             move de routes/index.tsx           → "/"
    compromisso.tsx       move de routes/compromisso.tsx     → "/compromisso"
    cycle-time.tsx        move de routes/cycle-time.tsx      → "/cycle-time"
    retrospectivas.tsx    move de routes/retrospectivas.tsx  → "/retrospectivas"
  admin.tsx               (fica onde está, fora da casca)
  aceitar-convite.tsx     (fica onde está, fora da casca)
```

`src/routeTree.gen.ts` é regenerado pelo `@tanstack/router-plugin` no `vite dev`
/`vite build`; ele é versionado e **precisa entrar no commit**, mas não é
editado à mão (`src/routes/README.md` diz isso explicitamente).

`ssr: false` vai no `_shell.tsx` — a casca lê `localStorage` e a sessão do
Supabase no boot. Os `ssr: false` que já existem nos quatro filhos **ficam**:
são redundantes sob um pai client-only, e mantê-los evita que mover um arquivo
para fora da casca no futuro reative SSR em silêncio.

**Nome do arquivo:** `src/routes/README.md` documenta `_layout.tsx` como "layout
route (renders children via `<Outlet />`)" — o prefixo `_` é o que torna a rota
sem caminho, e o resto do nome é livre; `_shell` diz o que é. O aviso do mesmo
README contra `src/routes/_app/index.tsx` é sobre a convenção `_app` do Next, não
sobre rotas de layout do TanStack. Se o gerador reclamar do nome na hora da
implementação, `_layout.tsx`/`_layout/` é o fallback literal do README.

### `/admin` e `/aceitar-convite` ficam fora — confirmado

Ambas continuam em `src/routes/` (irmãs de `_shell.tsx`, não filhas), com os
cabeçalhos próprias que já têm, e **sem seletor de projeto**:

- **`/admin`** é a "tela de cadastro de usuários" do pedido. Usuário e papel são
  da plataforma, não de um projeto — a spec de RBAC não tem uma linha de projeto,
  e a de Alocações registra que "projeto não é fronteira de permissão". Colocar
  um seletor ali sugeriria um isolamento que não existe. Ela **mantém** o link de
  volta (`AdminView.tsx` 25-30), apenas com o rótulo renomeado, e **mantém** as
  suas `Tabs` internas (Usuários / Histórico), que não são guias da casca.
- **`/aceitar-convite`** é acessada por quem ainda não tem papel e talvez nem
  senha. Ela **não ganha** link de volta: navegar para a casca antes de definir a
  senha só produziria um `AccessDenied`. O `navigate({ to: "/" })` que já existe
  no fim do fluxo (linha 36) continua sendo a única saída, e é a certa.

Consequência positiva: o link "Usuários" (hoje só em `BoardGrid`, visível para
`isAdmin`) sobe para o cabeçalho da casca e passa a estar disponível de qualquer
guia. Ele **não é uma guia** — a barra tem exatamente quatro.

### A home continua sendo Alocações

No `jira-live` a guia ativa por padrão era Compromisso. Aqui, `/` continua sendo
**Alocações**, apesar de ela ser a **última** da barra. Não é descuido:

- O produto nasceu como o quadro; `__root.tsx` se chama "Sprint Board"; `/` é o
  que está em favorito e é para onde `admin.tsx` e `aceitar-convite.tsx`
  navegam. Trocar o destino de `/` seria uma mudança de comportamento que
  ninguém pediu.
- A **ordem** da barra é o que o usuário pediu ("conforme estavam dispostas"), e
  ela é fiel: Compromisso → Cycle Time → Retrospectivas → Alocações.
- Um redirect `/` → `/compromisso` deixaria `/` sem página própria e obrigaria a
  inventar uma URL nova para as Alocações. Pior em tudo.

Registrado como divergência deliberada.

---

## O estado compartilhado

### De onde vêm as opções do seletor

**As chaves vêm de `JIRA_PROJECTS`; os rótulos vêm do Jira quando o Jira
responde.**

```ts
// dentro da casca
const projectsQ = useQuery({
  queryKey: ["jira", "projects"],          // mesma chave de hoje
  queryFn: () => getJiraProjects(),
  staleTime: 30 * 60_000,
});

const options = JIRA_PROJECTS.map((p) => ({
  key: p.key,
  name: projectsQ.data?.find((j) => j.key === p.key)?.name ?? p.name,
}));
```

Por que este desenho e não "um ou o outro":

1. **Não existe fallback a executar.** A spec de Alocações exige que "se o
   seletor compartilhado alimentar as opções com `getJiraProjects()`, a guia
   Alocações precisa degradar para `JIRA_PROJECTS` quando essa query falhar".
   Aqui não há um ramo de degradação: **a lista nunca veio da rede.** Com token
   expirado, Atlassian instável ou `projectsQ` em voo, o seletor está completo e
   as Alocações funcionam. O requisito é atendido por construção, que é a forma
   forte de atendê-lo — um `catch` pode ser esquecido, a ausência de dependência
   não.
2. **As duas listas não podem divergir em chaves.** `fetchAllowedProjects()`
   filtra o resultado do Jira por `ALLOWED_PROJECTS`
   (`projects.server.ts` 38-40), e a spec de Alocações faz `ALLOWED_PROJECTS`
   derivar de `JIRA_PROJECTS`. Logo `getJiraProjects()` só devolve
   **subconjunto** de `JIRA_PROJECTS`. A constante local é a superlista por
   construção; usar o Jira apenas para o nome é usar cada fonte para o que ela
   sabe.
3. **O rótulo continua o de hoje.** Cycle Time e Compromisso mostram
   `PIM — <nome real do projeto no Jira>`. Fixar o nome na constante deixaria o
   rótulo desatualizar em silêncio se alguém renomear o projeto no Jira.
4. **Uma query em vez de duas cópias de lógica.** `["jira","projects"]` já é
   deduplicada pelo TanStack Query, então hoje já é *uma* chamada de rede — o que
   se elimina é o efeito "se não tem projeto, pega o primeiro" duplicado em
   `CompromissoView` 61-64 e `CycleTimeView` 67-70.

**Consequência aceita e registrada:** um projeto que está em `JIRA_PROJECTS` mas
não é visível no Jira (permissão, projeto arquivado) passa a **aparecer** no
seletor, onde hoje Compromisso e Cycle Time simplesmente o omitiam. Ao
selecioná-lo, essas duas guias mostram o próprio estado de erro/vazio, e
Alocações funciona normalmente. É melhor que o comportamento atual, em que uma
falha de credencial esvazia o seletor e nenhuma tela abre — inclusive a que não
depende do Jira.

### Onde mora o valor do projeto

**Na URL, com `localStorage` como padrão.** É o desenho do `jira-live`
(`urlProject || localStorage.getItem("lastProject")`, `app.js` 207-216) e o
motivo está escrito no comentário do `syncUrl()`: sem isso "era impossível mandar
um link no Teams que reabrisse a mesma tela".

- `_shell.tsx` declara `validateSearch` produzindo `{ project?: JiraProjectKey }`.
  Chave desconhecida é **coagida para `undefined`, nunca lançada** — um link
  antigo para um projeto que saiu da lista tem de abrir a aplicação, não um erro
  de rota.
- Resolução, síncrona: `project = search.project ?? ls("lastProject") ?? JIRA_PROJECTS[0].key`.
- No boot, se a URL não trouxer `project`, a casca escreve o projeto efetivo com
  `navigate({ search, replace: true })` — assim qualquer URL copiada da barra do
  navegador já está completa. É o `history.replaceState` do original.
- Trocar no seletor: `navigate({ search: (prev) => ({ ...prev, project: p }), replace: true })`
  **+** `localStorage.setItem("lastProject", p)`. `replace` e não `push`: um
  histórico com uma entrada por troca de projeto é ruído, e é o comportamento do
  original.
- Os `<Link>` da barra de guias passam `search: (prev) => prev`, senão o roteador
  descarta o parâmetro ao navegar entre guias.

Ganho colateral que vale a pena registrar: com o projeto na URL, **duas abas do
navegador podem ficar em dois projetos diferentes** — que é justamente o caso de
uso que `CycleTimeView.tsx` 41-44 documenta ("olhar o Compromisso do PIM
enquanto se analisa o Cycle Time do PH"). Um seletor compartilhado tira isso de
dentro de uma aba e a URL devolve entre abas. O `localStorage` fica last-write-wins
entre abas, e isso é inofensivo: quem manda na tela é a URL.

**Fallback se a herança de search param no layout se mostrar hostil na
implementação:** `project` passa a ser `useState` na casca com a mesma chave de
`localStorage`, e a URL carrega só a guia. Nada nos contratos dos painéis muda —
eles recebem `project` do contexto de qualquer forma. É uma degradação de uma
linha, e deve ser registrada no plano como tal, não improvisada.

### Uma chave de `localStorage`, três órfãs

| Chave | Destino |
| ----- | ------- |
| `compromissoLastProject` | **eliminada** (`CompromissoView.tsx` 51, 173) |
| `cycleTimeLastProject` | **eliminada** (`CycleTimeView.tsx` 44, 59) |
| `alocacoesLastProject` | **nunca criada** — ver "Riscos", item 2 |
| `lastProject` **(nova)** | única, global. Mesmo nome do `jira-live`. |
| `cycleTimeView` | **fica** — sub-visão *dentro* do painel, não guia |
| `compromissoAssignee:<projeto>` | **fica** — já é por projeto e continua correta |
| `activeTab` (do `jira-live`) | **não é portada** — a guia ativa é a URL; histórico e favoritos do navegador fazem esse trabalho |

Com um seletor compartilhado, três chaves para o mesmo conceito produziriam o
absurdo de trocar de guia e trocar de projeto. Colapsar é a única leitura
coerente, e a spec de Alocações já delegou a decisão para cá ("A chave de
`localStorage` compartilhada … é decisão da outra spec").

**As três antigas ficam órfãs, sem migração.** Não quebram nada — `localStorage`
tolera chave não lida. Deliberadamente não escrevemos código de migração: o
efeito de não migrar é que, no primeiro acesso após o deploy, quem estava no PH
no Cycle Time cai no `JIRA_PROJECTS[0]` (`PIM`) uma vez e escolhe de novo. Para
as Alocações não há efeito nenhum: o backfill da outra spec leva tudo para `PIM`,
que é o primeiro item da lista. Três linhas de *seed* a partir de
`compromissoLastProject ?? cycleTimeLastProject` são a alternativa, e ficam
descartadas por não pagarem o próprio custo de leitura.

### Sessão e autorização

`useAuthorizedSession()` é chamado **uma vez**, no componente do `_shell.tsx`:

```
loading            → "Carregando..." (mesmo markup dos quatro de hoje)
!session           → <AuthCard />
!canView           → <AccessDenied title="Acesso ainda não liberado" … />
caso contrário     → <AppShell …>{<Outlet/>}</AppShell>
```

Os quatro blocos idênticos de `routes/index.tsx` 35-57,
`routes/compromisso.tsx` 26-48, `routes/cycle-time.tsx` 27-49 e
`routes/retrospectivas.tsx` 26-51 desaparecem, junto com os imports de
`AuthCard`, `AccessDenied`, `Button` e `supabase` nesses quatro arquivos.

`canEdit`, `isAdmin`, `email` e `project` chegam aos painéis por **contexto**, não
por prop — `<Outlet/>` não aceita props:

```ts
type ShellContext = {
  email: string;
  canEdit: boolean;
  isAdmin: boolean;
  project: JiraProjectKey;   // não anulável: a casca garante
};
```

A alternativa era cada painel chamar `useAuthorizedSession()` de novo (é barato:
`useRole` é uma query com `staleTime` de 5 min e `useSession` é um listener).
Recusada porque reintroduziria dentro de cada painel exatamente os estados
(`loading`, `session | null`, `canView`) que a casca existe para eliminar — o
contexto faz a garantia aparecer no **tipo**, e é isso que apaga os ramos
`!project` como código morto em vez de os deixar como defesa duplicada.

`/admin` continua chamando `useAuthorizedSession()` por conta própria: está fora
da casca e a sua condição é outra (`isAdmin`, não `canView`).

---

## O gate de projeto: o estado "sem projeto" não existe

A pergunta era: com projeto ausente, esconde-se a barra de guias inteira (como
o `emptyState` do `jira-live`) ou cada painel mostra o seu vazio?

**A pergunta se dissolve.** Com a lista vindo de uma constante local não vazia e
a resolução sendo `search.project ?? ls("lastProject") ?? JIRA_PROJECTS[0].key`,
**`project` é sempre uma chave válida**: chave inválida na URL é coagida para
`undefined` e cai no `localStorage`; chave inválida no `localStorage` cai no
primeiro item. Não há caminho que produza "nenhum projeto selecionado" — e é por
isso que `project` é declarado não anulável no contexto.

O que fica decidido, então:

- **A barra de guias está sempre visível** e os quatro painéis sempre têm
  projeto. É a forma mais forte de "todas as guias dependem de projeto
  selecionado": não dependem de uma seleção que pode faltar, dependem de uma que
  não pode.
- **Os quatro ramos `!project` de hoje são deletados como código morto**, não
  reescritos: `CycleTimePane` 233-235 (`"Selecione um projeto."`),
  `CompromissoView` 280-283 (`"Selecione um projeto na barra lateral."`), o
  ramo equivalente que a spec de Alocações prevê no quadro, e a tipagem
  `project: string | null` do `CycleTimePane`.
- **O único estado sem projeto que sobra é erro de configuração:**
  `JIRA_PROJECTS` vazia. Nesse caso a casca renderiza "Nenhum projeto
  configurado." **e esconde a barra de guias** — nada funcionaria, e uma barra
  clicável sobre quatro painéis quebrados é pior que uma frase. É o único lugar
  onde a barra desaparece.
- **Vazio de dado continua sendo do painel.** Projeto válido e sem dado é outra
  coisa e não muda: "Vamos montar seu quadro" nas Alocações, "Selecione uma
  sprint na barra lateral." no Compromisso, tabela vazia no Cycle Time. A casca
  responde por *existir projeto*; o painel responde por *haver dado*.

Isso também é o que reconcilia Retrospectivas com o pedido: a guia vive sob um
projeto (gate estrutural, como o resto), e o conteúdo dela continua sem filtrar
por projeto. Nenhum filtro de participante por projeto é inventado aqui.

---

## Frontend

| Arquivo | Mudança |
| ------- | ------- |
| `src/routes/_shell.tsx` **(novo)** | rota de layout: `ssr:false`, `validateSearch` de `project`, preâmbulo de sessão, resolução/persistência do projeto, `<ShellProvider>` + `<AppShell>` + `<Outlet/>` |
| `src/components/shell/AppShell.tsx` **(novo)** | cabeçalho (logo, `ProjectSelect`, "Usuários" se `isAdmin`, `ThemeToggle`, logout) + tablist + `{children}` |
| `src/components/shell/shell-context.tsx` **(novo)** | `ShellProvider` e `useShell()` |
| `src/components/shell/tabs.ts` **(novo)** | `TABS: readonly {to, label, icon}[]` — a ordem das guias declarada num único lugar |
| `src/routes/_shell/index.tsx` | era `routes/index.tsx`: preâmbulo fora, `head()` renomeado, passa `project`/`canEdit` do contexto ao `BoardGrid` |
| `src/routes/_shell/compromisso.tsx` | era `routes/compromisso.tsx`: preâmbulo fora |
| `src/routes/_shell/cycle-time.tsx` | era `routes/cycle-time.tsx`: preâmbulo fora |
| `src/routes/_shell/retrospectivas.tsx` | era `routes/retrospectivas.tsx`: preâmbulo fora |
| `src/components/BoardGrid.tsx` | `<header>` → *toolbar* do painel; sai logo/nav/tema/logout; props `email` e `isAdmin` removidas; altura deixa de ser `h-screen` |
| `src/components/compromisso/CompromissoView.tsx` | `<header>` removido; `projectsQ`, estado `project`, `handleProjectChange` e o efeito de primeiro projeto removidos; `project` vem do contexto; prop `email` removida |
| `src/components/compromisso/CompromissoSidebar.tsx` | bloco "Projeto" (58-74) e props `projects`/`project`/`onProjectChange` removidos |
| `src/components/cycle-time/CycleTimeView.tsx` | `<header>` removido, "Recalcular" preservado no *toolbar* do painel; `projectsQ`, estado `project`, `handleProjectChange`, `LS_PROJECT` removidos; `CycleTimePane.project` passa a `JiraProjectKey` |
| `src/components/retrospectivas/RouletteView.tsx` | `<header>` removido, contador preservado dentro do painel; prop `email` removida |
| `src/components/admin/AdminView.tsx` | rótulo do link de volta: "Quadro" → "Alocações" |
| `src/routes/admin.tsx` | rótulo do botão: "Voltar ao quadro" → "Voltar para Alocações" |
| `src/lib/admin.ts`, `src/components/admin/UserTable.tsx` | textos de papel (tabela do rename) |
| `src/components/ProjectSelect.tsx` | **da spec de Alocações** — reaproveitado pela casca; ver "Riscos", item 1 |
| `src/routes/aceitar-convite.tsx` | **sem mudança** |

### O cabeçalho da casca

Duas fileiras, seguindo o padrão que `BoardGrid` já usa (172-275):

- **Fileira 1:** ícone + "Sprint Board" · `ProjectSelect` · "Usuários"
  (`isAdmin`) · `ThemeToggle` · logout (`title={email}`).
- **Fileira 2** (`border-t`): a tablist.

O subtítulo por tela ("Alocação de demandas do time", "Acompanhamento da sprint
no Jira", …) sai do cabeçalho: com quatro guias sob um cabeçalho só, ele
precisaria mudar a cada troca de painel para dizer algo que a guia ativa já diz.
Os títulos que os painéis têm *dentro* de si (cards, `CycleTimeTable`,
`SprintBar`) ficam.

### O que exatamente sai de cada componente

**`BoardGrid.tsx`** — sai o `<header>` **parcialmente**. Isto é o ponto de erro
mais fácil da migração: o cabeçalho dele mistura cruzeta de navegação com
controles do próprio quadro.

| Elemento | Destino |
| -------- | ------- |
| ícone `LayoutGrid` + `<h1>Sprint Board</h1>` + subtítulo (174-180) | **sai** (vira o logo da casca) |
| `Input` de busca (182-190) | **fica** — controle do quadro, vai para o *toolbar* do painel |
| botões "Sprint" e "Pessoa" com `canEdit` (192-209) | **ficam** no *toolbar* |
| link "Usuários" com `isAdmin` (210-216) | **sai** (sobe para a casca) |
| links `/cycle-time`, `/compromisso`, `/retrospectivas` (217-231) | **saem** (viram guias) |
| `<ThemeToggle/>` e botão de logout (232-235) | **saem** |
| fileira de chips Tipo/Status (238-274) | **fica** no *toolbar* |

Props: `email` e `isAdmin` deixam de ser usadas e saem da assinatura; `canEdit`
fica; `project` entra (spec de Alocações). Imports que ficam órfãos:
`Link`, `LayoutGrid`, `LogOut`, `Timer`, `ClipboardList`, `Dices`, `Users`,
`ThemeToggle`.

**Altura:** o `<div className="flex h-screen flex-col overflow-hidden">` externo
(171) não pode continuar `h-screen` — a casca já ocupa a viewport e um filho
`h-screen` dentro dela produz rolagem dupla. O painel passa a
`flex min-h-0 flex-1 flex-col`, e o `overflow-y-auto` do container do grid (293)
continua sendo o que rola. Isso vale para os quatro painéis (`CompromissoView`
234 e `CycleTimeView` 126 também são `h-screen`; `RouletteView` 35 é
`min-h-screen`).

**`CompromissoView.tsx`** — além do `<header>` (257-277): saem `projectsQ` (59),
o efeito de primeiro projeto (61-64), o estado `project` (51),
`handleProjectChange` (170-177) e o ramo `!project` (280-283). `project` passa a
vir de `useShell()` e continua alimentando `["jira","sprints",project]` (67) e
`compromissoAssignee:${project}` (137, 162). O efeito que zera sprint/chips ao
trocar de projeto (74-78) **fica** — agora reagindo ao projeto da casca, que é
exatamente o que se quer. `loadError` (231) deixa de somar `projectsQ.error`: a
falha da lista é da casca e não é fatal (só o rótulo degrada).

**`CycleTimeView.tsx`** — além do `<header>` (127-174): saem `projectsQ` (65), o
efeito de primeiro projeto (67-70), o estado `project` (59),
`handleProjectChange` (91-94) e `LS_PROJECT` (44). O botão "Recalcular"
(151-158) **é preservado** e vai para a mesma linha da `TabsList` das sub-visões
(178-181). `LS_VIEW`/`cycleTimeView` ficam.

**`RouletteView.tsx`** — sai o `<header>` (36-52), mas o contador
`"N / 20 sorteados · M ausentes"` (43) **é preservado** dentro do painel, acima
do `Card`. A região `aria-live` do vencedor (58) não é tocada. Prop `email` sai.

### A barra de guias

`TABS` em `src/components/shell/tabs.ts`, na ordem do `jira-live`:

| # | Rótulo | `to` |
| - | ------ | ---- |
| 1 | Compromisso | `/compromisso` |
| 2 | Cycle Time | `/cycle-time` |
| 3 | Retrospectivas | `/retrospectivas` |
| 4 | **Alocações** | `/` |

Marcação: `<nav role="tablist" aria-label="Navegação principal">` com um
`<Link role="tab" aria-selected={…} search={(prev) => prev}>` por guia, e o
`<Outlet/>` embrulhado em `role="tabpanel"` com `aria-labelledby` apontando para
o `id` da guia ativa. É a marcação do `jira-live` (`index.html` 116-120) e é o
que o pedido descreve.

**Desvio de acessibilidade registrado:** o padrão ARIA de *tabs* espera
navegação por setas com *roving tabindex*; estes são links reais, que respondem a
Tab + Enter e alimentam o histórico do navegador. Fica sem setas de propósito —
meia implementação de *roving tabindex* seria pior que nenhuma, e a alternativa
purista (`<nav>` com `aria-current="page"`, sem papéis de tab) foi descartada por
divergir da marcação pedida. Se acessibilidade por teclado virar requisito, a
troca certa é adotar `aria-current` e abandonar os papéis de tab por completo —
não somar setas a links.

---

## Rename Quadro → Alocações

| Onde | Antes | Depois |
| ---- | ----- | ------ |
| `src/components/shell/tabs.ts` | — | rótulo `Alocações` |
| `_shell/index.tsx` `head` `title` e `og:title` | `Sprint Board — Alocação de demandas do time de devs` | `Alocações — Sprint Board` |
| `_shell/index.tsx` `description` e `og:description` | "Substitua a planilha: **quadro** visual de sprints x devs…" | "Alocações de sprints × pessoas, com status coloridos, tickets, férias e realocação por arrastar e soltar." |
| `BoardGrid.tsx` 279 | `Carregando quadro...` | `Carregando alocações…` |
| `BoardGrid.tsx` 289 | `O quadro ainda não foi montado.` | `As alocações ainda não foram montadas.` |
| `BoardGrid.tsx` 612 | `Vamos montar seu quadro` | `Vamos montar as alocações` (+ nome do projeto, pela spec de Alocações) |
| `BoardGrid.tsx` 613-616 | "Cadastre as pessoas … clicar em cada célula para alocar as demandas." | mantém o sentido, sem a palavra "quadro" |
| `admin/AdminView.tsx` 27 | `Quadro` | `Alocações` |
| `routes/admin.tsx` 36 | `Voltar ao quadro` | `Voltar para Alocações` |
| `lib/admin.ts` 29 | `Gerencia usuários e edita o quadro` | `Gerencia usuários e edita as alocações` |
| `lib/admin.ts` 30 | `Edita o quadro` | `Edita as alocações` |
| `lib/admin.ts` 31 | `Apenas visualiza o quadro` | `Apenas visualiza, não edita` |
| `admin/UserTable.tsx` 141 | `Não enxerga o quadro` | `Não enxerga a plataforma` |
| `CompromissoView` 266, `CycleTimeView` 162, `RouletteView` 46 | links `Quadro` | deletados junto com os cabeçalhos |

Duas correções de sentido escondidas nessa tabela, e não são cosméticas:
`viewer` não é "quem só visualiza o quadro" — `private.can_view_board` também é o
que libera as server functions do Jira (`assertCanViewBoard` em cada handler de
`server-fns.ts`), então "Apenas visualiza" é a descrição correta e "das
alocações" seria uma restrição falsa. Pelo mesmo motivo, "sem papel" não é "não
enxerga o quadro": não enxerga nada.

**O que NÃO é renomeado, e por quê:**

- `__root.tsx` 83-86 (`title`/`og:title` = "Sprint Board") e `AuthCard.tsx` 36 —
  é o nome do **produto**, não da guia. Alocações é uma das quatro coisas que ele
  faz.
- `BoardGrid.tsx` (nome do arquivo e do componente), `src/lib/board.ts`,
  `src/lib/board-errors.ts`, as `queryKey` `["board", …]`,
  `private.can_view_board`/`can_edit_board`, `assertCanViewBoard` — são
  identificadores, invisíveis ao usuário. Renomeá-los é churn puro e garantiria
  conflito com o diff da spec de Alocações, que está mexendo nesses mesmos
  arquivos.

---

## Remontagem dos painéis: o custo aceito

Com guia = rota, trocar de guia **desmonta o painel anterior**. O `jira-live` não
desmontava nada (só alternava classes CSS), então isto é a única perda real da
opção (c). Inventário honesto do que se perde:

| Estado | Hoje | Depois de trocar de guia e voltar |
| ------ | ---- | --------------------------------- |
| Retrospectivas (sorteados, ausentes, vencedor) | `localStorage` (`src/lib/retrospectivas/storage.ts`) | **preservado** |
| Cycle Time — sub-visão | `localStorage` `cycleTimeView` | **preservado** |
| Compromisso — filtro de responsável | `localStorage` por projeto | **preservado** |
| Compromisso — sprint escolhida | `useState` | volta para "ativa, senão a primeira" |
| Compromisso — `viewMode` e chips de status | `useState` | resetados |
| Cycle Time — ordenação e página da tabela | `useState` em `CycleTimeTable` 46-47 | resetados |
| Alocações — busca e chips Tipo/Status | `useState` em `BoardGrid` 64-66 | resetados |
| Dados de qualquer guia | TanStack Query | **preservados** (o cache é do `QueryClient`, não do componente) |

Nenhum dado é rebuscado do zero na volta — mas com o `QueryClient` criado sem
defaults (`src/router.tsx`), `staleTime` é 0 e cada remontagem dispara um
*refetch* em segundo plano. Para o Cycle Time isso significa dois `createServerFn`
por visita à guia. Mitigação, junto com a implementação:

| `queryKey` | `staleTime` | Motivo |
| ---------- | ----------- | ------ |
| `["jira","projects"]` | 30 min | a lista de projetos praticamente não muda |
| `["jira","cycle-time", …]` | 5 min | casa com o cache de 5 min que `fetchCycleTime` já tem no servidor |
| `["jira","sprint", …]`, `["jira","issues", …]` | 1 min | o auto-refresh do Compromisso é de 10 min; 1 min só cobre o bate-volta entre guias |

Os botões de atualizar continuam funcionando: `invalidateQueries` marca a query
como obsoleta e refaz o *fetch* dos observadores ativos **independentemente** do
`staleTime`, e o "Recalcular" do Cycle Time não passa por invalidação — ele chama
`getJiraCycleTime({ force: true })` e escreve o resultado com `setQueryData`
(`CycleTimeView` 102-121).

O reset de `viewMode`/chips/ordenação fica **aceito sem mitigação**: são um clique
para refazer, e a resposta do próprio `jira-live` para "estado que precisa
sobreviver" foi `localStorage` explícito (`activeTab`, `lastProject`, `ctView`,
responsável por projeto, cards recolhidos) — a sobrevivência por não-desmontagem
era acidental, não desenhada. Se algum desses resets incomodar no uso, a correção
é uma chave de `localStorage` para aquele item específico, não voltar para a
opção (a).

---

## Divergências deliberadas em relação ao `jira-live`

| # | `jira-live` | Aqui | Por quê |
| - | ----------- | ---- | ------- |
| 1 | Guias aparecem só com **projeto e sprint** carregados (`hideLoading()` 511-520) | dependem só de **projeto** | O pedido do usuário fala em projeto. E sprint só existe para o Compromisso: fazer Cycle Time, Retrospectivas e Alocações esperarem uma sprint seria acoplá-las a um conceito que elas não usam. |
| 2 | Guia ativa padrão = Compromisso | `/` = Alocações (4ª guia) | `/` é a home histórica do produto e o destino de `admin`/`aceitar-convite`. A **ordem** da barra é fiel. |
| 3 | Sidebar única com projeto + sprint + visão + chips + atualizar | só o projeto sobe para a casca | Sprint, visão e chips só afetavam a guia Compromisso mesmo no original — uma sidebar global que muda uma guia é a confusão que estamos desfazendo. |
| 4 | Um "Atualizar dados" global | um por painel | Atualizam coisas diferentes; o do Cycle Time precisa mandar `force` ao servidor. |
| 5 | Painéis nunca desmontam | painel desmonta ao trocar de guia | Ver "Remontagem dos painéis". |
| 6 | `?tab=` + `history.replaceState` à mão | guia = caminho real | O lovable tem roteador; o original não tinha. |
| 7 | Roleta importada dinamicamente na 1ª abertura | rota carregada pelo roteador | O *code splitting* por rota já entrega o mesmo efeito. |

---

## Verificação

O projeto não tem *test runner* (`package.json` só traz `dev`, `build`,
`build:dev`, `preview`, `lint`, `format`) e esta demanda **não introduz um**.
Verificação estática + roteiro manual, como nas seis specs anteriores.

### Estática

- `npm run lint` e `npm run build` passam.
- `src/routeTree.gen.ts` foi **regenerado** pelo plugin (não editado à mão) e
  contém `/`, `/compromisso`, `/cycle-time`, `/retrospectivas` com o mesmo
  `fullPath` de hoje, além de `/admin` e `/aceitar-convite` **fora** da árvore
  do `_shell`.
- Nenhum `import` de `ThemeToggle`, `AuthCard` ou `AccessDenied` sobra nos quatro
  componentes de painel (`grep`), e nenhum `<Link to="/compromisso">` fora de
  `src/components/shell/`.
- `grep -ri "quadro" src/` devolve **só** identificadores (`BoardGrid`,
  `board.ts`, `["board"…]`, `can_view_board`) — nenhum texto visível.

### Roteiro manual

1. `/` → um cabeçalho só, com logo, seletor mostrando `PIM`, e a barra com as
   quatro guias na ordem Compromisso → Cycle Time → Retrospectivas → Alocações,
   com **Alocações** marcada (`aria-selected="true"`). O quadro está idêntico ao
   de antes. Aba do navegador: "Alocações — Sprint Board".
2. Clicar em "Compromisso" → URL `/compromisso?project=PIM`; **um** cabeçalho;
   sidebar **sem** o campo "Projeto"; sprint ativa selecionada.
3. Trocar para `PH` no seletor da casca → URL atualiza sem criar entrada nova de
   histórico; Compromisso recarrega no `PH`. Ir para "Cycle Time" → **continua
   `PH`**, sem segunda seleção. Ir para "Alocações" → quadro do `PH`.
4. Recarregar em `/cycle-time?project=PH` → abre na guia Cycle Time, `PH`
   selecionado. Copiar essa URL e abrir em outra janela (após login) → mesma
   visão. Duas abas em dois projetos diferentes ao mesmo tempo → cada uma
   mantém o seu.
5. `/cycle-time?project=FOO` → abre normalmente no projeto persistido (ou `PIM`),
   **sem** 404 e sem tela em branco.
6. Voltar/avançar do navegador percorre as guias visitadas; a rolagem de cada
   guia é restaurada.
7. Retrospectivas → contador visível, "Sortear" funciona; sair para outra guia e
   voltar → sorteados/ausentes/vencedor preservados.
8. Compromisso → Cycle Time → Compromisso: os dados voltam do cache sem
   *spinner*; a sprint volta para a ativa (comportamento esperado, registrado).
9. Logout pelo cabeçalho → `AuthCard`; login → volta para a mesma URL.
10. Papel `viewer` → sem "Sprint"/"Pessoa" no *toolbar* das Alocações, sem link
    "Usuários"; **as quatro guias visíveis e funcionando**.
11. Usuário sem papel → `AccessDenied` **uma vez**, sem cabeçalho e sem barra de
    guias, em qualquer uma das quatro URLs.
12. `/admin` → cabeçalho próprio, **sem** seletor de projeto, `Tabs` internas
    intactas, link "Alocações" volta para `/`. `/aceitar-convite` → inalterada,
    sem link de volta.
13. Alternar tema pelo cabeçalho → persiste ao trocar de guia e ao recarregar.
14. **Teste de degradação (o que a spec de Alocações exigiu):** com
    `JIRA_API_TOKEN` inválido, o seletor **continua listando os quatro projetos**
    (por chave, sem o nome do Jira); **Alocações funciona por completo**;
    Compromisso e Cycle Time mostram os próprios erros. Nenhuma tela em branco,
    nenhum seletor vazio.
15. Rolagem: nenhuma das quatro guias produz barra de rolagem dupla (o `h-screen`
    dos painéis foi removido).

---

## Ordem de implementação

1. `src/components/shell/tabs.ts`, `shell-context.tsx` e `AppShell.tsx` — a
   casca com o seletor alimentado por `JIRA_PROJECTS` e rótulos enriquecidos por
   `getJiraProjects()`
2. `src/routes/_shell.tsx` — `ssr:false`, `validateSearch` de `project`,
   preâmbulo de sessão, resolução/persistência (`lastProject`), provider
3. Mover os quatro arquivos de rota para `src/routes/_shell/`, esvaziando o
   preâmbulo; deixar o plugin regenerar `routeTree.gen.ts` e conferir as URLs
4. `BoardGrid` — cabeçalho → *toolbar*, props `email`/`isAdmin` fora, altura
5. `CompromissoView` + `CompromissoSidebar` — cabeçalho e campo "Projeto" fora,
   `project` do contexto
6. `CycleTimeView` — cabeçalho fora, "Recalcular" para o *toolbar*, `project` do
   contexto, `CycleTimePane` sem o ramo `!project`
7. `RouletteView` — cabeçalho fora, contador preservado
8. `staleTime` nas três famílias de query do Jira
9. Renomeações de texto (tabela do rename), incluindo `/admin`
10. Roteiro manual + `npm run lint` + `npm run build`

Os passos 1-3 entregam a casca com os painéis ainda mostrando os cabeçalhos
antigos — feio, mas funcional e navegável, o que permite validar o roteamento e o
seletor compartilhado **antes** de mexer em quatro componentes grandes. Os passos
4-7 são independentes entre si e podem ser feitos em qualquer ordem; o passo 4
é o que colide com a spec de Alocações e deve ser o último a ser encostado se as
duas frentes estiverem abertas ao mesmo tempo.

---

## Riscos e dependências da spec de Alocações

Esta spec **assume** que `2026-08-10-alocacoes-projeto-design.md` já entregou:

1. `src/lib/projects.ts` com `JIRA_PROJECTS: readonly {key,name}[]` e
   `type JiraProjectKey`.
2. `src/components/ProjectSelect.tsx` controlado (`project` / `onProjectChange`).
3. `BoardGrid` controlado, filtrando as quatro queries por `jira_project` e com o
   projeto nas `queryKey`.
4. `ALLOWED_PROJECTS` derivando de `JIRA_PROJECTS`.

Riscos, em ordem de probabilidade:

1. **`ProjectSelect` pode não aceitar as opções por prop.** A spec de Alocações
   diz de onde vem a lista, não se ela é lida por `import` dentro do componente ou
   recebida. Se for `import` interno, a casca não consegue injetar os rótulos
   vindos do Jira. **Não invento contrato:** ver a pergunta 1 no final.
2. **`alocacoesLastProject` pode já existir.** Se Alocações for implementada
   antes, essa chave nasce e morre. Sem efeito funcional (esta spec cria
   `lastProject`), mas o plano de Alocações deveria simplesmente não criá-la.
3. **`onProjectChange` no `BoardGrid`.** Depois desta spec o `BoardGrid` recebe
   só `project`. Executar o plano de Alocações literalmente **depois** desta spec
   readicionaria a prop e um `<ProjectSelect>` dentro do quadro — segundo seletor
   na tela.
4. **Colisão de diff em `BoardGrid.tsx`.** As duas specs mexem no mesmo
   `<header>`: Alocações **acrescenta** `<ProjectSelect>` ali, esta **remove** o
   `<header>`. Se as duas frentes rodarem em paralelo, o conflito é certo.
5. **Retrospectivas sob um projeto que não é o dela.** Com `PH` selecionado, a
   guia mostra a lista de participantes do PIM (`participants.ts`; o commit
   `d82ae6a` do `jira-live` diz "conforme #paporeto (PIM)"). É o que foi
   determinado — gate estrutural sem filtro — mas é visível e reportável como bug
   por quem usar. Ver a pergunta 3 no final.
6. **`validateSearch` em rota de layout.** Herança de search param por rotas
   filhas é API documentada do TanStack Router, mas não foi exercitada neste
   repositório (nenhuma rota usa `validateSearch` hoje). Fallback já definido em
   "Onde mora o valor do projeto".

---

## Resumo das decisões

1. **Guia = rota**, via rota de layout sem caminho `src/routes/_shell.tsx`; `/`,
   `/compromisso`, `/cycle-time` e `/retrospectivas` seguem sendo as URLs de hoje.
2. Ordem da barra fiel ao `jira-live`: **Compromisso → Cycle Time →
   Retrospectivas → Alocações**; `/` continua sendo Alocações (divergência
   deliberada: era Compromisso a guia padrão do original).
3. **Seletor único na casca**: chaves sempre de `JIRA_PROJECTS`, rótulos
   enriquecidos por `getJiraProjects()` — a degradação exigida pela spec de
   Alocações passa a ser estrutural, sem ramo de fallback.
4. **Projeto na URL** (`?project=`) com `localStorage.lastProject` como padrão;
   as três chaves por tela colapsam numa só e as antigas ficam órfãs sem migração.
5. **Não existe estado "sem projeto"**: a resolução é síncrona e sempre válida, os
   quatro ramos `!project` são deletados, `project` é não anulável no contexto, e
   a barra de guias fica sempre visível (exceto se `JIRA_PROJECTS` estiver vazia).
6. Preâmbulo de sessão **uma vez** na casca; `email`/`canEdit`/`isAdmin`/`project`
   chegam aos painéis por contexto, porque `<Outlet/>` não aceita props.
7. Os quatro `<header>` somem, mas os **controles próprios de cada tela**
   (busca, Sprint/Pessoa, chips, Recalcular, contador da roleta) são preservados
   em *toolbars* de painel.
8. Rename Quadro → **Alocações** em todo texto visível (13 pontos tabelados);
   identificadores (`BoardGrid`, `board.ts`, `can_view_board`) **não** mudam.
9. `/admin` e `/aceitar-convite` ficam fora da casca, sem seletor de projeto,
   confirmando o pedido; o link "Usuários" sobe para o cabeçalho da casca.
10. Custo aceito: painéis desmontam ao trocar de guia (perde-se ordenação, chips e
    sprint escolhida); mitigado com `staleTime` nas queries do Jira.
