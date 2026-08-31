# CRUD de Times no Quadro de Alocação — Design

**Issue:** [dbizfreitas/agile-assignment#14](https://github.com/dbizfreitas/agile-assignment/issues/14)
**Data:** 2026-08-30

## Problema

Um time só pode ser **criado**, e só de raspão: dentro do `DevDialog`, pela opção `+ Criar novo time` do seletor de time. Depois disso o registro é permanente — não há como renomear, trocar a cor, reordenar ou excluir. Erro de digitação no nome de um time vira dado permanente no cabeçalho de todas as colunas daquele time.

`teams` não é uma tabela qualquer: é a **raiz do eixo de colunas** do quadro. `position` ordena as colunas de pessoas ([BoardGrid.tsx:154](../../../src/components/BoardGrid.tsx#L154)), `color` pinta o avatar e a borda inferior do cabeçalho, e `jira_project` é de onde `devs` e `allocations` derivam o projeto por trigger.

## Escopo

Criar, editar (nome, cor, posição) e excluir times, com **realocação explícita** das pessoas na exclusão. Fora de escopo: mover um time entre projetos (proibido pelas FKs compostas — ver "Invariante de projeto"), drag-and-drop de reordenação, gestão de times em `/admin`.

## Decisão central: a exclusão é uma RPC, não duas chamadas

A issue oferece duas saídas para excluir um time com pessoas — bloquear, ou realocar. **Escolhemos realocar.** Bloquear é o que o banco já faz hoje (`devs_team_id_fkey` é `ON DELETE RESTRICT`) e deixaria o caso real — apagar um time legado com oito pessoas — como oito visitas ao `DevDialog`.

Realocar exige mover pessoas e apagar o time **na mesma transação**. `supabase-js` não abre transação: `await update(devs)` seguido de `await delete(teams)` pode deixar as pessoas movidas e o time vivo se a segunda chamada falhar, e nada na tela avisaria — o quadro simplesmente passaria a mostrar um time vazio com gente que já esteve nele. Num eixo raiz isso é estado silenciosamente errado.

Daí `public.delete_team(_team uuid, _target uuid)`: `SECURITY DEFINER`, uma transação, e a invariante de projeto verificada **no servidor** em vez de apenas na tela.

## Invariante de projeto

`teams` é a raiz: `jira_project` é `NOT NULL`, sem `DEFAULT`, e `devs`/`allocations` o derivam por trigger. As FKs compostas (`devs_team_project_fkey`, `allocations_dev_project_fkey`) recusam qualquer combinação incoerente.

A invariante é fechada em três camadas, e **a de cima não é uma validação**:

1. **Tela** — o formulário de edição não tem campo de projeto. Não há o que preencher errado.
2. **RPC** — `delete_team` recusa (`W4006`) um destino cujo `jira_project` difere o da origem, mesmo que a chamada venha de fora da tela.
3. **Banco** — as FKs compostas continuam sendo a última palavra.

O `UPDATE` de nome/cor/posição nunca inclui `jira_project` no payload. Isso é ausência de campo, não filtro: um payload sem a coluna não pode movê-la.

## A RPC

```
public.delete_team(_team uuid, _target uuid DEFAULT NULL) RETURNS void
```

Sequência:

1. `auth.uid()` nulo → `W4001`. `private.can_edit_board(auth.uid())` falso → `W4002`.
2. Trava `teams` para `id IN (_team, _target)` **com `ORDER BY id`**. A ordem importa: duas exclusões simultâneas cruzadas (A→B e B→A) travariam em ordem oposta e produziriam deadlock.
3. Time inexistente → `W4003`.
4. Conta as pessoas do time.
5. **Se há pessoas:** `_target` nulo → `W4004`; `_target = _team` → `W4005`; destino inexistente → `W4003`; destino de outro projeto → `W4006`. Caso contrário, `UPDATE devs SET team_id = _target WHERE team_id = _team`.
6. `DELETE FROM teams WHERE id = _team`.
7. Renumera `position` das pessoas do time de destino e dos times restantes do projeto.

**Por que `SECURITY DEFINER`:** segue o padrão de `delete_platform_user` e dos helpers em `private`. A autorização não é herdada — é verificada explicitamente no passo 1 e a função é chamada com o client do próprio usuário, para `auth.uid()` resolver o ator. As policies `teams_delete_editors` / `devs_update_editors` permanecem, cobrindo o caminho direto.

**Por que renumerar (passo 7):** `devs` ordena por `(posição do time, position da pessoa)`. Pessoas realocadas chegam ao destino com as `position` que tinham na origem, colidindo com as de lá — duas pessoas com `position = 0` ficam em ordem indefinida, e a coluna dança entre recargas. Renumerar por `row_number()` torna a ordem determinística. A exclusão também abre um buraco na sequência de `position` dos times; renumerar mantém a próxima inserção (`position: teams.length`) consistente.

O `UPDATE` de `devs` redispara `devs_set_project`, que recalcula `jira_project` a partir do novo time. Como origem e destino são do mesmo projeto, o valor não muda — o trigger é inofensivo aqui, e é justamente ele que impediria a realocação cross-projeto de produzir uma linha coerente às escondidas.

`allocations` não é tocada: os cartões seguem a **pessoa**, não o time, e o `jira_project` deles continua correto.

## Códigos de erro

`W2xxx` é a faixa do RBAC, `W3001` a dos triggers de derivação. Times ficam com **`W4xxx`**:

| Código | Situação | Mensagem pt-BR |
|---|---|---|
| `W4001` | sessão sem `auth.uid()` | Sessão expirada. Entre novamente. |
| `W4002` | usuário sem permissão de edição | Você não tem permissão para excluir times. |
| `W4003` | time (origem ou destino) inexistente | Time não encontrado. Recarregue a página. |
| `W4004` | time com pessoas e sem destino | Escolha para qual time as pessoas devem ir. |
| `W4005` | destino igual à origem | O time de destino precisa ser diferente. |
| `W4006` | destino em outro projeto | O time de destino precisa ser do mesmo projeto. |

`W4004`, `W4005` e `W4006` são inalcançáveis pela tela (o `Select` só oferece os outros times do projeto, e o botão fica desabilitado sem destino). Existem porque a RPC é `SECURITY DEFINER` e precisa se defender de um cliente desatualizado ou de uma chamada direta. `boardErrorMessage` também passa a traduzir o `23503` de `devs_team_id_fkey`, para o caminho de exclusão direta via `.from("teams").delete()` fora da RPC.

## Superfície de UI

Botão `Times` na toolbar do quadro, ao lado de `Sprint` e `Pessoa`, sob a mesma guarda `canEdit`. Abre `TeamsDialog` — **um** diálogo, sem aninhamento, com a lista de times do projeto atual.

**Por que não dentro do `DevDialog`:** aquele diálogo é sobre *uma pessoa*. Pendurar exclusão e reordenação de times no seletor o transformaria em duas telas empilhadas com dois assuntos e dois níveis de destrutividade. O `+ Criar novo time` de lá **permanece** — criar um time no fluxo de cadastrar alguém é conveniência legítima, e some se o `TeamsDialog` virar o único caminho.

Cada linha da lista: bolinha de cor, nome, contagem de pessoas, e três ações — `↑`/`↓` (reordenar), lápis (editar) e lixeira (excluir).

- **Editar** troca a linha por um formulário no lugar: `Input` de nome, a paleta `TEAM_COLORS`, `Salvar`/`Cancelar`. Sem diálogo dentro de diálogo.
- **Novo time** é o mesmo formulário, no fim da lista.
- **Reordenar** é `↑`/`↓` trocando `position` com o vizinho — não drag-and-drop. Times são poucos (unidades), as setas são acessíveis por teclado de graça, e o DnD do quadro hoje é dos cartões: adicionar um segundo idioma de arraste para uma lista de cinco itens não se paga.
- **Excluir** abre um `AlertDialog` (mesmo padrão de [UserTable.tsx:285](../../../src/components/admin/UserTable.tsx#L285)), com confirmação **simples, não nominal**: nenhum dado é destruído além do próprio time — as pessoas mudam de time e os cartões nem são tocados. A confirmação nominal da exclusão de usuário existe porque lá a operação é irreversível em `auth.users`.

### O diálogo de exclusão

- **Time sem pessoas:** só a confirmação. A RPC é chamada com `_target = null`.
- **Time com pessoas:** um `Select` obrigatório — *"Mover as N pessoas para:"* — listando os outros times do projeto por `position`. Pré-selecionado: o time chamado `Sem time` do projeto, se existir; senão o primeiro da lista. `Excluir` fica desabilitado sem destino.
- **Time com pessoas e nenhum outro time no projeto:** exclusão bloqueada, com o motivo à vista — *"Este é o único time do projeto e tem N pessoas. Crie outro time para movê-las antes de excluir."* Criar um `Sem time` automático nos outros projetos foi descartado: `Sem time` só existe no PIM por acidente do backfill ([board_project_column.sql:39](../../../supabase/migrations/20260810120000_board_project_column.sql#L39)), e semear um time vazio em três projetos para cobrir um caso de borda é dívida.

## Cache

`TeamsDialog` reusa a chave `["board", "teams", project]` — a **mesma** do `BoardGrid` e do `DevDialog`. Chaves divergentes fariam os três componentes brigarem pela mesma entrada de cache; o comentário em [DevDialog.tsx:57](../../../src/components/DevDialog.tsx#L57) já registra essa decisão.

Invalidação por operação:

| Operação | Invalida |
|---|---|
| criar / editar / reordenar | `["board", "teams"]` |
| excluir | `["board", "teams"]` e `["board", "devs"]` |

A exclusão mexe em `devs.team_id` e em `devs.position`, daí a segunda chave. Como as chaves são invalidadas pelo prefixo (sem o projeto), a mudança de cor ou nome reflete no cabeçalho das colunas assim que a query refaz — que é o critério de aceite explícito da issue.

## Arquivos

| Arquivo | O quê |
|---|---|
| `supabase/migrations/20260830120000_team_delete_rpc.sql` | **Criar.** `public.delete_team` + `REVOKE`/`GRANT`. |
| `supabase/tests/team_delete_smoke.sql` | **Criar.** Suíte em `BEGIN…ROLLBACK`. |
| `src/integrations/supabase/types.ts` | **Modificar.** `Functions.delete_team`. |
| `src/lib/board-errors.ts` | **Modificar.** `W4001`–`W4006` e `devs_team_id_fkey`. |
| `src/components/TeamsDialog.tsx` | **Criar.** Lista, formulário, reordenação, exclusão. |
| `src/components/BoardGrid.tsx` | **Modificar.** Botão `Times` e estado do diálogo. |

Nenhuma tabela nova, nenhuma coluna nova, nenhuma policy nova.

## Verificação

O repositório não tem test runner (`package.json` traz só `dev`, `build`, `build:dev`, `preview`, `lint`, `format`) e esta demanda não introduz um.

- **Banco:** `supabase/tests/team_delete_smoke.sql`, em `BEGIN…ROLLBACK`, sem resíduo — exclusão de time vazio; exclusão com realocação; `W4004` sem destino; `W4006` com destino de outro projeto; `W4002` para `viewer`; renumeração de `position` conferida.
- **Código:** `prettier` → `eslint` → `tsc --noEmit`, sempre nessa ordem e **só nos arquivos tocados** (o checkout usa `core.autocrlf=true`; um `npm run lint` sem escopo reprova arquivos alheios por CRLF).
- **UI:** roteiro manual no `/alocacoes` — renomear e ver o cabeçalho mudar, trocar cor, reordenar, excluir vazio, excluir com realocação e conferir que as pessoas apareceram sob o time de destino.

## Restrições de processo

- Migrations são aplicadas **manualmente** pelo usuário no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr`. A ferramenta MCP `query_database` do Lovable **não** serve: aponta para outro banco (confirmado na issue #23). O agente cria o `.sql`, pede a aplicação e **aguarda confirmação explícita** antes de qualquer passo dependente.
- `src/integrations/supabase/types.ts` é editado à mão, como já se fez para `invitations`, `role_audit_log` e `delete_platform_user`.
- Sem `git push` — o repositório sincroniza com o Lovable e o push é decisão do usuário.
- Sem reescrita de histórico (`rebase`, `amend`, `squash` de commits publicados) — restrição do `AGENTS.md`.
- **Não commitar `src/routeTree.gen.ts` nem `src/components/compromisso/StatsCards.tsx`** — chegam modificados no working tree e não são desta frente. Todo `git add` é por caminho explícito, nunca `git add -A`.
- Mensagens de commit em ASCII, seguindo o padrão dos commits recentes.
- UI em pt-BR, com acentuação correta.
