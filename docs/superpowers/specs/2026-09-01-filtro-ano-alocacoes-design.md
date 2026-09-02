# Filtro de ano no board de Alocações

**Data:** 2026-09-01
**Status:** aprovado para planejamento
**Issue:** [#35 — Board de Alocações: agrupar sprints por ano e quarter (Q1–Q4)](https://github.com/dbizfreitas/agile-assignment/issues/35)
**Origem:** brainstorming em sessão de planejamento com Diego Freitas (01/09/2026)

## Problema

O board de Alocações (`src/components/BoardGrid.tsx`) renderiza todas as sprints
do projeto como uma lista vertical única, ordenada só por `start_date`/`position`
(query `.from("sprints")` nas linhas 102-110, `sprints.map(...)` na linha 355).
Não existe nenhum jeito de restringir a visão a um período — quem quer ver só um
ano de planejamento precisa rolar a lista inteira.

Cada `SprintRow` (a partir da linha 416) já mostra um badge com `sprint.quarter`
(linhas 448-451), preenchido como texto livre no `SprintDialog.tsx:118-125`. Isso
não muda nesta frente.

## Objetivo

Um dropdown de ano na toolbar do board, ao lado de onde ficam os botões de ação
("Times" / "Sprint" / "Pessoa"), filtra as sprints exibidas (e, por consequência,
as alocações, que herdam o período da sprint via `sprint_id`) para as que caem no
ano escolhido.

## Escopo

**Dentro:** o dropdown de ano; a derivação do ano de cada sprint a partir de
`start_date`; o filtro client-side da lista de sprints exibidas; uma mensagem
dedicada para "ano sem sprint cadastrada".

**Fora (decidido explicitamente):**

- **Seções agrupadas por ano e quarter.** A issue original pedia cabeçalhos
  visuais agrupando sprints por ano → quarter. Ficou só o filtro de ano; `quarter`
  continua sendo um badge solto por linha, exatamente como hoje.
- **Regra para sprint que atravessa virada de quarter/ano.** Não há grouping por
  quarter, logo não há ambiguidade a resolver aqui. O ano da sprint é sempre o
  ano do `start_date`, mesmo quando ela termina no ano seguinte.
- **Mudança na coluna `quarter`.** Continua texto livre, editável no
  `SprintDialog`, sem nenhuma derivação automática.
- **Persistência do ano escolhido (URL, localStorage).** Reseta para o ano
  corrente a cada carregamento, igual aos filtros de busca/status/tipo que já
  existem no board.
- **Migration.** Nenhuma coluna nova; o ano é sempre calculado no cliente a
  partir de `start_date`, que já existe.

## Decisões

### Ano da sprint deriva do `start_date`, não de `quarter`

O ano exibido/filtrado de uma sprint é sempre o ano do seu `start_date`. Uma
sprint que começa em dezembro de 2026 e termina em janeiro de 2027 é tratada como
2026. Decisão explícita do usuário — sem cálculo de "quarter com mais dias
sobrepostos" nem qualquer outra heurística.

### Diverge do texto literal da issue #35

A issue pedia agrupamento visual por ano **e** quarter, com uma regra documentada
e testada para sprint na virada. O que foi combinado é mais enxuto: só o filtro
de ano, `quarter` intocado. Essa divergência deve virar comentário na issue #35
antes de fechá-la, registrando que o agrupamento por quarter foi conscientemente
descartado nesta rodada.

### Lista de anos: distintos entre as sprints, mais o ano corrente sempre presente

O dropdown lista todo ano que aparece em pelo menos uma sprint do projeto, **e
sempre inclui o ano corrente do relógio** mesmo que nenhuma sprint caia nele —
senão o valor padrão (ano corrente) poderia não ter opção correspondente na
lista.

### Ano padrão: o ano corrente do relógio, não o da sprint mais próxima

Ao abrir o board, o filtro começa no ano civil de hoje
(`new Date().getFullYear()`). Foi uma escolha deliberada em vez de calcular o ano
da sprint vigente — mais simples e previsível, ao custo de abrir num ano vazio se
o calendário de sprints estiver desalinhado do ano civil (coberto pela mensagem
de "ano sem sprint").

### Visível para leitor e editor

O dropdown não depende de `canEdit`. Ele é posicionado no lugar em que ficaria
"ao lado do botão Pessoa", mas o controle em si aparece tanto para quem edita
quanto para quem só visualiza — filtrar por ano é uma ação de visualização, não
de edição, e os outros filtros do board (busca, status, tipo) já seguem essa
mesma regra.

### Ano sem sprint cadastrada: mensagem dedicada, não o `EmptyState` geral

O `EmptyState` atual (`BoardGrid.tsx:635-663`) cobre "projeto inteiro sem sprint
ou sem pessoa", com CTAs para os dois cadastros. O caso novo é mais estreito: o
projeto TEM sprints e pessoas, só não há nenhuma sprint no ano escolhido. Vira
uma mensagem própria ("Nenhuma sprint cadastrada em {ano}"), com o mesmo botão
"Adicionar sprint" quando `canEdit` — sem duplicar o CTA de pessoa, que não faz
sentido aqui.

## Arquitetura

### `src/lib/board.ts` — `getSprintYear`

```ts
/**
 * Ano da sprint = ano do início, por fatiamento de string — mesmo cuidado de
 * `formatDate`: `new Date("2026-08-15")` é meia-noite UTC e pode virar o dia
 * (e o ano, na virada) anterior em fusos negativos.
 */
export function getSprintYear(sprint: Pick<Sprint, "start_date">): number {
  return Number(sprint.start_date.slice(0, 4));
}
```

Recebe `Pick<Sprint, "start_date">` e não `Sprint` inteira, mesmo padrão de
`isDevAvailableInSprint` — a função depende só do campo que usa.

### `src/components/BoardGrid.tsx` — estado, filtro e dropdown

- `years` (`useMemo` sobre `sprints`): `Array.from(new Set([...sprints.map(getSprintYear), new Date().getFullYear()])).sort()`.
- `yearFilter`, `useState<number>(() => new Date().getFullYear())`.
- `sprintsInYear` (`useMemo`): `sprints.filter((s) => getSprintYear(s) === yearFilter)`. Substitui `sprints` nas linhas que hoje montam `gridTemplateRows` (303-309) e no `.map(SprintRow)` (355) — `sprintsWithCards` continua calculado sobre todas as `allocations` do projeto, sem mudança, e passa a ser consultado só para as sprints que sobrarem no ano filtrado.
- A condição que decide o `EmptyState` de projeto inteiro (linha 284,
  `sprints.length === 0 || devs.length === 0`) continua usando `sprints`
  **não filtrado**. Um novo ramo, `sprintsInYear.length === 0`, mostra a
  mensagem de "ano sem sprint" no lugar da grade.
- Nenhuma query muda — `sprintsQ`/`allocQ` continuam carregando todas as sprints
  e alocações do projeto, como hoje; o filtro atua só sobre o array já
  carregado.

### UI — `Select` do design system

Mesmo padrão do `ProjectSelect.tsx` (que já usa `ui/select.tsx` com trigger
compacto): um `<Select>` com `SelectItem` por ano de `years`, posicionado na
toolbar logo após o bloco `canEdit ? <>...</> : null` das linhas 215-239, fora
dele — para renderizar independente de `canEdit`.

## Alternativas descartadas

**Persistir o ano na URL (`?ano=`).** Daria link direto para "Alocações de
2025" e sobreviveria a F5, no mesmo espírito do `?project=` que
`/embed/alocacoes` já usa. Descartada por ora: nenhum outro filtro do board
(busca, status, tipo) sobrevive a reload hoje, e persistir só o ano criaria uma
assimetria de comportamento sem pedido explícito para isso. Se a necessidade de
compartilhar/fixar uma visão de ano aparecer (ex.: embed institucional fixo num
ano), a migração de `useState` para `validateSearch` é direta.

**Quarter pelo dia com mais sobreposição.** Calcular em qual quarter uma sprint
que atravessa a virada tem mais dias caídos. Fica sem objeto nesta frente, já
que não há agrupamento por quarter — só registrado aqui porque foi cogitado e
descartado explicitamente durante o brainstorming.

**Seções visuais agrupadas por ano → quarter (o pedido literal da issue).**
Escopo reduzido para just o filtro de ano a pedido do usuário; ver "Diverge do
texto literal da issue #35" acima.

## Verificação

O projeto não tem test runner (`package.json` só traz `dev`, `build`,
`build:dev`, `preview`, `lint`, `format`) — verificação estática mais roteiro
manual, como as frentes anteriores.

Estática: `npx prettier --write`, `npx eslint` e `npx tsc --noEmit` sobre os
arquivos tocados, mais `npm run build`.

Roteiro manual, em `/alocacoes` e repetido em `/embed/alocacoes`:

1. Abrir o board: dropdown mostra o ano corrente selecionado; sprints exibidas
   são só as desse ano.
2. Trocar de ano no dropdown: a grade troca para as sprints daquele ano; as
   alocações de cada sprint continuam corretas nas células (nenhuma "some" nem
   aparece na sprint errada).
3. Ano sem nenhuma sprint: mensagem "Nenhuma sprint cadastrada em {ano}" no
   lugar da grade, com botão "Adicionar sprint" quando `canEdit`; sem esse botão
   para papel leitor.
4. Projeto sem nenhuma sprint/pessoa em lugar nenhum: `EmptyState` geral
   continua aparecendo como hoje, não a mensagem de "ano sem sprint".
5. Sprint com `start_date` em um ano e `end_date` no ano seguinte: aparece no
   ano do `start_date`, não no do `end_date`.
6. Badge de `quarter` e campo do `SprintDialog`: idênticos ao comportamento
   atual, sem nenhuma mudança visual ou de validação.
7. Papel leitor (`canEdit === false`): dropdown de ano aparece e funciona igual,
   sem os botões de edição ao lado.
