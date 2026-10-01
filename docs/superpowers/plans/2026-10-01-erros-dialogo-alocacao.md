# Erros do diálogo de demanda — plano de implementação (#49)

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** os erros ao salvar, excluir ou replicar uma demanda deixam de mostrar o texto cru do Postgres ou da rede e passam a mostrar mensagens amigáveis em pt-BR, específicas para alocação.

**Arquitetura:** `boardErrorMessage` (`src/lib/board-errors.ts`) ganha (a) um ramo de falha de rede, que usa um helper `isNetworkError` extraído de `src/router.tsx` para `src/lib/network-errors.ts`, e (b) um segundo parâmetro opcional `context?: "allocation"`, que troca as mensagens das FKs de `allocations` por textos que fazem sentido para quem está salvando uma demanda. `AllocationDialog` (salvar e excluir) e a mutação `replicate` de `BoardGrid` passam a chamar `boardErrorMessage(e, "allocation")`.

**Stack:** React 19 + TanStack Query + supabase-js 2 (postgrest-js 2.111) + sonner (toasts). TypeScript, Vite.

## Restrições globais

- Não há framework de testes no projeto (nem `vitest`/`jest`, nem script `test`). As funções puras são verificadas com um script `tsx` descartável (`npx tsx <arquivo>`), que **não deve ser commitado**. O resto se verifica com `npm run build` e no navegador.
- Baseline conhecida: `npm run lint` já falha no checkout local com `prettier/prettier: Delete '␍'`, porque o Windows usa `core.autocrlf=true`. Isso não é responsabilidade deste plano. Nos arquivos tocados, rode `npx prettier --write <arquivo>` antes de commitar e confira com `git diff --stat` que só as linhas da tarefa mudaram. Se o prettier reformatar o arquivo inteiro por causa de CRLF, rode `git checkout -- <arquivo>` e refaça só a edição, sem prettier.
- Textos visíveis ao usuário em pt-BR, com acentuação correta. Comentários de código em pt-BR, no estilo dos que já existem em `board-errors.ts` (explicam o *porquê*).
- O projeto é sincronizado com o Lovable: não reescreva histórico (sem amend, rebase ou force push). Trabalhe no branch `fix/alocacao-erros-49`, que já existe.
- Toda mensagem de commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use o padrão `fix(alocacoes): ... (#49)`.

## Fatos que motivam o desenho (já verificados)

1. **Falha de rede não chega como `TypeError`.** Quando o `fetch` falha, o postgrest-js 2.x **não lança exceção**: ele devolve `{ error: { message: "TypeError: Failed to fetch", details: "<stack>", hint: "", code: "" } }`, um objeto simples, não uma instância de `Error`. Hoje o `AllocationDialog` faz `throw res.error` e mostra `e.message`, ou seja, `TypeError: Failed to fetch`. O `isNetworkError` atual de `src/router.tsx` só reconhece `err instanceof TypeError`, então não pega esse formato. O helper novo precisa reconhecer os dois:
   - `TypeError` de verdade (fetch lançado fora do supabase): mensagem `Failed to fetch` (Chrome/Edge), `NetworkError when attempting to fetch resource` (Firefox) ou `Load failed` (Safari).
   - Objeto do postgrest com `code` vazio e `message` começando com `TypeError: ` ou `FetchError: `, seguido de uma das mensagens acima.
2. **FKs de `allocations`** (migrations `20260801002005_*.sql` e `20260810121000_board_project_constraints.sql`):
   - `allocations_sprint_id_fkey`: a sprint foi excluída enquanto o diálogo estava aberto.
   - `allocations_dev_id_fkey`: a pessoa foi excluída. Na prática, o trigger `allocations_set_project` costuma barrar antes com `W3001`, que já tem mensagem.
   - `allocations_sprint_project_fkey`: a sprint é de outro projeto (dado velho na tela, ou pessoa trocada de projeto em outra aba).
   - `allocations_dev_project_fkey`: hoje a mensagem fala em "mover pessoa para outro time", que é o caso do `DevDialog`. Ao salvar uma demanda, isso significa que a pessoa não está mais no projeto.
3. **`replicate` (BoardGrid) lança `new Error(blockReason)`** com um texto pt-BR já amigável. `boardErrorMessage` devolve `error.message` para `Error` sem `code`, e isso **precisa continuar assim**.
4. `remove` no `AllocationDialog` já usa `boardErrorMessage(e)`. Só falta o contexto.
5. Os outros chamadores (`DevDialog`, `TeamsDialog`, `SprintDialog`, a mutação `move` do `BoardGrid`) continuam chamando sem contexto e mantêm as mensagens atuais. O único efeito neles é ganharem a mensagem de rede.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/lib/network-errors.ts` | criar | `isNetworkError(err)`: reconhece falha de rede nos dois formatos |
| `src/router.tsx` | modificar | apagar o `isNetworkError` local e importar o de `@/lib/network-errors` |
| `src/lib/board-errors.ts` | modificar | ramo de rede + parâmetro `context` + `ALLOCATION_FK_MESSAGES` |
| `src/components/AllocationDialog.tsx` | modificar | `save` e `remove` usam `boardErrorMessage(e, "allocation")` |
| `src/components/BoardGrid.tsx` | modificar | `replicate` usa `boardErrorMessage(e, "allocation")` |

---

### Tarefa 1: `isNetworkError` compartilhado e `boardErrorMessage` com rede e contexto de alocação

**Arquivos:**
- Criar: `src/lib/network-errors.ts`
- Modificar: `src/router.tsx` (linhas 5-14: comentário e função `isNetworkError`)
- Modificar: `src/lib/board-errors.ts`
- Verificação: `src/lib/board-errors.check.ts` (temporário, apagado no fim da tarefa)

**Interfaces:**
- Produz: `export function isNetworkError(err: unknown): boolean` em `src/lib/network-errors.ts`
- Produz: `export type BoardErrorContext = "allocation"` e `export function boardErrorMessage(error: unknown, context?: BoardErrorContext): string` em `src/lib/board-errors.ts`
- Produz: a constante de texto `"Sem conexão. Tente novamente."`

- [ ] **Passo 1: escrever o script de verificação (vai falhar)**

Crie `src/lib/board-errors.check.ts`:

```ts
// Verificação descartável da issue #49. Rodar com: npx tsx src/lib/board-errors.check.ts
// NÃO commitar.
import { boardErrorMessage } from "./board-errors";
import { isNetworkError } from "./network-errors";

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`ok   ${label}`);
  } else {
    failures++;
    console.log(`FAIL ${label}\n     esperado: ${String(expected)}\n     recebido: ${String(actual)}`);
  }
}

// Silencia o console.error do fallback para a saída ficar legível.
console.error = () => {};

const OFFLINE = "Sem conexão. Tente novamente.";
const pgNetwork = (msg: string) => ({ message: `TypeError: ${msg}`, details: "stack", hint: "", code: "" });
const fk = (constraint: string) => ({
  code: "23503",
  message: `insert or update on table "allocations" violates foreign key constraint "${constraint}"`,
  details: "",
});

// isNetworkError
eq("rede: TypeError Chrome", isNetworkError(new TypeError("Failed to fetch")), true);
eq("rede: TypeError Firefox", isNetworkError(new TypeError("NetworkError when attempting to fetch resource.")), true);
eq("rede: TypeError Safari", isNetworkError(new TypeError("Load failed")), true);
eq("rede: postgrest Chrome", isNetworkError(pgNetwork("Failed to fetch")), true);
eq("rede: postgrest FetchError", isNetworkError({ message: "FetchError: Load failed", code: "" }), true);
eq("rede: TypeError não relacionado", isNetworkError(new TypeError("x is not a function")), false);
eq("rede: erro do Postgres com code", isNetworkError({ message: "TypeError: Failed to fetch", code: "23503" }), false);
eq("rede: Error comum", isNetworkError(new Error("Failed to fetch")), false);
eq("rede: null", isNetworkError(null), false);

// boardErrorMessage: rede, com e sem contexto
eq("board: rede postgrest", boardErrorMessage(pgNetwork("Failed to fetch")), OFFLINE);
eq("board: rede postgrest (alocação)", boardErrorMessage(pgNetwork("Failed to fetch"), "allocation"), OFFLINE);
eq("board: rede TypeError", boardErrorMessage(new TypeError("Failed to fetch"), "allocation"), OFFLINE);

// boardErrorMessage: FKs de alocação com contexto
eq(
  "alocação: dev_project",
  boardErrorMessage(fk("allocations_dev_project_fkey"), "allocation"),
  "Esta pessoa não está mais neste projeto. Recarregue a página.",
);
eq(
  "alocação: sprint_project",
  boardErrorMessage(fk("allocations_sprint_project_fkey"), "allocation"),
  "Esta sprint não é do projeto desta pessoa. Recarregue a página.",
);
eq(
  "alocação: sprint_id",
  boardErrorMessage(fk("allocations_sprint_id_fkey"), "allocation"),
  "Esta sprint foi excluída. Recarregue a página.",
);
eq(
  "alocação: dev_id",
  boardErrorMessage(fk("allocations_dev_id_fkey"), "allocation"),
  "Esta pessoa foi excluída. Recarregue a página.",
);

// Sem contexto, as mensagens atuais continuam (DevDialog, drag-and-drop)
eq(
  "sem contexto: dev_project",
  boardErrorMessage(fk("allocations_dev_project_fkey")),
  "Esta pessoa tem demandas alocadas; remova-as antes de movê-la para um time de outro projeto.",
);
eq(
  "sem contexto: sprint_project",
  boardErrorMessage(fk("allocations_sprint_project_fkey")),
  "Não é possível mover uma demanda para a sprint de outro projeto.",
);

// Contexto de alocação não engole as FKs genéricas nem os códigos W
eq(
  "alocação: FK genérica continua",
  boardErrorMessage({ code: "23503", message: 'violates foreign key constraint "devs_team_id_fkey"' }, "allocation"),
  "Este time tem pessoas; escolha para qual time elas devem ir antes de excluí-lo.",
);
eq(
  "alocação: W3001",
  boardErrorMessage({ code: "W3001", message: "Pessoa não encontrada" }, "allocation"),
  "Time ou pessoa não encontrado. Recarregue a página.",
);

// Error sem code (blockReason do replicate) passa intacto
eq(
  "alocação: Error sem code",
  boardErrorMessage(new Error("Não há sprint cadastrada depois de S10."), "allocation"),
  "Não há sprint cadastrada depois de S10.",
);

// Erro do Postgres desconhecido cai no genérico, nunca no texto cru
eq(
  "alocação: 23503 desconhecido",
  boardErrorMessage(fk("outra_fkey"), "allocation"),
  "Não foi possível salvar a alteração.",
);

if (failures > 0) {
  console.log(`\n${failures} falha(s)`);
  process.exit(1);
}
console.log("\ntudo ok");
```

- [ ] **Passo 2: rodar e ver falhar**

Rode: `npx tsx src/lib/board-errors.check.ts`
Esperado: erro de import (`Cannot find module './network-errors'` ou parecido). O arquivo ainda não existe.

- [ ] **Passo 3: criar `src/lib/network-errors.ts`**

```ts
// Falha de rede: a conexão caiu antes de qualquer resposta chegar (servidor de
// dev reiniciou no meio da requisição, rede oscilou, máquina offline). Tentar
// de novo pode resolver, ao contrário de um erro que o servidor devolveu.
//
// Chega em dois formatos:
// - `TypeError` lançado pelo `fetch` do navegador: "Failed to fetch"
//   (Chrome/Edge), "NetworkError when attempting to fetch resource" (Firefox)
//   ou "Load failed" (Safari).
// - Objeto de erro do postgrest-js 2.x, que NÃO lança: captura o TypeError e
//   devolve `{ message: "TypeError: Failed to fetch", code: "" }`. Não é
//   instância de Error, então só dá para reconhecer pela forma.
const NETWORK_MESSAGE = /fetch|network|load failed/i;
const WRAPPED_PREFIX = /^(TypeError|FetchError): /;

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return NETWORK_MESSAGE.test(err.message);
  const e = err as { code?: string; message?: unknown } | null;
  if (!e || e.code || typeof e.message !== "string") return false;
  return WRAPPED_PREFIX.test(e.message) && NETWORK_MESSAGE.test(e.message);
}
```

- [ ] **Passo 4: `src/router.tsx` passa a usar o helper**

Apague o comentário e a função das linhas 5-14 (de `// "Failed to fetch" (Chrome/Edge)...` até o `}` de `isNetworkError`) e adicione o import junto aos outros:

```ts
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { isNetworkError } from "@/lib/network-errors";
import { routeTree } from "./routeTree.gen";
```

O restante (`retry: (failureCount, error) => isNetworkError(error) && failureCount < 2`) fica igual. Efeito colateral desejado: queries que recebem o erro de rede do postgrest também passam a ter retry.

Confirme que o alias `@/` resolve em `router.tsx`: outros arquivos em `src/` já o usam (ex.: `import { boardErrorMessage } from "@/lib/board-errors"` em `AllocationDialog.tsx`).

- [ ] **Passo 5: atualizar `src/lib/board-errors.ts`**

5a. No topo, junto ao comentário de cabeçalho, adicione o import:

```ts
import { isNetworkError } from "@/lib/network-errors";
```

Atenção: o script de verificação roda com `tsx`, que pode não resolver o alias `@/`. Se o Passo 6 falhar com `Cannot find module '@/lib/network-errors'`, use o import relativo `import { isNetworkError } from "./network-errors";` (mesmo diretório, funciona nos dois casos). Prefira o relativo desde o início.

5b. Logo depois de `FK_MESSAGES`, adicione:

```ts
// Mesmas FKs vistas por quem está salvando, excluindo ou replicando uma
// demanda (AllocationDialog e o "Replicar" do BoardGrid). Sem este mapa,
// allocations_dev_project_fkey cairia na mensagem de FK_MESSAGES, que fala em
// mover a pessoa de time — o caso do DevDialog, não o de quem edita um card.
// Todas indicam dado velho na tela: algo mudou em outra aba ou por outra pessoa.
const ALLOCATION_FK_MESSAGES: { constraint: string; message: string }[] = [
  {
    constraint: "allocations_dev_project_fkey",
    message: "Esta pessoa não está mais neste projeto. Recarregue a página.",
  },
  {
    constraint: "allocations_sprint_project_fkey",
    message: "Esta sprint não é do projeto desta pessoa. Recarregue a página.",
  },
  {
    constraint: "allocations_sprint_id_fkey",
    message: "Esta sprint foi excluída. Recarregue a página.",
  },
  {
    // O trigger allocations_set_project costuma barrar antes com W3001; isto
    // cobre a corrida em que a pessoa some entre o trigger e a checagem da FK.
    constraint: "allocations_dev_id_fkey",
    message: "Esta pessoa foi excluída. Recarregue a página.",
  },
];

// Quem chama diz de onde veio o erro quando a mesma violação precisa de um
// texto diferente conforme a tela. Sem contexto = mensagens genéricas do board.
export type BoardErrorContext = "allocation";
```

5c. Troque a assinatura e o começo de `boardErrorMessage`. O ramo de rede vem **antes** de tudo, porque o erro de rede do postgrest tem `code: ""`:

```ts
export function boardErrorMessage(error: unknown, context?: BoardErrorContext): string {
  if (isNetworkError(error)) return "Sem conexão. Tente novamente.";

  const e = error as { code?: string; message?: string; details?: string } | null;
  const code = e?.code;
  const haystack = `${e?.message ?? ""} ${e?.details ?? ""}`;
```

5d. Troque o bloco `if (code === "23503") { ... }` por:

```ts
  if (code === "23503") {
    const specific =
      context === "allocation"
        ? ALLOCATION_FK_MESSAGES.find((m) => haystack.includes(m.constraint))
        : undefined;
    const hit = specific ?? FK_MESSAGES.find((m) => haystack.includes(m.constraint));
    if (hit) return hit.message;
  }
```

O resto da função (W3001, TEAM_CODES, 23514, 23505, fallback final) não muda.

- [ ] **Passo 6: rodar e ver passar**

Rode: `npx tsx src/lib/board-errors.check.ts`
Esperado: todas as linhas `ok` e, no fim, `tudo ok`, com exit code 0.

- [ ] **Passo 7: apagar o script, build e formatação**

```bash
rm src/lib/board-errors.check.ts
npx prettier --write src/lib/network-errors.ts src/lib/board-errors.ts src/router.tsx
npm run build
git diff --stat
```

Esperado: build sem erro. O `git diff --stat` mostra só os três arquivos, com mudanças proporcionais (nada de arquivo inteiro reformatado por CRLF; veja as restrições globais).

- [ ] **Passo 8: commit**

```bash
git add src/lib/network-errors.ts src/lib/board-errors.ts src/router.tsx
git commit -m "fix(alocacoes): mensagens de rede e de FK de alocação em boardErrorMessage (#49)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 2: `AllocationDialog` e `replicate` usam o contexto de alocação

**Arquivos:**
- Modificar: `src/components/AllocationDialog.tsx:192` (`onError` de `save`) e `:226` (`onError` de `remove`)
- Modificar: `src/components/BoardGrid.tsx:255` (`onError` de `replicate`)

**Interfaces:**
- Consome: `boardErrorMessage(error: unknown, context?: "allocation"): string` da Tarefa 1. O import já existe nos dois arquivos (`import { boardErrorMessage } from "@/lib/board-errors";`).

- [ ] **Passo 1: `save` no `AllocationDialog`**

Em `src/components/AllocationDialog.tsx`, dentro de `const save = useMutation({ ... })`, troque:

```ts
    onError: (e: Error) => toast.error(e.message),
```

por:

```ts
    onError: (e: Error) => toast.error(boardErrorMessage(e, "allocation")),
```

- [ ] **Passo 2: `remove` no `AllocationDialog`**

No mesmo arquivo, dentro de `const remove = useMutation({ ... })`, troque:

```ts
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
```

por:

```ts
    onError: (e: Error) => toast.error(boardErrorMessage(e, "allocation")),
```

Atenção: a mesma linha `onError: (e: Error) => toast.error(boardErrorMessage(e)),` **não** existe em outro lugar deste arquivo. Confira com `grep -n "onError" src/components/AllocationDialog.tsx`: devem aparecer exatamente duas linhas, ambas com `"allocation"` no fim.

- [ ] **Passo 3: `replicate` no `BoardGrid`**

Em `src/components/BoardGrid.tsx`, dentro de `const replicate = useMutation({ ... })` (por volta da linha 225), troque o `onError`:

```ts
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
```

por:

```ts
    onError: (e: Error) => toast.error(boardErrorMessage(e, "allocation")),
```

**Cuidado:** a mutação `move`, logo acima (por volta da linha 197), tem um `onError` idêntico e **deve continuar sem contexto**: no drag-and-drop, a mensagem "Não é possível mover uma demanda para a sprint de outro projeto." é a certa. Edite só o `onError` do bloco `replicate`. Para conferir, rode `grep -n "boardErrorMessage" src/components/BoardGrid.tsx`: devem aparecer o import, uma chamada `boardErrorMessage(e)` (move) e uma `boardErrorMessage(e, "allocation")` (replicate).

- [ ] **Passo 4: build e formatação**

```bash
npx prettier --write src/components/AllocationDialog.tsx src/components/BoardGrid.tsx
npm run build
git diff --stat
```

Esperado: build sem erro, com 3 linhas alteradas no total (2 em `AllocationDialog.tsx` e 1 em `BoardGrid.tsx`). Se o prettier reformatar o arquivo inteiro, siga as restrições globais.

- [ ] **Passo 5: commit**

```bash
git add src/components/AllocationDialog.tsx src/components/BoardGrid.tsx
git commit -m "fix(alocacoes): diálogo de demanda e replicar usam boardErrorMessage com contexto (#49)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3: verificação no navegador (coordenador)

Feita pelo coordenador, não pelo implementador.

- [ ] Abrir o board em localhost, editar uma demanda e, com o DevTools em modo **Offline** (ou bloqueando a URL do Supabase), clicar em Salvar. Esperado: toast "Sem conexão. Tente novamente." e diálogo aberto com o conteúdo preservado.
- [ ] Repetir com Excluir (confirmação) e com Replicar. Esperado: a mesma mensagem.
- [ ] Voltar a ficar online e salvar. Esperado: salva normalmente.
- [ ] Console sem erro novo além do `console.error("[board]", ...)` esperado do fallback.

## Cobertura da issue

| Critério de aceite | Onde |
|---|---|
| Erros do AllocationDialog passam por `boardErrorMessage` | Tarefa 2, passos 1-2 (e o replicate, passo 3) |
| Falha de rede mostra "Sem conexão. Tente novamente." | Tarefa 1, passos 3 e 5c; verificação na Tarefa 3 |
| Mensagens específicas para alocação (`allocations_dev_project_fkey` sem "mover para outro time") | Tarefa 1, passos 5b e 5d |
