# Alocações — Dimensão de Projeto — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada projeto Jira passa a ter o seu próprio quadro de alocação — os seus times, as suas pessoas, as suas sprints e as suas demandas — com a coerência entre eles garantida pelo Postgres, não pela tela.

**Architecture:** Duas migrations acrescentam `jira_project` a `teams`, `sprints`, `devs` e `allocations`; `teams` e `sprints` são as raízes (projeto é escolha explícita de quem cria) e `devs`/`allocations` recebem o valor **derivado do pai por trigger**, o que torna a coluna inforjável pelo cliente. Três FKs compostas deferíveis (`devs→teams`, `allocations→devs`, `allocations→sprints`) tornam "cartão em sprint de outro projeto" impossível no banco. No front, a lista de projetos passa a existir uma única vez em `src/lib/projects.ts`, `BoardGrid` fica controlado (`project` + `onProjectChange` vêm de `routes/index.tsx`) e as quatro queries ganham `.eq("jira_project", project)` mais o projeto na `queryKey`.

**Tech Stack:** PostgreSQL 15 (Supabase), TanStack Start + React 19, TanStack Query v5, shadcn/ui (Radix Select), Tailwind v4, TypeScript 5.8 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).

**Spec:** [`docs/superpowers/specs/2026-08-10-alocacoes-projeto-design.md`](../specs/2026-08-10-alocacoes-projeto-design.md)

## Global Constraints

- **Idioma da UI:** pt-BR em todo texto visível, com acentuação correta.
- **Chaves de projeto:** exatamente quatro, nesta ordem — `PIM`, `PH`, `INTFLOW`, `PDC`. `PIM` é o primeiro item do seletor porque o backfill leva o quadro existente para `PIM`; assim o primeiro acesso depois da migration mostra o quadro de hoje, inalterado.
- **Sem `enum` no banco.** A lista mora **só em TypeScript** (`src/lib/projects.ts`); o banco valida apenas o **formato** da chave (`CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$')`). Um cliente forjado gravar `'FOO'` é higiene, não segurança — quem consegue já é `editor`.
- **Nenhuma policy de RLS muda.** Projeto é dimensão de dado, não fronteira de permissão. Os `GRANT`s são de tabela e cobrem coluna nova automaticamente. Qualquer pessoa com papel continua podendo ler o quadro de qualquer projeto — isso é intencional e está documentado na spec.
- **`devs.jira_project` e `allocations.jira_project` são derivados por trigger.** O cliente nunca envia esses campos; se enviar, o trigger sobrescreve.
- **`queryKey` das quatro queries do quadro:** `["board", "<tabela>", project]`. **Invalidação:** sempre pelo prefixo `["board", "<tabela>"]`, **sem** o projeto — invalida o projeto atual e o que estiver em cache dos outros.
- **`DevDialog` e `BoardGrid` compartilham a mesma `queryKey` de `teams`** (`["board", "teams", project]`). Chaves diferentes fariam o diálogo listar times do projeto errado.
- **`enabled: !!project`** nas quatro queries.
- **Chave de `localStorage`:** `alocacoesLastProject` (própria da tela, seguindo o precedente de `cycleTimeLastProject` em `CycleTimeView.tsx`).
- **`src/components/AllocationDialog.tsx` não muda.** O projeto do cartão é derivado no banco.
- **Não refatorar `CycleTimeView.tsx` nem o Compromisso** para usar o `ProjectSelect` novo — é escopo da spec de navegação unificada e evita conflito de diff entre as duas frentes.
- **`ProjectSelect` recebe as opções por prop** (`options: readonly { key: string; name: string }[]`), nunca importando `JIRA_PROJECTS` internamente: assim a casca compartilhada da navegação unificada o reaproveita sem reescrita.
- **Sem test runner.** `package.json` só traz `dev`, `build`, `build:dev`, `preview`, `lint`, `format`, e esta demanda **não introduz um**. A verificação é `supabase/tests/alocacoes_projeto_smoke.sql` + `npx tsc --noEmit` + `npx eslint` + `npm run build` + roteiro manual.
- **`src/integrations/supabase/types.ts` é editado à mão** neste projeto — mesma convenção usada para `invitations` e `role_audit_log` no admin-rbac.
- **Não fazer `git push`.** O repositório sincroniza com o Lovable; o push é decisão do usuário ao final.
- **Nunca reescrever histórico** (sem `rebase`, `amend` ou `squash` de commits publicados) — restrição do `AGENTS.md`.

### Verificação de código: sempre nesta ordem

```bash
npx prettier --write <arquivos tocados>
npx eslint <arquivos tocados>
npx tsc --noEmit
```

**Nunca rodar `npm run lint` sem escopo.** O checkout tem `core.autocrlf=true`, então todo arquivo do repositório chega com CRLF e a regra `prettier/prettier` reprova centenas de linhas em arquivos que a task não tocou (`npx eslint src/lib/board.ts` sozinho já devolve ~340 erros `Delete ␍`). É ruído pré-existente, não é desta demanda. O `npx prettier --write` nos arquivos tocados normaliza para LF e resolve; como o git normaliza CRLF↔LF na comparação, isso **não** gera diff espúrio.

### Como aplicar as migrations

**Não existe caminho automatizado neste ambiente.** Verificado: `supabase/config.toml` só contém `project_id = "lpgkridgduuquteopnaj"`; não há CLI do Supabase em `package.json` (nem em `dependencies` nem em `devDependencies`); `psql` não está no PATH; e o `.env` só tem `SUPABASE_URL`, `SUPABASE_PROJECT_ID` e `SUPABASE_PUBLISHABLE_KEY` (nenhuma senha de banco nem `service_role` key). **Aplicar a migration é um passo manual de quem executa o plano**, contra o projeto Supabase real:

1. Abrir o SQL Editor do projeto Supabase `lpgkridgduuquteopnaj`.
2. Colar o conteúdo integral do arquivo `.sql`.
3. Executar e confirmar "Success. No rows returned" (a Migration A pode emitir `NOTICE` de sprint duplicada — ver Task 1).

Alternativa, **só** se quem executa tiver a senha do banco em mãos: `npx supabase link --project-ref lpgkridgduuquteopnaj` seguido de `npx supabase db push`. Isso instala o CLI sob demanda e não é a via padrão aqui.

### Como rodar o script de verificação

`supabase/tests/alocacoes_projeto_smoke.sql` roda inteiro dentro de `BEGIN … ROLLBACK`, cria fixtures temporárias e **não deixa resíduo**. Colar no SQL Editor e executar. Sucesso = "Success. No rows returned" com um `NOTICE` `Seção N OK` por seção. Falha = `ERROR:` com a mensagem da asserção.

### Encaixe com a frente de navegação unificada

Outro plano vai remover o `<header>` de `BoardGrid.tsx` e mover a seleção de projeto para uma casca compartilhada. Três decisões deste plano existem para que isso não gere retrabalho:

1. `ProjectSelect` recebe `options` por prop — a casca passa as dela (inclusive vindas de `getJiraProjects()`) sem tocar no componente.
2. `BoardGrid` é **controlado**: `project` e `onProjectChange` são props. O filtro e as `queryKey`s não mudam quando o seletor sobe de lugar.
3. **Todo o estado e a persistência ficam em `src/routes/index.tsx`** — a constante `LS_PROJECT`, os helpers `ls`/`save` e o `useState`. A outra frente apaga só esse arquivo de rota e, em `BoardGrid.tsx`, remove as duas linhas do `<ProjectSelect>` no header (é o que a própria spec descreve como o encaixe: "tirar o `<ProjectSelect>` do header e parar de passar `onProjectChange`").

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `supabase/migrations/20260810120000_board_project_column.sql` | Migration A: colunas anuláveis, backfill por voto de prefixo, divisão de sprints mistas |
| `supabase/migrations/20260810121000_board_project_constraints.sql` | Migration B: `NOT NULL`, `CHECK` de formato, `UNIQUE (id, jira_project)`, três FKs compostas deferíveis, dois triggers de derivação, quatro índices |
| `supabase/tests/alocacoes_projeto_smoke.sql` | Suíte assertiva de 9 seções (estrutura, backfill, derivação, cruzamentos, curadoria, regressão de RLS) |
| `src/lib/projects.ts` | `JIRA_PROJECTS`, `type JiraProjectKey`, `isJiraProjectKey` — fonte de verdade única das chaves no cliente |
| `src/components/ProjectSelect.tsx` | `Select` de projeto reutilizável, opções por prop |
| `src/lib/board-errors.ts` | SQLSTATE + nome da restrição → mensagem pt-BR |

**Modificar:**

| Arquivo | Mudança |
| --- | --- |
| `src/integrations/jira/config.server.ts` | `ALLOWED_PROJECTS` deriva de `@/lib/projects` |
| `src/integrations/supabase/types.ts` | `jira_project` em `Row`/`Insert`/`Update` das quatro tabelas |
| `src/lib/board.ts` | `Team`, `Dev`, `Sprint`, `Allocation` ganham `jira_project: JiraProjectKey` |
| `src/routes/index.tsx` | Dono do estado `project` + persistência em `localStorage` |
| `src/components/BoardGrid.tsx` | Controlado; `.eq` + `queryKey` com projeto nas quatro queries; `<ProjectSelect>` no header; ramo "Selecione um projeto."; `EmptyState` com o nome do projeto |
| `src/components/DevDialog.tsx` | Recebe `project`; lista só os times do projeto; time novo nasce com `jira_project` |
| `src/components/SprintDialog.tsx` | Recebe `project`; payload inclui `jira_project`; projeto no título |

**Não tocar:** `src/components/AllocationDialog.tsx`, `src/components/cycle-time/*`, `src/components/compromisso/*`, qualquer migration existente.

---

## Task 1: Migration A — coluna e dado

Aditiva e reversível: `DROP COLUMN jira_project` nas quatro tabelas volta ao estado anterior. Nenhuma escrita passa a ser recusada aqui.

**Files:**
- Create: `supabase/migrations/20260810120000_board_project_column.sql`

**Interfaces:**
- Consumes: schema existente — `public.teams (id, name, color, position)`, `public.sprints (id, code, quarter, start_date, end_date, days, position)`, `public.devs (id, name, initials, team_id, position, active)`, `public.allocations (id, sprint_id, dev_id, title, ticket_key, …)`.
- Produces: coluna `jira_project text` (anulável) nas quatro tabelas, preenchida e coerente: `devs.jira_project = teams.jira_project`, `allocations.jira_project = devs.jira_project` e `allocations.jira_project = sprints.jira_project` para toda linha.

- [ ] **Step 1: Criar `supabase/migrations/20260810120000_board_project_column.sql`**

```sql
-- Dimensão de projeto no quadro de alocação — parte A (aditiva e reversível).
--
-- Só acrescenta coluna e dado; nenhuma escrita passa a ser recusada aqui. As
-- travas ficam na parte B, pelo mesmo motivo das migrations de RBAC: se algo
-- der errado em B, A já está estável. Reverter A é
-- `ALTER TABLE … DROP COLUMN jira_project` nas quatro tabelas.

-- ============================================================
-- 1. Colunas anuláveis
-- ============================================================
ALTER TABLE public.teams       ADD COLUMN jira_project text;
ALTER TABLE public.sprints     ADD COLUMN jira_project text;
ALTER TABLE public.devs        ADD COLUMN jira_project text;
ALTER TABLE public.allocations ADD COLUMN jira_project text;

-- ============================================================
-- 2. Eixo das colunas: time -> pessoas -> cartões
-- ============================================================
-- Nenhuma migration semeou devs ou sprints: todo time e toda pessoa que
-- existem hoje foram criados à mão pela tela, e a única evidência de projeto
-- disponível é o prefixo de allocations.ticket_key. O voto é por TIME, não por
-- cartão, porque time é a raiz do eixo: um cartão de INTFLOW-… na linha de
-- alguém do time do PIM é trabalho pontual, não muda o projeto do time.
-- Empate resolvido por ordem alfabética, para o resultado ser determinístico.
WITH voto AS (
  SELECT d.team_id,
         upper(split_part(a.ticket_key, '-', 1)) AS chave,
         count(*) AS n
    FROM public.allocations a
    JOIN public.devs d ON d.id = a.dev_id
   WHERE a.ticket_key ~ '^[A-Za-z]+-[0-9]+$'
   GROUP BY 1, 2
), vencedor AS (
  SELECT DISTINCT ON (team_id) team_id, chave
    FROM voto
   WHERE chave IN ('PIM','PH','INTFLOW','PDC')
   ORDER BY team_id, n DESC, chave
)
UPDATE public.teams t
   SET jira_project = COALESCE(
         (SELECT v.chave FROM vencedor v WHERE v.team_id = t.id),
         'PIM');   -- sem nenhum sinal (inclusive o time 'Sem time'): PIM

UPDATE public.devs d
   SET jira_project = t.jira_project
  FROM public.teams t
 WHERE t.id = d.team_id;

UPDATE public.allocations a
   SET jira_project = d.jira_project
  FROM public.devs d
 WHERE d.id = a.dev_id;

-- ============================================================
-- 3. Eixo das linhas: a sprint herda o projeto dos seus cartões
-- ============================================================
-- (a) cada sprint fica com o primeiro projeto dos seus cartões (ordem
--     alfabética, determinística); sem cartões, PIM.
UPDATE public.sprints s
   SET jira_project = COALESCE(
     (SELECT a.jira_project FROM public.allocations a
       WHERE a.sprint_id = s.id ORDER BY a.jira_project LIMIT 1),
     'PIM');

-- (b) Sprint com cartões de mais de um projeto é DIVIDIDA, não recusada: não
--     existe atribuição única possível, e abortar a migration travaria o
--     deploy por um dado que ninguém consegue inspecionar antes. Os projetos
--     restantes ganham uma cópia da sprint e os cartões daquele projeto passam
--     a apontar para ela — que é exatamente o modelo final (cada projeto tem
--     seu próprio calendário). Nada é perdido.
--     Num quadro de projeto único — o cenário quase certo — este bloco não faz
--     nada e não emite NOTICE nenhum.
DO $$
DECLARE r record; v_new uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT a.sprint_id, a.jira_project
      FROM public.allocations a
      JOIN public.sprints s ON s.id = a.sprint_id
     WHERE a.jira_project <> s.jira_project
  LOOP
    INSERT INTO public.sprints (code, quarter, start_date, end_date, days, position, jira_project)
    SELECT code, quarter, start_date, end_date, days, position, r.jira_project
      FROM public.sprints WHERE id = r.sprint_id
    RETURNING id INTO v_new;

    UPDATE public.allocations
       SET sprint_id = v_new
     WHERE sprint_id = r.sprint_id AND jira_project = r.jira_project;

    RAISE NOTICE 'sprint % duplicada para o projeto %', r.sprint_id, r.jira_project;
  END LOOP;
END $$;
```

- [ ] **Step 2: Aplicar a Migration A no Supabase real (passo manual)**

Não há CLI nem `psql` neste ambiente — ver "Como aplicar as migrations" nas Global Constraints. Abrir o SQL Editor do projeto `lpgkridgduuquteopnaj`, colar o arquivo inteiro e executar.

Esperado: "Success. No rows returned". Se aparecer `NOTICE: sprint … duplicada para o projeto …`, **anotar quais** — significa que o quadro de hoje tinha sprints com cartões de mais de um projeto e elas foram divididas de propósito.

- [ ] **Step 3: Conferir o backfill com uma consulta de leitura**

Colar no SQL Editor:

```sql
SELECT
  (SELECT count(*) FROM public.teams       WHERE jira_project IS NULL) AS teams_nulos,
  (SELECT count(*) FROM public.sprints     WHERE jira_project IS NULL) AS sprints_nulos,
  (SELECT count(*) FROM public.devs        WHERE jira_project IS NULL) AS devs_nulos,
  (SELECT count(*) FROM public.allocations WHERE jira_project IS NULL) AS alloc_nulos,
  (SELECT count(*) FROM public.devs d
     JOIN public.teams t ON t.id = d.team_id
    WHERE d.jira_project <> t.jira_project)                            AS dev_x_time,
  (SELECT count(*) FROM public.allocations a
     JOIN public.devs d ON d.id = a.dev_id
    WHERE a.jira_project <> d.jira_project)                            AS cartao_x_pessoa,
  (SELECT count(*) FROM public.allocations a
     JOIN public.sprints s ON s.id = a.sprint_id
    WHERE a.jira_project <> s.jira_project)                            AS cartao_x_sprint;
```

Esperado: **sete zeros**. Qualquer valor diferente de zero significa que a Migration B vai falhar ao validar as FKs — não seguir para a Task 2 antes de entender o motivo.

- [ ] **Step 4: Conferir a distribuição por projeto**

```sql
SELECT 'teams' AS tabela, jira_project, count(*) FROM public.teams       GROUP BY 1, 2
UNION ALL
SELECT 'sprints',        jira_project, count(*) FROM public.sprints     GROUP BY 1, 2
UNION ALL
SELECT 'devs',           jira_project, count(*) FROM public.devs        GROUP BY 1, 2
UNION ALL
SELECT 'allocations',    jira_project, count(*) FROM public.allocations GROUP BY 1, 2
ORDER BY 1, 2;
```

Esperado, no cenário previsto: só linhas com `jira_project = 'PIM'`. Se aparecer outra chave, o voto do prefixo encontrou evidência real — confirmar com o usuário se aquele time é mesmo daquele projeto antes de seguir.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260810120000_board_project_column.sql
git commit -m "feat(board): add jira_project column and backfill by ticket prefix vote"
```

---

## Task 2: Migration B — travas, derivação e índices

Esta é a migration que passa a **recusar escrita**. Só rodar depois que a Task 1 estiver aplicada e os sete zeros do Step 3 confirmados.

**Files:**
- Create: `supabase/migrations/20260810121000_board_project_constraints.sql`

**Interfaces:**
- Consumes: `jira_project` preenchida e coerente nas quatro tabelas (Task 1).
- Produces:
  - `jira_project` `NOT NULL` nas quatro tabelas, com `CHECK <tabela>_jira_project_format` (`^[A-Z][A-Z0-9]{1,9}$`).
  - `UNIQUE (id, jira_project)` como `teams_id_project_key`, `sprints_id_project_key`, `devs_id_project_key`.
  - FKs compostas deferíveis `devs_team_project_fkey`, `allocations_dev_project_fkey`, `allocations_sprint_project_fkey`.
  - Triggers `devs_set_project` (função `private.set_dev_project()`) e `allocations_set_project` (função `private.set_allocation_project()`), ambos `BEFORE INSERT OR UPDATE FOR EACH ROW`, que sobrescrevem `NEW.jira_project` a partir do pai e levantam `W3001` se o pai não existir.
  - Índices `teams_project_position_idx`, `sprints_project_start_idx`, `devs_project_position_idx`, `allocations_project_idx`.

- [ ] **Step 1: Criar `supabase/migrations/20260810121000_board_project_constraints.sql`**

```sql
-- Dimensão de projeto no quadro de alocação — parte B (muda comportamento de
-- escrita). Só aplicar depois que a parte A estiver aplicada e o backfill
-- conferido: são estas restrições que recusam linha órfã.

-- ============================================================
-- 1. NOT NULL, formato e a chave única que a FK composta exige
-- ============================================================
-- Sem DEFAULT: teams e sprints são as raízes e o projeto é escolha explícita
-- de quem cria; um default silenciosamente colocaria a linha no projeto errado.
--
-- UNIQUE (id, jira_project) é redundante com a PK, mas o Postgres exige uma
-- restrição única sobre as colunas referenciadas para aceitar a FK composta.
-- Custo: um índice pequeno em três tabelas de dezenas de linhas.
--
-- O banco valida só o FORMATO da chave, não a lista: a lista mora em
-- src/lib/projects.ts e um enum aqui criaria uma terceira fonte de verdade.
ALTER TABLE public.teams
  ALTER COLUMN jira_project SET NOT NULL,
  ADD CONSTRAINT teams_jira_project_format
    CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$'),
  ADD CONSTRAINT teams_id_project_key UNIQUE (id, jira_project);

ALTER TABLE public.sprints
  ALTER COLUMN jira_project SET NOT NULL,
  ADD CONSTRAINT sprints_jira_project_format
    CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$'),
  ADD CONSTRAINT sprints_id_project_key UNIQUE (id, jira_project);

ALTER TABLE public.devs
  ALTER COLUMN jira_project SET NOT NULL,
  ADD CONSTRAINT devs_jira_project_format
    CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$'),
  ADD CONSTRAINT devs_id_project_key UNIQUE (id, jira_project);

ALTER TABLE public.allocations
  ALTER COLUMN jira_project SET NOT NULL,
  ADD CONSTRAINT allocations_jira_project_format
    CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$');

-- ============================================================
-- 2. As três FKs compostas — onde a coerência é enforçada
-- ============================================================
-- As FKs simples de 20260801002005/20260803233437 PERMANECEM e continuam
-- definindo o ON DELETE: devs_team_id_fkey com RESTRICT (não se apaga um time
-- com gente) e allocations_*_fkey com CASCADE. Nas compostas, o ON DELETE da
-- FK para teams é NO ACTION de propósito: RESTRICT não pode ser combinado com
-- DEFERRABLE, e a trava de exclusão já vem da FK simples.
--
-- DEFERRABLE INITIALLY IMMEDIATE não muda nada no comportamento da aplicação
-- (a violação estoura no mesmo lugar), mas permite a curadoria descrita ao pé
-- deste arquivo: mover um time inteiro de projeto numa transação só.
ALTER TABLE public.devs
  ADD CONSTRAINT devs_team_project_fkey
  FOREIGN KEY (team_id, jira_project) REFERENCES public.teams (id, jira_project)
  ON UPDATE NO ACTION ON DELETE NO ACTION
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE public.allocations
  ADD CONSTRAINT allocations_dev_project_fkey
  FOREIGN KEY (dev_id, jira_project) REFERENCES public.devs (id, jira_project)
  ON UPDATE NO ACTION ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE,
  ADD CONSTRAINT allocations_sprint_project_fkey
  FOREIGN KEY (sprint_id, jira_project) REFERENCES public.sprints (id, jira_project)
  ON UPDATE NO ACTION ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- ============================================================
-- 3. Derivação por trigger — o cliente não envia o projeto dos filhos
-- ============================================================
-- Dispara em TODO INSERT e UPDATE, não em UPDATE OF team_id/dev_id: o valor
-- enviado pelo cliente é sempre sobrescrito, então a coluna é inforjável por
-- construção. SECURITY DEFINER porque a função precisa ler a linha do pai
-- independentemente do que a RLS venha a permitir no futuro; segue o padrão
-- dos helpers em private (SET search_path = public).
--
-- O ganho prático: AllocationDialog.tsx não muda em nada, e a mutação de
-- drag-and-drop update({ sprint_id, dev_id }) em BoardGrid.tsx também não — o
-- projeto é recalculado a cada movimento e a FK para sprints valida o destino.
CREATE OR REPLACE FUNCTION private.set_dev_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT t.jira_project INTO NEW.jira_project
    FROM public.teams t WHERE t.id = NEW.team_id;
  IF NEW.jira_project IS NULL THEN
    RAISE EXCEPTION 'Time não encontrado' USING ERRCODE = 'W3001';
  END IF;
  RETURN NEW;
END $$;

-- Trigger functions não têm o EXECUTE checado em tempo de execução (a
-- verificação acontece no CREATE TRIGGER), então revogar é seguro e mantém a
-- disciplina das outras funções novas do projeto.
REVOKE ALL ON FUNCTION private.set_dev_project() FROM public, anon;

CREATE TRIGGER devs_set_project
BEFORE INSERT OR UPDATE ON public.devs
FOR EACH ROW EXECUTE FUNCTION private.set_dev_project();

CREATE OR REPLACE FUNCTION private.set_allocation_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT d.jira_project INTO NEW.jira_project
    FROM public.devs d WHERE d.id = NEW.dev_id;
  IF NEW.jira_project IS NULL THEN
    RAISE EXCEPTION 'Pessoa não encontrada' USING ERRCODE = 'W3001';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.set_allocation_project() FROM public, anon;

CREATE TRIGGER allocations_set_project
BEFORE INSERT OR UPDATE ON public.allocations
FOR EACH ROW EXECUTE FUNCTION private.set_allocation_project();

-- ============================================================
-- 4. Índices — cada um casa o ORDER BY da query correspondente
-- ============================================================
-- allocations_sprint_dev_idx (20260801002005) continua servindo o acesso por
-- célula do grid.
CREATE INDEX teams_project_position_idx ON public.teams       (jira_project, position);
CREATE INDEX sprints_project_start_idx  ON public.sprints     (jira_project, start_date, position);
CREATE INDEX devs_project_position_idx  ON public.devs        (jira_project, position);
CREATE INDEX allocations_project_idx    ON public.allocations (jira_project);

-- ============================================================
-- Curadoria: mover um time inteiro de projeto depois (operador, não a tela)
-- ============================================================
-- Se o backfill errar, ou se um time realmente mudar de projeto, a operação é
-- coerente por natureza (time + pessoas + cartões + sprints juntos) e por isso
-- precisa que as FKs sejam diferidas. Receita, no SQL Editor:
--
--   BEGIN;
--   SET CONSTRAINTS ALL DEFERRED;
--   UPDATE public.teams       SET jira_project = 'PH' WHERE id = :time;
--   UPDATE public.devs        SET jira_project = 'PH' WHERE team_id = :time;
--   UPDATE public.allocations SET jira_project = 'PH'
--    WHERE dev_id IN (SELECT id FROM public.devs WHERE team_id = :time);
--   -- as sprints usadas por esses cartões também precisam ser do projeto de
--   -- destino: mova-as, ou crie as sprints do destino e repontue os cartões.
--   COMMIT;   -- as três FKs compostas são checadas aqui, tudo ou nada
--
-- SET CONSTRAINTS ALL DEFERRED não afeta os triggers de derivação, que
-- sobrescrevem devs.jira_project e allocations.jira_project a partir do pai —
-- e é por isso que os UPDATEs precisam subir na ordem time -> pessoas ->
-- cartões.
```

- [ ] **Step 2: Aplicar a Migration B no Supabase real (passo manual)**

Abrir o SQL Editor do projeto `lpgkridgduuquteopnaj`, colar o arquivo inteiro e executar.

Esperado: "Success. No rows returned".

Se der `ERROR: 23503 … violates foreign key constraint "allocations_sprint_project_fkey"`, o backfill da Task 1 deixou cartão em sprint de outro projeto — voltar ao Step 3 da Task 1 e corrigir antes de insistir. Reverter B, se necessário:

```sql
DROP TRIGGER IF EXISTS allocations_set_project ON public.allocations;
DROP TRIGGER IF EXISTS devs_set_project ON public.devs;
DROP FUNCTION IF EXISTS private.set_allocation_project();
DROP FUNCTION IF EXISTS private.set_dev_project();
ALTER TABLE public.allocations
  DROP CONSTRAINT IF EXISTS allocations_sprint_project_fkey,
  DROP CONSTRAINT IF EXISTS allocations_dev_project_fkey,
  DROP CONSTRAINT IF EXISTS allocations_jira_project_format,
  ALTER COLUMN jira_project DROP NOT NULL;
ALTER TABLE public.devs
  DROP CONSTRAINT IF EXISTS devs_team_project_fkey,
  DROP CONSTRAINT IF EXISTS devs_id_project_key,
  DROP CONSTRAINT IF EXISTS devs_jira_project_format,
  ALTER COLUMN jira_project DROP NOT NULL;
ALTER TABLE public.sprints
  DROP CONSTRAINT IF EXISTS sprints_id_project_key,
  DROP CONSTRAINT IF EXISTS sprints_jira_project_format,
  ALTER COLUMN jira_project DROP NOT NULL;
ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_id_project_key,
  DROP CONSTRAINT IF EXISTS teams_jira_project_format,
  ALTER COLUMN jira_project DROP NOT NULL;
DROP INDEX IF EXISTS public.teams_project_position_idx;
DROP INDEX IF EXISTS public.sprints_project_start_idx;
DROP INDEX IF EXISTS public.devs_project_position_idx;
DROP INDEX IF EXISTS public.allocations_project_idx;
```

- [ ] **Step 3: Conferir que as restrições e os triggers existem**

```sql
SELECT conname, contype, condeferrable
  FROM pg_constraint
 WHERE conname LIKE '%jira_project%' OR conname LIKE '%_id_project_key'
    OR conname IN ('devs_team_project_fkey','allocations_dev_project_fkey',
                   'allocations_sprint_project_fkey')
 ORDER BY conname;

SELECT tgname, tgrelid::regclass AS tabela
  FROM pg_trigger
 WHERE tgname IN ('devs_set_project','allocations_set_project');
```

Esperado: 10 restrições (4 `c` de formato, 3 `u` de `id_project_key`, 3 `f` com `condeferrable = true`) e 2 triggers.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260810121000_board_project_constraints.sql
git commit -m "feat(board): enforce project coherence with composite FKs and triggers"
```

---

## Task 3: Smoke test SQL

**Files:**
- Create: `supabase/tests/alocacoes_projeto_smoke.sql`

**Interfaces:**
- Consumes: tudo o que as Tasks 1 e 2 criaram, mais `private.can_view_board` e as policies `*_select_viewers` de `20260808121000_rbac_rpc_policies.sql`.
- Produces: nada de código — é a prova de que o front pode entrar. É este script que garante que o backfill não deixou linha órfã.

- [ ] **Step 1: Criar `supabase/tests/alocacoes_projeto_smoke.sql`**

```sql
-- Suíte de verificação da dimensão de projeto do quadro de alocação.
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
-- Falha = ERROR: com a mensagem da asserção.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura (Tasks 1 e 2)
-- ============================================================
DO $$
DECLARE
  t text;
  v_count int;
BEGIN
  FOREACH t IN ARRAY ARRAY['teams','sprints','devs','allocations'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'jira_project'
    ) THEN
      RAISE EXCEPTION 'FALHA 1.1: coluna jira_project ausente em public.%', t;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t
         AND column_name = 'jira_project' AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'FALHA 1.2: public.%.jira_project não é NOT NULL', t;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = t || '_jira_project_format'
         AND conrelid = ('public.' || t)::regclass
         AND contype = 'c'
    ) THEN
      RAISE EXCEPTION 'FALHA 1.3: CHECK %_jira_project_format ausente', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['teams','sprints','devs'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = t || '_id_project_key'
         AND conrelid = ('public.' || t)::regclass
         AND contype = 'u'
    ) THEN
      RAISE EXCEPTION 'FALHA 1.4: UNIQUE %_id_project_key ausente', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['devs_team_project_fkey',
                           'allocations_dev_project_fkey',
                           'allocations_sprint_project_fkey'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = t AND contype = 'f' AND condeferrable
    ) THEN
      RAISE EXCEPTION 'FALHA 1.5: FK composta % ausente ou não deferível', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.devs'::regclass
                    AND tgname = 'devs_set_project') THEN
    RAISE EXCEPTION 'FALHA 1.6: trigger devs_set_project ausente';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.allocations'::regclass
                    AND tgname = 'allocations_set_project') THEN
    RAISE EXCEPTION 'FALHA 1.7: trigger allocations_set_project ausente';
  END IF;

  SELECT count(*) INTO v_count FROM pg_class
   WHERE relname IN ('teams_project_position_idx','sprints_project_start_idx',
                     'devs_project_position_idx','allocations_project_idx');
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'FALHA 1.8: esperados 4 índices de projeto, achou %', v_count;
  END IF;

  RAISE NOTICE 'Seção 1 OK';
END $$;

-- ============================================================
-- Seção 2 — Backfill sem linha órfã (Task 1)
-- ============================================================
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.devs d
    JOIN public.teams t ON t.id = d.team_id
   WHERE d.jira_project <> t.jira_project;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 2.1: % pessoa(s) com projeto diferente do time', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.allocations a
    JOIN public.devs d ON d.id = a.dev_id
   WHERE a.jira_project <> d.jira_project;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 2.2: % cartão(ões) com projeto diferente da pessoa', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.allocations a
    JOIN public.sprints s ON s.id = a.sprint_id
   WHERE a.jira_project <> s.jira_project;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA 2.3: % cartão(ões) com projeto diferente da sprint', v_count;
  END IF;

  RAISE NOTICE 'Seção 2 OK';
END $$;

-- ============================================================
-- Seções 3 a 8 — Comportamento, com fixtures compartilhadas
-- ============================================================
DO $$
DECLARE
  v_team_pim uuid; v_team_ph uuid; v_team_vazio uuid; v_team_cur uuid;
  v_sprint_pim uuid; v_sprint_ph uuid; v_sprint_cur uuid;
  v_dev_pim uuid; v_dev_ph uuid; v_dev_livre uuid; v_dev_cur uuid;
  v_proj text;
  v_count int;
BEGIN
  -- Fixtures: position alto para não brigar com os dados reais na tela
  -- (a transação faz ROLLBACK ao final de qualquer forma).
  INSERT INTO public.teams (name, color, position, jira_project)
       VALUES ('Smoke time PIM', '#0f766e', 900, 'PIM') RETURNING id INTO v_team_pim;
  INSERT INTO public.teams (name, color, position, jira_project)
       VALUES ('Smoke time PH', '#1d4ed8', 901, 'PH') RETURNING id INTO v_team_ph;
  INSERT INTO public.teams (name, color, position, jira_project)
       VALUES ('Smoke time vazio', '#b45309', 902, 'PIM') RETURNING id INTO v_team_vazio;
  INSERT INTO public.teams (name, color, position, jira_project)
       VALUES ('Smoke time curadoria', '#be123c', 903, 'PIM') RETURNING id INTO v_team_cur;

  INSERT INTO public.sprints (code, quarter, start_date, end_date, days, position, jira_project)
       VALUES ('SMOKE-PIM', 'Q3', '2026-08-01', '2026-08-15', 15, 900, 'PIM')
    RETURNING id INTO v_sprint_pim;
  INSERT INTO public.sprints (code, quarter, start_date, end_date, days, position, jira_project)
       VALUES ('SMOKE-PH', 'Q3', '2026-08-01', '2026-08-15', 15, 901, 'PH')
    RETURNING id INTO v_sprint_ph;
  INSERT INTO public.sprints (code, quarter, start_date, end_date, days, position, jira_project)
       VALUES ('SMOKE-CUR', 'Q3', '2026-08-01', '2026-08-15', 15, 902, 'PIM')
    RETURNING id INTO v_sprint_cur;

  -- ---------- Seção 3 — Derivação por trigger ----------
  -- Envia 'PIM' de propósito num time do PH: o trigger tem de sobrescrever.
  INSERT INTO public.devs (name, initials, team_id, position, jira_project)
       VALUES ('Smoke Dev PH', 'SP', v_team_ph, 900, 'PIM')
    RETURNING id, jira_project INTO v_dev_ph, v_proj;
  IF v_proj IS DISTINCT FROM 'PH' THEN
    RAISE EXCEPTION 'FALHA 3.1: trigger não derivou o projeto do time (achou %)', v_proj;
  END IF;

  INSERT INTO public.devs (name, initials, team_id, position)
       VALUES ('Smoke Dev PIM', 'SD', v_team_pim, 901) RETURNING id INTO v_dev_pim;
  INSERT INTO public.devs (name, initials, team_id, position)
       VALUES ('Smoke Dev livre', 'SL', v_team_ph, 902) RETURNING id INTO v_dev_livre;
  INSERT INTO public.devs (name, initials, team_id, position)
       VALUES ('Smoke Dev curadoria', 'SC', v_team_cur, 903) RETURNING id INTO v_dev_cur;

  -- O cartão herda o projeto da pessoa, mesmo enviando outro.
  INSERT INTO public.allocations (sprint_id, dev_id, title, jira_project)
       VALUES (v_sprint_ph, v_dev_ph, 'Smoke cartão PH', 'PIM')
    RETURNING jira_project INTO v_proj;
  IF v_proj IS DISTINCT FROM 'PH' THEN
    RAISE EXCEPTION 'FALHA 3.2: trigger não derivou o projeto da pessoa (achou %)', v_proj;
  END IF;
  RAISE NOTICE 'Seção 3 OK';

  -- ---------- Seção 4 — Cartão cruzado ----------
  BEGIN
    INSERT INTO public.allocations (sprint_id, dev_id, title)
         VALUES (v_sprint_pim, v_dev_ph, 'Smoke cartão cruzado');
    RAISE EXCEPTION 'FALHA 4.1: cartão de pessoa do PH aceito em sprint do PIM';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'Seção 4 OK';

  -- ---------- Seção 5 — Drag cruzado ----------
  BEGIN
    UPDATE public.allocations SET sprint_id = v_sprint_pim WHERE dev_id = v_dev_ph;
    RAISE EXCEPTION 'FALHA 5.1: cartão do PH movido para sprint do PIM';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'Seção 5 OK';

  -- ---------- Seção 6 — Time troca de projeto ----------
  BEGIN
    UPDATE public.teams SET jira_project = 'PDC' WHERE id = v_team_pim;
    RAISE EXCEPTION 'FALHA 6.1: time com pessoas trocou de projeto';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  UPDATE public.teams SET jira_project = 'PDC' WHERE id = v_team_vazio;
  IF (SELECT jira_project FROM public.teams WHERE id = v_team_vazio) IS DISTINCT FROM 'PDC' THEN
    RAISE EXCEPTION 'FALHA 6.2: time sem pessoas não conseguiu trocar de projeto';
  END IF;
  RAISE NOTICE 'Seção 6 OK';

  -- ---------- Seção 7 — Pessoa troca de time ----------
  BEGIN
    UPDATE public.devs SET team_id = v_team_pim WHERE id = v_dev_ph;
    RAISE EXCEPTION 'FALHA 7.1: pessoa com alocações mudou para time de outro projeto';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  UPDATE public.devs SET team_id = v_team_pim WHERE id = v_dev_livre;
  IF (SELECT jira_project FROM public.devs WHERE id = v_dev_livre) IS DISTINCT FROM 'PIM' THEN
    RAISE EXCEPTION 'FALHA 7.2: pessoa sem alocações não migrou de projeto junto com o time';
  END IF;
  RAISE NOTICE 'Seção 7 OK';

  -- ---------- Seção 8 — Curadoria com FKs diferidas ----------
  INSERT INTO public.allocations (sprint_id, dev_id, title)
       VALUES (v_sprint_cur, v_dev_cur, 'Smoke cartão curadoria');
  BEGIN
    SET CONSTRAINTS ALL DEFERRED;
    UPDATE public.teams       SET jira_project = 'INTFLOW' WHERE id = v_team_cur;
    UPDATE public.devs        SET jira_project = 'INTFLOW' WHERE team_id = v_team_cur;
    UPDATE public.allocations SET jira_project = 'INTFLOW'
     WHERE dev_id IN (SELECT id FROM public.devs WHERE team_id = v_team_cur);
    UPDATE public.sprints     SET jira_project = 'INTFLOW' WHERE id = v_sprint_cur;
    -- Substitui o COMMIT: voltar as constraints para IMMEDIATE força a
    -- verificação do que ficou pendente, aqui e agora, sem sair da transação
    -- (o script termina em ROLLBACK).
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'FALHA 8.1: curadoria coerente recusada mesmo com SET CONSTRAINTS ALL DEFERRED';
  END;

  SELECT count(*) INTO v_count FROM public.allocations a
    JOIN public.sprints s ON s.id = a.sprint_id
   WHERE a.dev_id = v_dev_cur
     AND a.jira_project = 'INTFLOW'
     AND s.jira_project = 'INTFLOW';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 8.2: curadoria não deixou cartão e sprint no projeto de destino (achou %)', v_count;
  END IF;
  RAISE NOTICE 'Seção 8 OK';
END $$;

-- ============================================================
-- Seção 9 — Regressão de RLS: a coluna nova não abriu caminho novo
-- ============================================================
DO $$
DECLARE
  v_viewer uuid := '88888888-8888-8888-8888-888888888888';
  v_nobody uuid := '99999999-9999-9999-9999-999999999999';
  v_count int;
  v_total int;
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_viewer, 'authenticated', 'authenticated',
     'smoke-proj-viewer@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_nobody, 'authenticated', 'authenticated',
     'smoke-proj-nobody@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES (v_viewer, 'viewer');

  -- 9.1 a 9.4 — sem papel, nenhuma das quatro tabelas devolve linha
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_nobody, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_count FROM public.teams;
  IF v_count <> 0 THEN RESET ROLE;
    RAISE EXCEPTION 'FALHA 9.1: sem papel leu % linha(s) de teams', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.devs;
  IF v_count <> 0 THEN RESET ROLE;
    RAISE EXCEPTION 'FALHA 9.2: sem papel leu % linha(s) de devs', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.sprints;
  IF v_count <> 0 THEN RESET ROLE;
    RAISE EXCEPTION 'FALHA 9.3: sem papel leu % linha(s) de sprints', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.allocations;
  IF v_count <> 0 THEN RESET ROLE;
    RAISE EXCEPTION 'FALHA 9.4: sem papel leu % linha(s) de allocations', v_count; END IF;

  RESET ROLE;

  -- 9.5 — viewer lê tudo o que existe: a RLS libera leitura, não filtra projeto
  SELECT count(*) INTO v_total FROM public.sprints;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_count FROM public.sprints;
  RESET ROLE;
  IF v_count <> v_total THEN
    RAISE EXCEPTION 'FALHA 9.5: viewer viu % sprints, esperado %', v_count, v_total;
  END IF;

  -- 9.6 — viewer continua sem escrever, inclusive enviando jira_project
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.teams (name, color, position, jira_project)
    VALUES ('Smoke viewer', '#475569', 950, 'PIM');
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 9.6: viewer inseriu time sob RLS real';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;

  RAISE NOTICE 'Seção 9 OK';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Executar o smoke test no Supabase real (passo manual)**

Colar o arquivo inteiro no SQL Editor do projeto `lpgkridgduuquteopnaj` e executar.

Esperado: "Success. No rows returned" e, no painel de mensagens, `Seção 1 OK` … `Seção 9 OK`. Qualquer `ERROR: FALHA N.M: …` é uma invariante quebrada — corrigir antes de tocar no front, porque é este script que prova que o backfill não deixou linha órfã.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/alocacoes_projeto_smoke.sql
git commit -m "test(board): add project dimension smoke suite"
```

---

## Task 4: `src/lib/projects.ts` e `ALLOWED_PROJECTS` derivado

**Files:**
- Create: `src/lib/projects.ts`
- Modify: `src/integrations/jira/config.server.ts:11`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export const JIRA_PROJECTS` — `readonly [{key:"PIM",name:"PIM"}, {key:"PH",name:"PowerHub"}, {key:"INTFLOW",name:"IntegraFlow"}, {key:"PDC",name:"PDC"}]`.
  - `export type JiraProjectKey = "PIM" | "PH" | "INTFLOW" | "PDC"`.
  - `export function isJiraProjectKey(value: string | null | undefined): value is JiraProjectKey`.
  - `ALLOWED_PROJECTS: Set<string>` em `config.server.ts`, agora derivado.

- [ ] **Step 1: Criar `src/lib/projects.ts`**

```ts
/**
 * Fonte de verdade única das chaves de projeto Jira no cliente.
 *
 * Por que uma constante local e não `getJiraProjects()`: Compromisso e Cycle
 * Time chamam o Jira porque os dados deles *são* do Jira — sem Jira não há
 * tela. O quadro de alocação é o oposto: funciona com zero dependência do
 * Jira, o dado é próprio e mora no Supabase. Fazer o seletor esperar uma ida à
 * Atlassian significaria que um token expirado derruba o *planejamento*.
 *
 * Além disso a constante é necessária de qualquer forma: `ALLOWED_PROJECTS`
 * mora em `src/integrations/jira/config.server.ts`, que é server-only e não
 * pode ser importado por um componente. Com esta lista aqui, o `config.server`
 * passa a derivar dela e a lista existe UMA vez. A direção do import é a única
 * legal: o proibido é componente importar `*.server.ts`, não o contrário.
 *
 * A ordem importa: `JIRA_PROJECTS[0]` é o projeto padrão do seletor de
 * Alocações, e o backfill da migration levou o quadro existente para `PIM` —
 * então o primeiro acesso depois da migration mostra o quadro de hoje,
 * inalterado.
 */
export const JIRA_PROJECTS = [
  { key: "PIM", name: "PIM" },
  { key: "PH", name: "PowerHub" },
  { key: "INTFLOW", name: "IntegraFlow" },
  { key: "PDC", name: "PDC" },
] as const satisfies readonly { key: string; name: string }[];

export type JiraProjectKey = (typeof JIRA_PROJECTS)[number]["key"];

const KEYS: readonly string[] = JIRA_PROJECTS.map((p) => p.key);

/**
 * Valida a chave que volta do `localStorage` e a que volta do `<Select>` do
 * Radix (que devolve `string`). Sem isto, uma chave antiga — projeto removido
 * da lista — entraria no estado e o `.eq("jira_project", …)` pediria um
 * projeto que o seletor não mostra.
 */
export function isJiraProjectKey(value: string | null | undefined): value is JiraProjectKey {
  return typeof value === "string" && KEYS.includes(value);
}
```

- [ ] **Step 2: Fazer `ALLOWED_PROJECTS` derivar da lista**

Em `src/integrations/jira/config.server.ts`, acrescentar o import no topo (depois do bloco de comentário das linhas 1-3, antes de `export const JIRA_BASE`):

```ts
import { JIRA_PROJECTS } from "@/lib/projects";
```

E substituir a linha 11 inteira:

```ts
export const ALLOWED_PROJECTS = new Set(["PIM", "PH", "INTFLOW", "PDC"]);
```

por:

```ts
// Deriva da lista única do cliente (src/lib/projects.ts) em vez de repetir as
// quatro chaves: um projeto novo entra em um lugar só. `Set<string>` explícito
// porque os chamadores testam `.has(key.toUpperCase())`, cujo argumento é
// `string` — com o tipo inferido (`Set<"PIM" | "PH" | …>`) isso não compila.
export const ALLOWED_PROJECTS = new Set<string>(JIRA_PROJECTS.map((p) => p.key));
```

- [ ] **Step 3: Verificar tipos e formatação**

```bash
npx prettier --write src/lib/projects.ts src/integrations/jira/config.server.ts
npx eslint src/lib/projects.ts src/integrations/jira/config.server.ts
npx tsc --noEmit
```

Esperado: sem erros. Os quatro consumidores de `ALLOWED_PROJECTS` (`cycle-time.server.ts:301`, `projects.server.ts:41`, `sprints.server.ts:126` e `:160`) continuam compilando porque o `Set<string>` aceita `key.toUpperCase()`.

- [ ] **Step 4: Confirmar que nenhum comportamento do Jira mudou**

```bash
git diff src/integrations/jira/config.server.ts
```

Esperado: apenas o import novo e a linha do `ALLOWED_PROJECTS` — nenhuma outra constante tocada. As quatro chaves continuam as mesmas, na mesma ordem.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects.ts src/integrations/jira/config.server.ts
git commit -m "feat(board): single source of truth for Jira project keys"
```

---

## Task 5: Tipos — `types.ts` e `src/lib/board.ts`

**Files:**
- Modify: `src/integrations/supabase/types.ts:17-236` (blocos `allocations`, `devs`, `sprints`, `teams`)
- Modify: `src/lib/board.ts:5-42` (os quatro tipos)

**Interfaces:**
- Consumes: `JiraProjectKey` (Task 4).
- Produces: `jira_project` disponível para `.eq("jira_project", …)` nas quatro tabelas; `Team`, `Dev`, `Sprint` e `Allocation` com `jira_project: JiraProjectKey`.

**Nota de sequenciamento:** aqui `Insert`/`Update` recebem `jira_project` como **opcional nas quatro tabelas**. A spec pede obrigatório em `teams` e `sprints`, e é o Step 13 da Task 7 que aperta — porque é lá que `DevDialog` e `SprintDialog` passam a enviar o campo. Apertar agora deixaria a árvore com dois erros de compilação atravessando duas tasks.

- [ ] **Step 1: Acrescentar `jira_project` ao bloco `allocations` de `src/integrations/supabase/types.ts`**

Derivado por trigger, então opcional em `Insert` e `Update`. Nas três listas (`Row`, `Insert`, `Update`), a chave entra em ordem alfabética, logo depois de `id`:

Em `Row` (linhas 18-31), depois de `id: string`:

```ts
          jira_project: string
```

Em `Insert` (linhas 32-45), depois de `id?: string`:

```ts
          jira_project?: string
```

Em `Update` (linhas 46-59), depois de `id?: string`:

```ts
          jira_project?: string
```

- [ ] **Step 2: Acrescentar `jira_project` ao bloco `devs`**

Também derivado por trigger. Em `Row` (linhas 78-86), depois de `initials: string`:

```ts
          jira_project: string
```

Em `Insert` (linhas 87-95), depois de `initials?: string`:

```ts
          jira_project?: string
```

Em `Update` (linhas 96-104), depois de `initials?: string`:

```ts
          jira_project?: string
```

- [ ] **Step 3: Acrescentar `jira_project` ao bloco `sprints`**

Em `Row` (linhas 182-191), depois de `id: string`:

```ts
          jira_project: string
```

Em `Insert` (linhas 192-201), depois de `id?: string`:

```ts
          jira_project?: string
```

Em `Update` (linhas 202-211), depois de `id?: string`:

```ts
          jira_project?: string
```

- [ ] **Step 4: Acrescentar `jira_project` ao bloco `teams`**

Em `Row` (linhas 215-221), depois de `id: string`:

```ts
          jira_project: string
```

Em `Insert` (linhas 222-228), depois de `id?: string`:

```ts
          jira_project?: string
```

Em `Update` (linhas 229-235), depois de `id?: string`:

```ts
          jira_project?: string
```

- [ ] **Step 5: Acrescentar `jira_project` aos quatro tipos de `src/lib/board.ts`**

Substituir o bloco das linhas 1-42 por:

```ts
import type { JiraProjectKey } from "@/lib/projects";

export type AllocationStatus = "nao_especificada" | "especificada";

export type AllocationTipo = "planejado" | "bug" | "evolutiva" | "ferias";

// jira_project é `text` no banco (a lista mora em src/lib/projects.ts, o banco
// valida só o formato), mas do lado do cliente só as quatro chaves conhecidas
// chegam a ser desenhadas — daí o tipo estreito. As queries usam
// `data as Dev[]`, como já usavam.
export type Team = {
  id: string;
  name: string;
  color: string;
  position: number;
  jira_project: JiraProjectKey;
};

export type Dev = {
  id: string;
  name: string;
  initials: string;
  team_id: string;
  position: number;
  active: boolean;
  jira_project: JiraProjectKey;
};

export type Sprint = {
  id: string;
  code: string;
  quarter: string;
  start_date: string;
  end_date: string;
  days: number;
  position: number;
  jira_project: JiraProjectKey;
};

export type Allocation = {
  id: string;
  sprint_id: string;
  dev_id: string;
  title: string;
  ticket_key: string | null;
  ticket_url: string | null;
  status: AllocationStatus;
  tipo: AllocationTipo;
  notes: string | null;
  position: number;
  jira_project: JiraProjectKey;
};
```

- [ ] **Step 6: Verificar tipos e formatação**

```bash
npx prettier --write src/lib/board.ts
npx eslint src/lib/board.ts
npx tsc --noEmit
```

Esperado: sem erros. `types.ts` fica **fora** do `prettier --write` de propósito: é um arquivo de estilo gerado (sem ponto e vírgula, indentação própria) e reformatá-lo inteiro polui o diff. Ele não é lintado aqui porque nenhuma regra do projeto o cobre além de `prettier/prettier`, que reprovaria o arquivo inteiro — pré-existente.

- [ ] **Step 7: Confirmar que o diff de `types.ts` é só aditivo**

```bash
git diff src/integrations/supabase/types.ts | grep "^-" | grep -v "^---"
```

Esperado: **nada impresso** — 12 linhas acrescentadas, zero removidas.

- [ ] **Step 8: Commit**

```bash
git add src/integrations/supabase/types.ts src/lib/board.ts
git commit -m "feat(board): type jira_project on the four board tables"
```

---

## Task 6: `ProjectSelect`

Componente isolado, sem nenhum dependente ainda — compila, linta e é revisável por si só. É exatamente ele que a casca compartilhada da navegação unificada vai reaproveitar.

**Files:**
- Create: `src/components/ProjectSelect.tsx`

**Interfaces:**
- Consumes: `@/components/ui/select` (shadcn/Radix).
- Produces: `export type ProjectOption = { key: string; name: string }` e `export function ProjectSelect(props: { value: string | null; options: readonly ProjectOption[]; onChange: (key: string) => void; className?: string })`.

- [ ] **Step 1: Criar `src/components/ProjectSelect.tsx`**

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ProjectOption = { key: string; name: string };

// As opções vêm por PROP, nunca de um import de JIRA_PROJECTS aqui dentro: a
// casca compartilhada da navegação unificada vai reaproveitar este componente
// com a lista dela (possivelmente a do Jira), e um import interno obrigaria a
// reescrevê-lo.
export function ProjectSelect({
  value,
  options,
  onChange,
  className,
}: {
  value: string | null;
  options: readonly ProjectOption[];
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    // O spread condicional é o mesmo de CycleTimeView: com
    // exactOptionalPropertyTypes ligado, passar `value={undefined}` não
    // compila, e o Radix precisa da prop ausente para ficar não-controlado
    // enquanto nada está selecionado.
    <Select {...(value ? { value } : {})} onValueChange={onChange}>
      <SelectTrigger className={className ?? "h-9 w-56"} aria-label="Projeto">
        <SelectValue placeholder="Selecione um projeto…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem key={p.key} value={p.key}>
            {p.key === p.name ? p.key : `${p.key} — ${p.name}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Verificar tipos e formatação**

```bash
npx prettier --write src/components/ProjectSelect.tsx
npx eslint src/components/ProjectSelect.tsx
npx tsc --noEmit
```

Esperado: sem erros. O `tsconfig.json` inclui `src/**/*.tsx`, então o arquivo é checado mesmo sem nenhum importador ainda.

- [ ] **Step 3: Commit**

```bash
git add src/components/ProjectSelect.tsx
git commit -m "feat(board): add reusable ProjectSelect with options by prop"
```

---

## Task 7: Front do quadro — rota, `BoardGrid` filtrado e os dois diálogos

Uma task só porque é **uma unidade de compilação**: a prop `project` que os diálogos passam a exigir só existe porque o `BoardGrid` a repassa, e o `BoardGrid` só a tem porque a rota a fornece. Dividir deixaria a árvore com erro de `tsc` atravessando duas tasks.

Fim desta task: a tela troca de projeto, o quadro mostra só as pessoas e as sprints daquele projeto, os formulários criam no projeto aberto, e a escolha sobrevive ao recarregamento.

**Files:**
- Modify: `src/routes/index.tsx:1-60` (arquivo inteiro)
- Modify: `src/components/BoardGrid.tsx:1-53` (imports e assinatura), `:69-123` (queries e mutação), `:172-236` (header), `:277-389` (main e diálogos), `:601-627` (`EmptyState`)
- Modify: `src/components/DevDialog.tsx:23-113`
- Modify: `src/components/SprintDialog.tsx:16-90`
- Modify: `src/integrations/supabase/types.ts` (aperta `jira_project` para obrigatório em `teams.Insert/Update` e `sprints.Insert/Update`)

**Interfaces:**
- Consumes: `JIRA_PROJECTS`, `JiraProjectKey`, `isJiraProjectKey` (Task 4); `Team`/`Dev`/`Sprint`/`Allocation` com `jira_project` (Task 5); `ProjectSelect` (Task 6).
- Produces:
  - `BoardGrid` passa a exigir `project: JiraProjectKey | null` e `onProjectChange: (p: JiraProjectKey) => void`.
  - `DevDialog` e `SprintDialog` passam a exigir `project: JiraProjectKey`.
  - `queryKey`s `["board","devs",project]`, `["board","teams",project]`, `["board","sprints",project]`, `["board","allocations",project]`; invalidação pelos prefixos `["board","devs"]`, `["board","teams"]`, `["board","sprints"]`, `["board","allocations"]`.
  - `teams.Insert`/`teams.Update` e `sprints.Insert`/`sprints.Update` exigindo `jira_project`.

**Por que `project` é `JiraProjectKey | null` e não `JiraProjectKey`:** a spec pede `enabled: !!project` nas quatro queries e o ramo "Selecione um projeto." na tela — as duas coisas só fazem sentido com o valor anulável, e o próprio trecho de query da spec escreve `project!`. Na prática o `null` é inalcançável: `routes/index.tsx` cai em `JIRA_PROJECTS[0]` quando a chave persistida é inválida. O ramo existe para não quebrar se a lista de projetos ficar vazia (e porque `noUncheckedIndexedAccess` torna `JIRA_PROJECTS[0]` possivelmente `undefined`). Nos diálogos a prop é não-anulável: o `BoardGrid` só os monta com projeto escolhido.

**Nos formulários, o projeto vem da tela, não de um campo.** Um seletor de projeto dentro do diálogo permitiria criar uma sprint num projeto que não está aberto — ela desapareceria ao salvar, parecendo um bug. É a mesma lógica pela qual `position: count` já é derivado do estado da tela em vez de digitado.

- [ ] **Step 1: Substituir `src/routes/index.tsx` inteiro**

Este arquivo passa a ser o dono do estado e da persistência. É de propósito: quando a navegação unificada subir o seletor para a casca compartilhada, ela apaga a persistência **só aqui**.

```tsx
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAuthorizedSession } from "@/hooks/use-authorized-session";
import { AuthCard } from "@/components/AuthCard";
import { AccessDenied } from "@/components/AccessDenied";
import { BoardGrid } from "@/components/BoardGrid";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { JIRA_PROJECTS, isJiraProjectKey, type JiraProjectKey } from "@/lib/projects";

// Chave própria da tela, não global: seguindo o precedente documentado em
// CycleTimeView.tsx — olhar o Compromisso do PIM enquanto se analisa o quadro
// do PH é um uso legítimo. Uma seleção compartilhada entre as quatro telas é
// decisão da spec de navegação unificada, não desta.
const LS_PROJECT = "alocacoesLastProject";

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

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sprint Board — Alocação de demandas do time de devs" },
      {
        name: "description",
        content:
          "Substitua a planilha: quadro visual de sprints x devs com status coloridos, tickets, férias e realocação por arrastar e soltar.",
      },
      { property: "og:title", content: "Sprint Board — Alocação de demandas do time de devs" },
      {
        property: "og:description",
        content:
          "Quadro visual de sprints x devs com status coloridos, tickets, férias e realocação por arrastar e soltar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { session, loading, canEdit, isAdmin, canView } = useAuthorizedSession();

  // A lista é local, então o projeto inicial é escolhido de forma síncrona, sem
  // esperar rede: em prática o usuário nunca vê a tela vazia. O fallback existe
  // para a chave persistida inválida (projeto removido de JIRA_PROJECTS).
  // `ssr: false` nesta rota garante que localStorage existe aqui.
  const [project, setProject] = useState<JiraProjectKey | null>(() => {
    const stored = ls(LS_PROJECT);
    return isJiraProjectKey(stored) ? stored : (JIRA_PROJECTS[0]?.key ?? null);
  });

  function handleProjectChange(p: JiraProjectKey) {
    setProject(p);
    save(LS_PROJECT, p);
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

  return (
    <BoardGrid
      email={session.user.email ?? ""}
      canEdit={canEdit}
      isAdmin={isAdmin}
      project={project}
      onProjectChange={handleProjectChange}
    />
  );
}
```

- [ ] **Step 2: Acrescentar os imports novos em `BoardGrid.tsx`**

Depois da linha 43 (`import { ThemeToggle } from "./ThemeToggle";`), acrescentar:

```tsx
import { ProjectSelect } from "./ProjectSelect";
import { JIRA_PROJECTS, isJiraProjectKey, type JiraProjectKey } from "@/lib/projects";
```

- [ ] **Step 3: Trocar a assinatura de `BoardGrid` (linhas 45-53)**

Substituir:

```tsx
export function BoardGrid({
  email,
  canEdit,
  isAdmin,
}: {
  email: string;
  canEdit: boolean;
  isAdmin: boolean;
}) {
```

por:

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
  /**
   * Componente CONTROLADO: o projeto e a persistência moram em
   * routes/index.tsx. Quando a navegação unificada subir o seletor para a
   * casca compartilhada, o filtro e as queryKeys daqui não mudam — só sai o
   * <ProjectSelect> do header.
   *
   * `null` é inalcançável em prática (a rota cai em JIRA_PROJECTS[0]); o ramo
   * existe para a lista de projetos vazia.
   */
  project: JiraProjectKey | null;
  onProjectChange: (p: JiraProjectKey) => void;
}) {
```

- [ ] **Step 4: Substituir as quatro queries e a mutação (linhas 69-123)**

Substituir o bloco inteiro que hoje vai de `const devsQ = useQuery({` até o fechamento de `const move = useMutation({ … });` por:

```tsx
  // As quatro queries são `select("*")` planas com um `.eq("jira_project", …)`
  // cada — sem `!inner`, sem query dependente: `devs` e `allocations` têm o
  // projeto denormalizado, derivado do pai por trigger no banco.
  //
  // O projeto entra na queryKey obrigatoriamente. DevDialog usa a MESMA chave
  // de `teams`; se as duas divergissem, os dois componentes brigariam pela
  // mesma entrada de cache e o diálogo listaria times do projeto errado.
  //
  // `enabled: !!project`: no TanStack Query v5 uma query desabilitada tem
  // isPending true e isFetching false, logo isLoading === false — o `loading`
  // composto abaixo não fica preso em "Carregando quadro...".
  const devsQ = useQuery({
    queryKey: ["board", "devs", project],
    enabled: !!project,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devs")
        .select("*")
        .eq("jira_project", project!)
        .order("position")
        .order("name");
      if (error) throw error;
      return data as Dev[];
    },
  });

  const teamsQ = useQuery({
    queryKey: ["board", "teams", project],
    enabled: !!project,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("jira_project", project!)
        .order("position");
      if (error) throw error;
      return data as Team[];
    },
  });

  const sprintsQ = useQuery({
    queryKey: ["board", "sprints", project],
    enabled: !!project,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sprints")
        .select("*")
        .eq("jira_project", project!)
        .order("start_date")
        .order("position");
      if (error) throw error;
      return data as Sprint[];
    },
  });

  const allocQ = useQuery({
    queryKey: ["board", "allocations", project],
    enabled: !!project,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*")
        .eq("jira_project", project!)
        .order("position");
      if (error) throw error;
      return data as Allocation[];
    },
  });

  // Sem mudança no payload: o projeto do cartão é recalculado pelo trigger a
  // cada movimento, e allocations_sprint_project_fkey valida o destino.
  const move = useMutation({
    mutationFn: async (v: { id: string; sprint_id: string; dev_id: string }) => {
      const { error } = await supabase
        .from("allocations")
        .update({ sprint_id: v.sprint_id, dev_id: v.dev_id })
        .eq("id", v.id);
      if (error) throw error;
    },
    // Invalida pelo PREFIXO, sem o projeto: derruba o cache do projeto atual e
    // o dos outros que estiverem em cache, que é o comportamento desejado.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", "allocations"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  function handleProjectChange(key: string) {
    // O Radix devolve `string`; isJiraProjectKey é o portão.
    if (isJiraProjectKey(key)) onProjectChange(key);
  }
```

- [ ] **Step 5: Montar o `<ProjectSelect>` no header e desabilitar a escrita sem projeto**

Em `BoardGrid.tsx`, no header, logo **depois** do bloco `<div className="mr-auto"> … </div>` (linhas 177-180) e **antes** do `<div className="relative">` do campo de busca (linha 182), acrescentar:

```tsx
            <ProjectSelect
              value={project}
              options={JIRA_PROJECTS}
              onChange={handleProjectChange}
            />
```

E nos dois botões de escrita (linhas 192-209), acrescentar `disabled={!project}`:

```tsx
            {canEdit ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!project}
                  onClick={() => setSprintDialog({ open: true, sprint: null })}
                >
                  <CalendarPlus className="size-4" /> Sprint
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!project}
                  onClick={() => setDevDialog({ open: true, dev: null })}
                >
                  <UserPlus className="size-4" /> Pessoa
                </Button>
              </>
            ) : null}
```

- [ ] **Step 6: Pôr o ramo "Selecione um projeto." na frente da cadeia do `<main>`**

Substituir a abertura do `<main>` (linhas 277-291) por:

```tsx
        <main className="min-h-0 flex-1 p-4">
          {/* O ramo sem projeto vem PRIMEIRO: com as queries desabilitadas,
              `loading` é false e `sprints`/`devs` são [], então a cadeia cairia
              no EmptyState e pediria para cadastrar sprint num projeto que não
              existe. Mesma frase que o Cycle Time já usa. */}
          {!project ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              Selecione um projeto.
            </p>
          ) : loading ? (
            <p className="py-20 text-center text-sm text-muted-foreground">Carregando quadro...</p>
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
                O quadro do {project} ainda não foi montado.
              </p>
            )
          ) : (
```

O restante do `<main>` (o `<div>` do grid, das linhas 293 a 374, e o `)}` `</main>`) fica **exatamente** como está.

- [ ] **Step 7: Passar `project` aos dois diálogos que precisam dele (linhas 377-389)**

Substituir:

```tsx
        <AllocationDialog draft={draft} onOpenChange={(o) => !o && setDraft(null)} />
        <DevDialog
          dev={devDialog.dev}
          open={devDialog.open}
          count={devs.length}
          onOpenChange={(o) => setDevDialog({ open: o, dev: o ? devDialog.dev : null })}
        />
        <SprintDialog
          sprint={sprintDialog.sprint}
          open={sprintDialog.open}
          count={sprints.length}
          onOpenChange={(o) => setSprintDialog({ open: o, sprint: o ? sprintDialog.sprint : null })}
        />
```

por:

```tsx
        {/* AllocationDialog fica fora do condicional: não depende de projeto
            (o cartão herda o da pessoa no banco) e envolvê-lo remontaria o
            diálogo sem motivo. */}
        <AllocationDialog draft={draft} onOpenChange={(o) => !o && setDraft(null)} />
        {project ? (
          <>
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
              onOpenChange={(o) =>
                setSprintDialog({ open: o, sprint: o ? sprintDialog.sprint : null })
              }
            />
          </>
        ) : null}
```

- [ ] **Step 8: Pôr o nome do projeto no `EmptyState` (linhas 601-627)**

Substituir a função inteira por:

```tsx
function EmptyState({
  project,
  hasDevs,
  onAddSprint,
  onAddDev,
}: {
  project: JiraProjectKey;
  hasDevs: boolean;
  onAddSprint: () => void;
  onAddDev: () => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed border-grid-line bg-surface p-10 text-center">
      <h2 className="text-lg font-semibold">Vamos montar seu quadro do {project}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Cadastre as pessoas e as sprints do {project}. Depois é só clicar em cada célula para alocar
        as demandas.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={onAddDev} variant={hasDevs ? "outline" : "default"}>
          <UserPlus className="size-4" /> Adicionar pessoa
        </Button>
        <Button onClick={onAddSprint} variant={hasDevs ? "default" : "outline"}>
          <CalendarPlus className="size-4" /> Adicionar sprint
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: `DevDialog` — assinatura, query de times e escrita**

O `JiraProjectKey` usado abaixo é importado no Step 10 (é lá que a linha de import muda); a verificação de tipos só acontece no Step 14, com os dois steps já aplicados.

Substituir o bloco das linhas 27-97 (de `export function DevDialog({` até o fechamento de `const save = useMutation({ … });`) por:

```tsx
export function DevDialog({
  dev,
  open,
  count,
  project,
  onOpenChange,
}: {
  dev: Dev | null;
  open: boolean;
  count: number;
  project: JiraProjectKey;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState<string>(NEW_TEAM);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamColor, setNewTeamColor] = useState(TEAM_COLORS[0]!);

  // MESMA queryKey do BoardGrid, de propósito: chaves diferentes fariam os dois
  // componentes brigarem pela mesma entrada de cache e o diálogo listaria times
  // do projeto errado. Como só existem times do projeto atual na lista, mover
  // uma pessoa para um time de outro projeto é impossível pela tela — e a FK
  // composta cobre o resto.
  const teamsQ = useQuery({
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
  const teams = teamsQ.data ?? [];

  useEffect(() => {
    if (!open) return;
    setName(dev?.name ?? "");
    setTeamId(dev?.team_id ?? (teams.length > 0 ? teams[0]!.id : NEW_TEAM));
    setNewTeamName("");
    setNewTeamColor(TEAM_COLORS[teams.length % TEAM_COLORS.length]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dev]);

  const save = useMutation({
    mutationFn: async () => {
      let finalTeamId = teamId;
      if (teamId === NEW_TEAM) {
        const teamRes = await supabase
          .from("teams")
          .insert({
            name: newTeamName.trim(),
            color: newTeamColor,
            position: teams.length,
            // teams é raiz do eixo das colunas: o projeto é explícito, vem da
            // tela e não tem DEFAULT no banco.
            jira_project: project,
          })
          .select("id")
          .single();
        if (teamRes.error) throw teamRes.error;
        finalTeamId = teamRes.data.id;
      }

      // Sem jira_project no payload de devs: o trigger devs_set_project o
      // deriva do time, e sobrescreveria o que fosse enviado.
      const payload = {
        name: name.trim(),
        initials: initialsFrom(name),
        team_id: finalTeamId,
        position: dev?.position ?? count,
      };
      const res = dev
        ? await supabase.from("devs").update(payload).eq("id", dev.id)
        : await supabase.from("devs").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "devs"] });
      qc.invalidateQueries({ queryKey: ["board", "teams"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
```

- [ ] **Step 10: `DevDialog` — imports e a invalidação do `remove`**

Substituir a linha 23:

```tsx
import { TEAM_COLORS, initialsFrom, type Dev, type Team } from "@/lib/board";
```

por:

```tsx
import { TEAM_COLORS, initialsFrom, type Dev, type Team } from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";
```

E, no `remove` (linhas 102-114), trocar as duas invalidações:

```tsx
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "devs"] });
      qc.invalidateQueries({ queryKey: ["board", "allocations"] });
      onOpenChange(false);
    },
```

- [ ] **Step 11: `SprintDialog` — assinatura, payload e invalidações**

Substituir o bloco das linhas 16-82 (do import de `Sprint` até o fechamento de `const remove = useMutation({ … });`) por:

```tsx
import type { Sprint } from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";

function diffDays(a: string, b: string) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

export function SprintDialog({
  sprint,
  open,
  count,
  project,
  onOpenChange,
}: {
  sprint: Sprint | null;
  open: boolean;
  count: number;
  project: JiraProjectKey;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [quarter, setQuarter] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (!open) return;
    setCode(sprint?.code ?? "");
    setQuarter(sprint?.quarter ?? "");
    setStart(sprint?.start_date ?? "");
    setEnd(sprint?.end_date ?? "");
  }, [open, sprint]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        code: code.trim(),
        quarter: quarter.trim(),
        start_date: start,
        end_date: end,
        days: diffDays(start, end),
        position: sprint?.position ?? count,
        // sprints é raiz do eixo das linhas: cada projeto tem seu calendário e
        // o projeto vem da tela, sem campo no formulário e sem DEFAULT no
        // banco. Nenhum campo novo aparece — só o texto do título.
        jira_project: project,
      };
      const res = sprint
        ? await supabase.from("sprints").update(payload).eq("id", sprint.id)
        : await supabase.from("sprints").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "sprints"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!sprint) return;
      const { error } = await supabase.from("sprints").delete().eq("id", sprint.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", "sprints"] });
      qc.invalidateQueries({ queryKey: ["board", "allocations"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
```

- [ ] **Step 12: `SprintDialog` — projeto no título (linha 90)**

Substituir:

```tsx
          <DialogTitle>{sprint ? "Editar sprint" : "Nova sprint"}</DialogTitle>
```

por:

```tsx
          {/* O projeto aparece como texto, não como campo: não deve haver
              dúvida de onde a sprint vai nascer. */}
          <DialogTitle>
            {sprint ? "Editar sprint" : "Nova sprint"} · {project}
          </DialogTitle>
```

- [ ] **Step 13: Apertar `types.ts` — `jira_project` obrigatório em `teams` e `sprints`**

Agora que os dois call sites enviam o campo, os `Insert`/`Update` das duas raízes passam a exigi-lo (as raízes não têm `DEFAULT` no banco). Em `src/integrations/supabase/types.ts`:

No bloco `sprints`, em `Insert`, trocar

```ts
          jira_project?: string
```

por

```ts
          jira_project: string
```

e o mesmo em `sprints` → `Update`, `teams` → `Insert` e `teams` → `Update`. **Quatro linhas.** Os blocos `devs` e `allocations` continuam com `jira_project?: string` em `Insert`/`Update`: são derivados por trigger e o cliente não os envia.

- [ ] **Step 14: Verificar tipos e formatação**

```bash
npx prettier --write src/routes/index.tsx src/components/BoardGrid.tsx src/components/DevDialog.tsx src/components/SprintDialog.tsx
npx eslint src/routes/index.tsx src/components/BoardGrid.tsx src/components/DevDialog.tsx src/components/SprintDialog.tsx
npx tsc --noEmit
```

Esperado: **sem erros**. Se `tsc` reclamar de `jira_project` faltando em algum `insert`/`update`, é call site esquecido no Step 13. Se reclamar de `project` não existir nas props de `DevDialog`/`SprintDialog`, os Steps 9 e 11 não foram aplicados por inteiro.

- [ ] **Step 15: Confirmar que `AllocationDialog.tsx` não foi tocado**

```bash
git status --porcelain src/components/AllocationDialog.tsx
```

Esperado: **nada impresso**. O projeto do cartão é derivado no banco; este arquivo não muda nesta demanda.

- [ ] **Step 16: Build**

```bash
npm run build
```

Esperado: build concluído sem erro.

- [ ] **Step 17: Commit**

```bash
git add src/routes/index.tsx src/components/BoardGrid.tsx src/components/DevDialog.tsx src/components/SprintDialog.tsx src/integrations/supabase/types.ts
git commit -m "feat(board): filter the board by Jira project"
```

---

## Task 8: `board-errors.ts` e as mensagens em pt-BR

Sem isto, uma violação de FK composta aparece como `insert or update on table "allocations" violates foreign key constraint "allocations_sprint_project_fkey"` num toast.

**Files:**
- Create: `src/lib/board-errors.ts`
- Modify: `src/components/BoardGrid.tsx` (o `onError` do `move`)
- Modify: `src/components/DevDialog.tsx` (os `onError` de `save` e `remove`)
- Modify: `src/components/SprintDialog.tsx` (os `onError` de `save` e `remove`)

**Interfaces:**
- Consumes: `PostgrestError` como forma estrutural (`code`, `message`, `details`, `hint`) — o nome da restrição vem dentro de `message`.
- Produces: `export function boardErrorMessage(error: unknown): string`.

- [ ] **Step 1: Criar `src/lib/board-errors.ts`**

```ts
// SQLSTATE + nome da restrição -> mensagem pt-BR, para as violações que a
// dimensão de projeto introduziu. Mesmo padrão de src/lib/admin-errors.ts:
// nenhuma dependência de tipo do supabase-js, só a forma estrutural do
// PostgrestError (code, message, details, hint). O nome da restrição vem
// dentro de `message`, então o casamento é por code + substring.
const FK_MESSAGES: { constraint: string; message: string }[] = [
  {
    constraint: "allocations_sprint_project_fkey",
    message: "Não é possível mover uma demanda para a sprint de outro projeto.",
  },
  {
    constraint: "allocations_dev_project_fkey",
    message:
      "Esta pessoa tem demandas alocadas; remova-as antes de movê-la para um time de outro projeto.",
  },
  {
    constraint: "devs_team_project_fkey",
    message: "Este time já tem pessoas; não é possível trocar o projeto dele.",
  },
];

export function boardErrorMessage(error: unknown): string {
  const e = error as { code?: string; message?: string; details?: string } | null;
  const code = e?.code;
  const haystack = `${e?.message ?? ""} ${e?.details ?? ""}`;

  // W3001: os triggers de derivação não acharam o time ou a pessoa — a tela
  // está com dado velho.
  if (code === "W3001") return "Time ou pessoa não encontrado. Recarregue a página.";

  if (code === "23503") {
    const hit = FK_MESSAGES.find((m) => haystack.includes(m.constraint));
    if (hit) return hit.message;
  }

  if (code === "23514" && haystack.includes("_jira_project_format")) {
    return "Chave de projeto inválida.";
  }

  console.error("[board]", error);
  return error instanceof Error && !code ? error.message : "Não foi possível salvar a alteração.";
}
```

- [ ] **Step 2: Usar o mapeamento na mutação de drag-and-drop de `BoardGrid.tsx`**

Acrescentar o import junto dos outros de `@/lib` (depois da linha do import de `@/lib/projects`, feita no Step 2 da Task 7):

```tsx
import { boardErrorMessage } from "@/lib/board-errors";
```

E no `move`, trocar

```tsx
    onError: (e: Error) => toast.error(e.message),
```

por

```tsx
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
```

- [ ] **Step 3: Usar o mapeamento em `DevDialog.tsx`**

Acrescentar, depois do import de `@/lib/projects`:

```tsx
import { boardErrorMessage } from "@/lib/board-errors";
```

E trocar **as duas** ocorrências de

```tsx
    onError: (e: Error) => toast.error(e.message),
```

(uma no `save`, uma no `remove`) por

```tsx
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
```

- [ ] **Step 4: Usar o mapeamento em `SprintDialog.tsx`**

Acrescentar, depois do import de `@/lib/projects`:

```tsx
import { boardErrorMessage } from "@/lib/board-errors";
```

E trocar **as duas** ocorrências de

```tsx
    onError: (e: Error) => toast.error(e.message),
```

(uma no `save`, uma no `remove`) por

```tsx
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
```

- [ ] **Step 5: Confirmar que as cinco chamadas foram trocadas e nenhuma sobrou**

```bash
git diff -U0 src/components/BoardGrid.tsx src/components/DevDialog.tsx src/components/SprintDialog.tsx | grep "toast.error"
```

Esperado: cinco linhas `+ … toast.error(boardErrorMessage(e))` e cinco linhas `- … toast.error(e.message)`. `AllocationDialog.tsx` **não** aparece — a spec o mantém intacto, e os cruzamentos que ele poderia sofrer são impossíveis pela tela (o cartão nasce na célula de uma pessoa e uma sprint do mesmo quadro).

- [ ] **Step 6: Verificar tipos, formatação e build**

```bash
npx prettier --write src/lib/board-errors.ts src/components/BoardGrid.tsx src/components/DevDialog.tsx src/components/SprintDialog.tsx
npx eslint src/lib/board-errors.ts src/components/BoardGrid.tsx src/components/DevDialog.tsx src/components/SprintDialog.tsx
npx tsc --noEmit
npm run build
```

Esperado: sem erros; build concluído.

- [ ] **Step 7: Commit**

```bash
git add src/lib/board-errors.ts src/components/BoardGrid.tsx src/components/DevDialog.tsx src/components/SprintDialog.tsx
git commit -m "feat(board): map project constraint violations to pt-BR messages"
```

---

## Task 9: Roteiro manual

Última task: prova que a tela faz o que a spec pediu, com o banco real.

**Files:** nenhum arquivo de código. Só verificação.

**Interfaces:**
- Consumes: tudo das Tasks 1 a 8, com as duas migrations já aplicadas no Supabase real.
- Produces: confirmação de que o quadro de hoje continua idêntico e que um segundo projeto é utilizável de ponta a ponta.

- [ ] **Step 1: Subir o app**

```bash
npm run dev
```

Esperado: servidor de dev no ar (Vite imprime a URL local).

- [ ] **Step 2: Paridade com o quadro de antes**

Abrir `/` logado como `admin` ou `editor`.

Esperado: o seletor mostra `PIM` e o quadro está **idêntico** ao de antes da migration — mesmas colunas (pessoas), mesmas linhas (sprints), mesmos cartões.

- [ ] **Step 3: Projeto vazio**

Trocar o seletor para `PH`.

Esperado: "Vamos montar seu quadro do PH", com os botões "Adicionar pessoa" e "Adicionar sprint".

- [ ] **Step 4: Criar sprint e pessoa no `PH`**

Clicar em "Sprint": o título do diálogo diz "Nova sprint · PH". Preencher `code`, início e fim; salvar.
Clicar em "Pessoa": o `Select` de time **não** lista nenhum time do `PIM`; escolher "+ Criar novo time", dar um nome, salvar.

Esperado: a sprint e a pessoa aparecem no quadro do `PH`.

- [ ] **Step 5: Persistência**

Recarregar a página (F5).

Esperado: continua no `PH` (a chave `alocacoesLastProject` no `localStorage` guardou a escolha).

- [ ] **Step 6: Alocar e arrastar dentro do `PH`**

Criar uma segunda sprint no `PH`, alocar uma demanda numa célula e arrastá-la para a outra sprint.

Esperado: o cartão se move sem erro e sem toast.

- [ ] **Step 7: O `PIM` não mudou**

Voltar o seletor para `PIM`.

Esperado: o time novo do `PH` **não** aparece como coluna, as sprints do `PH` **não** aparecem como linhas, e nada do `PIM` mudou.

- [ ] **Step 8: Papel `viewer`**

Entrar com um usuário `viewer`.

Esperado: nenhum botão de escrita (sem "Sprint", sem "Pessoa", cartões não arrastáveis), **seletor de projeto funcionando** e a troca de projeto redesenhando o quadro.

- [ ] **Step 9: Usuário sem papel**

Entrar com um usuário sem papel nenhum.

Esperado: `AccessDenied` ("Acesso ainda não liberado") — a coluna nova não abriu caminho para quem não tem papel. É a mesma invariante que a Seção 9 do smoke test guarda no banco.

- [ ] **Step 10: Chave persistida inválida**

No console do navegador, com `/` aberto:

```js
localStorage.setItem("alocacoesLastProject", "FOO");
location.reload();
```

Esperado: a tela volta em `PIM` (o `isJiraProjectKey` rejeitou `"FOO"` e caiu em `JIRA_PROJECTS[0]`), **não** em branco e **não** com erro no console.

- [ ] **Step 11: Verificação final de código**

```bash
npx tsc --noEmit
npm run build
```

Esperado: sem erros; build concluído.

- [ ] **Step 12: Commit (só se algum ajuste tiver saído do roteiro)**

Se os steps acima não exigiram nenhuma correção, não há nada a commitar — a task termina aqui. Se exigiram:

```bash
git add -A
git commit -m "fix(board): adjustments from the manual project-dimension walkthrough"
```

---

## Anexo: por que a spec recusou as alternativas

Registrado aqui para que quem executa não "melhore" o desenho no meio do caminho:

- **Só `teams.jira_project`** filtraria as colunas e deixaria as linhas globais — o quadro do PIM mostraria as sprints do PH, vazias.
- **Só `sprints.jira_project`** filtraria as linhas e deixaria as colunas globais.
- **Derivar de `allocations.ticket_key`** não resolve nada estrutural: `tipo = 'ferias'` e rótulos livres não têm ticket, `ticket_key` é `text` sem formato garantido, e o filtro voltaria a ser cosmético — exatamente o que foi recusado.
- **`enum` no Postgres para a chave** criaria uma terceira fonte de verdade (enum + `ALLOWED_PROJECTS` + constante do cliente) para sincronizar a cada projeto novo.
- **Validar o cruzamento no formulário** em vez de por FK deixaria a `service_role` key fora da trava e a coerência dependendo da tela.
- **Mostrar todos os projetos por padrão** dá um grid com uma coluna por pessoa de quatro projetos — ilegível, e é o problema que a demanda resolve.
- **Permissão por projeto** é outra spec: tabela `user_project_access`, helper `private.can_view_project(uuid, text)` e as policies de `SELECT` das quatro tabelas passando a testá-lo. Nada aqui impede isso depois — a coluna necessária é justamente a que está sendo criada.
