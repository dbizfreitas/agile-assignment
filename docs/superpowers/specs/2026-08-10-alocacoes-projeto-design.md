# Alocações por projeto Jira

**Data:** 2026-08-10
**Status:** aprovado para planejamento

## Problema

A tela do quadro (`/`, hoje "Quadro", em breve "Alocações") é a única das quatro
telas da plataforma que não sabe em que projeto Jira você está. Compromisso e
Cycle Time abrem por um seletor de projeto e tudo o que exibem é daquele
projeto; o quadro é global.

O que isso significa em concreto, olhando o código:

1. **Nenhuma tabela tem projeto.** `teams`, `devs`, `sprints` e `allocations`
   (migrations `20260801002005` e `20260803233437`) não têm uma única coluna que
   diga a que projeto a linha pertence.
2. **Um quadro só para todo mundo.** `BoardGrid.tsx` monta o grid com
   `gridTemplateColumns: minmax(0,1fr) repeat(${devs.length}, …)` e
   `gridTemplateRows` a partir de `sprints` — ou seja, **as colunas são todas as
   pessoas cadastradas e as linhas são todas as sprints cadastradas**. Quando o
   time do PH começar a usar a tela, o quadro do PIM ganha as colunas do PH e as
   linhas das sprints do PH, vazias.
3. **O único sinal de projeto existente é frágil.** `allocations.ticket_key`
   (ex.: `"PIM-6801"`) carrega o prefixo do projeto, mas é `text` livre, sem
   formato garantido, e cartão de `tipo = 'ferias'` — assim como os rótulos
   livres que o desenho original previa (`VEE`, `CCEE`, `Team Building`) — não
   tem ticket nenhum.
4. **A lista de projetos não existe no cliente.** `ALLOWED_PROJECTS =
   {PIM, PH, INTFLOW, PDC}` mora em `src/integrations/jira/config.server.ts`,
   que é *server-only* e não pode ser importado por um componente. Hoje nenhuma
   tela do quadro tem como oferecer um seletor.

O pedido é explícito: o quadro deve **depender de projeto selecionado igual às
outras telas** — filtro de verdade, não cosmético.

## Objetivo

Cada projeto Jira passa a ter o seu próprio quadro de alocação — os seus times,
as suas pessoas, as suas sprints e as suas demandas — com a coerência entre eles
garantida pelo banco, não pela tela.

## Escopo

**Dentro:** coluna de projeto em `teams`, `devs`, `sprints` e `allocations`;
backfill do quadro que já existe; restrições que impedem um quadro misto;
seletor de projeto na tela; filtro nas quatro queries; projeto nos formulários
de criação.

**Fora (decidido explicitamente):**

- **Importar o JSON do `jira-live`.** O `alocacao.json` foi descartado quando a
  feature virou Supabase; não existe arquivo para importar. Dado morto.
- **Permissão por projeto.** Hoje quem tem papel vê o quadro inteiro; isso
  continua igual. Projeto é dimensão de dado, não fronteira de segurança (ver
  "Projeto não é fronteira de permissão").
- **Renomear a tela para "Alocações"** e a **navegação unificada com seletor
  compartilhado** — outra frente. Esta spec define o encaixe, não a UI da
  navegação.
- **Partição por ano/quarter** do desenho antigo (`{ [ano]: { [quarter]: … } }`).
  `sprints.quarter` já existe como rótulo livre e resolve o caso de uso atual.
- **Um time em mais de um projeto.** No modelo, um time pertence a exatamente um
  projeto.

## Princípios

1. **Os dois eixos do quadro têm dono.** Um filtro que só esconde cartões deixa
   as colunas e as linhas erradas na tela. Quem define a forma do grid é
   `devs` × `sprints`; então os dois precisam pertencer a um projeto.
2. **Coerência no Postgres, não no TypeScript.** "Um cartão não pode estar numa
   sprint de outro projeto" é chave estrangeira, não validação de formulário.
   Vale inclusive para quem tem a `service_role` key.
3. **O cliente nunca escolhe o projeto de um cartão.** `devs.jira_project` e
   `allocations.jira_project` são derivados do pai por trigger; o cliente sequer
   envia o campo.
4. **Projeto não é papel.** Nenhuma policy de RLS muda. Misturar as duas coisas
   criaria a ilusão de isolamento sem o enforcement dele.
5. **Ninguém perde o quadro que já usa.** O backfill leva tudo para `PIM` e
   `PIM` é o projeto padrão do seletor: no primeiro acesso depois da migration,
   a tela está idêntica à de hoje.

---

## O desenho antigo, e o que se aproveita dele

`git show HEAD:server/routes/alocacao.ts` e
`static/components/alocacao.js` no `jira-live` mostram a estrutura gravada:

```
{ "PIM": { "2026": { "Q3": { teams: {...}, sprints: [...], allocation: {...} } } } }
```

E, dentro de `"PIM"`, os times eram `"PIM"` e `"PIM B"`. Duas conclusões que
valem para cá:

- **Um projeto tem vários times; um time pertence a um projeto.** A relação é
  N:1 de time para projeto, não 1:1. O quadro atual já reproduz isso sem saber:
  o placeholder do campo "Nome do time" em `DevDialog.tsx` é literalmente
  `"Ex.: PIM"`.
- **Sprints eram por projeto**, não globais — o array `sprints` vivia dentro do
  projeto, e o PIM tinha raias próprias como `TB` (Team Building) que não fazem
  sentido para os outros.

O que **não** se aproveita: a partição por ano/quarter (fora de escopo) e o
formato dos times como `{ nome: [strings] }` (o Supabase já tem `teams` e `devs`
como tabelas, o que é melhor).

Sobre os dados de hoje: as migrations não semeiam nenhum time além de
`INSERT INTO public.teams … ('Sem time', …)` em `20260803233437`, usado só para
poder tornar `devs.team_id` `NOT NULL`. Não existe seed de `devs` nem de
`sprints`. Portanto **todo time e toda pessoa que existem hoje foram criados à
mão pela tela** — e a única evidência disponível sobre a que projeto pertencem é
o prefixo de `allocations.ticket_key`. O backfill usa exatamente essa evidência.

---

## Decisão: onde mora a informação de projeto

### As três opções avaliadas

| Opção | O que resolve | Por que não basta |
| ----- | ------------- | ----------------- |
| (a) só `teams.jira_project` | filtra as **colunas** (pessoas) | as **linhas** continuam globais: o quadro do PIM mostra as sprints do PH, vazias |
| (b) só `sprints.jira_project` | filtra as **linhas** | as **colunas** continuam globais: as pessoas do PH aparecem como colunas vazias no quadro do PIM |
| (c) derivar de `allocations.ticket_key` | nada estrutural | `tipo='ferias'` e rótulos livres não têm ticket; `ticket_key` é `text` sem formato garantido; times e sprints ficam sem dono e o filtro volta a ser cosmético — exatamente o que foi recusado |

Nenhuma das três isolada serve, porque o grid tem **dois** eixos. `BoardGrid`
deriva as colunas de `devs` e as linhas de `sprints`; filtrar um só deixa o
outro errado na tela.

### O que fica decidido

`jira_project` em **`teams`, `sprints`, `devs` e `allocations`** — os dois eixos
mais dois filhos denormalizados, cada um com uma razão específica:

- **`teams`** é a raiz do eixo das colunas. É o time que pertence a um projeto
  (é o que o desenho antigo dizia, e o que o placeholder `"Ex.: PIM"` já
  sugere).
- **`sprints`** é a raiz do eixo das linhas. Cada projeto tem seu calendário.
- **`devs`** recebe o projeto **derivado do time**. Não é redundância inútil:
  é o que permite a FK composta `allocations (dev_id, jira_project) → devs (id,
  jira_project)` e o que faz `UPDATE teams SET jira_project` ser recusado pelo
  Postgres enquanto o time tiver gente.
- **`allocations`** recebe o projeto **derivado da pessoa**. Além de fechar a
  coerência, é a única das quatro tabelas que cresce sem limite (sprints ×
  pessoas × cartões, indefinidamente) e a única que realmente precisa de filtro
  no servidor em vez de no cliente.

O efeito colateral é que as quatro queries que `BoardGrid` já faz continuam
sendo `select("*")` planas, com um `.eq("jira_project", project)` cada — sem
`!inner`, sem query dependente, sem mudar a forma das linhas nem os tipos de
`src/lib/board.ts`.

### Alternativa considerada e recusada: `enum` para a chave do projeto

`CREATE TYPE public.jira_project AS ENUM ('PIM','PH','INTFLOW','PDC')` daria a
lista exata no banco e um *union type* de graça no `types.ts` gerado. Recusada
porque criaria uma **terceira** fonte de verdade para a lista de projetos (o
enum, o `ALLOWED_PROJECTS` e a constante nova do cliente), e sincronizar as três
a cada projeto novo é justamente o tipo de dívida que este desenho pode evitar:
a lista fica **só em TypeScript** (`src/lib/projects.ts`), de onde o
`config.server.ts` passa a derivar o `ALLOWED_PROJECTS`, e o banco valida apenas
o **formato** da chave.

Consequência aceita: um cliente forjado pode gravar `jira_project = 'FOO'` e
criar linhas que nenhum seletor mostra. Isso não vaza dado nem eleva privilégio
— quem consegue fazer isso já é `editor` e já pode escrever qualquer coisa no
quadro. É higiene, não segurança.

---

## Banco de dados

### Migration A — coluna e dado (aditiva, reversível)

```sql
ALTER TABLE public.teams       ADD COLUMN jira_project text;
ALTER TABLE public.sprints     ADD COLUMN jira_project text;
ALTER TABLE public.devs        ADD COLUMN jira_project text;
ALTER TABLE public.allocations ADD COLUMN jira_project text;
```

#### Backfill — o time decide, pelo voto do prefixo do ticket

A única evidência disponível é o prefixo de `allocations.ticket_key`. O voto é
por **time** (e não por cartão) porque time é a raiz do eixo: um cartão de
`INTFLOW-…` na linha de uma pessoa do time do PIM é trabalho pontual, não muda o
projeto do time.

```sql
-- Voto majoritário do prefixo de ticket_key entre as alocações das pessoas do
-- time, restrito às chaves conhecidas. Empate resolvido pela ordem alfabética,
-- para o resultado ser determinístico.
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
```

`'PIM'` é o fallback porque é o quadro que existe hoje: a planilha de origem, a
feature equivalente do `jira-live` e o placeholder do formulário são todos do
PIM. E como `PIM` também será o primeiro item do seletor, quem abre a tela
depois da migration vê **exatamente** o quadro de antes.

#### Sprint com cartões de mais de um projeto é dividida, não recusada

A sprint herda o projeto dos seus cartões. Se uma sprint carregar cartões de
dois projetos, não existe atribuição única possível — e abortar a migration
travaria o deploy por um dado que ninguém consegue inspecionar antes. Em vez
disso, a sprint é **duplicada por projeto**, que é precisamente o que o modelo
final diz (cada projeto tem seu próprio calendário). Nada é perdido.

```sql
-- (a) cada sprint fica com o primeiro projeto dos seus cartões (ordem
--     alfabética, determinística); sem cartões, PIM.
UPDATE public.sprints s
   SET jira_project = COALESCE(
     (SELECT a.jira_project FROM public.allocations a
       WHERE a.sprint_id = s.id ORDER BY a.jira_project LIMIT 1),
     'PIM');

-- (b) os projetos restantes ganham uma cópia da sprint, e os cartões daquele
--     projeto passam a apontar para ela.
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

Se o quadro atual for de um único projeto — o cenário quase certo — este bloco
não faz nada e não emite `NOTICE` nenhum.

### Migration B — travas (muda comportamento de escrita)

```sql
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
```

`UNIQUE (id, jira_project)` é redundante com a PK, mas o Postgres exige uma
restrição única sobre as colunas referenciadas para aceitar a FK composta. Custo:
um índice pequeno em três tabelas de dezenas de linhas.

**Sem `DEFAULT`.** `teams` e `sprints` são as raízes e o projeto é escolha
explícita de quem cria; um default silenciosamente colocaria a linha no projeto
errado.

#### As três FKs compostas — onde a coerência é enforçada

```sql
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
```

As FKs simples de `20260801002005`/`20260803233437` **permanecem** e são elas que
seguem definindo o `ON DELETE`: `devs_team_id_fkey` com `RESTRICT` (não se apaga
um time com gente) e `allocations_*_fkey` com `CASCADE` (apagar sprint ou pessoa
apaga os cartões). Nas compostas, `ON DELETE` da FK para `teams` é `NO ACTION` de
propósito — `RESTRICT` não pode ser combinado com `DEFERRABLE`, e a trava de
exclusão já vem da FK simples.

O que essas três linhas compram, sem uma única validação de tela:

| Tentativa | Resultado |
| --------- | --------- |
| cartão numa sprint de outro projeto (drag-and-drop entre quadros) | recusado por `allocations_sprint_project_fkey` |
| pessoa movida para um time de outro projeto **tendo** alocações | recusado por `allocations_dev_project_fkey` |
| pessoa movida para um time de outro projeto **sem** alocações | permitido |
| trocar `teams.jira_project` de um time **com** pessoas | recusado por `devs_team_project_fkey` |
| trocar `teams.jira_project` de um time **sem** pessoas | permitido (corrige um erro de cadastro) |

`DEFERRABLE INITIALLY IMMEDIATE` não muda nada no comportamento da aplicação
(a violação estoura no mesmo lugar), mas abre a porta para a curadoria descrita
adiante. É a razão de usar `NO ACTION` em vez de `RESTRICT`: `RESTRICT` não pode
ser diferido.

#### Derivação por trigger — o cliente não envia o projeto dos filhos

```sql
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

CREATE TRIGGER allocations_set_project
BEFORE INSERT OR UPDATE ON public.allocations
FOR EACH ROW EXECUTE FUNCTION private.set_allocation_project();
```

Dispara em **todo** `INSERT` e `UPDATE`, não em `UPDATE OF team_id`/`dev_id`: o
valor enviado pelo cliente é sempre sobrescrito, então a coluna é
inforjável por construção. `SECURITY DEFINER` porque a função precisa ler a
linha do pai independentemente do que a RLS venha a permitir no futuro; segue o
padrão dos helpers em `private` (`SET search_path = public`).

O ganho prático: **`AllocationDialog.tsx` não muda em nada**, e a mutação de
drag-and-drop `update({ sprint_id, dev_id })` em `BoardGrid.tsx` também não —
o projeto é recalculado a cada movimento e a FK para `sprints` valida o destino.

#### Índices

```sql
CREATE INDEX teams_project_position_idx   ON public.teams       (jira_project, position);
CREATE INDEX sprints_project_start_idx    ON public.sprints     (jira_project, start_date, position);
CREATE INDEX devs_project_position_idx    ON public.devs        (jira_project, position);
CREATE INDEX allocations_project_idx      ON public.allocations (jira_project);
```

Cada um casa exatamente o `ORDER BY` que a query correspondente já usa em
`BoardGrid.tsx`. `allocations_sprint_dev_idx` continua servindo o acesso por
célula.

### RLS: nenhuma policy muda

As policies de `20260808121000` (`…_select_viewers` com
`private.can_view_board(auth.uid())`) e as de escrita com
`private.can_edit_board(auth.uid())` continuam idênticas. Duas razões:

1. Os `GRANT`s são de tabela (`GRANT SELECT, INSERT, UPDATE, DELETE ON public.devs
   TO authenticated`), e grant de tabela cobre coluna nova automaticamente. Não
   há grant de coluna a ajustar.
2. Projeto não é papel. A RLS decide *se* você vê o quadro; o projeto decide
   *qual pedaço* dele a tela desenha.

**Nenhuma brecha nova:** toda linha continua atrás de `can_view_board`, e toda
escrita atrás de `can_edit_board`. Um `viewer` sem papel continua sem ler uma
única linha — a seção 9 do smoke test guarda isso como regressão.

### Projeto não é fronteira de permissão

Precisa ficar escrito, porque a tela vai *parecer* isolada: **qualquer pessoa
com papel continua podendo ler o quadro de qualquer projeto.** O filtro é um
`.eq()` que o cliente envia; um cliente forjado pede outro projeto e recebe.

Se isolamento por projeto virar requisito (por exemplo, o time do PDC não deve
ver o planejamento do PIM), o desenho é outro e é outra spec: uma tabela
`user_project_access (user_id, jira_project)`, um helper
`private.can_view_project(uuid, text)` e as policies de `SELECT` das quatro
tabelas passando a testá-lo. Nada nesta spec impede isso depois — a coluna
necessária é justamente a que está sendo criada.

### Códigos de erro

| SQLSTATE / restrição | Situação | Mensagem ao usuário |
| -------------------- | -------- | ------------------- |
| `23503` `allocations_sprint_project_fkey` | cartão indo para sprint de outro projeto | "Não é possível mover uma demanda para a sprint de outro projeto." |
| `23503` `allocations_dev_project_fkey` | pessoa com alocações mudando de projeto | "Esta pessoa tem demandas alocadas; remova-as antes de movê-la para um time de outro projeto." |
| `23503` `devs_team_project_fkey` | time com pessoas trocando de projeto | "Este time já tem pessoas; não é possível trocar o projeto dele." |
| `23514` `…_jira_project_format` | chave fora do formato | "Chave de projeto inválida." |
| `W3001` | pai inexistente na derivação | "Time ou pessoa não encontrado. Recarregue a página." |

`PostgrestError` expõe `code`, `message`, `details` e `hint` — o nome da
restrição vem dentro de `message`, então o mapeamento em
`src/lib/board-errors.ts` casa por `code` + substring do nome da restrição.
Mesmo padrão de `src/lib/admin-errors.ts`.

### Curadoria: mover um time inteiro de projeto depois

Se o backfill errar, ou se um time realmente mudar de projeto, a operação é
coerente por natureza (time + pessoas + cartões + sprints juntos) e por isso
precisa que as FKs sejam diferidas. É trabalho de operador no SQL Editor, não
função da tela:

```sql
BEGIN;
SET CONSTRAINTS ALL DEFERRED;

UPDATE public.teams       SET jira_project = 'PH' WHERE id = :time;
UPDATE public.devs        SET jira_project = 'PH' WHERE team_id = :time;
UPDATE public.allocations SET jira_project = 'PH'
 WHERE dev_id IN (SELECT id FROM public.devs WHERE team_id = :time);
-- as sprints usadas por esses cartões também precisam ser do projeto de
-- destino: mova-as, ou crie as sprints do destino e repontue os cartões.
COMMIT;   -- as três FKs compostas são checadas aqui, tudo ou nada
```

`SET CONSTRAINTS ALL DEFERRED` não afeta os triggers de derivação, que
sobrescrevem `devs.jira_project` e `allocations.jira_project` a partir do pai —
e é exatamente por isso que os `UPDATE`s acima precisam subir na ordem
time → pessoas → cartões.

---

## Contrato: como o filtro entra nas queries

`BoardGrid.tsx` conversa **direto com o Supabase pelo cliente do navegador**
(`import { supabase } from "@/integrations/supabase/client"`), com a chave
publicável e sob RLS. Não há `createServerFn` no caminho do quadro — as server
functions existem só para o Jira (`src/integrations/jira/server-fns.ts`) e para
a administração. Isso **não muda**: o filtro é um `.eq()` no cliente.

As quatro queries passam a ser:

```ts
// devs, teams, sprints, allocations — mesma forma para as quatro
useQuery({
  queryKey: ["board", "devs", project],
  enabled: !!project,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("devs").select("*")
      .eq("jira_project", project!)
      .order("position").order("name");
    if (error) throw error;
    return data as Dev[];
  },
});
```

Três detalhes que não são opcionais:

1. **A `queryKey` precisa conter o projeto.** Hoje as chaves são `["devs"]`,
   `["teams"]`, `["sprints"]`, `["allocations"]` — e **`DevDialog.tsx` usa
   `["teams"]` com uma query própria, sem filtro**. Se só o `BoardGrid` passar a
   filtrar, os dois componentes brigam pela mesma entrada de cache e o diálogo
   mostra times do projeto errado (ou o quadro mostra times de todos). As duas
   queries de `teams` têm que usar a mesma chave, com o mesmo projeto.
2. **`enabled: !!project`** em todas. Em TanStack Query v5 uma query desabilitada
   tem `isPending: true` e `isFetching: false`, logo `isLoading === false` — o
   `loading` composto de `BoardGrid` não fica preso em "Carregando quadro..."
   com nenhum projeto escolhido (era um pé-de-ouvido real na v4).
3. **`invalidateQueries` precisa acompanhar a chave.** Os `onSuccess` dos
   diálogos e da mutação de drag-and-drop invalidam hoje `["devs"]`, `["teams"]`,
   `["sprints"]` e `["allocations"]` — chaves que deixam de existir e passariam a
   não invalidar nada, deixando a tela desatualizada depois de salvar. Cada um
   passa a invalidar o prefixo `["board", "devs"]` etc., **sem** o projeto: isso
   invalida o projeto atual e também o que estiver em cache de outros projetos,
   que é o comportamento desejado.

`src/integrations/supabase/types.ts` é gerado, mas mantido no repositório e já
foi editado à mão nas demandas anteriores (é como `invitations` e
`role_audit_log` entraram). `jira_project` precisa entrar em `Row`, `Insert` e
`Update` das quatro tabelas — `Row` obrigatório, `Insert`/`Update` opcionais em
`devs` e `allocations` (derivados) e obrigatórios em `teams` e `sprints`. Sem
isso o `.eq("jira_project", …)` não compila.

---

## Frontend

| Arquivo | Mudança |
| ------- | ------- |
| `src/lib/projects.ts` **(novo)** | `JIRA_PROJECTS: readonly {key,name}[]` e `type JiraProjectKey` — fonte de verdade única das chaves no cliente |
| `src/integrations/jira/config.server.ts` | `ALLOWED_PROJECTS` passa a derivar de `@/lib/projects` em vez de repetir as quatro chaves |
| `src/lib/board.ts` | `Team`, `Dev`, `Sprint` e `Allocation` ganham `jira_project: JiraProjectKey` |
| `src/integrations/supabase/types.ts` | `jira_project` nas quatro tabelas |
| `src/components/ProjectSelect.tsx` **(novo)** | `Select` de projeto, mesma aparência do Cycle Time (`h-9 w-56`, placeholder "Selecione um projeto…") |
| `src/routes/index.tsx` | dono do estado `project` + persistência em `localStorage` |
| `src/components/BoardGrid.tsx` | recebe `project` e `onProjectChange`; `.eq("jira_project", …)` nas quatro queries; `queryKey` com projeto; `<ProjectSelect>` no header |
| `src/components/DevDialog.tsx` | recebe `project`; lista só os times do projeto; time novo nasce com `jira_project` |
| `src/components/SprintDialog.tsx` | recebe `project`; payload inclui `jira_project` |
| `src/lib/board-errors.ts` **(novo)** | violação de FK composta → mensagem pt-BR |
| `src/components/AllocationDialog.tsx` | **sem mudança** — o projeto é derivado no banco |

### De onde vem a lista do seletor

Da constante local (`JIRA_PROJECTS`), **não** de `getJiraProjects()`.

Compromisso e Cycle Time chamam `getJiraProjects()` porque os dados deles *são*
do Jira — sem Jira não há tela. O quadro é o oposto: hoje ele funciona com zero
dependência do Jira. Fazer o seletor depender de uma ida ao Jira significaria que
um token expirado ou uma instabilidade da Atlassian derruba o **planejamento**,
que é dado próprio, guardado no Supabase. Não vale a troca.

Além disso a constante é necessária de qualquer forma: `ALLOWED_PROJECTS` mora em
`config.server.ts` e não pode ser importado por um componente. Criando
`src/lib/projects.ts` e fazendo o `config.server.ts` derivar dele, a lista passa
a existir **uma** vez (a direção do import é legal: o proibido é componente
importar `*.server.ts`, não o contrário).

### Comportamento sem projeto selecionado

Tela vazia pedindo a seleção, com a mesma frase que o Cycle Time já usa
("Selecione um projeto."). Mostrar tudo por padrão está descartado por três
motivos, na ordem:

1. **Não funcionaria.** O grid tem uma coluna por pessoa; quatro projetos
   somados dão um quadro ilegível. É literalmente o problema que a demanda
   resolve.
2. **Consistência.** Compromisso e Cycle Time nunca mostram tudo.
3. **É o estado transitório, não o normal.** A inicialização é
   `ls("alocacoesLastProject") ?? JIRA_PROJECTS[0].key` — e, como a lista é
   local, o primeiro projeto é escolhido de forma síncrona, sem esperar rede.
   Em prática o usuário nunca vê a tela vazia; o ramo existe para não quebrar
   caso a chave persistida seja inválida (projeto removido da lista).

Chave de `localStorage`: `alocacoesLastProject`, própria da tela — seguindo o
precedente documentado em `CycleTimeView.tsx` ("olhar o Compromisso do PIM
enquanto se analisa o Cycle Time do PH é um uso legítimo"). Uma chave por tela,
não uma global.

Com `JIRA_PROJECTS` na ordem `PIM, PH, INTFLOW, PDC` e o backfill em `PIM`, o
primeiro acesso depois da migration mostra o quadro de hoje, inalterado.

### Os formulários de criação

O princípio: **o projeto vem da tela, não de um campo.** Um seletor de projeto
dentro do diálogo permitiria criar uma sprint num projeto que não está aberto —
ela desapareceria ao salvar, parecendo um bug. É a mesma lógica pela qual
`position: count` já é derivado do estado da tela em vez de ser digitado.

- **`SprintDialog`** — recebe `project` e o inclui no payload. Nenhum campo
  novo; o projeto aparece como texto no título ("Nova sprint · PIM"), para não
  haver dúvida de onde a sprint vai nascer.
- **`DevDialog`** — recebe `project`. O `Select` de time lista **só** os times do
  projeto (a mesma `queryKey` do `BoardGrid`), e "+ Criar novo time" grava
  `jira_project: project`. O default de `teamId` continua "primeiro time, senão
  `NEW_TEAM`" — num projeto ainda vazio isso cai direto em "criar time", que é o
  caminho certo de onboarding. Como só existem times do projeto atual na lista,
  **mover uma pessoa para um time de outro projeto é impossível pela tela**, e a
  FK cobre o resto.
- **`AllocationDialog`** e o drag-and-drop — sem mudança nenhuma.
- **`EmptyState`** ("Vamos montar seu quadro") já é exatamente a tela certa para
  um projeto ainda sem dados; ganha o nome do projeto no texto. O ramo de quem
  não pode editar ("O quadro ainda não foi montado.") idem.

### O encaixe com a navegação unificada

Recomendação: **Alocações nasce com controle próprio** (`ProjectSelect` no
header do quadro, estado em `routes/index.tsx`), e a spec de navegação decide
depois se o controle sobe para a casca compartilhada. O encaixe é de propósito
uma costura de uma linha:

- `BoardGrid` é **controlado**: recebe `project` e `onProjectChange`. Mover o
  seletor para uma casca compartilhada é tirar o `<ProjectSelect>` do header e
  parar de passar `onProjectChange` — o filtro e as `queryKey`s não mudam.
- `ProjectSelect` já nasce isolado, pronto para ser reaproveitado pela casca.
  Esta spec **não** refatora Cycle Time nem Compromisso para usá-lo: isso é
  escopo da navegação e evita conflito de diff entre as duas frentes.
- **Requisito para a outra spec:** se o seletor compartilhado alimentar as
  opções com `getJiraProjects()`, Alocações precisa degradar para
  `JIRA_PROJECTS` quando essa query falhar. Caso contrário uma instabilidade do
  Jira passa a derrubar o planejamento, que hoje não depende dele.
- A chave de `localStorage` compartilhada (uma seleção global para as quatro
  telas) é decisão da outra spec. Se ela adotar isso, o precedente de chave por
  tela documentado no Cycle Time precisa ser revisto lá, não aqui.

---

## Verificação

O projeto não tem *test runner* (`package.json` só traz `dev`, `build`,
`preview`, `lint`, `format`) e esta demanda **não introduz um**. A verificação
segue o padrão já estabelecido em `supabase/tests/rbac_smoke.sql`.

### `supabase/tests/alocacoes_projeto_smoke.sql`

Script assertivo (`BEGIN` … `DO $$ … RAISE EXCEPTION` … `ROLLBACK`), colável no
SQL Editor:

1. **Estrutura** — `jira_project` existe e é `NOT NULL` nas quatro tabelas; os
   quatro `CHECK` de formato; os três `UNIQUE (id, jira_project)`; as três FKs
   compostas (e `condeferrable = true`); os dois triggers de derivação.
2. **Backfill** — nenhum `jira_project` nulo; nenhum dev com projeto diferente
   do seu time; nenhuma alocação com projeto diferente da sua pessoa; nenhuma
   alocação com projeto diferente da sua sprint.
3. **Derivação** — inserir dev num time do `PH` enviando `jira_project = 'PIM'`
   resulta em `'PH'`.
4. **Cartão cruzado** — inserir alocação com dev do `PH` e sprint do `PIM`
   levanta `23503`.
5. **Drag cruzado** — `UPDATE allocations SET sprint_id` para sprint de outro
   projeto levanta `23503`.
6. **Time** — trocar `teams.jira_project` com pessoas levanta `23503`; sem
   pessoas, passa.
7. **Pessoa** — mover dev para time de outro projeto com alocações levanta
   `23503`; sem alocações, passa.
8. **Curadoria** — a transação com `SET CONSTRAINTS ALL DEFERRED` move time +
   pessoas + cartões + sprints e comita.
9. **Regressão de RLS** — usuário sem papel continua sem ler `teams`, `devs`,
   `sprints` e `allocations`; `viewer` lê e não escreve. A coluna nova não abriu
   caminho novo.

### Roteiro manual

Com o app rodando: abrir `/` → o seletor mostra `PIM` e o quadro está idêntico
ao de antes da migration; trocar para `PH` → "Vamos montar seu quadro"; criar
uma sprint e uma pessoa no `PH` → aparecem, e o time novo só aparece no `PH`;
recarregar → continua no `PH`; alocar e arrastar um cartão dentro do `PH` → ok;
voltar para `PIM` → nada mudou lá; entrar como `viewer` → sem botões de escrita,
seletor funcionando; entrar como usuário sem papel → segue barrado pelo
`AccessDenied`.

`npm run lint` e o build têm de passar (o `types.ts` editado à mão é a fonte
mais provável de erro de compilação).

---

## Ordem de implementação

1. **Migration A** — colunas anuláveis, backfill por voto, divisão de sprints
   mistas
2. **Migration B** — `NOT NULL`, `CHECK`, `UNIQUE (id, jira_project)`, as três
   FKs compostas deferíveis, os dois triggers de derivação, os índices
3. `alocacoes_projeto_smoke.sql` e execução
4. `src/lib/projects.ts` + `config.server.ts` derivando dele
5. `types.ts` + `src/lib/board.ts`
6. `ProjectSelect` + estado em `routes/index.tsx` + `BoardGrid` controlado,
   filtrado e com as `queryKey`s novas
7. `DevDialog` e `SprintDialog` recebendo o projeto
8. `board-errors.ts` e os `toast.error` passando por ele
9. Roteiro manual

A e B são separadas pelo mesmo motivo das migrations de RBAC: A é aditiva e
reversível (`DROP COLUMN` volta ao estado anterior), B é a que passa a recusar
escrita. Se algo der errado em B, A já está estável — e o front só entra depois
que o smoke test passa, porque é ele que prova que o backfill não deixou linha
órfã.
