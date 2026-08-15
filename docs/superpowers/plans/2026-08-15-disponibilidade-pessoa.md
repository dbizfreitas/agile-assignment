# Janela de Disponibilidade da Pessoa — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada pessoa passa a ter uma janela de disponibilidade opcional (`de` … `até`), e a grade de alocações desabilita as células das sprints que não cabem inteiras nessa janela — o mesmo cinza que hoje é pintado à mão na planilha.

**Architecture:** Uma migration acrescenta `available_from` e `available_to` (ambas `date`, ambas anuláveis) a `public.devs`, mais um `CHECK` de ordem. A regra que decide se uma sprint cabe na janela vive como **função pura** em `src/lib/board.ts` (`isDevAvailableInSprint`), não como condicional no JSX — é o que a faz sobreviver à reescrita da grade para formato Gantt (issue #12). `DevDialog` ganha dois campos de data e `BoardGrid` consulta a função por célula para esmaecer, esconder o botão "+ demanda" e recusar o drop. Nenhum trigger valida a janela em `allocations`: a decisão e o motivo estão na spec.

**Tech Stack:** PostgreSQL 15 (Supabase), TanStack Start + React 19, TanStack Query v5, shadcn/ui (Radix Tooltip/Dialog/Select), Tailwind v4, TypeScript 5.8 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Node 24 (para a verificação da Task 2).

**Spec:** [`docs/superpowers/specs/2026-08-15-disponibilidade-pessoa-design.md`](../specs/2026-08-15-disponibilidade-pessoa-design.md)

**Issue:** [#2 — Cadastro de pessoa: data de início de disponibilidade](https://github.com/dbizfreitas/agile-assignment/issues/2)

## Global Constraints

- **Idioma da UI:** pt-BR em todo texto visível, com acentuação correta.
- **Regra de fronteira: contenção total.** Uma sprint só fica habilitada se couber **inteira** na janela. Pessoa que entra no dia 10, com a sprint indo de 01 a 15, aparece só a partir da sprint seguinte. Isso diverge do texto literal da issue #2 e é intencional — está justificado na spec.
- **`NULL` desliga o lado correspondente da regra.** As duas colunas são anuláveis. Pessoa sem janela aparece habilitada em todas as sprints, exatamente como antes desta frente. **Não há backfill.**
- **Cartões preexistentes fora da janela continuam visíveis, editáveis e arrastáveis para fora.** Só a célula é que fica cinza e recusa entrada. Dado nunca some por mudança de configuração.
- **Nenhum trigger em `allocations`.** O único objeto novo no banco é o `CHECK devs_availability_order`.
- **Nenhuma policy de RLS muda.** As policies de `devs` são por tabela e por papel; os `GRANT`s de tabela cobrem coluna nova automaticamente.
- **`devs.active` não é tocada.** É coluna morta desde a migration inicial e fica fora de escopo — decisão registrada na spec.
- **`src/components/AllocationDialog.tsx` não muda.**
- **Datas são comparadas como strings `YYYY-MM-DD`, nunca com `new Date()`.** Nesse formato a ordem lexicográfica é a cronológica, e `new Date("2026-08-15")` é meia-noite UTC — vira 14/08 em `UTC-3`. O `formatRange` que já existe toma esse mesmo cuidado.
- **`src/integrations/supabase/types.ts` é editado à mão** neste projeto — mesma convenção usada para `invitations`, `role_audit_log` e `allocations.tickets`.
- **Sem test runner.** `package.json` só traz `dev`, `build`, `build:dev`, `preview`, `lint`, `format`, e esta demanda **não introduz um** (decisão da spec). A verificação é: smoke SQL para o banco, script descartável rodado com `node --experimental-strip-types` para a função pura, `tsc`/`eslint`/`build` para o resto, e roteiro manual para a UI.
- **Não fazer `git push`.** O repositório sincroniza com o Lovable; o push é decisão do usuário ao final.
- **Nunca reescrever histórico** (sem `rebase`, `amend` ou `squash` de commits publicados) — restrição do `AGENTS.md`.
- **Não commitar `src/routeTree.gen.ts`.** Ele já chega modificado no working tree e não é desta frente. Todo `git add` deste plano é por caminho explícito, nunca `git add -A`.

### Verificação de código: sempre nesta ordem

```bash
npx prettier --write <arquivos tocados>
npx eslint <arquivos tocados>
npx tsc --noEmit
```

**Nunca rodar `npm run lint` sem escopo.** O checkout tem `core.autocrlf=true`, então todo arquivo do repositório chega com CRLF e a regra `prettier/prettier` reprova centenas de linhas em arquivos que a task não tocou (`npx eslint src/lib/board.ts` sozinho devolve ~340 erros `Delete ␍`). É ruído pré-existente, não é desta demanda. O `npx prettier --write` nos arquivos tocados normaliza para LF e resolve; como o git normaliza CRLF↔LF na comparação, isso **não** gera diff espúrio.

### Como aplicar a migration

**Não existe caminho automatizado neste ambiente.** `supabase/config.toml` só tem `project_id = "lpgkridgduuquteopnaj"`; não há CLI do Supabase no `package.json`; `psql` não está no PATH; e o `.env` não tem senha de banco nem `service_role` key. **Aplicar a migration é passo manual de quem executa o plano**, contra o projeto Supabase real:

1. Abrir o SQL Editor do projeto Supabase `lpgkridgduuquteopnaj`.
2. Colar o conteúdo integral do arquivo `.sql`.
3. Executar e confirmar "Success. No rows returned".

O mesmo vale para os arquivos de `supabase/tests/`: são colados e executados no SQL Editor. Rodam inteiros dentro de `BEGIN … ROLLBACK` e não deixam resíduo.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `supabase/migrations/20260815120000_devs_availability_window.sql` | **Criar.** As duas colunas e o `CHECK` de ordem. | 1 |
| `supabase/tests/disponibilidade_pessoa_smoke.sql` | **Criar.** Prova que as colunas existem, são anuláveis, e que o `CHECK` aceita janela aberta e rejeita janela invertida. | 1 |
| `src/integrations/supabase/types.ts` | **Modificar** (bloco `devs`, linhas 91‑121). Os dois campos em `Row`/`Insert`/`Update`. | 1 |
| `src/lib/board.ts` | **Modificar.** Tipo `Dev` + `isDevAvailableInSprint` + `formatAvailability` + extração de `formatDate`. É onde a regra mora. | 2 |
| `src/components/DevDialog.tsx` | **Modificar.** Dois campos de data, validação de janela invertida, `null` no payload. | 3 |
| `src/lib/board-errors.ts` | **Modificar.** Mensagem pt-BR para o `CHECK` — rede de segurança do diálogo. | 3 |
| `src/components/BoardGrid.tsx` | **Modificar.** Célula desabilitada (visual, sem botão, sem drop) e período no tooltip do cabeçalho. | 4 |

---

## Task 1: Colunas de disponibilidade no banco

**Files:**
- Create: `supabase/migrations/20260815120000_devs_availability_window.sql`
- Create: `supabase/tests/disponibilidade_pessoa_smoke.sql`
- Modify: `src/integrations/supabase/types.ts:91-121`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: as colunas `public.devs.available_from` e `public.devs.available_to`, ambas `date` e anuláveis; a restrição `devs_availability_order`; e os campos `available_from: string | null` / `available_to: string | null` no tipo gerado `Database["public"]["Tables"]["devs"]`. As Tasks 2‑4 dependem desses nomes exatos.

- [ ] **Step 1: Escrever o smoke SQL (a verificação que deve falhar primeiro)**

Criar `supabase/tests/disponibilidade_pessoa_smoke.sql`:

```sql
-- Suíte de verificação da janela de disponibilidade da pessoa (issue #2).
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
-- Falha = ERROR: com a mensagem da asserção.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura
-- ============================================================
DO $$
DECLARE
  c text;
  v_type text;
  v_nullable text;
BEGIN
  FOREACH c IN ARRAY ARRAY['available_from','available_to'] LOOP
    SELECT data_type, is_nullable INTO v_type, v_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'devs' AND column_name = c;

    IF v_type IS NULL THEN
      RAISE EXCEPTION 'FALHA 1.1: coluna public.devs.% ausente', c;
    END IF;

    IF v_type <> 'date' THEN
      RAISE EXCEPTION 'FALHA 1.2: public.devs.% deveria ser date, é %', c, v_type;
    END IF;

    -- Anulável é requisito, não descuido: NULL significa "sem restrição" e é
    -- o que mantém toda pessoa já cadastrada com o comportamento de antes.
    IF v_nullable <> 'YES' THEN
      RAISE EXCEPTION 'FALHA 1.3: public.devs.% precisa ser anulável', c;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'devs_availability_order'
       AND conrelid = 'public.devs'::regclass
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'FALHA 1.4: CHECK devs_availability_order ausente';
  END IF;

  RAISE NOTICE 'Seção 1 OK — colunas date anuláveis e CHECK presentes';
END $$;

-- ============================================================
-- Seção 2 — Comportamento do CHECK
-- ============================================================
DO $$
DECLARE
  v_team uuid;
BEGIN
  INSERT INTO public.teams (name, color, position, jira_project)
       VALUES ('Smoke time disponibilidade', '#0f766e', 910, 'PIM')
    RETURNING id INTO v_team;

  -- 2.1 Janela aberta dos dois lados (o caso de toda pessoa existente).
  INSERT INTO public.devs (name, initials, team_id, position)
       VALUES ('Smoke sem janela', 'SJ', v_team, 910);

  -- 2.2 Janela aberta de um lado só, nos dois sentidos.
  INSERT INTO public.devs (name, initials, team_id, position, available_from)
       VALUES ('Smoke só início', 'SI', v_team, 911, '2026-08-10');
  INSERT INTO public.devs (name, initials, team_id, position, available_to)
       VALUES ('Smoke só fim', 'SF', v_team, 912, '2026-09-30');

  -- 2.3 Janela fechada e válida.
  INSERT INTO public.devs (name, initials, team_id, position, available_from, available_to)
       VALUES ('Smoke janela', 'SW', v_team, 913, '2026-08-10', '2026-09-30');

  -- 2.4 Limite: início igual ao fim é janela de um dia, e é válida.
  INSERT INTO public.devs (name, initials, team_id, position, available_from, available_to)
       VALUES ('Smoke um dia', 'SU', v_team, 914, '2026-08-10', '2026-08-10');

  -- 2.5 Janela invertida tem de estourar.
  BEGIN
    INSERT INTO public.devs (name, initials, team_id, position, available_from, available_to)
         VALUES ('Smoke invertida', 'SX', v_team, 915, '2026-09-30', '2026-08-10');
    RAISE EXCEPTION 'FALHA 2.5: o CHECK aceitou janela invertida no INSERT';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- 2.6 E também no UPDATE, não só no INSERT.
  BEGIN
    UPDATE public.devs
       SET available_to = '2026-01-01'
     WHERE name = 'Smoke janela';
    RAISE EXCEPTION 'FALHA 2.6: o CHECK aceitou janela invertida no UPDATE';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'Seção 2 OK — CHECK aceita janela aberta e rejeita invertida';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar o smoke ANTES da migration e confirmar que falha**

Colar `supabase/tests/disponibilidade_pessoa_smoke.sql` no SQL Editor do projeto `lpgkridgduuquteopnaj` e executar.

Esperado: `ERROR: FALHA 1.1: coluna public.devs.available_from ausente`.

Se passar, a migration já foi aplicada por engano — parar e investigar antes de seguir.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260815120000_devs_availability_window.sql`:

```sql
-- Janela de disponibilidade da pessoa (issue #2 do repo): a partir de quando,
-- e opcionalmente até quando, alguém faz parte do time e deve aparecer
-- habilitada na grade de alocações. Substitui o cinza que hoje é pintado à
-- mão na planilha que a ferramenta veio aposentar.
--
-- As duas colunas são ANULÁVEIS de propósito: NULL desliga o lado
-- correspondente da regra, então toda pessoa já cadastrada nasce sem
-- restrição e se comporta exatamente como antes desta migration. Não há
-- backfill — preencher com uma data que ninguém informou seria inventar dado.
--
-- Nenhuma policy de RLS muda: as policies de devs (devs_select_viewers,
-- devs_insert_editors, devs_update_editors, devs_delete_editors) são por
-- tabela e por papel, não por coluna, e os GRANTs de tabela cobrem coluna
-- nova automaticamente.
--
-- Sem índice: a regra é avaliada no cliente sobre a lista de pessoas que a
-- tela já carrega em memória, nunca num WHERE.
--
-- Sem trigger em allocations validando a janela — decisão registrada em
-- docs/superpowers/specs/2026-08-15-disponibilidade-pessoa-design.md.
-- Resumo: projeto é imutável na prática, janela de disponibilidade muda.
-- Com o trigger, encurtar a janela de alguém travaria o UPDATE de todo
-- cartão preexistente fora dela — inclusive o arrastar-para-fora, que é
-- justamente a correção. O banco impediria a única ação que resolve.
ALTER TABLE public.devs
  ADD COLUMN available_from date,
  ADD COLUMN available_to   date;

-- Este CHECK fica porque é invariante de LINHA, não de relação: não depende
-- de nenhuma outra tabela, então travá-lo no banco não pode encurralar o
-- usuário. Os dois IS NULL deixam passar janela aberta dos dois lados e
-- janela aberta de um lado só.
ALTER TABLE public.devs
  ADD CONSTRAINT devs_availability_order
  CHECK (available_to IS NULL OR available_from IS NULL OR available_to >= available_from);
```

- [ ] **Step 4: Aplicar a migration e rodar o smoke de novo**

Colar o conteúdo da migration no SQL Editor e executar. Esperado: `Success. No rows returned`.

Em seguida, colar e executar `supabase/tests/disponibilidade_pessoa_smoke.sql` novamente.

Esperado: `Success. No rows returned` com os NOTICEs `Seção 1 OK — colunas date anuláveis e CHECK presentes` e `Seção 2 OK — CHECK aceita janela aberta e rejeita invertida`.

- [ ] **Step 5: Refletir as colunas em `types.ts`**

Em `src/integrations/supabase/types.ts`, no bloco `devs` (linhas 91‑121), acrescentar os dois campos em `Row`, `Insert` e `Update`. O arquivo é ordenado alfabeticamente pelo codegen, então `available_from` e `available_to` entram **depois de `active` e antes de `created_at`**:

```ts
      devs: {
        Row: {
          active: boolean
          available_from: string | null
          available_to: string | null
          created_at: string
          id: string
          initials: string
          jira_project: string
          name: string
          position: number
          team_id: string
        }
        Insert: {
          active?: boolean
          available_from?: string | null
          available_to?: string | null
          created_at?: string
          id?: string
          initials?: string
          jira_project: string
          name: string
          position?: number
          team_id: string
        }
        Update: {
          active?: boolean
          available_from?: string | null
          available_to?: string | null
          created_at?: string
          id?: string
          initials?: string
          jira_project?: string
          name?: string
          position?: number
          team_id?: string
        }
```

O bloco `Relationships` de `devs` não muda.

- [ ] **Step 6: Verificar tipos**

```bash
npx tsc --noEmit
```

Esperado: nenhum erro. Este arquivo não é formatado pelo prettier do projeto (é saída de codegen) — não rodar `prettier --write` nele.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260815120000_devs_availability_window.sql supabase/tests/disponibilidade_pessoa_smoke.sql src/integrations/supabase/types.ts
git commit -m "feat(alocacoes): colunas de janela de disponibilidade em devs (#2)"
```

---

## Task 2: A regra de disponibilidade como função pura

**Files:**
- Modify: `src/lib/board.ts:19-27` (tipo `Dev`) e `src/lib/board.ts:132-138` (`formatRange`)
- Temp: `verificacao-disponibilidade.ts` na raiz do repo — **criado e apagado dentro desta task, nunca commitado**

**Interfaces:**
- Consumes: os nomes de coluna `available_from` / `available_to` da Task 1.
- Produces:
  - `Dev` com `available_from: string | null` e `available_to: string | null`
  - `isDevAvailableInSprint(dev: Pick<Dev, "available_from" | "available_to">, sprint: Pick<Sprint, "start_date" | "end_date">): boolean`
  - `formatAvailability(dev: Pick<Dev, "available_from" | "available_to">): string | null`
  - `formatDate(iso: string): string`

  A Task 4 usa `isDevAvailableInSprint` e `formatAvailability` com esses nomes exatos.

**Por que a verificação é um script descartável:** o projeto não tem test runner e a spec decidiu não introduzir um. `src/lib/board.ts` tem uma única importação e ela é `import type`, que o type-stripping do Node 24 remove por completo — então o Node consegue importar o módulo direto, sem bundler, sem resolver o alias `@/`. Isso dá um ciclo vermelho/verde de verdade com zero dependência nova. O script é apagado no Step 6, antes do commit.

- [ ] **Step 1: Escrever o script de verificação (deve falhar)**

Criar `verificacao-disponibilidade.ts` na **raiz do repositório**:

```ts
import assert from "node:assert/strict";
import { isDevAvailableInSprint, formatAvailability } from "./src/lib/board.ts";

const sprint = (start_date: string, end_date: string) => ({ start_date, end_date });
const s1 = sprint("2026-08-01", "2026-08-15");
const s2 = sprint("2026-08-16", "2026-08-31");
const s3 = sprint("2026-09-01", "2026-09-15");

// Sem janela: disponível em qualquer sprint. É o caso de toda pessoa já
// cadastrada, e o que garante que a migration não muda comportamento.
assert.equal(isDevAvailableInSprint({ available_from: null, available_to: null }, s1), true);

// Entrou dia 10, no meio da s1: CONTENÇÃO TOTAL — a s1 não acende, a s2 sim.
const entrouDia10 = { available_from: "2026-08-10", available_to: null };
assert.equal(isDevAvailableInSprint(entrouDia10, s1), false);
assert.equal(isDevAvailableInSprint(entrouDia10, s2), true);

// Limite exato: janela começa no primeiro dia da sprint -> acende.
assert.equal(isDevAvailableInSprint({ available_from: "2026-08-01", available_to: null }, s1), true);

// Saiu dia 20, no meio da s2: só a s1 acende.
const saiuDia20 = { available_from: null, available_to: "2026-08-20" };
assert.equal(isDevAvailableInSprint(saiuDia20, s1), true);
assert.equal(isDevAvailableInSprint(saiuDia20, s2), false);
assert.equal(isDevAvailableInSprint(saiuDia20, s3), false);

// Limite exato: janela termina no último dia da sprint -> acende.
assert.equal(isDevAvailableInSprint({ available_from: null, available_to: "2026-08-15" }, s1), true);

// Janela fechada dos dois lados: só a sprint contida acende.
const janela = { available_from: "2026-08-16", available_to: "2026-08-31" };
assert.equal(isDevAvailableInSprint(janela, s1), false);
assert.equal(isDevAvailableInSprint(janela, s2), true);
assert.equal(isDevAvailableInSprint(janela, s3), false);

// Texto do tooltip nos quatro casos.
assert.equal(formatAvailability({ available_from: null, available_to: null }), null);
assert.equal(
  formatAvailability({ available_from: "2026-08-10", available_to: null }),
  "Disponível a partir de 10/08/26",
);
assert.equal(
  formatAvailability({ available_from: null, available_to: "2026-09-30" }),
  "Disponível até 30/09/26",
);
assert.equal(
  formatAvailability({ available_from: "2026-08-10", available_to: "2026-09-30" }),
  "Disponível de 10/08/26 a 30/09/26",
);

console.log("OK — 15 asserções de disponibilidade passaram");
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
node --experimental-strip-types verificacao-disponibilidade.ts
```

Esperado: erro de importação — `SyntaxError: The requested module './src/lib/board.ts' does not provide an export named 'isDevAvailableInSprint'`.

- [ ] **Step 3: Implementar em `src/lib/board.ts`**

**3a.** Acrescentar os dois campos ao tipo `Dev` (linhas 19‑27), depois de `jira_project`:

```ts
export type Dev = {
  id: string;
  name: string;
  initials: string;
  team_id: string;
  position: number;
  active: boolean;
  jira_project: JiraProjectKey;
  /**
   * Janela de disponibilidade (issue #2). `null` desliga o lado
   * correspondente da regra — pessoa sem janela aparece habilitada em todas
   * as sprints, que é o comportamento de antes destas colunas existirem.
   */
  available_from: string | null;
  available_to: string | null;
};
```

**3b.** Substituir o `formatRange` atual (linhas 132‑138) pelo trecho abaixo, que extrai o formatador de data e acrescenta as duas funções novas:

```ts
/**
 * `2026-08-15` → `15/08/26`. Fatia a string em vez de construir um `Date`:
 * `new Date("2026-08-15")` é meia-noite UTC e vira 14/08 em `UTC-3`.
 */
export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y?.slice(2)}`;
}

export function formatRange(start: string, end: string) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/**
 * Uma sprint só é oferecida a uma pessoa quando cabe INTEIRA na janela de
 * disponibilidade dela — quem entra no meio de uma sprint aparece a partir da
 * seguinte. É contenção total, não sobreposição: quem tem meia sprint não
 * deveria receber demanda de sprint cheia. A escolha diverge do texto literal
 * da issue #2 e está justificada na spec.
 *
 * Compara strings `YYYY-MM-DD` diretamente, sem `Date`: nesse formato a ordem
 * lexicográfica É a cronológica, e não passar por `Date` evita o erro de fuso
 * descrito em `formatDate`.
 *
 * Recebe `Pick<…>` e não as entidades inteiras porque depende só das quatro
 * datas — a assinatura estreita diz isso, e mantém a função utilizável pelo
 * novo layout da grade quando a issue #12 reescrever o `BoardGrid`.
 */
export function isDevAvailableInSprint(
  dev: Pick<Dev, "available_from" | "available_to">,
  sprint: Pick<Sprint, "start_date" | "end_date">,
) {
  if (dev.available_from && sprint.start_date < dev.available_from) return false;
  if (dev.available_to && sprint.end_date > dev.available_to) return false;
  return true;
}

/** Período para o tooltip do cabeçalho da coluna; `null` quando não há janela. */
export function formatAvailability(dev: Pick<Dev, "available_from" | "available_to">) {
  if (dev.available_from && dev.available_to) {
    return `Disponível de ${formatDate(dev.available_from)} a ${formatDate(dev.available_to)}`;
  }
  if (dev.available_from) return `Disponível a partir de ${formatDate(dev.available_from)}`;
  if (dev.available_to) return `Disponível até ${formatDate(dev.available_to)}`;
  return null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
node --experimental-strip-types verificacao-disponibilidade.ts
```

Esperado: `OK — 15 asserções de disponibilidade passaram`.

- [ ] **Step 5: Verificar formatação e tipos**

```bash
npx prettier --write src/lib/board.ts
npx eslint src/lib/board.ts
npx tsc --noEmit
```

Esperado: `eslint` sem saída; `tsc` sem erro.

Os dois campos novos são obrigatórios no tipo `Dev`, mas nenhum arquivo constrói um `Dev` por literal — as queries usam `data as Dev[]` (cast) e `DevDialog` só recebe `Dev | null` por prop. Portanto nada deve quebrar em cascata. Se `tsc` acusar erro em qualquer outro arquivo, parar e investigar antes de commitar.

O script `verificacao-disponibilidade.ts` na raiz não entra no `tsc`: o `include` do `tsconfig.json` é `["src/**/*.ts", "src/**/*.tsx", "vite.config.ts", "eslint.config.js"]`.

- [ ] **Step 6: Apagar o script descartável**

```bash
rm verificacao-disponibilidade.ts
```

Confirmar que sumiu:

```bash
git status --short
```

Esperado: `verificacao-disponibilidade.ts` **não** aparece na saída.

- [ ] **Step 7: Commit**

```bash
git add src/lib/board.ts
git commit -m "feat(alocacoes): regra de disponibilidade por sprint em lib/board (#2)"
```

---

## Task 3: Campos de disponibilidade no cadastro de pessoa

**Files:**
- Modify: `src/components/DevDialog.tsx`
- Modify: `src/lib/board-errors.ts:36-38`

**Interfaces:**
- Consumes: `Dev.available_from` / `Dev.available_to` (Task 2); a restrição `devs_availability_order` (Task 1).
- Produces: nada que outra task consuma. É a ponta de escrita.

- [ ] **Step 1: Estados dos dois campos**

Em `src/components/DevDialog.tsx`, logo depois de `const [newTeamColor, setNewTeamColor] = useState(TEAM_COLORS[0]!);`:

```ts
  // Strings vazias, não `null`: `<Input type="date">` é controlado e `null`
  // faria o React alternar entre controlado e não-controlado.
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableTo, setAvailableTo] = useState("");
```

- [ ] **Step 2: Resetar os campos na abertura do diálogo**

No `useEffect` existente (o que começa com `if (!open) return;`), acrescentar duas linhas depois de `setNewTeamColor(...)`:

```ts
  useEffect(() => {
    if (!open) return;
    setName(dev?.name ?? "");
    setTeamId(dev?.team_id ?? (teams.length > 0 ? teams[0]!.id : NEW_TEAM));
    setNewTeamName("");
    setNewTeamColor(TEAM_COLORS[teams.length % TEAM_COLORS.length]!);
    setAvailableFrom(dev?.available_from ?? "");
    setAvailableTo(dev?.available_to ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dev]);
```

- [ ] **Step 3: Mandar os dois campos no payload**

No `payload` do `save`, depois de `position`:

```ts
      const payload = {
        name: name.trim(),
        initials: initialsFrom(name),
        team_id: finalTeamId,
        position: dev?.position ?? count,
        // `|| null` e não a string vazia: `""` em coluna `date` é erro de
        // sintaxe no Postgres, e `null` é o valor que significa "sem
        // restrição" — o mesmo estado de toda pessoa cadastrada antes da
        // migration.
        available_from: availableFrom || null,
        available_to: availableTo || null,
      };
```

- [ ] **Step 4: Bloquear janela invertida antes de chegar ao banco**

Substituir a linha do `canSave` (hoje `const canSave = name.trim().length > 0 && (teamId !== NEW_TEAM || newTeamName.trim().length > 0);`) por:

```ts
  // Comparação de strings `YYYY-MM-DD`, mesma técnica de `isDevAvailableInSprint`.
  const windowInverted = Boolean(availableFrom && availableTo && availableTo < availableFrom);

  const canSave =
    name.trim().length > 0 &&
    (teamId !== NEW_TEAM || newTeamName.trim().length > 0) &&
    !windowInverted;
```

- [ ] **Step 5: Desenhar os campos**

No JSX, **depois** do bloco condicional `{teamId === NEW_TEAM ? (…) : null}` e ainda dentro da `<div className="space-y-4">`:

```tsx
          <div className="space-y-1.5">
            <Label>Disponibilidade</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dfrom" className="text-xs font-normal text-muted-foreground">
                  A partir de
                </Label>
                <Input
                  id="dfrom"
                  type="date"
                  value={availableFrom}
                  onChange={(e) => setAvailableFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dto" className="text-xs font-normal text-muted-foreground">
                  Até (opcional)
                </Label>
                <Input
                  id="dto"
                  type="date"
                  value={availableTo}
                  onChange={(e) => setAvailableTo(e.target.value)}
                />
              </div>
            </div>
            {windowInverted ? (
              <p className="text-xs text-destructive">
                A data de fim não pode ser anterior à de início.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Em branco, a pessoa fica disponível em todas as sprints. A sprint precisa caber
                inteira na janela para ficar habilitada.
              </p>
            )}
          </div>
```

- [ ] **Step 6: Mensagem pt-BR para o CHECK, como rede de segurança**

Em `src/lib/board-errors.ts`, dentro de `boardErrorMessage`, **antes** do bloco `if (code === "23514" && haystack.includes("_jira_project_format"))`:

```ts
  // O diálogo já barra janela invertida no `canSave`; isto cobre o caminho de
  // um cliente desatualizado, para o usuário não ver o texto cru do Postgres.
  if (code === "23514" && haystack.includes("devs_availability_order")) {
    return "A data de fim da disponibilidade não pode ser anterior à de início.";
  }
```

- [ ] **Step 7: Verificar formatação e tipos**

```bash
npx prettier --write src/components/DevDialog.tsx src/lib/board-errors.ts
npx eslint src/components/DevDialog.tsx src/lib/board-errors.ts
npx tsc --noEmit
```

Esperado: `eslint` sem saída; `tsc` sem erro.

- [ ] **Step 8: Verificar no navegador**

```bash
npm run dev
```

Abrir `/alocacoes`, clicar em "Pessoa", e confirmar:

1. Os dois campos de data aparecem, vazios, com o texto de ajuda cinza embaixo.
2. Preenchendo fim anterior ao início: o texto vira vermelho e o botão "Salvar" desabilita.
3. Salvando com fim posterior ao início: fecha sem erro.
4. Reabrindo a mesma pessoa pelo cabeçalho da coluna: os dois campos voltam preenchidos.
5. Salvando uma pessoa com os dois campos vazios: fecha sem erro (é o caso `null/null`).

- [ ] **Step 9: Commit**

```bash
git add src/components/DevDialog.tsx src/lib/board-errors.ts
git commit -m "feat(alocacoes): campos de disponibilidade no cadastro de pessoa (#2)"
```

---

## Task 4: Célula desabilitada na grade

**Files:**
- Modify: `src/components/BoardGrid.tsx` — import (linhas 8‑25), tooltip do cabeçalho (linhas 303‑336), célula do `SprintRow` (linhas 443‑486)

**Interfaces:**
- Consumes: `isDevAvailableInSprint` e `formatAvailability` (Task 2).
- Produces: nada. É a ponta de leitura.

- [ ] **Step 1: Importar as duas funções**

No `import { … } from "@/lib/board";` (linhas 8‑25), acrescentar `formatAvailability` e `isDevAvailableInSprint` mantendo a ordem alfabética existente:

```ts
import {
  accentClassFor,
  chipClassFor,
  formatAvailability,
  formatRange,
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

- [ ] **Step 2: Período no tooltip do cabeçalho da coluna**

No `devs.map` do cabeçalho (linha 303), acrescentar a constante junto de `team` e trocar o conteúdo do `<TooltipContent>`:

```tsx
                {devs.map((d) => {
                  const team = teamById.get(d.team_id);
                  const availability = formatAvailability(d);
                  return (
                    <Tooltip key={d.id}>
```

E, no fim do mesmo bloco, substituir `<TooltipContent>{d.name}</TooltipContent>` por:

```tsx
                      <TooltipContent>
                        {d.name}
                        {availability ? (
                          <span className="block text-muted-foreground">{availability}</span>
                        ) : null}
                      </TooltipContent>
```

- [ ] **Step 3: Calcular a disponibilidade por célula**

Em `SprintRow`, no `devs.map` (linha 443), acrescentar a constante depois de `items`:

```tsx
      {devs.map((d) => {
        const key = `${sprint.id}:${d.id}`;
        const items = byCell.get(key) ?? [];
        // A célula fora da janela não some nem esvazia: ela só deixa de
        // aceitar entrada. Cartões que já estavam ali continuam renderizando,
        // abrem no diálogo e podem ser arrastados PARA FORA — que é a ação
        // que corrige a inconsistência.
        const available = isDevAvailableInSprint(d, sprint);
        return (
```

- [ ] **Step 4: Recusar o drop e esmaecer a célula**

Substituir o `<div>` da célula (o que hoje tem `onDragOver`, `onDragLeave`, `onDrop` e a `className` com `group/cell`) por:

```tsx
          <div
            key={key}
            onDragOver={(e) => {
              // Sem `preventDefault()` o navegador não marca a célula como
              // alvo válido — é assim que o cursor de "proibido" aparece.
              if (!available) return;
              e.preventDefault();
              setDragOver(key);
            }}
            onDragLeave={() => setDragOver(dragOver === key ? null : dragOver)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              if (!available) return;
              const id = e.dataTransfer.getData("text/allocation");
              if (id) onDrop(id, d.id);
            }}
            className={`group/cell relative flex flex-col gap-1 border-b border-r border-grid-line p-1.5 last:border-r-0 ${
              available ? "" : "cursor-not-allowed bg-muted/40"
            } ${dragOver === key ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}`}
          >
```

Não há conflito entre `bg-muted/40` e `bg-primary/10`: célula indisponível nunca chega a entrar em `dragOver`, porque o `onDragOver` sai antes de `setDragOver`.

- [ ] **Step 5: Esconder o botão "+ demanda" na célula indisponível**

Trocar a condição do bloco do botão (hoje `{canEdit ? (`) por:

```tsx
            {canEdit && available ? (
```

O resto do bloco — o `<button onClick={() => onAdd(d.id)} …>` — fica idêntico.

- [ ] **Step 6: Verificar formatação e tipos**

```bash
npx prettier --write src/components/BoardGrid.tsx
npx eslint src/components/BoardGrid.tsx
npx tsc --noEmit
```

Esperado: `eslint` sem saída; `tsc` sem erro.

- [ ] **Step 7: Verificar no navegador**

```bash
npm run dev
```

Em `/alocacoes`, com uma pessoa que tenha `available_from` no meio do calendário de sprints:

1. As sprints anteriores à data ficam cinzas.
2. A sprint que **contém** a data também fica cinza (contenção total) e a seguinte fica normal.
3. Passar o mouse numa célula cinza: o botão "+ demanda" não aparece.
4. Arrastar um cartão sobre uma célula cinza: ela não ganha a borda azul e o cartão volta ao lugar ao soltar.
5. Tooltip do cabeçalho da coluna mostra o período; o de quem não tem janela mostra só o nome.

- [ ] **Step 8: Commit**

```bash
git add src/components/BoardGrid.tsx
git commit -m "feat(alocacoes): grade desabilita sprints fora da janela da pessoa (#2)"
```

---

## Task 5: Verificação de ponta a ponta

**Files:** nenhum arquivo novo. Esta task é o portão final antes de considerar a issue #2 pronta.

**Interfaces:**
- Consumes: tudo das Tasks 1‑4.
- Produces: o build verde e o roteiro manual da spec percorrido.

- [ ] **Step 1: Build de produção**

```bash
npm run build
```

Esperado: build concluído sem erro. Se o TanStack Router regravar `src/routeTree.gen.ts`, **não commitar** — o arquivo já estava modificado antes desta frente.

- [ ] **Step 2: Roteiro manual completo, na aba `/alocacoes`**

```bash
npm run dev
```

Percorrer os sete casos da spec:

1. Pessoa sem janela: grade idêntica à de antes, todas as células ativas.
2. Pessoa com `available_from` no meio do calendário: sprints anteriores cinzas e sem "+ demanda"; a sprint que contém a data também cinza; a seguinte ativa.
3. Pessoa com `available_to`: sprints posteriores cinzas pela mesma regra.
4. Janela invertida no diálogo: "Salvar" desabilitado, aviso vermelho inline.
5. Cartão preexistente em célula que virou cinza: visível, abre no diálogo ao clicar, arrasta para fora com sucesso; a célula cinza recusa drop e não destaca no `dragOver`.
6. Tooltip do cabeçalho mostra o período de quem tem janela e só o nome de quem não tem.
7. Papel `leitor` (`canEdit === false`): células cinzas continuam cinzas e nenhum botão de ação aparece.

Para o caso 5, montar o cenário assim: escolher uma pessoa que já tenha um cartão numa sprint, abrir o cadastro dela e preencher `available_from` com uma data **posterior** ao fim dessa sprint. Salvar e observar a célula.

- [ ] **Step 3: Repetir os casos 1, 2 e 5 na rota de embed**

Abrir `http://localhost:3000/embed/alocacoes?project=PIM` e confirmar o mesmo comportamento. É o mesmo componente `BoardGrid`, então a expectativa é comportamento idêntico — a checagem existe para pegar regressão de layout na versão sem casca.

- [ ] **Step 4: Confirmar que nada indesejado entrou no diff**

```bash
git status --short
git log --oneline -4
```

Esperado em `git status`: no máximo `M src/routeTree.gen.ts` (pré-existente). Nenhum `verificacao-disponibilidade.ts`.

Esperado em `git log`: os quatro commits das Tasks 1‑4, mais antigos que eles o `1fb83a7` da spec.

- [ ] **Step 5: Registrar a divergência de fronteira na issue #2**

A regra implementada (contenção total) diverge do texto literal da issue, que descreve sobreposição. Isso precisa ficar registrado para quem abriu a demanda.

**Perguntar ao usuário antes de postar** — comentar numa issue é ação visível para terceiros e não está pré-autorizada. Texto sugerido, sujeito à aprovação dele:

> Implementado com **contenção total**: a sprint só fica habilitada se couber inteira na janela de disponibilidade. Na prática, quem entra no dia 10 e tem uma sprint de 01 a 15 aparece só a partir da sprint seguinte — e não já na sprint que contém a data, como o texto original descrevia. O motivo é que quem tem meia sprint disponível não deveria receber uma demanda dimensionada para a sprint cheia. Se o comportamento desejado for o de sobreposição, é a troca de um `>=` por um `<=` em `isDevAvailableInSprint` (`src/lib/board.ts`).

- [ ] **Step 6: Decidir sobre o `git push`**

O repositório sincroniza com o Lovable. **Não fazer `push` por conta própria** — perguntar ao usuário se ele quer publicar agora ou revisar antes.

---

## Fora deste plano

- **`devs.active`.** Coluna morta desde a migration inicial, nunca lida pela UI. Merece issue própria: usar ou dropar. Não tocar aqui.
- **Trigger de validação em `allocations`.** Descartado com justificativa na spec.
- **Tabela `dev_availability` com N períodos.** YAGNI hoje; a migração de duas colunas para tabela é direta se um segundo período aparecer na prática.
- **Layout Gantt (issue #12).** A regra foi isolada em `lib/board.ts` justamente para essa reescrita a reaproveitar sem alteração, mas o novo layout não é desta frente.
