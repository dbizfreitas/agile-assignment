# Janela de disponibilidade da pessoa

**Data:** 2026-08-15
**Status:** aprovado para planejamento
**Issue:** [#2 — Cadastro de pessoa: data de início de disponibilidade](https://github.com/dbizfreitas/agile-assignment/issues/2)
**Origem:** reunião "Ferramenta de alocação" (12/08/2026), Diego Freitas e Dariel Cuenca

## Problema

Quem entra no time aparece na grade de alocações como disponível **desde a
primeira sprint do calendário**, inclusive em sprints anteriores à sua entrada.
Quem sai continua disponível para sempre. A grade não tem como saber quando cada
pessoa passou a fazer parte do time porque essa informação simplesmente não
existe no sistema.

Olhando o código:

1. **`devs` não guarda período.** As colunas são `id`, `name`, `initials`,
   `team_id`, `position`, `active`, `jira_project`, `created_at`
   (migration `20260801002005`, mais `team_id` em `20260803233437` e
   `jira_project` em `20260810120000`). Nenhuma data.
2. **`devs.active` existe e é coluna morta.** Está lá desde a migration inicial
   com `DEFAULT true` e **não é lida em lugar nenhum** do `src/`. Não resolve o
   problema — é um booleano sem data, não uma janela — e não será usada aqui.
3. **A célula da grade não filtra nada.** `SprintRow`
   (`src/components/BoardGrid.tsx`) desenha uma célula para todo par
   (sprint × pessoa), sempre com o botão "+ demanda" no hover e sempre aceitando
   drop.
4. **A informação existe, mas na planilha.** Hoje o cinza é pintado à mão na
   planilha que a ferramenta veio substituir. É trabalho manual que se repete a
   cada pessoa que entra ou sai.

Os dados para calcular a regra já estão todos no cliente: `sprints` tem
`start_date` e `end_date`; falta só a janela da pessoa.

## Objetivo

Cada pessoa passa a ter uma janela de disponibilidade opcional
(`de` … `até`). A grade de alocações desabilita visualmente as células das
sprints fora dessa janela, e não oferece ação de criar nem de mover demanda
para elas — o mesmo efeito que hoje é pintado à mão na planilha.

## Escopo

**Dentro:** duas colunas de data em `devs`; dois campos no cadastro de pessoa;
uma função pura que decide se uma sprint cabe na janela; célula desabilitada na
grade (visual, sem botão de adicionar, sem alvo de drop); período no tooltip do
cabeçalho da coluna.

**Fora (decidido explicitamente):**

- **Trava no banco.** Nenhum trigger em `allocations` rejeitando alocação fora
  da janela. Ver "Por que a regra não desce ao banco".
- **`devs.active`.** Continua morta e intocada. Ver "O que fazer com `active`".
- **Tabela `dev_availability` com N períodos** (entrou, saiu, voltou). Ver
  "Alternativas descartadas".
- **Ausências curtas.** Férias e afastamentos já são cartões de
  `tipo = 'ferias'` no quadro. Esta frente é sobre presença no time, não sobre
  ausência pontual.
- **Migração de dado.** Ninguém é preenchido retroativamente.
- **`AllocationDialog`, RLS, policies, grants.** Nada muda.

## Decisões

### A sprint precisa caber inteira na janela

Uma sprint fica habilitada quando está **inteiramente contida** na janela da
pessoa:

```
habilitada  ⟺  (available_from é nulo  ou  sprint.start_date >= available_from)
             e (available_to   é nulo  ou  sprint.end_date   <= available_to)
```

Consequência concreta: pessoa que entra no dia 10, com a sprint 26.3.1 indo de
01 a 15, **não** aparece na 26.3.1 — aparece a partir da 26.3.2.

Isso diverge do texto literal da issue ("a partir dessa data compreendida na
sprint de inicio"), que descreve sobreposição. A contenção total foi escolhida
deliberadamente: quem entra no meio de uma sprint não tem a sprint inteira para
trabalhar, e mostrar a célula colorida convida a alocar uma demanda de sprint
cheia para quem tem meia. A divergência deve ser registrada como comentário na
issue #2 antes de fechá-la.

### Janela opcional; vazio significa sem restrição

Ambas as colunas são anuláveis, e `NULL` desliga o lado correspondente da regra.
Toda pessoa já cadastrada nasce `NULL/NULL` e se comporta **exatamente como
hoje**. Sem backfill, sem data inventada, sem duas classes de registro. Quem
quiser a regra preenche.

Só a data de fim é anulável no discurso da issue ("opcionalmente data de fim"),
mas tornar a de início obrigatória exigiria backfill das pessoas existentes com
uma data que ninguém informou. As duas são opcionais.

### Cartões preexistentes fora da janela continuam visíveis

Encurtar a janela de alguém pode deixar cartões numa célula que passou a ser
indisponível. Nesse caso a célula fica cinza e sem "+ demanda", mas os cartões
**renderizam normalmente, abrem no diálogo e podem ser arrastados para fora**.

Dado nunca desaparece por mudança de configuração. O estado inconsistente fica
visível — cartão colorido sobre célula cinza — e é resolvível arrastando, que é
justamente a ação que se quer permitir.

### Por que a regra não desce ao banco

Um trigger em `allocations` rejeitando alocação fora da janela seria coerente
com a filosofia do resto do quadro, onde as FKs compostas e os triggers de
`20260810121000_board_project_constraints.sql` garantem que um cartão nunca
esteja em sprint de outro projeto.

A diferença é que projeto é imutável na prática e janela de disponibilidade
muda. Com o trigger, encurtar a janela de alguém transformaria todo cartão
preexistente fora dela em linha impossível de atualizar — inclusive para
arrastar para fora, que é a correção. O usuário ficaria travado justamente na
ação que resolve o problema, e a decisão acima ("continuam visíveis e
arrastáveis") seria contrariada pelo banco.

O `CHECK` de ordem das datas em `devs` fica, porque `available_to >=
available_from` é invariante de verdade: não depende de nenhuma outra linha.

### O que fazer com `active`

Nada, nesta frente. `devs.active` é um booleano sem data que nunca foi lido pela
UI. Ele *parece* relacionado, e é tentador resolver os dois de uma vez, mas são
duas decisões de produto distintas — "esta pessoa está no time hoje?" e "de
quando a quando esta pessoa esteve no time?" — e misturá-las no mesmo PR
esconde a segunda atrás da primeira. Merece issue própria: usar ou dropar.

## Arquitetura

### Banco — uma migration, duas colunas

```sql
ALTER TABLE public.devs
  ADD COLUMN available_from date,
  ADD COLUMN available_to   date,
  ADD CONSTRAINT devs_availability_order
    CHECK (available_to IS NULL OR available_from IS NULL OR available_to >= available_from);
```

Sem RLS nova: as policies de `devs`
(`devs_select_viewers`, `devs_insert_editors`, `devs_update_editors`,
`devs_delete_editors`) são por tabela e por papel, não por coluna. Os `GRANT`s
de tabela cobrem coluna nova automaticamente. Sem índice: a regra é avaliada no
cliente sobre a lista de pessoas já carregada, nunca em `WHERE`.

`src/integrations/supabase/types.ts` é editado à mão neste projeto — os dois
campos entram em `Row`, `Insert` e `Update` de `devs`.

### `src/lib/board.ts` — a regra isolada

O tipo `Dev` ganha `available_from: string | null` e
`available_to: string | null`, e o arquivo ganha duas funções puras:

```ts
export function isDevAvailableInSprint(
  dev: Pick<Dev, "available_from" | "available_to">,
  sprint: Pick<Sprint, "start_date" | "end_date">,
): boolean;

/** "de 10/08/26 a 30/09/26" · "a partir de 10/08/26" · "até 30/09/26" · null */
export function formatAvailability(
  dev: Pick<Dev, "available_from" | "available_to">,
): string | null;
```

Datas são comparadas como strings `YYYY-MM-DD`, sem `new Date()`. A ordem
lexicográfica desse formato é a ordem cronológica, e evitar `Date` evita o bug
de fuso que faz `new Date("2026-08-10")` virar 09/08 em `UTC-3` — o mesmo
cuidado que `formatRange` já toma ao fatiar a string.

Os parâmetros são `Pick<…>` e não `Dev`/`Sprint` inteiros: a função depende só
das quatro datas, e a assinatura estreita diz isso.

**Esta é a decisão de arquitetura que importa.** A regra é uma função pura em
`lib/`, não uma condicional no JSX, porque a issue #12 vai reescrever a grade
para formato Gantt (pessoas em linhas, sprints em colunas). Com a regra isolada,
o novo layout a reaproveita como está; embutida no `SprintRow`, ela seria
reescrita junto e provavelmente com semântica ligeiramente diferente.

### `src/components/DevDialog.tsx` — dois campos

Um bloco `grid grid-cols-2 gap-3` com "Disponível a partir de" e
"até (opcional)", ambos `<Input type="date">`, no mesmo molde dos campos de data
do `SprintDialog`. Dois estados novos, resetados no `useEffect` de abertura
junto com os existentes, e enviados no payload como `null` quando vazios.

`canSave` passa a exigir também que a janela não esteja invertida, com aviso
inline quando estiver. O `CHECK` do banco é rede de segurança, não a primeira
linha de defesa: o usuário não deve descobrir o erro por um toast de erro de
constraint.

### `src/components/BoardGrid.tsx` — a célula desabilitada

`SprintRow` já recebe `sprint` e itera sobre `devs`; para cada célula chama
`isDevAvailableInSprint(d, sprint)`. Quando falso:

| Aspecto | Comportamento |
|---|---|
| Fundo | esmaecido (`bg-muted/40`), `cursor-not-allowed` |
| Botão "+ demanda" | não renderizado |
| `onDragOver` | não marca `dragOver` — a célula não se destaca como alvo |
| `onDrop` | retorna cedo, sem chamar `onDrop` do pai |
| Cartões existentes | renderizam, abrem no diálogo, arrastáveis para fora |

O `TooltipContent` do cabeçalho da coluna, que hoje só repete `d.name`, passa a
mostrar também `formatAvailability(d)` quando houver janela.

Nenhuma query muda: `available_from`/`available_to` chegam no `select("*")` de
`devs` que já existe.

### Alcance

`BoardGrid` é o mesmo componente usado pela aba `/alocacoes` e pela rota
`/embed/alocacoes`. A mudança vale para as duas sem trabalho extra, e as duas
entram no roteiro de verificação.

## Alternativas descartadas

**Tabela `dev_availability` com N períodos por pessoa.** Modelaria
entrou → saiu → voltou e afastamentos longos como linhas separadas. É o modelo
mais fiel a longo prazo, mas custa tabela nova, RLS, CRUD próprio,
`jira_project` denormalizado por trigger e um join na grade. A issue pede
literalmente uma data de início e opcionalmente uma de fim, e ausências curtas
já são cartões `tipo = 'ferias'`. YAGNI: se o segundo período aparecer na
prática, a migração de duas colunas para tabela é direta.

**Reaproveitar `devs.active` como interruptor manual.** Resolveria "sumiu do
time" com uma linha de código, mas não resolve o pedido — que é a grade acender
e apagar **automaticamente na data**, sem ninguém lembrar de clicar.

**Esconder a pessoa da grade quando indisponível em todo o calendário
visível.** Faria a coluna aparecer e desaparecer conforme o intervalo de sprints
cadastradas, o que é confuso e assimétrico com o resto do quadro. Cinza é mais
honesto: a pessoa existe, aquele período é que não é dela.

## Verificação

O projeto não tem test runner — `package.json` traz apenas `dev`, `build`,
`build:dev`, `preview`, `lint`, `format` — e esta frente **não introduz um**.
A verificação é estática mais roteiro manual.

Estática: `npx prettier --write`, `npx eslint` e `npx tsc --noEmit` sobre os
arquivos tocados, mais `npm run build`.

Roteiro manual, na aba `/alocacoes` e repetido em `/embed/alocacoes`:

1. Pessoa sem janela: grade idêntica à de hoje, todas as células ativas.
2. Pessoa com `available_from` no meio do calendário: sprints anteriores cinzas,
   sem "+ demanda"; a sprint que contém a data também cinza (contenção total);
   a seguinte ativa.
3. Pessoa com `available_to`: sprints posteriores cinzas pela mesma regra.
4. Janela invertida no diálogo: salvar bloqueado, aviso inline.
5. Cartão preexistente em célula que virou cinza: visível, abre no diálogo,
   arrasta para fora; a célula cinza recusa drop e não destaca no `dragOver`.
6. Tooltip do cabeçalho mostra o período de quem tem janela e só o nome de quem
   não tem.
7. Papel `leitor` (`canEdit === false`): células cinzas continuam cinzas e
   nenhum botão de ação aparece, como já acontece hoje.
