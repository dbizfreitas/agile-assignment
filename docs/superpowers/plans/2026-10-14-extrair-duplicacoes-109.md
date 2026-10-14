# Extrair consultas e helpers duplicados (#109) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar quatro trechos copiados entre arquivos por uma única definição: as consultas de leitura de `teams` e `devs` viram hooks, os helpers `ls`/`save` de `localStorage` vão para `src/lib/`, e `demandasPhrase` vai para `src/lib/board.ts`.

**Architecture:** Refactor sem mudança de comportamento. Os hooks devolvem o mesmo objeto de `useQuery` de hoje, com a mesma `queryKey`, o mesmo `select`, a mesma ordenação e o mesmo cast. Os componentes continuam chamando o resultado de `teamsQ`/`devsQ`, então o resto de cada arquivo não muda. A verificação é `tsc` + `build` + `grep`, porque o projeto não tem testes automatizados.

**Tech Stack:** TypeScript (strict), React, TanStack Query v5, Supabase JS, Vite.

## Global Constraints

- Repositório conectado ao Lovable: **não** fazer force push, rebase, amend ou squash de commits já publicados. **Não** fazer push: quem executa só commita, e o push/PR fica com a sessão principal.
- **Não** tocar em `.env` (é versionado de propósito).
- **Não** mexer em nada de `src/integrations/supabase/` (gerado pelo Lovable; `createSupabaseFetch`/`isNewSupabaseApiKey` estão fora do escopo).
- **Não** rodar `npm run dev` contra o banco: localhost grava em produção.
- Commits no padrão do repo, em português, com `(#109)` no fim do assunto e terminando com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Não há suíte de testes, então TDD não se aplica. O gate de cada task é `npx tsc --noEmit` (exit 0). No fim, `npm run build` e `npx prettier --check` nos arquivos tocados.
- Não reformate arquivos nem mexa em nada fora das linhas indicadas. As consultas de `sprints` e `allocations` do `BoardGrid` ficam onde estão.
- Os paths abaixo são relativos à raiz do repositório.

---

### Task 0: Branch

- [ ] **Step 1:** A partir de `main` limpa, crie a branch:

```bash
git checkout main
git checkout -b refactor/duplicacoes-109
```

- [ ] **Step 2:** Rode a verificação de base e confirme exit 0:

```bash
npx tsc --noEmit
```

---

### Task 1: Hooks `useTeamsQuery` e `useDevsQuery`

**Files:**
- Create: `src/hooks/use-board-queries.ts`
- Modify: `src/components/BoardGrid.tsx` (consultas em ~185-217)
- Modify: `src/components/DevDialog.tsx` (consulta em ~85-102)
- Modify: `src/components/TeamsDialog.tsx` (consultas em ~44-82)
- Modify: `src/hooks/use-reorder-devs.ts` (comentário em ~14-15)

- [ ] **Step 1: Criar `src/hooks/use-board-queries.ts`** com exatamente este conteúdo:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Dev, Team } from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";

/**
 * Leituras de `teams` e `devs` compartilhadas por BoardGrid, DevDialog e
 * TeamsDialog (#109). Ficam num lugar só porque a chave, o select, os filtros,
 * a ordenação e o cast PRECISAM ser idênticos em todos os componentes.
 *
 * O TanStack Query v5 guarda uma única entrada por chave e usa a `queryFn` do
 * observer que renderizou por último. Se um componente registrasse um select
 * mais estreito sob a mesma chave, um refetch em segundo plano rodaria essa
 * versão e sobrescreveria o cache com linhas parciais. E o projeto entra na
 * chave obrigatoriamente: sem ele, um diálogo listaria times do projeto errado.
 *
 * As mutações invalidam pelo prefixo (`["board", "teams"]`, `["board", "devs"]`),
 * então criar ou editar um time ou uma pessoa atualiza todos os observers.
 */
export function useTeamsQuery(project: JiraProjectKey) {
  return useQuery({
    queryKey: ["board", "teams", project],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("jira_project", project)
        .order("position");
      if (error) throw error;
      return data as Team[];
    },
  });
}

export function useDevsQuery(project: JiraProjectKey) {
  return useQuery({
    queryKey: ["board", "devs", project],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devs")
        .select("*")
        .eq("jira_project", project)
        .order("position")
        .order("name");
      if (error) throw error;
      return data as Dev[];
    },
  });
}
```

- [ ] **Step 2: `BoardGrid.tsx`.** Substitua as duas consultas (`const devsQ = useQuery({...});` e `const teamsQ = useQuery({...});`, logo abaixo do comentário que começa em `// As quatro queries são`) por:

```ts
  const devsQ = useDevsQuery(project);
  const teamsQ = useTeamsQuery(project);
```

Troque o comentário que fica acima delas (o bloco de 7 linhas `// As quatro queries são ... // mesma entrada de cache e o diálogo listaria times do projeto errado.`) por:

```ts
  // As quatro queries são `select("*")` planas com um `.eq("jira_project", …)`
  // cada — sem `!inner`, sem query dependente: `devs` e `allocations` têm o
  // projeto denormalizado, derivado do pai por trigger no banco. `devs` e
  // `teams` vêm de hooks compartilhados com os diálogos (use-board-queries.ts).
```

Adicione o import junto aos outros de `@/hooks/`:

```ts
import { useDevsQuery, useTeamsQuery } from "@/hooks/use-board-queries";
```

`useQuery` continua importado (sprints e allocations usam). `type Dev`/`type Team` continuam no import de `@/lib/board` se ainda forem usados no arquivo; se o `tsc` ou o eslint acusarem import não usado, remova só o que acusarem.

- [ ] **Step 3: `DevDialog.tsx`.** Substitua o comentário de 5 linhas (`// MESMA queryKey do BoardGrid, de propósito: ...` até `// composta cobre o resto.`) e a consulta `const teamsQ = useQuery({...});` por:

```ts
  // Mesma consulta do BoardGrid (use-board-queries.ts). Como só existem times
  // do projeto atual na lista, mover uma pessoa para um time de outro projeto
  // é impossível pela tela — e a FK composta cobre o resto.
  const teamsQ = useTeamsQuery(project);
```

Tire `useQuery` do import de `@tanstack/react-query` (fica `useMutation, useQueryClient`) e adicione:

```ts
import { useTeamsQuery } from "@/hooks/use-board-queries";
```

junto ao import de `@/hooks/use-reorder-devs`.

- [ ] **Step 4: `TeamsDialog.tsx`.** Substitua o comentário `// MESMA queryKey do BoardGrid e do DevDialog, ...` (3 linhas) + `const teamsQ = useQuery({...});` por:

```ts
  const teamsQ = useTeamsQuery(project);
```

E substitua o comentário `// MESMA queryKey de devs do BoardGrid, ...` (8 linhas) + `const devsQ = useQuery({...});` por:

```ts
  const devsQ = useDevsQuery(project);
```

As linhas `const teams = teamsQ.data ?? [];` e o `useMemo` de `counts` ficam como estão. Tire `useQuery` do import de `@tanstack/react-query` e adicione:

```ts
import { useDevsQuery, useTeamsQuery } from "@/hooks/use-board-queries";
```

Se `type Dev`/`type Team` ficarem sem uso no import de `@/lib/board`, remova só o que ficar sem uso.

- [ ] **Step 5: `use-reorder-devs.ts`.** Troque o comentário

```ts
  // Mesma chave de BoardGrid/DevDialog/TeamsDialog: as linhas do cache devem
  // continuar sendo `Dev` completos.
```

por

```ts
  // Mesma chave de useDevsQuery (use-board-queries.ts): as linhas do cache
  // devem continuar sendo `Dev` completos.
```

(Se o comentário original tiver mais linhas, mantenha o resto e mude só a referência aos componentes.)

- [ ] **Step 6: Verificar.**

```bash
npx tsc --noEmit
grep -rn 'from("teams")' src/components
grep -rn 'from("devs")' src/components
grep -rn 'queryKey: \["board", "\(teams\|devs\)", project\]' src
```

`tsc` com exit 0. Os dois primeiros `grep` só podem mostrar linhas de `insert`, `update` ou `delete` (a linha `.from("teams")` em `DevDialog.tsx` dentro de `save` é seguida de `.insert`, então conta como escrita; confira com `-A1`). O terceiro só pode achar `src/hooks/use-board-queries.ts`.

- [ ] **Step 7: Commit.**

```bash
git add src/hooks/use-board-queries.ts src/components/BoardGrid.tsx src/components/DevDialog.tsx src/components/TeamsDialog.tsx src/hooks/use-reorder-devs.ts
git commit -m "refactor: extrair useTeamsQuery e useDevsQuery (#109)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Helpers de `localStorage`

**Files:**
- Create: `src/lib/local-storage.ts`
- Modify: `src/routes/_shell.tsx` (~26-40)
- Modify: `src/components/cycle-time/CycleTimeView.tsx` (~17-30)

- [ ] **Step 1: Criar `src/lib/local-storage.ts`:**

```ts
/**
 * Leitura e escrita em `localStorage` que nunca lançam (#109). O acesso pode
 * falhar em janela privada, com dados do site bloqueados ou cota cheia; nesses
 * casos a leitura devolve `null` e a escrita é ignorada, e a tela segue com o
 * valor padrão.
 */
export const ls = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};
```

- [ ] **Step 2: `_shell.tsx`.** Apague as definições locais `const ls = ...` e `const save = ...` (e a linha em branco que sobrar duplicada). Adicione aos imports:

```ts
import { ls, save } from "@/lib/local-storage";
```

`LS_PROJECT` e o comentário acima dele ficam onde estão.

- [ ] **Step 3: `CycleTimeView.tsx`.** Mesma coisa: apague `const ls = ...` e `const save = ...` locais e adicione:

```ts
import { ls, save } from "@/lib/local-storage";
```

junto aos outros imports de `@/lib/`.

- [ ] **Step 4: Verificar.**

```bash
npx tsc --noEmit
grep -rn "localStorage\.\(getItem\|setItem\)" src/routes/_shell.tsx src/components/cycle-time/CycleTimeView.tsx
```

`tsc` com exit 0 e `grep` vazio.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/local-storage.ts src/routes/_shell.tsx src/components/cycle-time/CycleTimeView.tsx
git commit -m "refactor: mover helpers de localStorage para lib/local-storage (#109)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `demandasPhrase` em `lib/board.ts`

**Files:**
- Modify: `src/lib/board.ts` (adicionar no fim)
- Modify: `src/components/DevDialog.tsx` (~49-51)
- Modify: `src/components/SprintDialog.tsx` (~38-40)

- [ ] **Step 1: `lib/board.ts`.** Adicione no fim do arquivo:

```ts
/** "1 demanda" / "N demandas", usado nos avisos de exclusão dos diálogos. */
export function demandasPhrase(n: number) {
  return n === 1 ? "1 demanda" : `${n} demandas`;
}
```

- [ ] **Step 2: `DevDialog.tsx`.** Apague a função local `demandasPhrase` (3 linhas + a linha em branco seguinte) e adicione `demandasPhrase,` à lista do import existente de `@/lib/board`, em ordem alfabética com os outros nomes.

- [ ] **Step 3: `SprintDialog.tsx`.** Apague a função local `demandasPhrase` (3 linhas + a linha em branco seguinte). Troque

```ts
import type { Sprint } from "@/lib/board";
```

por

```ts
import { demandasPhrase, type Sprint } from "@/lib/board";
```

- [ ] **Step 4: Verificar.**

```bash
npx tsc --noEmit
grep -rn "function demandasPhrase" src
```

`tsc` com exit 0 e o `grep` só acha `src/lib/board.ts`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/board.ts src/components/DevDialog.tsx src/components/SprintDialog.tsx
git commit -m "refactor: mover demandasPhrase para lib/board (#109)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verificação final

- [ ] **Step 1:**

```bash
npx tsc --noEmit
npm run build
npx prettier --check src/hooks/use-board-queries.ts src/lib/local-storage.ts src/lib/board.ts src/components/BoardGrid.tsx src/components/DevDialog.tsx src/components/TeamsDialog.tsx src/components/SprintDialog.tsx src/hooks/use-reorder-devs.ts src/routes/_shell.tsx src/components/cycle-time/CycleTimeView.tsx
npx eslint src/hooks/use-board-queries.ts src/lib/local-storage.ts src/components/BoardGrid.tsx src/components/DevDialog.tsx src/components/TeamsDialog.tsx src/components/SprintDialog.tsx src/routes/_shell.tsx src/components/cycle-time/CycleTimeView.tsx
```

Tudo com exit 0. Se o `prettier --check` acusar algum arquivo, rode `npx prettier --write` só nele, confira que o diff é apenas de formatação das linhas tocadas e faça um commit `style: ... (#109)`. Se o eslint acusar algo que já existia em `main` (confira com `git stash` ou `git diff main`), não corrija: só reporte.

- [ ] **Step 2:** `git log --oneline main..HEAD` e `git status` (árvore limpa). Reporte os commits e as saídas.

**Critérios da issue que ficam para depois do merge (precisam do app publicado):** criar/editar time ou pessoa atualiza grade e diálogos sem recarregar; filtros salvos (projeto no shell, sub-visão do Cycle Time) continuam lembrados.
