# Validação do diálogo de sprint (issue #47): plano de implementação

> **Para execução agêntica:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam sintaxe de checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** Fazer o diálogo Nova/Editar sprint recusar fim < início e código duplicado no mesmo projeto, restringir o quarter a Q1–Q4 e avisar (sem bloquear) quando as datas se sobrepõem a outra sprint do projeto. O banco ganha constraints equivalentes, e as mensagens delas ficam mapeadas em `board-errors.ts`.

**Arquitetura:** Uma função pura nova (`sprintIssues`, em `src/lib/sprint-validation.ts`) recebe o rascunho e a lista de sprints do projeto e calcula os problemas. O `SprintDialog` passa a receber essa lista via prop (`BoardGrid` já tem a lista em `sprintsQ`), chama a função e mostra mensagens inline, no mesmo padrão do `DevDialog` (`windowInverted`/`canSave`). Uma migration acrescenta `CHECK` de datas, `CHECK` de quarter e `UNIQUE (jira_project, code)`. O `boardErrorMessage` traduz essas violações para quando o cliente estiver desatualizado ou houver corrida entre duas abas.

**Tech Stack:** React 19, TanStack Query v5, Supabase JS, shadcn/ui (`Select` em `src/components/ui/select.tsx`), Tailwind, Postgres (migrations em `supabase/migrations/`).

## Restrições globais

- Todo texto de UI e comentário em pt-BR com acentuação correta.
- Paridade com o `DevDialog`: a mensagem de datas invertidas é **exatamente** `A data de fim não pode ser anterior à de início.` em `text-xs text-destructive`, e o Salvar fica desabilitado.
- Sobreposição de datas **avisa e não bloqueia** (a issue pede "avisar"). Use o tom âmbar já usado no projeto: `text-amber-600 dark:text-amber-400`.
- Código duplicado **bloqueia** no cliente e no banco.
- Quarter vazio continua permitido (a coluna é `NOT NULL DEFAULT ''` e o quadro só mostra o quarter quando ele existe, em `BoardGrid.tsx:636`). Os valores aceitos são `''`, `Q1`, `Q2`, `Q3` e `Q4`.
- Não há framework de testes no projeto (nem `vitest`/`jest`, nem script `test`). A função pura é verificada com um script `tsx` descartável, que não deve ser commitado. O resto se verifica com `npm run build` e no navegador.
- Baseline conhecida: `npm run lint` já falha no checkout local com `prettier/prettier: Delete '␍'` porque o Windows usa `core.autocrlf=true`. Isso não é responsabilidade deste plano. Nos arquivos tocados, rode `npx prettier --write <arquivo>` antes de commitar.
- Este repositório sincroniza com o Lovable. Trabalhe na branch `fix/sprint-validacao-47`, nunca reescreva histórico publicado e **não faça push**: o push e o PR ficam com o coordenador, depois da confirmação do usuário.
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Mapa de arquivos

- **Criar `src/lib/sprint-validation.ts`:** `QUARTERS`, `isValidQuarter` e `sprintIssues` (funções puras).
- **Criar `supabase/migrations/20261001120000_sprints_integrity.sql`:** `sprints_date_order`, `sprints_quarter_format` e `sprints_project_code_key`.
- **Modificar `src/lib/board-errors.ts`:** mapear as três constraints novas.
- **Modificar `src/components/SprintDialog.tsx`:** prop `sprints`, `Select` de quarter, mensagens inline, `canSave` e correção do `diffDays`.
- **Modificar `src/components/BoardGrid.tsx:582-593`:** passar `sprints={sprints}` ao `SprintDialog`.

---

### Tarefa 1: funções puras de validação

**Arquivos:**
- Criar: `src/lib/sprint-validation.ts`
- Verificação: `src/lib/sprint-validation.check.ts` (temporário, apagado no fim da tarefa)

**Interfaces:**
- Consome: o tipo `Sprint` de `src/lib/board.ts` (`{ id, code, quarter, start_date, end_date, days, position, jira_project }`, com datas em `YYYY-MM-DD`).
- Produz (usado pela Tarefa 3):
  - `QUARTERS: readonly ["Q1", "Q2", "Q3", "Q4"]`
  - `isValidQuarter(q: string): boolean`: verdadeiro para `""` e para Q1–Q4.
  - `type SprintDraft = { id: string | null; code: string; start: string; end: string }`
  - `type SprintIssues = { inverted: boolean; duplicate: Sprint | null; overlaps: Sprint[] }`
  - `sprintIssues(draft: SprintDraft, sprints: Sprint[]): SprintIssues`

- [ ] **Passo 1: escrever o script de verificação (vai falhar)**

Criar `src/lib/sprint-validation.check.ts`:

```typescript
import assert from "node:assert/strict";
import { isValidQuarter, sprintIssues } from "./sprint-validation";
import type { Sprint } from "./board";

const s = (id: string, code: string, start_date: string, end_date: string): Sprint => ({
  id,
  code,
  quarter: "",
  start_date,
  end_date,
  days: 15,
  position: 0,
  jira_project: "PIM",
});

const list = [s("a", "26.3.1", "2026-07-01", "2026-07-14"), s("b", "26.3.2", "2026-07-15", "2026-07-28")];

// quarter
assert.equal(isValidQuarter(""), true);
assert.equal(isValidQuarter("Q1"), true);
assert.equal(isValidQuarter("Q4"), true);
assert.equal(isValidQuarter("Q9"), false);
assert.equal(isValidQuarter("q3"), false);

// fim antes do início
assert.equal(sprintIssues({ id: null, code: "x", start: "2026-08-10", end: "2026-08-01" }, list).inverted, true);
assert.equal(sprintIssues({ id: null, code: "x", start: "2026-08-01", end: "2026-08-01" }, list).inverted, false);
assert.equal(sprintIssues({ id: null, code: "x", start: "", end: "2026-08-01" }, list).inverted, false);

// código duplicado (com espaços em volta) — e a própria sprint não conta
assert.equal(sprintIssues({ id: null, code: " 26.3.1 ", start: "", end: "" }, list).duplicate?.id, "a");
assert.equal(sprintIssues({ id: "a", code: "26.3.1", start: "", end: "" }, list).duplicate, null);
assert.equal(sprintIssues({ id: null, code: "", start: "", end: "" }, list).duplicate, null);

// sobreposição inclusiva, excluindo a própria sprint
assert.deepEqual(
  sprintIssues({ id: null, code: "n", start: "2026-07-10", end: "2026-07-20" }, list).overlaps.map((x) => x.id),
  ["a", "b"],
);
assert.deepEqual(
  sprintIssues({ id: null, code: "n", start: "2026-07-14", end: "2026-07-14" }, list).overlaps.map((x) => x.id),
  ["a"],
);
assert.deepEqual(
  sprintIssues({ id: "a", code: "26.3.1", start: "2026-07-01", end: "2026-07-14" }, list).overlaps,
  [],
);
assert.deepEqual(
  sprintIssues({ id: null, code: "n", start: "2026-08-01", end: "2026-08-14" }, list).overlaps,
  [],
);
// datas invertidas não geram aviso de sobreposição (o erro de datas já basta)
assert.deepEqual(
  sprintIssues({ id: null, code: "n", start: "2026-07-20", end: "2026-07-10" }, list).overlaps,
  [],
);

console.log("OK");
```

- [ ] **Passo 2: rodar e confirmar que falha**

Run: `npx tsx src/lib/sprint-validation.check.ts`
Esperado: FALHA, com erro de módulo não encontrado (`./sprint-validation`).

- [ ] **Passo 3: implementar**

Criar `src/lib/sprint-validation.ts`:

```typescript
import type { Sprint } from "@/lib/board";

// Regras do diálogo de sprint (issue #47). Puras e sem React, para o
// SprintDialog e o script de verificação usarem a mesma lógica. O banco tem
// as constraints equivalentes (sprints_date_order, sprints_quarter_format,
// sprints_project_code_key); isto aqui existe para avisar antes de salvar.

export const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

/** Vazio é permitido: a coluna nasce com DEFAULT '' e o quadro só mostra quarter preenchido. */
export function isValidQuarter(q: string): boolean {
  return q === "" || (QUARTERS as readonly string[]).includes(q);
}

export type SprintDraft = {
  /** `null` para sprint nova; o id da sprint em edição para ela não colidir consigo mesma. */
  id: string | null;
  code: string;
  start: string;
  end: string;
};

export type SprintIssues = {
  /** Fim antes do início: bloqueia o salvar. */
  inverted: boolean;
  /** Outra sprint do projeto com o mesmo código: bloqueia o salvar. */
  duplicate: Sprint | null;
  /** Sprints do projeto cujas datas cruzam com as do rascunho: só aviso. */
  overlaps: Sprint[];
};

/**
 * `sprints` precisa ser a lista do projeto atual, como `sprintsQ` traz em
 * BoardGrid (já filtrada por `jira_project`). Datas em `YYYY-MM-DD`, então a
 * comparação de strings é cronológica, a mesma técnica do DevDialog.
 * Sobreposição é inclusiva: as duas datas fazem parte da sprint.
 */
export function sprintIssues(draft: SprintDraft, sprints: Sprint[]): SprintIssues {
  const others = sprints.filter((s) => s.id !== draft.id);
  const code = draft.code.trim();
  const inverted = Boolean(draft.start && draft.end && draft.end < draft.start);
  const duplicate = code ? (others.find((s) => s.code.trim() === code) ?? null) : null;
  const overlaps =
    draft.start && draft.end && !inverted
      ? others.filter((s) => s.start_date <= draft.end && draft.start <= s.end_date)
      : [];
  return { inverted, duplicate, overlaps };
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

Run: `npx tsx src/lib/sprint-validation.check.ts`
Esperado: imprime `OK`.

- [ ] **Passo 5: apagar o script e commitar**

```bash
rm src/lib/sprint-validation.check.ts
npx prettier --write src/lib/sprint-validation.ts
git add src/lib/sprint-validation.ts
git commit -m "feat(sprint): regras puras de validação do diálogo de sprint (#47)"
```

---

### Tarefa 2: constraints no banco e mensagens em `board-errors.ts`

**Arquivos:**
- Criar: `supabase/migrations/20261001120000_sprints_integrity.sql`
- Modificar: `src/lib/board-errors.ts` (blocos `23514`, perto da linha 59)

**Interfaces:**
- Consome: nada.
- Produz: os nomes das constraints `sprints_date_order`, `sprints_quarter_format` e `sprints_project_code_key`, e as mensagens que `boardErrorMessage` devolve para cada uma (o `SprintDialog` já chama `boardErrorMessage` no `onError`).

- [ ] **Passo 1: escrever a migration**

Criar `supabase/migrations/20261001120000_sprints_integrity.sql`:

```sql
-- Integridade de sprints (issue #47). O diálogo aceitava fim antes do início,
-- código repetido no mesmo projeto e quarter livre ("Q9"). O SprintDialog
-- passa a barrar isso antes de salvar; estas constraints cobrem cliente
-- desatualizado, chamada direta e corrida entre duas abas. As mensagens
-- pt-BR de cada uma estão em src/lib/board-errors.ts.
--
-- Os dois CHECKs entram NOT VALID: valem para todo INSERT/UPDATE daqui em
-- diante, mas não reprovam a migration por causa de linha antiga. Para
-- validá-los depois, confira que as consultas abaixo voltam vazias e rode:
--   ALTER TABLE public.sprints VALIDATE CONSTRAINT sprints_date_order;
--   ALTER TABLE public.sprints VALIDATE CONSTRAINT sprints_quarter_format;
--
--   SELECT id, code, start_date, end_date FROM public.sprints WHERE end_date < start_date;
--   SELECT id, code, quarter FROM public.sprints WHERE quarter !~ '^(Q[1-4])?$';
--
-- O UNIQUE não tem NOT VALID. Antes de aplicar, confira no SQL Editor que
-- esta consulta volta vazia; se voltar linha, renomeie ou exclua as
-- duplicadas antes, ou a migration inteira é revertida:
--   SELECT jira_project, code, count(*) FROM public.sprints
--   GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Sobreposição de datas entre sprints NÃO vira constraint: a issue pede
-- só aviso, e o diálogo avisa sem bloquear.
--
-- Ordem de deploy: independente. O cliente novo não depende destas
-- constraints, e o cliente antigo só passa a ver as mensagens mapeadas.
ALTER TABLE public.sprints
  ADD CONSTRAINT sprints_date_order
    CHECK (end_date >= start_date) NOT VALID,
  ADD CONSTRAINT sprints_quarter_format
    CHECK (quarter ~ '^(Q[1-4])?$') NOT VALID,
  ADD CONSTRAINT sprints_project_code_key
    UNIQUE (jira_project, code);
```

- [ ] **Passo 2: mapear as mensagens**

Em `src/lib/board-errors.ts`, logo **depois** do bloco `devs_availability_order` e **antes** do bloco `_jira_project_format`, inserir:

```typescript
  // Constraints de sprints (issue #47). O SprintDialog barra isso antes de
  // salvar; aqui cobrimos cliente desatualizado e corrida entre duas abas.
  if (code === "23514" && haystack.includes("sprints_date_order")) {
    return "A data de fim da sprint não pode ser anterior à de início.";
  }

  if (code === "23514" && haystack.includes("sprints_quarter_format")) {
    return "Quarter inválido. Use Q1, Q2, Q3 ou Q4.";
  }

  if (code === "23505" && haystack.includes("sprints_project_code_key")) {
    return "Já existe uma sprint com este código neste projeto.";
  }

```

- [ ] **Passo 3: conferir o mapeamento com um script descartável**

Criar `src/lib/board-errors.check.ts`:

```typescript
import assert from "node:assert/strict";
import { boardErrorMessage } from "./board-errors";

const pg = (code: string, constraint: string) => ({
  code,
  message: `new row for relation "sprints" violates check constraint "${constraint}"`,
  details: "",
});

assert.equal(
  boardErrorMessage(pg("23514", "sprints_date_order")),
  "A data de fim da sprint não pode ser anterior à de início.",
);
assert.equal(boardErrorMessage(pg("23514", "sprints_quarter_format")), "Quarter inválido. Use Q1, Q2, Q3 ou Q4.");
assert.equal(
  boardErrorMessage({
    code: "23505",
    message: 'duplicate key value violates unique constraint "sprints_project_code_key"',
    details: "",
  }),
  "Já existe uma sprint com este código neste projeto.",
);
// não quebrou o mapeamento que já existia
assert.equal(
  boardErrorMessage(pg("23514", "devs_availability_order")),
  "A data de fim da disponibilidade não pode ser anterior à de início.",
);
console.log("OK");
```

Run: `npx tsx src/lib/board-errors.check.ts`
Esperado: imprime `OK`.

- [ ] **Passo 4: apagar o script e commitar**

```bash
rm src/lib/board-errors.check.ts
npx prettier --write src/lib/board-errors.ts
git add supabase/migrations/20261001120000_sprints_integrity.sql src/lib/board-errors.ts
git commit -m "fix(sprint): constraints de datas, quarter e código único no banco (#47)"
```

---

### Tarefa 3: `SprintDialog` com validação inline e `Select` de quarter

**Arquivos:**
- Modificar: `src/components/SprintDialog.tsx`
- Modificar: `src/components/BoardGrid.tsx:582-593` (o JSX do `<SprintDialog ... />`)

**Interfaces:**
- Consome: `QUARTERS`, `isValidQuarter` e `sprintIssues` de `@/lib/sprint-validation` (Tarefa 1); as mensagens de `boardErrorMessage` (Tarefa 2) já chegam pelo `onError` existente.
- Produz: a nova prop `sprints: Sprint[]` do `SprintDialog` (a lista do projeto atual).

- [ ] **Passo 1: passar a lista de sprints no `BoardGrid`**

Em `src/components/BoardGrid.tsx`, no `<SprintDialog`, acrescentar a prop logo depois de `count={sprints.length}`:

```tsx
          count={sprints.length}
          sprints={sprints}
```

(`sprints` é a variável já usada em `count={sprints.length}`, derivada de `sprintsQ`, com a lista completa do projeto e sem filtro de ano.)

- [ ] **Passo 2: imports e utilitário de dias**

Em `src/components/SprintDialog.tsx`:

1. Acrescentar aos imports:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QUARTERS, isValidQuarter, sprintIssues } from "@/lib/sprint-validation";
```

2. Substituir `diffDays` (linhas 34-37) por:

```tsx
// Só é chamado com fim >= início (o diálogo barra o caso invertido antes).
// O antigo Math.max(1, …) mascarava a inversão como "1 dias corridos".
function diffDays(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1;
}

// O Radix Select não aceita item com value "", então "sem quarter" usa um
// sentinela e é convertido para "" no estado.
const NO_QUARTER = "none";
```

- [ ] **Passo 3: prop, estado e regras**

1. Na desestruturação das props, acrescentar `sprints,` depois de `count,`. No tipo, depois de `count: number;`, acrescentar:

```tsx
  /** Sprints do projeto atual, para detectar código duplicado e sobreposição. */
  sprints: Sprint[];
```

2. Depois de `const [end, setEnd] = useState("");`, acrescentar:

```tsx
  // Quarter gravado antes da issue #47 fora de Q1–Q4 (ex.: "Q9"): o Select
  // não consegue exibi-lo, então avisamos em vez de descartá-lo em silêncio.
  const [legacyQuarter, setLegacyQuarter] = useState<string | null>(null);
```

3. No `useEffect`, trocar `setQuarter(sprint?.quarter ?? "");` por:

```tsx
    const q = (sprint?.quarter ?? "").trim().toUpperCase();
    setQuarter(isValidQuarter(q) ? q : "");
    setLegacyQuarter(isValidQuarter(q) ? null : (sprint?.quarter ?? null));
```

4. No `payload` do `save`, trocar `quarter: quarter.trim(),` por `quarter,`. O valor agora sempre vem do Select.

5. Trocar `const valid = code.trim() && start && end;` por:

```tsx
  const issues = sprintIssues({ id: sprint?.id ?? null, code, start, end }, sprints);
  // Sobreposição só avisa: não entra no canSave.
  const canSave = Boolean(code.trim() && start && end) && !issues.inverted && !issues.duplicate;
```

6. No botão Salvar, trocar `disabled={!valid || save.isPending}` por `disabled={!canSave || save.isPending}`.

- [ ] **Passo 4: JSX dos campos e mensagens**

1. Logo depois do `<Input id="scode" ... />` (dentro da mesma `div.space-y-1.5`), acrescentar:

```tsx
                {issues.duplicate ? (
                  <p className="text-xs text-destructive">
                    Já existe a sprint &quot;{issues.duplicate.code}&quot; neste projeto.
                  </p>
                ) : null}
```

2. Substituir o `<Input id="squarter" ... />` inteiro por:

```tsx
                <Select
                  value={quarter || NO_QUARTER}
                  onValueChange={(v) => {
                    setQuarter(v === NO_QUARTER ? "" : v);
                    setLegacyQuarter(null);
                  }}
                >
                  <SelectTrigger id="squarter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_QUARTER}>Sem quarter</SelectItem>
                    {QUARTERS.map((q) => (
                      <SelectItem key={q} value={q}>
                        {q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {legacyQuarter ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    O quarter salvo (&quot;{legacyQuarter}&quot;) não é válido. Escolha Q1–Q4.
                  </p>
                ) : null}
```

3. Substituir o bloco da duração (`{start && end ? ( <p ...>Duração: ...</p> ) : null}`) por:

```tsx
            {issues.inverted ? (
              <p className="text-xs text-destructive">
                A data de fim não pode ser anterior à de início.
              </p>
            ) : start && end ? (
              <p className="text-xs text-muted-foreground">
                Duração: {diffDays(start, end)} dias corridos
              </p>
            ) : null}
            {issues.overlaps.length > 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                As datas se sobrepõem{" "}
                {issues.overlaps.length === 1 ? "à sprint" : "às sprints"}{" "}
                {issues.overlaps.map((s) => s.code).join(", ")}. Você ainda pode salvar.
              </p>
            ) : null}
```

- [ ] **Passo 5: build e formatação**

```bash
npx prettier --write src/components/SprintDialog.tsx src/components/BoardGrid.tsx
npm run build
```
Esperado: build sem erro de tipo nem de compilação. Confira com `git diff --stat` que o prettier mudou só as linhas desta tarefa em `BoardGrid.tsx`. Se ele reformatou o arquivo inteiro por causa de CRLF, rode `git checkout -- src/components/BoardGrid.tsx` e refaça só a edição do Passo 1, sem prettier.

- [ ] **Passo 6: commitar**

```bash
git add src/components/SprintDialog.tsx src/components/BoardGrid.tsx
git commit -m "fix(sprint): diálogo barra fim antes do início e código duplicado, quarter vira select (#47)"
```

---

### Tarefa 4: verificação no navegador (coordenador)

Feita pelo coordenador, não por subagente. Suba o dev server (`.claude/launch.json` ou `npm run dev`) e, na tela de Alocações:

- [ ] Nova sprint com fim < início: aparece a mensagem vermelha, a duração some e o Salvar fica desabilitado.
- [ ] Nova sprint com o código de uma sprint existente: mensagem "Já existe a sprint …" e Salvar desabilitado.
- [ ] Editar uma sprint existente sem mudar o código: nenhum erro de duplicidade.
- [ ] Datas que cruzam com outra sprint: aviso âmbar, e o Salvar continua habilitado.
- [ ] O quarter é um Select com "Sem quarter" e Q1–Q4.
- [ ] Console sem erros.

Não salvar sprints de teste no banco real a menos que o usuário peça. Basta conferir os estados do formulário.
