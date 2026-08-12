# Navegação Unificada — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma casca só para as quatro telas — um cabeçalho, um seletor de projeto, uma barra de guias na ordem do `jira-live` e o preâmbulo de sessão rodando uma vez. Trocar de guia troca o painel; não troca o projeto, a sessão, o tema nem o cabeçalho. O quadro passa a se chamar **Alocações** em todo texto visível.

**Architecture:** Uma rota de layout sem caminho (`src/routes/_shell.tsx`) vira a única dona do preâmbulo de sessão, da lista de projetos e do projeto efetivo. As quatro telas de hoje passam a ser filhas dela (`src/routes/_shell/{index,compromisso,cycle-time,retrospectivas}.tsx`) e mantêm exatamente as URLs atuais, porque o prefixo `_` faz o segmento não existir na URL. O projeto mora na URL (`?project=`) com `localStorage["lastProject"]` como padrão, resolvido de forma síncrona para uma chave sempre válida — por isso `project` chega aos painéis como tipo **não anulável**, via React context (`useShell()`), e os quatro ramos `!project` de hoje morrem como código morto. As opções do seletor vêm sempre de `JIRA_PROJECTS` (constante local) e só os **rótulos** são enriquecidos por `getJiraProjects()`: a degradação sem Jira é estrutural, não um `catch`. Os quatro `<header>` de painel somem; os controles próprios de cada tela (busca, Sprint/Pessoa, chips, "Recalcular", contador da roleta) descem para *toolbars* dentro do painel.

**Tech Stack:** TanStack Start + React 19, TanStack Router 1.170 (route tree gerado pelo `@tanstack/router-plugin`, rotas de layout com prefixo `_`, `validateSearch`), TanStack Query v5, shadcn/ui (Radix Select, Tabs), Tailwind v4, TypeScript 5.8 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`).

**Spec:** [`docs/superpowers/specs/2026-08-10-navegacao-unificada-design.md`](../specs/2026-08-10-navegacao-unificada-design.md)

## Global Constraints

- **Este plano roda DEPOIS de [`2026-08-10-alocacoes-projeto.md`](./2026-08-10-alocacoes-projeto.md), inteiro e aplicado.** Ele assume, e não recria: `src/lib/projects.ts` (`JIRA_PROJECTS`, `type JiraProjectKey`, `isJiraProjectKey`), `src/components/ProjectSelect.tsx` (opções por prop, `export type ProjectOption`), `BoardGrid` controlado (`project` + `onProjectChange` por prop, quatro queries com `.eq("jira_project", …)` e projeto na `queryKey`), `DevDialog`/`SprintDialog` recebendo `project`, `src/lib/board-errors.ts` e as duas migrations. **Nada disso é redefinido aqui.**
- **Idioma da UI:** pt-BR em todo texto visível, com acentuação correta.
- **O rename é de texto, não de identificadores.** `BoardGrid` (arquivo e componente), `src/lib/board.ts`, `src/lib/board-errors.ts`, as `queryKey` `["board", …]`, `private.can_view_board`/`can_edit_board` e `assertCanViewBoard` **continuam com os nomes que têm**. Renomeá-los é churn e garantiria conflito com o diff da frente de Alocações.
- **Nenhuma migration, nenhuma policy, nenhuma tabela.** Esta demanda não toca no banco.
- **`/admin` e `/aceitar-convite` ficam FORA da casca** — irmãs de `_shell.tsx`, com os cabeçalhos próprios que já têm e **sem seletor de projeto**. `admin.tsx` continua chamando `useAuthorizedSession()` por conta própria (a condição dele é `isAdmin`, não `canView`). `aceitar-convite.tsx` **não muda em nada** e continua sem link de volta.
- **Não editar `src/routeTree.gen.ts` à mão.** É gerado pelo `@tanstack/router-plugin` no `vite dev`/`vite build`, é versionado e **entra nos commits** das tasks que mexem em arquivos de rota.
- **`project` é não anulável em tudo o que a casca alimenta.** A resolução é síncrona e sempre cai numa chave válida. O único estado sem projeto é erro de configuração (`JIRA_PROJECTS` vazia), tratado uma vez, na casca.
- **A lista do seletor nunca vem da rede.** `JIRA_PROJECTS` dá as chaves; `getJiraProjects()` só melhora o rótulo. Não existe ramo de fallback a escrever, e é assim que o requisito de degradação da spec de Alocações é atendido.
- **Uma chave de `localStorage` para projeto: `lastProject`.** `compromissoLastProject`, `cycleTimeLastProject` e `alocacoesLastProject` ficam **órfãs, sem código de migração** (decisão registrada na spec). `cycleTimeView` e `compromissoAssignee:<projeto>` **ficam**.
- **Sem test runner.** `package.json` só traz `dev`, `build`, `build:dev`, `preview`, `lint`, `format`, e esta demanda **não introduz um**. A verificação é `npx tsc --noEmit` + `npx eslint <arquivos tocados>` + `npm run build` + roteiro manual no navegador.
- **Não fazer `git push`.** O repositório sincroniza com o Lovable; publicar é decisão do usuário ao final.
- **Nunca reescrever histórico** (sem `rebase`, `amend` ou `squash` de commits publicados) — restrição do `AGENTS.md`.

### Verificação de código: sempre nesta ordem

```bash
npx prettier --write <arquivos tocados>
npx eslint <arquivos tocados>
npx tsc --noEmit
```

**Nunca rodar `npm run lint` sem escopo.** O checkout tem `core.autocrlf=true`, então todo arquivo do repositório chega com CRLF e a regra `prettier/prettier` reprova centenas de linhas em arquivos que a task não tocou. É ruído pré-existente. O `npx prettier --write` nos arquivos tocados normaliza para LF e resolve; como o git normaliza CRLF↔LF na comparação, isso **não** gera diff espúrio.

`npm run build` entra nas tasks que criam, movem ou apagam arquivos de rota — é ele que regenera `src/routeTree.gen.ts`.

### Nota sobre os nomes de rota gerados

Com `_shell.tsx` como rota de layout, os ids de arquivo que o `createFileRoute` recebe passam a ser:

| Arquivo | `createFileRoute(…)` | URL |
| --- | --- | --- |
| `src/routes/_shell.tsx` | `"/_shell"` | — (sem caminho) |
| `src/routes/_shell/index.tsx` | `"/_shell/"` | `/` |
| `src/routes/_shell/compromisso.tsx` | `"/_shell/compromisso"` | `/compromisso` |
| `src/routes/_shell/cycle-time.tsx` | `"/_shell/cycle-time"` | `/cycle-time` |
| `src/routes/_shell/retrospectivas.tsx` | `"/_shell/retrospectivas"` | `/retrospectivas` |

Escrever a string como está na tabela. Se o plugin do TanStack Router reescrever o argumento ao rodar `npm run build`, **aceitar a reescrita dele e comitá-la** — o plugin é a autoridade sobre o id, não este documento. Se o gerador recusar o nome `_shell`, o fallback literal do `src/routes/README.md` é `_layout.tsx` + `_layout/` (renomear os cinco arquivos e as cinco strings; nada mais muda).

### Ordem das tasks e por que ela difere da spec

A "Ordem de implementação" da spec manda mover os quatro arquivos de rota num passo só (passo 3) e mexer no `BoardGrid` depois (passo 4). Aqui isso é **quebrado em dois**: a Task 3 move Compromisso, Cycle Time e Retrospectivas, e a Task 4 move `index.tsx` **junto com** a mudança de assinatura do `BoardGrid`. Motivo mecânico: `routes/index.tsx` é hoje o dono do estado `project` e passa `project`/`onProjectChange`/`email`/`isAdmin` ao `BoardGrid`; mover esse arquivo para dentro da casca sem mudar a assinatura do `BoardGrid` deixaria a árvore com erro de `tsc` atravessando duas tasks. É a mesma razão pela qual a Task 7 do plano de Alocações é uma unidade de compilação só.

Consequência aceita: ao fim da Task 3 existe um intervalo em que `/compromisso`, `/cycle-time` e `/retrospectivas` estão na casca (com cabeçalho duplicado, feio mas navegável) e `/` continua fora dela, sem barra de guias. Some na Task 4.

### Isolamento de trabalho

Este projeto usa `git worktree` (`.worktrees/<nome>`, já no `.gitignore`) quando faz sentido isolar a frente. **Não é decisão deste plano** — é de quem executa. Nenhuma task depende disso.

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `src/components/shell/tabs.ts` | `TABS` — a ordem das guias declarada num único lugar |
| `src/components/shell/shell-context.tsx` | `ShellProvider` + `useShell()`; `project` não anulável no tipo |
| `src/components/shell/AppShell.tsx` | Cabeçalho (logo, `ProjectSelect`, "Usuários", `ThemeToggle`, logout) + tablist + `{children}` |
| `src/routes/_shell.tsx` | Rota de layout: `ssr:false`, `validateSearch` de `project`, preâmbulo de sessão, resolução/persistência do projeto, provider |
| `src/routes/_shell/index.tsx` | Era `src/routes/index.tsx` → `/` (Alocações) |
| `src/routes/_shell/compromisso.tsx` | Era `src/routes/compromisso.tsx` → `/compromisso` |
| `src/routes/_shell/cycle-time.tsx` | Era `src/routes/cycle-time.tsx` → `/cycle-time` |
| `src/routes/_shell/retrospectivas.tsx` | Era `src/routes/retrospectivas.tsx` → `/retrospectivas` |

**Apagar:**

`src/routes/index.tsx`, `src/routes/compromisso.tsx`, `src/routes/cycle-time.tsx`, `src/routes/retrospectivas.tsx` — substituídos pelos filhos de `_shell/`.

**Modificar:**

| Arquivo | Mudança |
| --- | --- |
| `src/components/BoardGrid.tsx` | `<header>` → *toolbar* do painel; props `email`/`isAdmin`/`onProjectChange` fora; `project` não anulável; altura sem `h-screen`; textos do rename |
| `src/components/compromisso/CompromissoView.tsx` | `<header>` fora; `projectsQ`, estado `project`, efeito de primeiro projeto, `handleProjectChange`, `ls` e o ramo `!project` fora; `project` do contexto; prop `email` fora |
| `src/components/compromisso/CompromissoSidebar.tsx` | Bloco "Projeto" e props `projects`/`project`/`onProjectChange` fora |
| `src/components/cycle-time/CycleTimeView.tsx` | `<header>` fora, "Recalcular" para o *toolbar*; `projectsQ`, estado `project`, efeito, `handleProjectChange` e `LS_PROJECT` fora; `CycleTimePane.project` passa a `JiraProjectKey`; prop `email` fora |
| `src/components/retrospectivas/RouletteView.tsx` | `<header>` fora, contador preservado dentro do painel; prop `email` fora; altura |
| `src/components/admin/AdminView.tsx` | Rótulo do link de volta: "Quadro" → "Alocações" |
| `src/routes/admin.tsx` | Rótulo do botão: "Voltar ao quadro" → "Voltar para Alocações" |
| `src/lib/admin.ts` | Três descrições de papel |
| `src/components/admin/UserTable.tsx` | "Não enxerga o quadro" → "Não enxerga a plataforma" |
| `src/routeTree.gen.ts` | Regenerado pelo plugin (não editar à mão) |

**Não tocar:** `src/routes/__root.tsx` (o `<title>` "Sprint Board" é o nome do **produto**), `src/routes/aceitar-convite.tsx`, `src/components/AuthCard.tsx`, `src/components/AccessDenied.tsx`, `src/components/ProjectSelect.tsx`, `src/lib/projects.ts`, `src/lib/board.ts`, `src/lib/board-errors.ts`, `src/components/AllocationDialog.tsx`, `src/components/DevDialog.tsx`, `src/components/SprintDialog.tsx`, qualquer coisa em `src/integrations/`, qualquer migration.

---

## Task 1: `TABS` e o contexto da casca

Dois arquivos pequenos, sem nenhum dependente ainda — compilam e são revisáveis por si sós.

**Files:**
- Create: `src/components/shell/tabs.ts`
- Create: `src/components/shell/shell-context.tsx`

**Interfaces:**
- Consumes: `JiraProjectKey` (`@/lib/projects`), `LucideIcon` (`lucide-react`).
- Produces:
  - `export type TabDef = { id: string; to: "/compromisso" | "/cycle-time" | "/retrospectivas" | "/"; label: string; icon: LucideIcon }`.
  - `export const TABS` — quatro guias, na ordem Compromisso → Cycle Time → Retrospectivas → Alocações.
  - `export type ShellContextValue = { email: string; canEdit: boolean; isAdmin: boolean; project: JiraProjectKey }`.
  - `export function ShellProvider({ value, children })` e `export function useShell(): ShellContextValue`.

- [ ] **Step 1: Criar `src/components/shell/tabs.ts`**

```ts
import { ClipboardList, Dices, LayoutGrid, Timer, type LucideIcon } from "lucide-react";

/**
 * A ordem das guias vive AQUI e em nenhum outro lugar. Antes desta demanda ela
 * estava replicada em quatro `<header>` que já haviam divergido entre si
 * (RouletteView só linkava para `/`, CompromissoView não linkava para
 * Retrospectivas, "Usuários" existia só no BoardGrid).
 *
 * A ordem é a do jira-live (`static/index.html` 112-115, no commit 7d6b618):
 * Compromisso → Cycle Time → Retrospectivas → Alocação. "Alocações" é a QUARTA
 * guia e mora em `/` — divergência deliberada registrada na spec: `/` é a home
 * histórica do produto e o destino de `admin`/`aceitar-convite`. A ordem da
 * barra é fiel; o destino de `/` não muda.
 *
 * `id` existe para a marcação ARIA: cada guia recebe `id={"tab-" + id}` e o
 * `role="tabpanel"` aponta para o `id` da guia ativa via `aria-labelledby`.
 */
export type TabDef = {
  id: string;
  to: "/compromisso" | "/cycle-time" | "/retrospectivas" | "/";
  label: string;
  icon: LucideIcon;
};

export const TABS = [
  { id: "compromisso", to: "/compromisso", label: "Compromisso", icon: ClipboardList },
  { id: "cycle-time", to: "/cycle-time", label: "Cycle Time", icon: Timer },
  { id: "retrospectivas", to: "/retrospectivas", label: "Retrospectivas", icon: Dices },
  { id: "alocacoes", to: "/", label: "Alocações", icon: LayoutGrid },
] as const satisfies readonly TabDef[];
```

- [ ] **Step 2: Criar `src/components/shell/shell-context.tsx`**

```tsx
import { createContext, useContext, type ReactNode } from "react";
import type { JiraProjectKey } from "@/lib/projects";

/**
 * O que a casca garante aos painéis. `project` é NÃO ANULÁVEL de propósito: a
 * resolução em `_shell.tsx` é síncrona e sempre cai numa chave válida
 * (`search.project ?? localStorage["lastProject"] ?? JIRA_PROJECTS[0].key`), e
 * o único caminho sem projeto — `JIRA_PROJECTS` vazia — é tratado na casca,
 * antes de o provider existir.
 *
 * É esse tipo que apaga os quatro ramos `!project` de hoje como código morto,
 * em vez de os deixar como defesa duplicada dentro de cada painel.
 *
 * Contexto e não prop porque `<Outlet/>` não aceita props.
 */
export type ShellContextValue = {
  email: string;
  canEdit: boolean;
  isAdmin: boolean;
  project: JiraProjectKey;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({
  value,
  children,
}: {
  value: ShellContextValue;
  children: ReactNode;
}) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  // Lançar em vez de devolver um default: um painel fora da casca não tem
  // projeto nem papel, e um default silencioso esconderia o erro de rota.
  if (!ctx) {
    throw new Error("useShell() só funciona dentro da rota de layout _shell.");
  }
  return ctx;
}
```

- [ ] **Step 3: Verificar tipos e formatação**

```bash
npx prettier --write src/components/shell/tabs.ts src/components/shell/shell-context.tsx
npx eslint src/components/shell/tabs.ts src/components/shell/shell-context.tsx
npx tsc --noEmit
```

Esperado: sem erros. O `tsconfig.json` inclui `src/**/*.{ts,tsx}`, então os dois arquivos são checados mesmo sem importador. `react-refresh/only-export-components` é **warning** neste projeto (`eslint.config.js:37`) e o padrão "provider + hook no mesmo arquivo" já existe em `src/components/ui/sidebar.tsx` — se aparecer o aviso, ele é aceito e não vira erro.

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/tabs.ts src/components/shell/shell-context.tsx
git commit -m "feat(shell): add tab order and shell context"
```

---

## Task 2: `AppShell` — cabeçalho e barra de guias

Componente puro de apresentação: recebe tudo por prop e não sabe de sessão nem de `localStorage`. Ainda sem importador — compila isolado.

**Files:**
- Create: `src/components/shell/AppShell.tsx`

**Interfaces:**
- Consumes: `TABS` (Task 1), `ProjectSelect` + `type ProjectOption` (`@/components/ProjectSelect`, da frente de Alocações), `ThemeToggle`, `Button`, `supabase`, `Link`/`useLocation` do TanStack Router.
- Produces: `export function AppShell(props: { email: string; isAdmin: boolean; project: string; options: readonly ProjectOption[]; onProjectChange: (key: string) => void; children: ReactNode })`.

**Duas fileiras**, seguindo o padrão que o `BoardGrid` já usava (`172-275`): fileira 1 = ícone + "Sprint Board" · `ProjectSelect` · "Usuários" (`isAdmin`) · `ThemeToggle` · logout; fileira 2 (`border-t`) = a tablist. O **subtítulo por tela sai**: com quatro guias sob um cabeçalho só, ele teria de mudar a cada troca de painel para dizer o que a guia ativa já diz.

**"Usuários" não é uma guia.** Fica na fileira 1, ao lado do tema e do logout. A barra tem exatamente quatro itens.

- [ ] **Step 1: Criar `src/components/shell/AppShell.tsx`**

```tsx
import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { LayoutGrid, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectSelect, type ProjectOption } from "@/components/ProjectSelect";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { TABS } from "./tabs";

const TAB_BASE =
  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors";

export function AppShell({
  email,
  isAdmin,
  project,
  options,
  onProjectChange,
  children,
}: {
  email: string;
  isAdmin: boolean;
  /** `string` e não `JiraProjectKey`: é o contrato do ProjectSelect. */
  project: string;
  options: readonly ProjectOption[];
  onProjectChange: (key: string) => void;
  children: ReactNode;
}) {
  // Só para o `aria-labelledby` do tabpanel. O estado visual de cada guia sai
  // de `activeProps`/`inactiveProps` do próprio <Link>, que é o roteador
  // respondendo — não um segundo cálculo nosso.
  const pathname = useLocation({ select: (l) => l.pathname });
  const activeTab = TABS.find((t) => (t.to === "/" ? pathname === "/" : pathname.startsWith(t.to)));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-header text-header-foreground">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <LayoutGrid className="size-4" />
          </span>
          {/* "Sprint Board" é o nome do PRODUTO e continua aqui: Alocações é
              uma das quatro coisas que ele faz, não o todo. */}
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

        {/* Marcação do jira-live (`static/index.html` 116-120). Desvio de
            acessibilidade registrado na spec: são links reais, que respondem a
            Tab + Enter e alimentam o histórico; ficam SEM navegação por setas
            de propósito, porque meia implementação de roving tabindex seria
            pior que nenhuma. */}
        <nav
          role="tablist"
          aria-label="Navegação principal"
          className="flex flex-wrap items-center gap-1 border-t border-border px-4 py-1.5"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                key={tab.id}
                id={`tab-${tab.id}`}
                role="tab"
                to={tab.to}
                // Sem isto o roteador descarta `?project=` ao trocar de guia.
                search={(prev) => prev}
                // `exact` é obrigatório para a guia `/`: sem ele, o casamento
                // por prefixo deixaria Alocações ativa em todas as rotas.
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

      {/* `min-h-0 flex-1` + `overflow-hidden`: a casca ocupa a viewport e cada
          painel controla a própria rolagem. É o que permite tirar o `h-screen`
          dos quatro painéis sem produzir barra de rolagem dupla. */}
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

- [ ] **Step 2: Verificar tipos e formatação**

```bash
npx prettier --write src/components/shell/AppShell.tsx
npx eslint src/components/shell/AppShell.tsx
npx tsc --noEmit
```

Esperado: sem erros.

Se o `tsc` reclamar do tipo do parâmetro de `search={(prev) => prev}` (o roteador ainda não conhece o schema do `_shell`, que só nasce na Task 3), **anotar explicitamente** e seguir:

```tsx
                search={(prev: Record<string, unknown>) => prev}
```

Depois da Task 3 a inferência passa a funcionar; se a anotação ficar, é inofensiva.

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/AppShell.tsx
git commit -m "feat(shell): add shared app shell with header and tablist"
```

---

## Task 3: A rota de layout e as três guias do Jira/retro

Aqui a casca entra no ar. Ela nasce **com filhos** de propósito: uma rota de layout sem nenhum filho é código inalcançável e não valida nada.

Fim desta task: `/compromisso`, `/cycle-time` e `/retrospectivas` abrem dentro da casca, com um cabeçalho compartilhado e a barra de guias, e o preâmbulo de sessão rodando **uma vez**. Os três painéis ainda mostram os cabeçalhos antigos por baixo — feio, e é o intervalo aceito descrito nas Global Constraints. `/` continua fora da casca até a Task 4.

**Files:**
- Create: `src/routes/_shell.tsx`
- Create: `src/routes/_shell/compromisso.tsx`
- Create: `src/routes/_shell/cycle-time.tsx`
- Create: `src/routes/_shell/retrospectivas.tsx`
- Delete: `src/routes/compromisso.tsx`, `src/routes/cycle-time.tsx`, `src/routes/retrospectivas.tsx`
- Regenerado: `src/routeTree.gen.ts`

**Interfaces:**
- Consumes: `AppShell` (Task 2), `ShellProvider`/`useShell` (Task 1), `useAuthorizedSession`, `AuthCard`, `AccessDenied`, `Button`, `supabase`, `getJiraProjects`, `JIRA_PROJECTS`/`isJiraProjectKey`/`JiraProjectKey`, `type ProjectOption`.
- Produces:
  - Rota `/_shell` com `ssr:false`, `validateSearch` produzindo `{ project: JiraProjectKey | undefined }`, e o preâmbulo `loading → !session → !canView → sem projeto configurado → casca`.
  - `localStorage["lastProject"]` como a única chave de projeto do produto.
  - Rotas `/compromisso`, `/cycle-time`, `/retrospectivas` **com os mesmos `fullPath` de hoje**.

- [ ] **Step 1: Criar `src/routes/_shell.tsx`**

```tsx
import { useEffect, useMemo } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
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
import { ShellProvider } from "@/components/shell/shell-context";

/**
 * UMA chave, global, com o mesmo nome do jira-live (`app.js` 207-216, 264).
 * As três de tela (`compromissoLastProject`, `cycleTimeLastProject`,
 * `alocacoesLastProject`) ficam órfãs sem migração: `localStorage` tolera
 * chave não lida, e o efeito de não migrar é uma escolha de projeto a mais no
 * primeiro acesso depois do deploy. Código de migração não paga o próprio
 * custo de leitura.
 */
const LS_PROJECT = "lastProject";

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

type ShellSearch = { project: JiraProjectKey | undefined };

/**
 * Resolução SÍNCRONA e sempre válida: chave inválida na URL já chegou aqui
 * como `undefined` (o `validateSearch` coage), chave inválida no
 * `localStorage` cai no primeiro item da lista. `null` só com `JIRA_PROJECTS`
 * vazia — erro de configuração, tratado uma vez no componente.
 *
 * É esta função que faz o estado "nenhum projeto selecionado" não existir, e é
 * por isso que o contexto declara `project` não anulável.
 */
function resolveProject(fromUrl: JiraProjectKey | undefined): JiraProjectKey | null {
  if (fromUrl) return fromUrl;
  const stored = ls(LS_PROJECT);
  if (isJiraProjectKey(stored)) return stored;
  return JIRA_PROJECTS[0]?.key ?? null;
}

export const Route = createFileRoute("/_shell")({
  // A casca lê localStorage e a sessão do Supabase no boot. Os `ssr: false`
  // dos quatro filhos FICAM: são redundantes sob um pai client-only, e
  // mantê-los evita que mover um arquivo para fora da casca no futuro reative
  // SSR em silêncio.
  ssr: false,
  /**
   * Chave desconhecida é COAGIDA para `undefined`, nunca lançada: um link
   * antigo para um projeto que saiu da lista tem de abrir a aplicação, não um
   * erro de rota. `search["project"]` com colchetes por causa de
   * `noPropertyAccessFromIndexSignature`.
   */
  validateSearch: (search: Record<string, unknown>): ShellSearch => {
    const raw = search["project"];
    return { project: typeof raw === "string" && isJiraProjectKey(raw) ? raw : undefined };
  },
  component: Shell,
});

function Shell() {
  const { session, loading, canEdit, isAdmin, canView } = useAuthorizedSession();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  /**
   * As CHAVES vêm de `JIRA_PROJECTS`; só o RÓTULO vem do Jira. Não existe
   * fallback a executar: com token expirado, Atlassian instável ou a query em
   * voo, o seletor está completo e as Alocações funcionam. `enabled: canView`
   * porque `getJiraProjects` exige sessão + papel — sem isso a tela de login
   * dispararia uma server function que só pode falhar.
   */
  const projectsQ = useQuery({
    queryKey: ["jira", "projects"],
    queryFn: () => getJiraProjects(),
    enabled: canView,
    // A lista de projetos praticamente não muda, e com guia = rota cada troca
    // de guia remontaria esta query. Ver "Remontagem dos painéis" na spec.
    staleTime: 30 * 60_000,
  });

  const options = useMemo<ProjectOption[]>(
    () =>
      JIRA_PROJECTS.map((p) => ({
        key: p.key,
        name: projectsQ.data?.find((j) => j.key === p.key)?.name ?? p.name,
      })),
    [projectsQ.data],
  );

  const project = resolveProject(search.project);

  // Completa a URL no boot, para que qualquer endereço copiado da barra do
  // navegador já reabra a mesma tela. É o `history.replaceState` do
  // `syncUrl()` do jira-live, cujo comentário diz literalmente que sem isso
  // "era impossível mandar um link no Teams que reabrisse a mesma tela".
  // `replace` e não `push`: uma entrada de histórico por troca de projeto é
  // ruído.
  useEffect(() => {
    if (!project || search.project === project) return;
    void navigate({ search: (prev) => ({ ...prev, project }), replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, search.project]);

  function handleProjectChange(key: string) {
    // O Radix devolve `string`; isJiraProjectKey é o portão.
    if (!isJiraProjectKey(key)) return;
    save(LS_PROJECT, key);
    void navigate({ search: (prev) => ({ ...prev, project: key }), replace: true });
  }

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

  // O único estado sem projeto que existe: erro de configuração. A barra de
  // guias desaparece aqui e SÓ aqui — quatro guias clicáveis sobre painéis que
  // não têm o que mostrar é pior que uma frase.
  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Nenhum projeto configurado.</p>
      </div>
    );
  }

  const email = session.user.email ?? "";

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
}
```

**Fallback registrado, não a improvisar:** se a herança de search param por rotas filhas se mostrar hostil (a spec registra que `validateSearch` nunca foi exercitado neste repositório), a degradação é de uma linha — `project` passa a `useState` na casca, com a **mesma** chave de `localStorage`, e a URL carrega só a guia:

```tsx
const [project, setProject] = useState<JiraProjectKey | null>(() => resolveProject(undefined));
```

…mais `setProject(key)` dentro de `handleProjectChange`, e fora o `validateSearch`, o `useEffect`, os dois `navigate` e o parâmetro `fromUrl` do `resolveProject`. **Nenhum contrato de painel muda** — eles recebem `project` do contexto de qualquer forma. Nesse caso, riscar os itens 3, 4 e 5 do roteiro manual da Task 10 e registrar no commit.

- [ ] **Step 2: Criar `src/routes/_shell/compromisso.tsx`**

O `head()` é o de hoje, palavra por palavra. O preâmbulo (`loading`/`!session`/`!canView`/`AccessDenied`) e os imports de `AuthCard`, `AccessDenied`, `Button`, `supabase` e `useAuthorizedSession` **desaparecem** — quem responde por isso agora é o `_shell.tsx`.

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { CompromissoView } from "@/components/compromisso/CompromissoView";
import { useShell } from "@/components/shell/shell-context";

export const Route = createFileRoute("/_shell/compromisso")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Compromisso — Acompanhamento de sprint no Jira" },
      {
        name: "description",
        content: "Status, burndown e demandas da sprint ativa, direto do Jira.",
      },
    ],
  }),
  component: CompromissoPage,
});

function CompromissoPage() {
  // `email` continua vindo por prop nesta task porque o <header> do painel
  // ainda existe (ele tem o botão de logout). A Task 5 remove a prop e estas
  // duas linhas viram `return <CompromissoView />;`.
  const { email } = useShell();
  return <CompromissoView email={email} />;
}
```

- [ ] **Step 3: Criar `src/routes/_shell/cycle-time.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { CycleTimeView } from "@/components/cycle-time/CycleTimeView";
import { useShell } from "@/components/shell/shell-context";

export const Route = createFileRoute("/_shell/cycle-time")({
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
  // Prop temporária — some na Task 6, junto com o <header> do painel.
  const { email } = useShell();
  return <CycleTimeView email={email} />;
}
```

- [ ] **Step 4: Criar `src/routes/_shell/retrospectivas.tsx`**

O comentário sobre `canView` versus `canEdit` que estava na rota (`retrospectivas.tsx` 36-38) **sobe para cá como nota de escopo**: a decisão continua valendo, só quem a aplica mudou.

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { RouletteView } from "@/components/retrospectivas/RouletteView";
import { useShell } from "@/components/shell/shell-context";

// canView, não canEdit: sortear não escreve no banco. E não é público — os
// dados exibidos são exatamente o que a migration de RBAC fechou nas tabelas
// do board. A checagem em si mora no `_shell.tsx`, que é `canView` para as
// quatro guias.
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
  // Prop temporária — some na Task 7, junto com o <header> do painel.
  const { email } = useShell();
  return <RouletteView email={email} />;
}
```

- [ ] **Step 5: Apagar as três rotas antigas**

```bash
git rm src/routes/compromisso.tsx src/routes/cycle-time.tsx src/routes/retrospectivas.tsx
```

- [ ] **Step 6: Deixar o plugin regenerar o route tree e conferir as URLs**

```bash
npm run build
```

Esperado: build concluído. Depois:

```bash
grep -n "fullPath" src/routeTree.gen.ts | head -40
grep -n "'/compromisso'\|'/cycle-time'\|'/retrospectivas'\|'/admin'\|'/aceitar-convite'" src/routeTree.gen.ts | head -40
```

Esperado, e é isto que prova que nenhum link compartilhado quebrou: `/compromisso`, `/cycle-time` e `/retrospectivas` continuam aparecendo em `FileRoutesByFullPath` e em `fullPaths` **sem** o segmento `_shell`, e `/admin` e `/aceitar-convite` continuam filhas de `rootRouteImport` (fora da árvore do `_shell`). Se algum `fullPath` virar `/_shell/compromisso`, o arquivo foi para o lugar errado — `_shell/` tem de ser um diretório irmão do arquivo `_shell.tsx`, não um sufixo de nome.

- [ ] **Step 7: Verificar tipos e formatação**

```bash
npx prettier --write src/routes/_shell.tsx src/routes/_shell/compromisso.tsx src/routes/_shell/cycle-time.tsx src/routes/_shell/retrospectivas.tsx
npx eslint src/routes/_shell.tsx src/routes/_shell/compromisso.tsx src/routes/_shell/cycle-time.tsx src/routes/_shell/retrospectivas.tsx
npx tsc --noEmit
```

Esperado: sem erros. `src/routeTree.gen.ts` fica fora do `prettier`/`eslint` — é gerado, tem `/* eslint-disable */` e `@ts-nocheck` no topo.

Se o `tsc` reclamar de `Route.useNavigate()` mudando o caminho ao navegar só com `search` (a rota `_shell` é sem caminho), trocar as duas chamadas por `useNavigate()` **sem** `from` — a navegação sem `to` permanece na rota atual:

```tsx
import { useNavigate } from "@tanstack/react-router";
// …
const navigate = useNavigate();
```

Se ainda assim o caminho mudar em tempo de execução (visível no roteiro manual da Task 10, item 3), usar o **fallback de `useState`** do Step 1.

- [ ] **Step 8: Conferir no navegador que a casca está de pé**

```bash
npm run dev
```

Abrir `/compromisso` logado. Esperado: **dois** cabeçalhos (o da casca em cima, o antigo do painel embaixo — é o intervalo aceito), a barra com as quatro guias na ordem Compromisso → Cycle Time → Retrospectivas → Alocações, "Compromisso" com `aria-selected="true"`, o seletor da casca mostrando `PIM`, e a URL virando `/compromisso?project=PIM` sozinha. Clicar em "Cycle Time" → `/cycle-time?project=PIM`, cabeçalho da casca **não** recarrega. Clicar em "Alocações" → `/` ainda sem barra de guias (a Task 4 resolve).

- [ ] **Step 9: Commit**

```bash
git add src/routes/_shell.tsx src/routes/_shell/compromisso.tsx src/routes/_shell/cycle-time.tsx src/routes/_shell/retrospectivas.tsx src/routeTree.gen.ts
git commit -m "feat(shell): add pathless layout route and move three tabs under it"
```

---

## Task 4: Alocações na casca — rota `/` e `BoardGrid`

Uma task só porque é **uma unidade de compilação**: `routes/index.tsx` é hoje o dono do estado `project` e passa `project`/`onProjectChange`/`email`/`isAdmin` ao `BoardGrid`. Mover o arquivo sem mudar a assinatura do componente (ou o contrário) deixaria a árvore com erro de `tsc` atravessando duas tasks.

Fim desta task: as quatro guias vivem na casca, `/` é Alocações, e o `<header>` do quadro virou *toolbar* do painel sem perder nenhum controle próprio.

**Files:**
- Create: `src/routes/_shell/index.tsx`
- Delete: `src/routes/index.tsx`
- Modify: `src/components/BoardGrid.tsx` (imports, assinatura, quatro queries, header → toolbar, altura, `<main>`, diálogos, `EmptyState`)
- Regenerado: `src/routeTree.gen.ts`

**Interfaces:**
- Consumes: `useShell()` (Task 1), `JiraProjectKey`.
- Produces:
  - Rota `/` (id `/_shell/`) com `head()` renomeado para Alocações.
  - `BoardGrid` passa a exigir **apenas** `{ canEdit: boolean; project: JiraProjectKey }`. Saem `email`, `isAdmin` e `onProjectChange`.
  - `localStorage["alocacoesLastProject"]` deixa de ser escrita e lida (fica órfã).

**Nota de encaixe com o plano de Alocações — leia antes de editar.** A briefing desta frente descreve o `<ProjectSelect>` como estando num `<header>` de `src/routes/index.tsx`; no plano de Alocações efetivamente escrito, ele está no `<header>` do **`BoardGrid.tsx`** (Task 7, Step 5), e `routes/index.tsx` não tem `<header>` nenhum — só o preâmbulo, `LS_PROJECT = "alocacoesLastProject"`, os helpers `ls`/`save`, o `useState` e o `handleProjectChange`. **Este plano segue o código, não a briefing:** o `<ProjectSelect>` sai de dentro do `BoardGrid` (Step 4 abaixo) e o estado/persistência morre junto com `routes/index.tsx` (Step 7). Se ao abrir os arquivos o `<ProjectSelect>` estiver em outro lugar, remover onde ele estiver e não inventar um terceiro desenho.

- [ ] **Step 1: Criar `src/routes/_shell/index.tsx`**

O `head()` aqui é o **primeiro grupo de renames** da tabela da spec: `title`, `og:title`, `description` e `og:description`. O `<title>` "Sprint Board" do `__root.tsx` **não** muda — é o nome do produto.

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { BoardGrid } from "@/components/BoardGrid";
import { useShell } from "@/components/shell/shell-context";

const DESCRIPTION =
  "Alocações de sprints × pessoas, com status coloridos, tickets, férias e realocação por arrastar e soltar.";

export const Route = createFileRoute("/_shell/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Alocações — Sprint Board" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Alocações — Sprint Board" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AlocacoesPage,
});

function AlocacoesPage() {
  // Sessão, papel e projeto já foram resolvidos pela casca. `email` e `isAdmin`
  // não são mais repassados: o logout e o link "Usuários" moram no cabeçalho
  // compartilhado.
  const { canEdit, project } = useShell();
  return <BoardGrid canEdit={canEdit} project={project} />;
}
```

- [ ] **Step 2: Trocar o bloco de imports de `BoardGrid.tsx` (linhas 1-43)**

Saem `Link` do roteador, os ícones que só o cabeçalho usava (`ClipboardList`, `Dices`, `LayoutGrid`, `LogOut`, `Timer`, `Users`), o `ThemeToggle`, o `ProjectSelect` e os dois helpers de `@/lib/projects` que só o seletor usava (`JIRA_PROJECTS`, `isJiraProjectKey`). **Ficam** `supabase` (as quatro queries e a mutação usam), `Input`/`Search` (a busca continua, no *toolbar*), `Button`, `CalendarPlus`, `UserPlus`, `Pencil`, `Plus`, `ExternalLink` e o `type JiraProjectKey`.

```tsx
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CalendarPlus, ExternalLink, Pencil, Plus, Search, UserPlus } from "lucide-react";
import {
  accentClassFor,
  chipClassFor,
  formatRange,
  statusInfo,
  tipoInfo,
  washClassFor,
  STATUS_LIST,
  TIPO_LIST,
  type Allocation,
  type AllocationStatus,
  type AllocationTipo,
  type Dev,
  type Sprint,
  type Team,
} from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AllocationDialog, toDraft, type AllocationDraft } from "./AllocationDialog";
import { DevDialog } from "./DevDialog";
import { SprintDialog } from "./SprintDialog";
```

Conferir contra o arquivo real antes de colar: os imports de `@/lib/board`, `HoverCard`, `Tooltip` e os três diálogos são os de hoje e não mudam; `boardErrorMessage` foi acrescentado pela Task 8 do plano de Alocações.

A auditoria de ícones foi feita contra o arquivo atual: `Users`, `Timer`, `ClipboardList`, `Dices`, `LogOut`, `LayoutGrid` e `Link` aparecem **só** entre as linhas 210 e 234 (o cabeçalho), e por isso saem. `Plus` (478), `ExternalLink` (532, 562), `UserPlus` (206, 619), `CalendarPlus` (622), `Pencil` e `Search` têm uso fora do cabeçalho e **ficam**. Refazer o `grep` se o plano de Alocações tiver mexido nessas linhas:

```bash
grep -n "LayoutGrid\|LogOut\|Timer\|ClipboardList\|Dices\|Users\|<Link\|ThemeToggle" src/components/BoardGrid.tsx
```

Esperado: só linhas dentro do `<header>` que este step remove.

- [ ] **Step 3: Trocar a assinatura (a que o plano de Alocações deixou)**

Substituir:

```tsx
export function BoardGrid({
  email,
  canEdit,
  isAdmin,
  project,
  onProjectChange,
}: {
  email: string;
  canEdit: boolean;
  isAdmin: boolean;
  project: JiraProjectKey | null;
  onProjectChange: (p: JiraProjectKey) => void;
}) {
```

por:

```tsx
export function BoardGrid({
  canEdit,
  project,
}: {
  canEdit: boolean;
  /**
   * NÃO ANULÁVEL: a casca (`src/routes/_shell.tsx`) garante uma chave válida
   * de forma síncrona. O ramo "Selecione um projeto." e o `enabled: !!project`
   * que existiam aqui eram defesa contra um estado que não existe mais.
   *
   * `onProjectChange` saiu: o seletor mora no cabeçalho compartilhado, e um
   * segundo seletor dentro do quadro é exatamente o que esta frente desfaz.
   */
  project: JiraProjectKey;
}) {
```

(O bloco de comentário longo que o plano de Alocações pôs sobre `project` é substituído por este — ele descrevia o componente como controlado por `routes/index.tsx`, que não existe mais.)

- [ ] **Step 4: Apagar o que sobrou do seletor dentro do quadro**

Três remoções no corpo do componente:

1. A função `handleProjectChange` inteira (a que faz `if (isJiraProjectKey(key)) onProjectChange(key)`), acrescentada pela Task 7 Step 4 do plano de Alocações.
2. O bloco `<ProjectSelect value={project} options={JIRA_PROJECTS} onChange={handleProjectChange} />` do header — ele desaparece junto com o header, no Step 5.
3. Nas quatro queries (`devsQ`, `teamsQ`, `sprintsQ`, `allocQ`): apagar a linha `enabled: !!project,` e trocar `.eq("jira_project", project!)` por `.eq("jira_project", project)`. Com o tipo não anulável, `enabled` é sempre `true` e o `!` é uma asserção sobre um valor que já não pode ser nulo. O comentário acima de `devsQ` que explica `enabled: !!project` (três linhas, começando em "`enabled: !!project`: no TanStack Query v5…") sai com ele; o resto do comentário — o que explica o `.eq` plano e a `queryKey` compartilhada com o `DevDialog` — **fica**.

**Nada mais nas queries muda:** `queryKey: ["board", "<tabela>", project]`, a ordenação e a invalidação por prefixo são do plano de Alocações e continuam como estão.

- [ ] **Step 5: Trocar o `<header>` pelo *toolbar* do painel**

Este é o ponto de erro mais fácil da migração: o cabeçalho do `BoardGrid` mistura cruzeta de navegação com controles do próprio quadro. O que sai e o que fica:

| Elemento | Destino |
| -------- | ------- |
| ícone `LayoutGrid` + `<h1>Sprint Board</h1>` + subtítulo | **sai** (virou o logo da casca) |
| `<ProjectSelect>` (do plano de Alocações) | **sai** (subiu para a casca) |
| `Input` de busca | **fica** no *toolbar* |
| botões "Sprint" e "Pessoa" com `canEdit` | **ficam** no *toolbar*, sem o `disabled={!project}` |
| link "Usuários" com `isAdmin` | **sai** (subiu para a casca) |
| links `/cycle-time`, `/compromisso`, `/retrospectivas` | **saem** (viraram guias) |
| `<ThemeToggle/>` e botão de logout | **saem** (subiram para a casca) |
| fileira de chips Tipo/Status | **fica** no *toolbar* |

Substituir tudo desde `<div className="flex h-screen flex-col overflow-hidden bg-background">` até o `</header>` por:

```tsx
      {/* `min-h-0 flex-1` e não `h-screen`: a casca já ocupa a viewport, e um
          filho `h-screen` dentro dela produz rolagem dupla. O
          `overflow-y-auto` do container do grid continua sendo o que rola. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {/* Toolbar DO PAINEL: só controles do quadro. Navegação, projeto, tema,
            logout e "Usuários" moram no cabeçalho da casca. */}
        <div className="shrink-0 border-b border-border bg-surface-2">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar demanda ou ticket"
                className="h-9 w-56 pl-8"
              />
            </div>

            {canEdit ? (
              <>
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

          <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Tipo
            </span>
            <FilterChip active={tipoFilter === "todos"} onClick={() => setTipoFilter("todos")}>
              Todos
            </FilterChip>
            {TIPO_LIST.map((t) => (
              <FilterChip
                key={t.value}
                active={tipoFilter === t.value}
                onClick={() => setTipoFilter(t.value)}
              >
                <span className={`size-2 rounded-full ${t.dot}`} />
                {t.label}
              </FilterChip>
            ))}

            <span className="mx-1 h-4 w-px bg-border" />

            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Status
            </span>
            <FilterChip active={statusFilter === "todos"} onClick={() => setStatusFilter("todos")}>
              Todos
            </FilterChip>
            {STATUS_LIST.map((s) => (
              <FilterChip
                key={s.value}
                active={statusFilter === s.value}
                onClick={() => setStatusFilter(s.value)}
              >
                <span className={`size-2 rounded-full ${s.dot}`} />
                {s.label}
              </FilterChip>
            ))}
          </div>
        </div>
```

- [ ] **Step 6: Simplificar o `<main>` e os diálogos, e renomear os dois textos**

No `<main>`, apagar o ramo `!project` (o `{!project ? (<p>Selecione um projeto.</p>) : loading ? (` volta a ser `{loading ? (`) junto com o comentário de quatro linhas que o justificava, e renomear os dois textos visíveis:

```tsx
        <main className="min-h-0 flex-1 p-4">
          {loading ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              Carregando alocações…
            </p>
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
```

O resto do `<main>` (o `<div>` do grid e o `)}` `</main>`) fica **exatamente** como está.

E nos diálogos, desembrulhar o `{project ? (<> … </>) : null}` que o plano de Alocações pôs em volta de `DevDialog`/`SprintDialog` — com `project` não anulável ele é sempre verdadeiro:

```tsx
        <AllocationDialog draft={draft} onOpenChange={(o) => !o && setDraft(null)} />
        <DevDialog
          dev={devDialog.dev}
          open={devDialog.open}
          count={devs.length}
          project={project}
          onOpenChange={(o) => setDevDialog({ open: o, dev: o ? devDialog.dev : null })}
        />
        <SprintDialog
          sprint={sprintDialog.sprint}
          open={sprintDialog.open}
          count={sprints.length}
          project={project}
          onOpenChange={(o) => setSprintDialog({ open: o, sprint: o ? sprintDialog.sprint : null })}
        />
```

E no `EmptyState` (fim do arquivo), renomear só o `<h2>`:

```tsx
      <h2 className="text-lg font-semibold">Vamos montar as alocações do {project}</h2>
```

O parágrafo seguinte ("Cadastre as pessoas e as sprints do {project}. Depois é só clicar em cada célula para alocar as demandas.") **já não tem a palavra "quadro"** — o plano de Alocações reescreveu essa frase. A linha da tabela de rename da spec que pedia "mantém o sentido, sem a palavra quadro" está **satisfeita, sem edição**. Registrado aqui para não parecer esquecimento.

- [ ] **Step 7: Apagar `src/routes/index.tsx`**

```bash
git rm src/routes/index.tsx
```

É aqui que `alocacoesLastProject` deixa de existir no código: a constante `LS_PROJECT`, os helpers `ls`/`save`, o `useState<JiraProjectKey | null>` e o `handleProjectChange` morrem com o arquivo. A chave fica órfã no `localStorage` de quem já usou a versão anterior, sem migração — decisão da spec.

- [ ] **Step 8: Regenerar o route tree e conferir**

```bash
npm run build
grep -n "'/': typeof" src/routeTree.gen.ts
grep -rn "alocacoesLastProject" src/
```

Esperado: build concluído; `/` presente em `FileRoutesByFullPath`/`FileRoutesByTo`; e **nenhum** resultado para `alocacoesLastProject`.

- [ ] **Step 9: Verificar tipos e formatação**

```bash
npx prettier --write src/routes/_shell/index.tsx src/components/BoardGrid.tsx
npx eslint src/routes/_shell/index.tsx src/components/BoardGrid.tsx
npx tsc --noEmit
```

Esperado: sem erros. Se o `tsc` reclamar de `project` possivelmente `null` em `DevDialog`/`SprintDialog`/`EmptyState`, o Step 3 não foi aplicado por inteiro. Se reclamar de `email` ou `isAdmin` faltando em `<BoardGrid>`, sobrou um call site — só deve existir o de `_shell/index.tsx`.

- [ ] **Step 10: Conferir no navegador**

Com `npm run dev`, abrir `/`. Esperado: **um** cabeçalho; a barra com as quatro guias e "Alocações" marcada; o *toolbar* do quadro com busca, "Sprint", "Pessoa" e os chips; o quadro idêntico ao de antes; aba do navegador escrita "Alocações — Sprint Board"; **nenhuma barra de rolagem dupla**.

- [ ] **Step 11: Commit**

```bash
git add src/routes/_shell/index.tsx src/components/BoardGrid.tsx src/routeTree.gen.ts
git commit -m "feat(shell): move Alocações into the shell and turn its header into a panel toolbar"
```

---

## Task 5: `CompromissoView` e `CompromissoSidebar`

Independente das Tasks 6 e 7 — podem sair em qualquer ordem entre si.

**Files:**
- Modify: `src/components/compromisso/CompromissoView.tsx`
- Modify: `src/components/compromisso/CompromissoSidebar.tsx`
- Modify: `src/routes/_shell/compromisso.tsx` (deixa de passar `email`)

**Interfaces:**
- Consumes: `useShell()`.
- Produces: `CompromissoView` sem props; `CompromissoSidebar` sem `projects`/`project`/`onProjectChange`.

**Nada migra para *toolbar* aqui.** Sprint, visão, chips e "Atualizar dados" já vivem dentro do painel, na `CompromissoSidebar` — que é exatamente a divergência 3 da spec: no `jira-live` a sidebar era global e mexia numa guia só; aqui **só o projeto** sobe.

- [ ] **Step 1: Trocar os imports de `CompromissoView.tsx` (linhas 1-23)**

Saem `Link`, os três ícones do cabeçalho (`LayoutGrid`, `LogOut`, `Timer`), `Button`, `supabase`, `ThemeToggle` e `getJiraProjects`. `Button` e `supabase` eram usados **só** no `<header>`; confirmar com um `grep` antes de remover (Step 6). `useEffect`, `useMemo`, `useState`, `useQuery`, `useQueryClient` e `toast` ficam.

```tsx
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getJiraIssues, getJiraSprint, getJiraSprints } from "@/integrations/jira/server-fns";
import { computeContabilizados, isDoneInSprint, sprintDoneBound } from "@/lib/compromisso/calc";
import type { IssueResponse, SprintResponse } from "@/lib/compromisso/types";
import { useShell } from "@/components/shell/shell-context";
import { CompromissoSidebar, type ViewMode } from "./CompromissoSidebar";
import { SprintBar } from "./SprintBar";
import { StatsCards } from "./StatsCards";
import { BurndownCard } from "./BurndownCard";
import { IssuesTable } from "./IssuesTable";
import { SPSummaryCard } from "./SPSummaryCard";
import { ChartsRow } from "./ChartsRow";
```

- [ ] **Step 2: Apagar o helper `ls` e trocar a assinatura e o estado (linhas 40-70)**

O helper `ls` (linhas 40-46) existia **só** para ler `compromissoLastProject` na inicialização do estado; com o projeto vindo da casca ele fica órfão e sai.

Substituir o bloco que vai de `const ls = (key: string) => {` até o fim do efeito de primeiro projeto (`}, [project, projectsQ.data]);`) por:

```tsx
export function CompromissoView() {
  const qc = useQueryClient();

  // Projeto e sessão vêm da casca. Foram-se: o estado `project`, a query
  // ["jira","projects"] duplicada, o efeito "se não tem projeto, pega o
  // primeiro" e a chave `compromissoLastProject`.
  const { project } = useShell();

  const [sprintId, setSprintId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [assigneeSel, setAssigneeSel] = useState<Set<string>>(new Set());
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [, setTick] = useState(0);
```

- [ ] **Step 3: Simplificar `sprintsQ` e apagar `handleProjectChange`**

`sprintsQ` (linhas 66-70) perde o `enabled` e o `!`:

```tsx
  const sprintsQ = useQuery({
    queryKey: ["jira", "sprints", project],
    queryFn: () => getJiraSprints({ data: { project } }),
  });
```

E a função `handleProjectChange` (linhas 170-177) é apagada por completo.

**O efeito que zera sprint/chips ao trocar de projeto (linhas 74-78) FICA.** Ele agora reage ao projeto da casca — que é exatamente o que se quer: trocar de projeto no cabeçalho tem de esquecer a sprint da tela anterior. O efeito que restaura `compromissoAssignee:${project}` (133-145) também fica: já é por projeto e continua correto.

- [ ] **Step 4: Tirar `projectsQ.error` do `loadError` (linha 231)**

```tsx
  const loadError = issuesQ.error ?? sprintQ.error ?? sprintsQ.error;
```

A falha da lista de projetos é da casca e **não é fatal**: só o rótulo do seletor degrada, e nenhuma tela precisa dela para funcionar.

- [ ] **Step 5: Apagar o `<header>`, o ramo `!project` e ajustar a altura (linhas 233-283)**

Substituir de `<div className="flex h-screen overflow-hidden bg-background">` até o fechamento do `</header>` mais o ramo `!project` do `<main>` por:

```tsx
  return (
    // `min-h-0 flex-1` em vez de `h-screen`: quem ocupa a viewport é a casca.
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <CompromissoSidebar
        sprints={sprintsQ.data ?? []}
        sprintId={sprintId}
        onSprintChange={setSprintId}
        sprintsLoading={sprintsQ.isLoading}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        statusOptions={statusOptions}
        statusSel={statusSel}
        onToggleStatus={toggleStatus}
        assigneeOptions={assigneeOptions}
        assigneeSel={assigneeSel}
        onToggleAssignee={toggleAssignee}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        lastUpdate={lastUpdate}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <main className="flex-1 space-y-4 p-4">
          {loadError ? (
            <p className="py-20 text-center text-sm text-destructive">
              {loadError instanceof Error ? loadError.message : "Erro ao carregar dados do Jira."}
            </p>
          ) : issuesQ.isLoading || sprintQ.isLoading ? (
            <p className="py-20 text-center text-sm text-muted-foreground">Carregando sprint…</p>
          ) : !sprintData ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              Selecione uma sprint na barra lateral.
            </p>
          ) : (
```

O `<CompromissoContent … />`, o `)}`, `</main>`, `</div>` e `</div>` do fim ficam como estão. **"Selecione uma sprint na barra lateral." fica**: vazio de dado continua sendo do painel — a casca responde por *existir projeto*, o painel por *haver dado*.

- [ ] **Step 6: Tirar o bloco "Projeto" da `CompromissoSidebar`**

No `src/components/compromisso/CompromissoSidebar.tsx`:

1. Do import de tipos (linha 11), remover `JiraProject`: `import type { SprintResponse } from "@/lib/compromisso/types";`
2. Da interface `CompromissoSidebarProps` (15-34), remover as três primeiras linhas (`projects`, `project`, `onProjectChange`).
3. Da desestruturação (36-55), remover `projects`, `project`, `onProjectChange`.
4. Apagar o `<div>` inteiro do bloco "Projeto" (58-74), incluindo o rótulo e o `<Select>`.
5. No `<Select>` da sprint (80-84), trocar `disabled={!project || sprintsLoading || sprints.length === 0}` por `disabled={sprintsLoading || sprints.length === 0}`.

Os imports de `Select*` **ficam**: o seletor de sprint continua usando os quatro.

- [ ] **Step 7: Parar de passar `email` na rota**

Em `src/routes/_shell/compromisso.tsx`, o componente de rota volta a ser trivial e o import de `useShell` sai:

```tsx
function CompromissoPage() {
  return <CompromissoView />;
}
```

- [ ] **Step 8: Confirmar que nada de cabeçalho sobrou**

```bash
grep -n "ThemeToggle\|signOut\|LogOut\|<Link\|getJiraProjects\|compromissoLastProject" src/components/compromisso/CompromissoView.tsx
```

Esperado: **nada impresso**.

- [ ] **Step 9: Verificar tipos e formatação**

```bash
npx prettier --write src/components/compromisso/CompromissoView.tsx src/components/compromisso/CompromissoSidebar.tsx src/routes/_shell/compromisso.tsx
npx eslint src/components/compromisso/CompromissoView.tsx src/components/compromisso/CompromissoSidebar.tsx src/routes/_shell/compromisso.tsx
npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 10: Commit**

```bash
git add src/components/compromisso/CompromissoView.tsx src/components/compromisso/CompromissoSidebar.tsx src/routes/_shell/compromisso.tsx
git commit -m "refactor(compromisso): drop own header and project selector in favor of the shell"
```

---

## Task 6: `CycleTimeView` e `CycleTimePane`

**Files:**
- Modify: `src/components/cycle-time/CycleTimeView.tsx`
- Modify: `src/routes/_shell/cycle-time.tsx` (deixa de passar `email`)

**Interfaces:**
- Consumes: `useShell()`, `JiraProjectKey`.
- Produces: `CycleTimeView` sem props; `CycleTimePane.project` passa de `string | null` a `JiraProjectKey`; "Recalcular" preservado no *toolbar* do painel.

- [ ] **Step 1: Trocar os imports (linhas 1-20)**

Saem `Link`, os ícones do cabeçalho (`ClipboardList`, `LayoutGrid`, `LogOut`, `Timer`), os cinco `Select*` (o seletor de projeto era o único uso), `supabase`, `ThemeToggle` e `getJiraProjects`. `RefreshCw` fica (o "Recalcular"), `Button` fica, `Tabs*` ficam.

```tsx
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getJiraCycleTime } from "@/integrations/jira/server-fns";
import { CYCLE_TIME_CONFIG, buildColumns, mergeStatusVariants } from "@/lib/cycle-time/calc";
import type { CycleTimeIssue, CycleTimeMode, CycleTimeResponse } from "@/lib/cycle-time/types";
import type { JiraProjectKey } from "@/lib/projects";
import { useShell } from "@/components/shell/shell-context";
import { CycleTimeTable } from "./CycleTimeTable";
```

`useEffect` sai da lista do `react` **se** o efeito de primeiro projeto (67-70) era o único uso — confirmar no arquivo antes de remover.

- [ ] **Step 2: Apagar `LS_PROJECT` (linha 44)**

O comentário de três linhas acima dele (41-43), que justificava chaves separadas por tela, sai com ele: a decisão foi revertida por esta spec, e deixá-lo seria documentação contraditória. `LS_VIEW`/`cycleTimeView` **ficam** — sub-visão *dentro* do painel não é guia. Os helpers `ls` e `save` ficam, os dois ainda servem `LS_VIEW`.

- [ ] **Step 3: Trocar a assinatura, o estado e as duas queries (linhas 57-94)**

Substituir de `export function CycleTimeView({ email }: { email: string }) {` até o fim de `handleProjectChange` por:

```tsx
export function CycleTimeView() {
  const qc = useQueryClient();
  const { project } = useShell();
  const [subView, setSubView] = useState<CycleTimeSubView>(() =>
    ls(LS_VIEW) === "full" ? "full" : "status",
  );
  const [recalculando, setRecalculando] = useState(false);

  // Duas queries separadas, não uma parametrizada pela aba ativa: alternar
  // entre as sub-visões passa a ser instantâneo (cache do Query) e é o
  // comportamento do original, cujo onProjectChange dispara loadCycleTime() e
  // loadCycleTime2() juntos. O prefixo ["jira", ...] casa o das outras queries.
  //
  // Sem `enabled` e sem `project ?? ""`: a casca garante uma chave válida.
  const stdQ = useQuery({
    queryKey: ["jira", "cycle-time", project, "standard"],
    queryFn: () => getJiraCycleTime({ data: { project, mode: "standard" } }),
  });

  const fullQ = useQuery({
    queryKey: ["jira", "cycle-time", project, "full"],
    queryFn: () => getJiraCycleTime({ data: { project, mode: "full" } }),
  });

  const std = useMemo(() => prepare(stdQ.data, "standard"), [stdQ.data]);
  const full = useMemo(() => prepare(fullQ.data, "full"), [fullQ.data]);
```

- [ ] **Step 4: Tirar a guarda de projeto do `handleRecalcular`**

Remover a primeira linha do corpo (`if (!project) return;`). O resto da função — inclusive o comentário sobre `force` ter de chegar ao servidor e os dois `setQueryData` — **não muda**.

- [ ] **Step 5: Apagar o `<header>` e pôr "Recalcular" na linha da `TabsList` (linhas 125-181)**

Substituir o trecho que vai de `<div className="flex h-screen flex-col overflow-hidden bg-background">` (linha 126) até o `</TabsList>` (linha 181), **inclusive**, por:

```tsx
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <main className="flex-1 overflow-y-auto p-4">
        <Tabs value={subView} onValueChange={handleSubViewChange}>
          {/* Toolbar do painel: as sub-visões e o "Recalcular" na mesma linha.
              "Recalcular" NÃO virou um botão global de atualizar: ele precisa
              mandar `force` ao servidor e o "Atualizar dados" do Compromisso
              faz outra coisa por outro caminho (divergência 4 da spec). */}
          <div className="flex flex-wrap items-center gap-3">
            <TabsList>
              <TabsTrigger value="status">Em Andamento</TabsTrigger>
              <TabsTrigger value="full">Histórico Completo</TabsTrigger>
            </TabsList>

            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={handleRecalcular}
              disabled={carregando}
            >
              <RefreshCw className={`size-4 ${carregando ? "animate-spin" : ""}`} /> Recalcular
            </Button>
          </div>
```

O `const carregando = …` que hoje fica na linha 123 (antes do `return`) continua onde está. Os dois `<TabsContent>` seguintes ficam, com uma mudança em cada: `error={stdQ.error ?? projectsQ.error}` → `error={stdQ.error}` e `error={fullQ.error ?? projectsQ.error}` → `error={fullQ.error}`.

- [ ] **Step 6: Tirar o ramo `!project` do `CycleTimePane` (linhas 214-235)**

Trocar o tipo da prop e apagar a guarda:

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
  // Não anulável: a casca garante. O ramo "Selecione um projeto." que existia
  // aqui era defesa contra um estado que não existe mais.
  project: JiraProjectKey;
  isLoading: boolean;
  error: Error | null;
  issues: CycleTimeIssue[];
  columns: string[];
  mode: CycleTimeMode;
  title: string;
  subtitle: string | null;
}) {
  if (error) {
```

O `key={project}` do `<CycleTimeTable>` **fica**: trocar de projeto continua descartando ordenação e página em vez de as carregar para dados de outro projeto.

- [ ] **Step 7: Parar de passar `email` na rota**

Em `src/routes/_shell/cycle-time.tsx`:

```tsx
function CycleTimePage() {
  return <CycleTimeView />;
}
```

…e remover o import de `useShell`.

- [ ] **Step 8: Confirmar que nada de cabeçalho sobrou**

```bash
grep -n "ThemeToggle\|signOut\|LogOut\|<Link\|getJiraProjects\|cycleTimeLastProject\|SelectTrigger" src/components/cycle-time/CycleTimeView.tsx
```

Esperado: **nada impresso**.

- [ ] **Step 9: Verificar tipos e formatação**

```bash
npx prettier --write src/components/cycle-time/CycleTimeView.tsx src/routes/_shell/cycle-time.tsx
npx eslint src/components/cycle-time/CycleTimeView.tsx src/routes/_shell/cycle-time.tsx
npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 10: Commit**

```bash
git add src/components/cycle-time/CycleTimeView.tsx src/routes/_shell/cycle-time.tsx
git commit -m "refactor(cycle-time): drop own header, keep Recalcular in the panel toolbar"
```

---

## Task 7: `RouletteView`

A menor das quatro. O único controle a preservar é o contador.

**Files:**
- Modify: `src/components/retrospectivas/RouletteView.tsx`
- Modify: `src/routes/_shell/retrospectivas.tsx` (deixa de passar `email`)

**Interfaces:**
- Consumes: nada de novo — a roleta não usa projeto (gate estrutural; `PARTICIPANTS` continua sendo uma lista única, decidido fora de escopo na spec).
- Produces: `RouletteView` sem props.

- [ ] **Step 1: Trocar imports, assinatura e cabeçalho (linhas 1-52)**

Saem `Link`, `Dices`, `LogOut`, `ThemeToggle` e `supabase`. `Button` fica (Sortear/Reiniciar), `RotateCcw` e `Shuffle` ficam.

Substituir de `import { Link } from "@tanstack/react-router";` até o `</header>` por:

```tsx
import { RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { useRoulette } from "@/hooks/use-roulette";
import { getPhoto } from "@/lib/retrospectivas/photos";
import {
  avatarColor,
  getInitials,
  shortName,
  PARTICIPANTS,
} from "@/lib/retrospectivas/participants";
import { ParticipantCard } from "./ParticipantCard";

export function RouletteView() {
  const roulette = useRoulette();

  const drawnCount = roulette.drawn.size;
  const skippedCount = roulette.skipped.size;
  const plural = skippedCount > 1 ? "s" : "";
  const counter =
    skippedCount > 0
      ? `${drawnCount} / ${PARTICIPANTS.length} sorteados · ${skippedCount} ausente${plural}`
      : `${drawnCount} / ${PARTICIPANTS.length} sorteados`;

  // O card do vencedor vive aqui: são ~15 linhas de JSX que não se repetem em
  // lugar nenhum — extrair componente só espalharia props.
  const winnerIndex = PARTICIPANTS.findIndex((p) => p.email === roulette.lastWinner);
  const winner = winnerIndex === -1 ? undefined : PARTICIPANTS[winnerIndex];

  return (
    // A roleta é a única das quatro sem rolagem interna própria, então ela
    // rola inteira: `flex-1` + `overflow-y-auto` no lugar do `min-h-screen`.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4">
        {/* Contador é texto real, já legível por leitor de tela. Estava no
            cabeçalho do painel; desce para cá, acima do Card. */}
        <p className="text-[11px] text-muted-foreground">{counter}</p>

        <Card className="flex flex-col items-center gap-4 p-6">
```

Todo o resto do arquivo — a região `aria-live` do vencedor, os botões Sortear/Reiniciar, o grid de `ParticipantCard` — **não é tocado**. O `<h1>Roleta de Retrospectiva</h1>` sai com o cabeçalho: a guia ativa já diz onde se está.

- [ ] **Step 2: Parar de passar `email` na rota**

Em `src/routes/_shell/retrospectivas.tsx`:

```tsx
function RetrospectivasPage() {
  return <RouletteView />;
}
```

…e remover o import de `useShell`.

- [ ] **Step 3: Confirmar que nada de cabeçalho sobrou**

```bash
grep -n "ThemeToggle\|signOut\|LogOut\|<Link\|min-h-screen" src/components/retrospectivas/RouletteView.tsx
```

Esperado: **nada impresso**.

- [ ] **Step 4: Verificar tipos e formatação**

```bash
npx prettier --write src/components/retrospectivas/RouletteView.tsx src/routes/_shell/retrospectivas.tsx
npx eslint src/components/retrospectivas/RouletteView.tsx src/routes/_shell/retrospectivas.tsx
npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/retrospectivas/RouletteView.tsx src/routes/_shell/retrospectivas.tsx
git commit -m "refactor(retrospectivas): drop own header, keep the counter inside the panel"
```

---

## Task 8: `staleTime` nas queries do Jira

Com guia = rota, trocar de guia **desmonta o painel**. Nenhum dado é rebuscado do zero na volta (o cache é do `QueryClient`, não do componente), mas o `QueryClient` é criado sem defaults (`src/router.tsx:6`), então `staleTime` é 0 e cada remontagem dispara um *refetch* em segundo plano. Para o Cycle Time isso significa **dois `createServerFn` por visita à guia**.

**Files:**
- Modify: `src/components/cycle-time/CycleTimeView.tsx` (as duas queries de cycle time)
- Modify: `src/components/compromisso/CompromissoView.tsx` (`sprintQ` e `issuesQ`)

**Interfaces:**
- Consumes: nada.
- Produces: `["jira","cycle-time",…]` com 5 min; `["jira","sprint",…]` e `["jira","issues",…]` com 1 min.

`["jira","projects"]` **já ganhou os 30 min na Task 3** (é a casca que cria a query agora). A família `["jira","sprints",project]` fica **sem** `staleTime`, como a spec definiu: ela é uma chamada leve e não está na tabela de mitigação.

- [ ] **Step 1: 5 min nas duas queries de cycle time**

Em `src/components/cycle-time/CycleTimeView.tsx`, acrescentar a linha a `stdQ` e a `fullQ`:

```tsx
    // Casa com o cache de 5 min que `fetchCycleTime` já mantém no servidor:
    // um refetch antes disso devolveria exatamente o mesmo payload.
    staleTime: 5 * 60_000,
```

- [ ] **Step 2: 1 min em `sprintQ` e `issuesQ`**

Em `src/components/compromisso/CompromissoView.tsx`, acrescentar a `sprintQ` e a `issuesQ`:

```tsx
    // O auto-refresh desta tela é de 10 min; 1 min só cobre o bate-volta entre
    // guias, sem atrasar o que o usuário espera ver atualizado.
    staleTime: 60_000,
```

- [ ] **Step 3: Confirmar que os botões de atualizar continuam funcionando**

Nenhuma mudança é necessária, e o motivo precisa ficar registrado: `invalidateQueries` marca a query como obsoleta e refaz o *fetch* dos observadores ativos **independentemente** do `staleTime` — então o "Atualizar dados" do Compromisso não é afetado. E o "Recalcular" do Cycle Time nem passa por invalidação: ele chama `getJiraCycleTime({ force: true })` e escreve o resultado com `setQueryData`.

```bash
grep -n "staleTime" src/components/cycle-time/CycleTimeView.tsx src/components/compromisso/CompromissoView.tsx src/routes/_shell.tsx
```

Esperado: cinco linhas — duas com `5 * 60_000`, duas com `60_000` e uma com `30 * 60_000`.

- [ ] **Step 4: Verificar tipos e formatação**

```bash
npx prettier --write src/components/cycle-time/CycleTimeView.tsx src/components/compromisso/CompromissoView.tsx
npx eslint src/components/cycle-time/CycleTimeView.tsx src/components/compromisso/CompromissoView.tsx
npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/components/cycle-time/CycleTimeView.tsx src/components/compromisso/CompromissoView.tsx
git commit -m "perf(jira): add staleTime so switching tabs stops refetching"
```

---

## Task 9: Rename Quadro → Alocações no que ficou fora da casca

Os renames dos painéis e do `head()` já saíram nas Tasks 4-7. Sobram os quatro arquivos de `/admin` — que **fica fora da casca** e por isso não foi tocado até aqui.

**Files:**
- Modify: `src/components/admin/AdminView.tsx:27`
- Modify: `src/routes/admin.tsx:36`
- Modify: `src/lib/admin.ts:29-31`
- Modify: `src/components/admin/UserTable.tsx:141`

**Interfaces:**
- Consumes: nada.
- Produces: nenhum texto visível com a palavra "quadro" em `src/`.

**Duas correções de sentido escondidas aqui, e não são cosméticas.** `viewer` não é "quem só visualiza o quadro": `private.can_view_board` também é o que libera as server functions do Jira (`assertCanViewBoard` em cada handler de `server-fns.ts`), então "Apenas visualiza" é a descrição correta e "das alocações" seria uma restrição falsa. Pelo mesmo motivo, "sem papel" não é "não enxerga o quadro" — não enxerga nada.

- [ ] **Step 1: `AdminView.tsx` — rótulo do link de volta**

Trocar (linha 27):

```tsx
              <ArrowLeft className="size-4" /> Quadro
```

por:

```tsx
              <ArrowLeft className="size-4" /> Alocações
```

O link continua indo para `/`, as `Tabs` internas (Usuários / Histórico) **ficam intactas** — não são guias da casca — e `/admin` **não ganha seletor de projeto**: usuário e papel são da plataforma, não de um projeto, e um seletor ali sugeriria um isolamento que não existe.

- [ ] **Step 2: `routes/admin.tsx` — rótulo do botão do `AccessDenied`**

Trocar (linha 36):

```tsx
            <Link to="/">Voltar ao quadro</Link>
```

por:

```tsx
            <Link to="/">Voltar para Alocações</Link>
```

- [ ] **Step 3: `src/lib/admin.ts` — as três descrições de papel**

Substituir o bloco das linhas 28-32 por:

```ts
export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "Gerencia usuários e edita as alocações",
  editor: "Edita as alocações",
  // Não "visualiza as alocações": can_view_board também libera as server
  // functions do Jira (Compromisso e Cycle Time), então restringir a frase às
  // alocações descreveria um papel mais estreito do que o que existe.
  viewer: "Apenas visualiza, não edita",
};
```

- [ ] **Step 4: `UserTable.tsx` — a descrição de "Sem acesso"**

Trocar (linha 141):

```tsx
                          Não enxerga o quadro
```

por:

```tsx
                          Não enxerga a plataforma
```

- [ ] **Step 5: Provar que nenhum texto visível sobrou**

```bash
grep -rn -i "quadro" src/
```

Esperado: **só comentários de código**, nenhum literal de JSX, `title`, `description` ou rótulo de botão. Os hits legítimos são os comentários que o plano de Alocações escreveu em `src/lib/projects.ts` (que explicam por que a lista de projetos não depende do Jira e por que `PIM` é o primeiro item) e, se algum sobrou, comentários equivalentes em `src/components/BoardGrid.tsx`. **Qualquer hit dentro de uma string renderizada é um rename esquecido** — voltar à tabela de rename da spec e fechá-lo.

Conferir também que o nome do produto ficou de pé, porque ele **não** é para ser renomeado:

```bash
grep -rn "Sprint Board" src/routes/__root.tsx src/components/AuthCard.tsx src/components/shell/AppShell.tsx
```

Esperado: os três aparecem. Alocações é uma das quatro coisas que o produto faz, não o produto.

- [ ] **Step 6: Verificar tipos e formatação**

```bash
npx prettier --write src/components/admin/AdminView.tsx src/routes/admin.tsx src/lib/admin.ts src/components/admin/UserTable.tsx
npx eslint src/components/admin/AdminView.tsx src/routes/admin.tsx src/lib/admin.ts src/components/admin/UserTable.tsx
npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/AdminView.tsx src/routes/admin.tsx src/lib/admin.ts src/components/admin/UserTable.tsx
git commit -m "feat(admin): rename Quadro to Alocações in visible text"
```

---

## Task 10: Verificação estática final e roteiro manual

Última task: prova que a casca faz o que a spec pediu, com o Supabase e o Jira reais.

**Files:** nenhum arquivo de código. Só verificação.

**Interfaces:**
- Consumes: tudo das Tasks 1 a 9.
- Produces: confirmação de que as quatro URLs de hoje continuam vivas, o projeto é um só nas quatro guias, e nenhuma tela ficou em branco.

- [ ] **Step 1: Estática — o route tree**

```bash
npm run build
grep -n "fullPaths\|'/admin'\|'/aceitar-convite'" src/routeTree.gen.ts | head -30
```

Esperado: build concluído; `fullPaths` contém `/`, `/aceitar-convite`, `/admin`, `/compromisso`, `/cycle-time`, `/retrospectivas` — os **mesmos seis de hoje**, e `/admin`/`/aceitar-convite` fora da árvore do `_shell`.

- [ ] **Step 2: Estática — nada de cabeçalho sobrou nos painéis**

```bash
grep -rn "ThemeToggle\|AuthCard\|AccessDenied" src/components/BoardGrid.tsx src/components/compromisso/ src/components/cycle-time/ src/components/retrospectivas/
grep -rn "to=\"/compromisso\"\|to=\"/cycle-time\"\|to=\"/retrospectivas\"" src/ --include=*.tsx
```

Esperado: o primeiro comando não imprime nada. O segundo imprime **só** ocorrências em `src/components/shell/` (na prática, nenhuma linha literal: os destinos vêm de `TABS`) — nenhum link de guia fora da casca.

- [ ] **Step 3: Subir o app**

```bash
npm run dev
```

- [ ] **Step 4: `/` — a casca e a ordem das guias**

Esperado: **um** cabeçalho, com logo, seletor mostrando `PIM`, e a barra com as quatro guias na ordem Compromisso → Cycle Time → Retrospectivas → Alocações, com **Alocações** marcada (`aria-selected="true"` no DevTools). O quadro está idêntico ao de antes. Aba do navegador: "Alocações — Sprint Board".

- [ ] **Step 5: Trocar de guia não recarrega a casca**

Clicar em "Compromisso". Esperado: URL `/compromisso?project=PIM`; **um** cabeçalho; sidebar **sem** o campo "Projeto"; sprint ativa selecionada.

- [ ] **Step 6: O projeto é um só nas quatro guias**

Trocar para `PH` no seletor da casca. Esperado: a URL atualiza **sem criar entrada nova de histórico** (o botão "voltar" não desfaz a troca de projeto); Compromisso recarrega no `PH`. Ir para "Cycle Time" → **continua `PH`**, sem segunda seleção. Ir para "Alocações" → quadro do `PH`.

- [ ] **Step 7: Deep link e duas abas em dois projetos**

Recarregar em `/cycle-time?project=PH`. Esperado: abre na guia Cycle Time, `PH` selecionado. Copiar essa URL e abrir em outra janela (após login) → mesma visão. Duas abas do navegador em dois projetos diferentes ao mesmo tempo → **cada uma mantém o seu** (quem manda na tela é a URL; o `localStorage` fica last-write-wins e isso é inofensivo).

- [ ] **Step 8: URL com projeto inválido não quebra**

Abrir `/cycle-time?project=FOO`. Esperado: abre normalmente no projeto persistido (ou `PIM`), **sem** 404 e sem tela em branco — a chave desconhecida é coagida para `undefined`, não lançada.

- [ ] **Step 9: Histórico e rolagem por guia**

Voltar/avançar do navegador percorre as guias visitadas; a posição de rolagem de cada guia é restaurada (`scrollRestoration: true` já está ligado em `src/router.tsx:11`).

- [ ] **Step 10: Retrospectivas — contador e estado preservado**

Esperado: contador visível acima do card, "Sortear" funciona. Sair para outra guia e voltar → sorteados/ausentes/vencedor **preservados** (moram em `localStorage`, `src/lib/retrospectivas/storage.ts`).

- [ ] **Step 11: Bate-volta entre guias sai do cache**

Compromisso → Cycle Time → Compromisso. Esperado: os dados voltam do cache **sem *spinner***, e a sprint volta para a ativa. O reset da sprint escolhida, do `viewMode`, dos chips de status e da ordenação/página da tabela é o **custo aceito** da opção "guia = rota", registrado na spec — não é bug.

- [ ] **Step 12: Sessão**

Logout pelo cabeçalho → `AuthCard`. Login → volta para a mesma URL.

- [ ] **Step 13: Papel `viewer`**

Entrar com um usuário `viewer`. Esperado: sem "Sprint"/"Pessoa" no *toolbar* das Alocações, sem link "Usuários" no cabeçalho, e **as quatro guias visíveis e funcionando**.

- [ ] **Step 14: Usuário sem papel**

Entrar com um usuário sem papel nenhum. Esperado: `AccessDenied` **uma vez**, sem cabeçalho e sem barra de guias, em **qualquer** uma das quatro URLs — os quatro blocos idênticos de preâmbulo viraram um.

- [ ] **Step 15: `/admin` e `/aceitar-convite` fora da casca**

`/admin` → cabeçalho próprio, **sem** seletor de projeto e **sem** barra de guias, `Tabs` internas intactas, link "Alocações" volta para `/`. Como `admin` fica fora da casca, entrar direto nela com um usuário não-admin mostra "Acesso restrito" com o botão "Voltar para Alocações".
`/aceitar-convite` → inalterada, sem link de volta (navegar para a casca antes de definir a senha só produziria um `AccessDenied`).

- [ ] **Step 16: Tema**

Alternar o tema pelo cabeçalho. Esperado: persiste ao trocar de guia e ao recarregar.

- [ ] **Step 17: Degradação sem Jira — o teste que a spec de Alocações exigiu**

Invalidar o `JIRA_API_TOKEN` no `.env` e reiniciar o `npm run dev`.

Esperado: o seletor **continua listando os quatro projetos** (pela chave, sem o nome vindo do Jira); **Alocações funciona por completo**; Compromisso e Cycle Time mostram os próprios erros. **Nenhuma tela em branco, nenhum seletor vazio.** É a diferença em relação ao comportamento anterior, em que uma falha de credencial esvaziava o seletor e nem a tela que não depende do Jira abria.

Restaurar o token ao final.

- [ ] **Step 18: Rolagem**

Percorrer as quatro guias. Esperado: **nenhuma barra de rolagem dupla** — o `h-screen`/`min-h-screen` dos quatro painéis foi removido e quem ocupa a viewport é a casca.

- [ ] **Step 19: Verificação final de código**

```bash
npx tsc --noEmit
npm run build
```

Esperado: sem erros; build concluído.

- [ ] **Step 20: Commit (só se algum ajuste tiver saído do roteiro)**

Se os steps acima não exigiram nenhuma correção, não há nada a comitar — a task termina aqui. Se exigiram:

```bash
git add -A
git commit -m "fix(shell): adjustments from the unified navigation walkthrough"
```

---

## Anexo A: rastreabilidade do rename Quadro → Alocações

A tabela da spec, com a task que fecha cada linha. Serve para conferir que nenhuma sumiu.

| # | Onde | Antes | Depois | Task |
| - | ---- | ----- | ------ | ---- |
| 1 | `shell/tabs.ts` | — | rótulo `Alocações` | 1 |
| 2 | `_shell/index.tsx` `head` `title` + `og:title` | `Sprint Board — Alocação de demandas do time de devs` | `Alocações — Sprint Board` | 4 |
| 3 | `_shell/index.tsx` `description` + `og:description` | "Substitua a planilha: **quadro** visual…" | "Alocações de sprints × pessoas, …" | 4 |
| 4 | `BoardGrid` (era 279) | `Carregando quadro...` | `Carregando alocações…` | 4 |
| 5 | `BoardGrid` (era 289) | `O quadro do {project} ainda não foi montado.` | `As alocações do {project} ainda não foram montadas.` | 4 |
| 6 | `BoardGrid` `EmptyState` `<h2>` | `Vamos montar seu quadro do {project}` | `Vamos montar as alocações do {project}` | 4 |
| 7 | `BoardGrid` `EmptyState` `<p>` | — | **já sem "quadro"** após o plano de Alocações; nenhuma edição | 4 (registrado) |
| 8 | `admin/AdminView.tsx` 27 | `Quadro` | `Alocações` | 9 |
| 9 | `routes/admin.tsx` 36 | `Voltar ao quadro` | `Voltar para Alocações` | 9 |
| 10 | `lib/admin.ts` 29 | `Gerencia usuários e edita o quadro` | `Gerencia usuários e edita as alocações` | 9 |
| 11 | `lib/admin.ts` 30 | `Edita o quadro` | `Edita as alocações` | 9 |
| 12 | `lib/admin.ts` 31 | `Apenas visualiza o quadro` | `Apenas visualiza, não edita` | 9 |
| 13 | `admin/UserTable.tsx` 141 | `Não enxerga o quadro` | `Não enxerga a plataforma` | 9 |
| 14 | `CompromissoView` 266, `CycleTimeView` 162, `RouletteView` 46 | links `Quadro` | **deletados** com os cabeçalhos | 5, 6, 7 |

**Não renomeado, e por quê:** `__root.tsx` 83-86 e `AuthCard.tsx` 36 ("Sprint Board" é o nome do **produto**); `BoardGrid` (arquivo/componente), `src/lib/board.ts`, `src/lib/board-errors.ts`, as `queryKey` `["board", …]`, `private.can_view_board`/`can_edit_board`, `assertCanViewBoard` (identificadores, invisíveis ao usuário — renomeá-los é churn e conflitaria com o diff da frente de Alocações).

---

## Anexo B: por que a spec recusou as alternativas

Registrado aqui para que quem executa não "melhore" o desenho no meio do caminho:

- **Rota única `/` + `useState` de aba** (a cópia literal do `jira-live`) preserva todo o estado local dos painéis, mas monta os quatro de uma vez: abrir as Alocações passaria a disparar as duas chamadas pesadas do Cycle Time, a cadeia do Compromisso e o módulo de fotos da retro. Hoje abrir `/` custa quatro queries no Supabase. Além disso `?tab=`, `<title>` por guia e o redirect das três URLs antigas passariam a ser código nosso.
- **Aba em search param** tem o mesmo custo de montagem sem o ganho de simplicidade.
- **Esconder a barra de guias sem projeto** virou pergunta sem objeto: a resolução é síncrona e sempre válida. A barra só desaparece com `JIRA_PROJECTS` vazia.
- **Seletor alimentado por `getJiraProjects()`** faria um token expirado esvaziar o seletor e derrubar até a guia que não depende do Jira. As chaves vêm da constante; só o rótulo vem da rede.
- **Migrar as três chaves antigas de `localStorage`** custa três linhas de *seed* que não pagam o próprio custo de leitura: o efeito de não migrar é uma escolha de projeto a mais no primeiro acesso.
- **Cada painel chamar `useAuthorizedSession()` de novo** é barato, mas reintroduziria dentro de cada painel exatamente os estados (`loading`, `session | null`, `canView`) que a casca existe para eliminar. O contexto faz a garantia aparecer no **tipo**, e é isso que apaga os ramos `!project` como código morto.
- **Um "Atualizar dados" global** juntaria duas coisas diferentes: o do Cycle Time precisa mandar `force` ao servidor, o do Compromisso invalida duas queries.
- **Uma sidebar global** como no original colocaria sprint, visão e chips — que só afetam o Compromisso — num lugar que muda as quatro guias. É a confusão que esta frente desfaz.
- **Setas de navegação nos links da tablist** seria meia implementação de *roving tabindex*, pior que nenhuma. Se acessibilidade por teclado virar requisito, a troca certa é adotar `aria-current="page"` e abandonar os papéis de tab por completo — não somar setas a links.
