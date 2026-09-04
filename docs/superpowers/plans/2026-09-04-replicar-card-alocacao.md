# Replicar card de alocação para a próxima sprint da mesma pessoa — Plano de implementação

> **Para execução agêntica:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam sintaxe de checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** Dar ao quadro de Alocações (`src/components/BoardGrid.tsx`) uma ação de "replicar" que cria uma cópia de um card existente na próxima sprint sequencial cadastrada, mantendo a mesma pessoa, acionável por dois gatilhos (ícone no hover do card e botão no `AllocationDialog`) que compartilham a mesma mutation e as mesmas regras de bloqueio.

**Arquitetura:** Toda a lógica nova (resolver a próxima sprint, checar disponibilidade, montar o payload, e a mutation de insert) fica centralizada em `BoardGrid.tsx`, que já é o dono de `sprintsQ` e da mutation `move`. O `AllocationDialog` recebe a função de replicar e o motivo de bloqueio via props — ele não faz sua própria query nem duplica a resolução de sprint. Uma função pura nova em `src/lib/board.ts` (`resolveNextSprint`) calcula a próxima sprint a partir da lista já ordenada, para ser testável isoladamente da UI e reutilizável pelos dois gatilhos.

**Tech Stack:** React 19, TanStack Query v5 (`useMutation`/`useQueryClient`), Supabase JS client, Tailwind, lucide-react (ícones), sonner (toasts).

## Restrições Globais

- Escopo estreito: mesma pessoa, próxima sprint sequencial. Não implementar seleção de pessoa/sprint diferente.
- Os dois gatilhos (ícone de hover e botão do diálogo) DEVEM chamar a mesma mutation e a mesma função de resolução de próxima sprint — nenhuma lógica duplicada entre eles.
- A réplica nasce e é salva no banco no mesmo gesto — nunca abre o `AllocationDialog` para revisão antes de gravar.
- A resolução de "próxima sprint" usa a lista `sprints` completa (cache de `["board", "sprints", project]`), nunca `sprintsInYear` — a próxima sprint pode cair no ano seguinte.
- Bloqueios (sem próxima sprint / pessoa fora da janela de disponibilidade) nunca inserem nada no banco; sempre comunicam o motivo ao usuário (toast de erro no ícone, texto de motivo visível no botão do diálogo).
- Não há framework de testes automatizados configurado neste projeto (sem `vitest`/`jest`, sem script `test` em `package.json`). A verificação de cada tarefa é manual, via dev server (`npm run dev` / `vite dev`) e checagem visual/funcional no navegador, exceto a função pura `resolveNextSprint`, que é verificável com um script Node ad-hoc descartável.
- Sem migração de banco: nenhuma coluna nova é necessária. `jira_project` continua resolvido pelo trigger existente, nunca enviado no payload.
- Não introduzir abstrações além do pedido (ex.: não criar sistema genérico de "duplicar qualquer entidade").
- Baseline conhecida deste worktree: `npm run build` passa limpo. `npm run lint` já falha na baseline (ANTES de qualquer mudança desta feature) com milhares de erros `prettier/prettier: Delete '␍'` — são finais de linha CRLF introduzidos pelo checkout local (`core.autocrlf=true` no Windows), não um problema do código-fonte versionado (que usa LF puro). Não é responsabilidade deste plano corrigir isso em arquivos não tocados pela feature.

---

## Mapa de arquivos

- **Modificar `src/lib/board.ts`**: adicionar `resolveNextSprint(sprints, currentSprintId)`, função pura que devolve a próxima sprint sequencial ou `null`.
- **Modificar `src/components/BoardGrid.tsx`**: adicionar a mutation `replicate` (insert), a função `buildReplicaBlockReason` (calcula o motivo de bloqueio, se houver), conectar o ícone de replicar no `AllocationChip`, e passar as novas props para `AllocationDialog`.
- **Modificar `src/components/AllocationDialog.tsx`**: adicionar o botão "Replicar na próxima sprint" no rodapé, a detecção de formulário sujo, e receber a função/motivo de replicar via props.

Nenhum arquivo novo é necessário — a issue é uma extensão pontual de um componente e um diálogo já existentes, e `src/lib/board.ts` já concentra as funções puras do quadro.

---

### Tarefa 1: `resolveNextSprint` em `src/lib/board.ts`

**Arquivos:**
- Modificar: `src/lib/board.ts` (adicionar função no final do arquivo, após `TEAM_COLORS`)
- Verificação: script Node ad-hoc descartável (não fica no repositório)

**Interfaces:**
- Consome: nada de tarefas anteriores (é a primeira tarefa).
- Produz: `resolveNextSprint(sprints: Sprint[], currentSprintId: string): Sprint | null` — usado pela Tarefa 2 (mutation `replicate` em `BoardGrid.tsx`).

A lista `sprints` chega **já ordenada** por `order("start_date").order("position")` (é como `sprintsQ` busca em `BoardGrid.tsx`). A função assume essa ordem e não reordena — ela só localiza o índice da sprint atual e devolve a seguinte, ou `null` se a atual for a última ou não for encontrada.

- [ ] **Passo 1: Escrever a função**

Adicionar ao final de `src/lib/board.ts`:

```typescript
/**
 * Próxima sprint sequencial após `currentSprintId`, na MESMA ordem que
 * `sprintsQ` já usa para montar as linhas do quadro (`order("start_date")
 * .order("position")`). Recebe a lista completa, nunca filtrada por ano — a
 * próxima sprint pode cair no ano seguinte, e o filtro de ano é só de
 * visualização (issue #42).
 *
 * `null` quando a sprint atual é a última cadastrada, ou quando não é
 * encontrada na lista (card órfão de uma sprint já excluída).
 */
export function resolveNextSprint(sprints: Sprint[], currentSprintId: string): Sprint | null {
  const index = sprints.findIndex((s) => s.id === currentSprintId);
  if (index === -1) return null;
  return sprints[index + 1] ?? null;
}
```

- [ ] **Passo 2: Verificar manualmente com um script ad-hoc**

Criar um arquivo temporário `scratch-resolve-next-sprint.mjs` na raiz do projeto (fora do controle de versão — apagar ao final do passo) com este conteúdo:

```javascript
function resolveNextSprint(sprints, currentSprintId) {
  const index = sprints.findIndex((s) => s.id === currentSprintId);
  if (index === -1) return null;
  return sprints[index + 1] ?? null;
}

const sprints = [
  { id: "a", code: "26.13" },
  { id: "b", code: "26.14" },
  { id: "c", code: "26.15" },
];

console.assert(resolveNextSprint(sprints, "a")?.code === "26.14", "caso meio: falhou");
console.assert(resolveNextSprint(sprints, "c") === null, "última sprint: falhou");
console.assert(resolveNextSprint(sprints, "x") === null, "sprint não encontrada: falhou");
console.assert(resolveNextSprint([], "a") === null, "lista vazia: falhou");
console.log("Todos os casos passaram.");
```

Rodar:

```bash
node scratch-resolve-next-sprint.mjs
```

Esperado: imprime `Todos os casos passaram.` sem nenhuma linha de `Assertion failed`.

Depois de confirmar, apagar o arquivo:

```bash
rm scratch-resolve-next-sprint.mjs
```

- [ ] **Passo 3: Commit**

```bash
git add src/lib/board.ts
git commit -m "feat(board): adiciona resolveNextSprint para localizar a sprint sequencial seguinte"
```

---

### Tarefa 2: Mutation `replicate` e resolução de bloqueio em `BoardGrid.tsx`

**Arquivos:**
- Modificar: `src/components/BoardGrid.tsx:149-161` (logo após a mutation `move`)

**Interfaces:**
- Consome: `resolveNextSprint` (Tarefa 1, `@/lib/board`), `isDevAvailableInSprint` (já importado), tipos `Allocation`, `Dev`, `Sprint` (já importados).
- Produz:
  - `replicate: UseMutationResult<...>` — mutation que insere a réplica. Chamada como `replicate.mutate(allocation)`, onde `allocation: Allocation`.
  - `buildReplicaBlockReason(allocation: Allocation): string | null` — função que devolve o motivo de bloqueio (string, para exibir) ou `null` se a replicação é permitida. Usada pela Tarefa 3 (ícone no `AllocationChip`) e pela Tarefa 4 (botão no `AllocationDialog`, via prop).

Esta tarefa **não** mexe em JSX ainda — só adiciona a lógica de dados. A ligação com a UI (ícone e botão) vem nas Tarefas 3 e 4.

- [ ] **Passo 1: Adicionar `buildReplicaBlockReason` e a mutation `replicate`**

Em `src/components/BoardGrid.tsx`, logo depois do bloco da mutation `move` (linha 161, após o fechamento de `});`), adicionar:

```typescript
  // Motivo de bloqueio da replicação, ou `null` se pode replicar. Compartilhado
  // pelos dois gatilhos (ícone de hover e botão do diálogo) — nenhum dos dois
  // reimplementa esta checagem. Usa `sprints` (lista completa, sem filtro de
  // ano): a próxima sprint pode cair no ano seguinte.
  const buildReplicaBlockReason = (allocation: Allocation): string | null => {
    const nextSprint = resolveNextSprint(sprints, allocation.sprint_id);
    if (!nextSprint) {
      const current = sprints.find((s) => s.id === allocation.sprint_id);
      return `Não há sprint cadastrada depois de ${current?.code ?? "atual"}.`;
    }
    const dev = devs.find((d) => d.id === allocation.dev_id);
    if (dev && !isDevAvailableInSprint(dev, nextSprint)) {
      return `${dev.name} está fora da janela de disponibilidade em ${nextSprint.code}.`;
    }
    return null;
  };

  // Insere uma cópia do card na próxima sprint sequencial, mesma pessoa.
  // `jira_project` fica de fora do payload de propósito: o trigger do banco
  // recalcula a partir de `dev_id`, mesmo contrato do insert em
  // AllocationDialog. `position` vai para o final da célula de destino —
  // maior posição já usada ali, mais 1 (ou 0 se a célula estiver vazia).
  const replicate = useMutation({
    mutationFn: async (allocation: Allocation) => {
      const blockReason = buildReplicaBlockReason(allocation);
      if (blockReason) throw new Error(blockReason);
      const nextSprint = resolveNextSprint(sprints, allocation.sprint_id)!;
      const siblingPositions = allocations
        .filter((a) => a.sprint_id === nextSprint.id && a.dev_id === allocation.dev_id)
        .map((a) => a.position);
      const position = siblingPositions.length > 0 ? Math.max(...siblingPositions) + 1 : 0;
      const { error } = await supabase.from("allocations").insert({
        sprint_id: nextSprint.id,
        dev_id: allocation.dev_id,
        title: allocation.title,
        tickets: allocation.tickets,
        status: allocation.status,
        tipo: allocation.tipo,
        notes: allocation.notes,
        position,
      });
      if (error) throw error;
      return nextSprint;
    },
    onSuccess: (nextSprint) => {
      qc.invalidateQueries({ queryKey: ["board", "allocations"] });
      toast.success(`Replicado em ${nextSprint.code}.`);
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
  });
```

Esta função precisa vir **depois** da declaração de `sprints`, `devs` e `allocations` (que hoje são calculados nas linhas 163-182 do arquivo, abaixo da mutation `move`). Reordenar: mover o bloco da mutation `move` e o novo bloco de `replicate`/`buildReplicaBlockReason` para **depois** da linha `const allocations = allocQ.data ?? [];` (atualmente linha 182), já que ambos dependem de `sprints`, `devs` ou `allocations`. `move` não depende de nenhum dos três, mas fica mais simples manter as duas mutations juntas — mover o bloco inteiro (linhas 149-161 originais) para logo antes de `buildReplicaBlockReason`.

Import novo necessário no topo do arquivo — adicionar `resolveNextSprint` à lista já importada de `@/lib/board` (linha 15-35):

```typescript
import {
  accentClassFor,
  chipClassFor,
  formatAvailability,
  formatRange,
  getSprintYear,
  isDevAvailableInSprint,
  resolveNextSprint,
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

- [ ] **Passo 2: Verificar manualmente**

Subir o dev server:

```bash
npm run dev
```

Abrir o quadro de Alocações no navegador. Como nenhuma UI nova foi conectada ainda, o comportamento visível deve ser **idêntico** ao de antes — o objetivo deste passo é só confirmar que a página carrega sem erro de console (import quebrado, erro de tipo em runtime) depois da mudança. Abrir o console do navegador e confirmar ausência de erros novos.

- [ ] **Passo 3: Commit**

```bash
git add src/components/BoardGrid.tsx
git commit -m "feat(board): adiciona mutation replicate e resolução de bloqueio de replicação"
```

---

### Tarefa 3: Ícone de replicar no hover do `AllocationChip`

**Arquivos:**
- Modificar: `src/components/BoardGrid.tsx` (função `AllocationChip`, linhas 604-663, e o local onde ela é instanciada dentro de `SprintRow`, linha 546-553)

**Interfaces:**
- Consome: `replicate.mutate` e `buildReplicaBlockReason` (Tarefa 2), ícone `Copy` de `lucide-react`.
- Produz: nada consumido por tarefas futuras — esta tarefa fecha o gatilho do ícone.

- [ ] **Passo 1: Importar o ícone `Copy`**

Em `src/components/BoardGrid.tsx`, linha 14, adicionar `Copy` à lista de ícones já importados de `lucide-react`:

```typescript
import { CalendarPlus, Copy, ExternalLink, Pencil, Plus, Search, UserPlus, Users } from "lucide-react";
```

- [ ] **Passo 2: Passar `onReplicate` e `canEdit` para `AllocationChip` via `SprintRow`**

`AllocationChip` já recebe `canEdit` (linha 614). Adicionar a prop `onReplicate` na assinatura da função (linha 604-616):

```typescript
function AllocationChip({
  allocation,
  dimmed,
  allowWrap,
  canEdit,
  onEdit,
  onReplicate,
}: {
  allocation: Allocation;
  dimmed: boolean;
  allowWrap: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onReplicate: () => void;
}) {
```

No corpo de `SprintRow` (linha 545-553), onde `AllocationChip` é instanciado, adicionar a prop:

```typescript
              {items.map((a) => (
                <AllocationChip
                  key={a.id}
                  allocation={a}
                  dimmed={!matches(a)}
                  allowWrap={items.length === 1}
                  canEdit={canEdit}
                  onEdit={() => onEdit(a)}
                  onReplicate={() => onReplicate(a)}
                />
              ))}
```

`SprintRow` precisa agora receber `onReplicate` também. Na assinatura de `SprintRow` (linhas 469-493), adicionar ao tipo de props e aos parâmetros:

```typescript
function SprintRow({
  sprint,
  devs,
  byCell,
  matches,
  dragOver,
  setDragOver,
  canEdit,
  onEditSprint,
  onAdd,
  onEdit,
  onReplicate,
  onDrop,
}: {
  sprint: Sprint;
  devs: Dev[];
  byCell: Map<string, Allocation[]>;
  matches: (a: Allocation) => boolean;
  dragOver: string | null;
  setDragOver: (v: string | null) => void;
  canEdit: boolean;
  onEditSprint: () => void;
  onAdd: (devId: string) => void;
  onEdit: (a: Allocation) => void;
  onReplicate: (a: Allocation) => void;
  onDrop: (allocationId: string, devId: string) => void;
}) {
```

No `BoardGrid`, onde `SprintRow` é instanciado (linhas 408-435), adicionar a prop `onReplicate` que chama `replicate.mutate` com o motivo de bloqueio checado antes:

```typescript
                {sprintsInYear.map((s) => (
                  <SprintRow
                    key={s.id}
                    sprint={s}
                    devs={devs}
                    byCell={byCell}
                    matches={matches}
                    dragOver={dragOver}
                    setDragOver={setDragOver}
                    canEdit={canEdit}
                    onEditSprint={() => {
                      if (!canEdit) return;
                      setSprintDialog({ open: true, sprint: s });
                    }}
                    onAdd={(devId) => {
                      if (!canEdit) return;
                      setDraft({ sprint_id: s.id, dev_id: devId });
                    }}
                    onEdit={(a) => {
                      if (!canEdit) return;
                      setDraft(toDraft(a));
                    }}
                    onReplicate={(a) => {
                      if (!canEdit) return;
                      const blockReason = buildReplicaBlockReason(a);
                      if (blockReason) {
                        toast.error(blockReason);
                        return;
                      }
                      replicate.mutate(a);
                    }}
                    onDrop={(id, devId) => {
                      if (!canEdit) return;
                      move.mutate({ id, sprint_id: s.id, dev_id: devId });
                    }}
                  />
                ))}
```

- [ ] **Passo 3: Adicionar o ícone visual no `AllocationChip`**

No JSX de `AllocationChip` (linhas 620-643), adicionar o botão de replicar dentro da `div` draggable, como um elemento posicionado no canto que só aparece no hover. Substituir o bloco:

```typescript
  return (
    <HoverCard openDelay={300}>
      <HoverCardTrigger asChild>
        <div
          draggable={canEdit}
          onDragStart={(e) => e.dataTransfer.setData("text/allocation", allocation.id)}
          onClick={onEdit}
          className={`shrink-0 overflow-hidden rounded-md border-l-[3px] px-2 py-1.5 text-left text-foreground shadow-card transition-opacity ${
            canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default"
          } ${washClass} ${accentClass} ${dimmed ? "opacity-25" : ""}`}
        >
          <p
            className={`text-xs font-medium leading-snug ${allowWrap ? "line-clamp-4" : "truncate"}`}
          >
            {allocation.title}
          </p>
          {allowWrap && (allocation.tickets.length > 0 || allocation.notes) ? (
            <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-80">
              <TicketSummary tickets={allocation.tickets} stopPropagation />
              {allocation.notes ? <span className="truncate">{allocation.notes}</span> : null}
            </div>
          ) : null}
        </div>
      </HoverCardTrigger>
```

por:

```typescript
  return (
    <HoverCard openDelay={300}>
      <HoverCardTrigger asChild>
        {/* group/chip: escopo próprio de hover, para não conflitar com
            group/cell (o "+ demanda" da célula) nem acender o ícone de outro
            card na mesma célula. */}
        <div
          draggable={canEdit}
          onDragStart={(e) => e.dataTransfer.setData("text/allocation", allocation.id)}
          onClick={onEdit}
          className={`group/chip relative shrink-0 overflow-hidden rounded-md border-l-[3px] px-2 py-1.5 text-left text-foreground shadow-card transition-opacity ${
            canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default"
          } ${washClass} ${accentClass} ${dimmed ? "opacity-25" : ""}`}
        >
          {canEdit ? (
            <button
              onClick={(e) => {
                // Sem isto, o clique no ícone também dispara o onClick do
                // card (linha acima) e abre o AllocationDialog junto.
                e.stopPropagation();
                onReplicate();
              }}
              title="Replicar na próxima sprint"
              aria-label="Replicar na próxima sprint"
              className="absolute right-1 top-1 z-10 rounded p-0.5 text-foreground/60 opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover/chip:opacity-100"
            >
              <Copy className="size-3" />
            </button>
          ) : null}
          <p
            className={`text-xs font-medium leading-snug ${allowWrap ? "line-clamp-4" : "truncate"} ${canEdit ? "pr-4" : ""}`}
          >
            {allocation.title}
          </p>
          {allowWrap && (allocation.tickets.length > 0 || allocation.notes) ? (
            <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-80">
              <TicketSummary tickets={allocation.tickets} stopPropagation />
              {allocation.notes ? <span className="truncate">{allocation.notes}</span> : null}
            </div>
          ) : null}
        </div>
      </HoverCardTrigger>
```

Nota: `pr-4` no `<p>` do título evita que o ícone absoluto cubra o texto quando o título é longo e a célula é estreita (`minmax(104px, auto)`) — o critério de aceite "o ícone não pode cobrir o título" fica atendido por reservar espaço à direita.

- [ ] **Passo 4: Verificar manualmente no navegador**

Com o dev server rodando (`npm run dev`):

1. Abrir o quadro de Alocações com um usuário `canEdit`.
2. Passar o mouse sobre um card que tenha uma sprint seguinte cadastrada e a pessoa disponível nela. Confirmar que o ícone de copiar aparece no canto superior direito do card, sem cobrir o título.
3. Confirmar que arrastar o card (drag) ainda funciona com o ícone presente.
4. Passar o mouse sobre o card sem clicar no ícone e confirmar que o `HoverCard` de detalhe (painel lateral) ainda abre normalmente após o delay.
5. Clicar no ícone de copiar. Confirmar que:
   - O `AllocationDialog` do card de origem **não** abre.
   - Um toast de sucesso aparece nomeando a sprint de destino (ex.: "Replicado em 26.15").
   - Se a sprint de destino estiver no ano filtrado atual, o novo card aparece na coluna da mesma pessoa, na linha da sprint seguinte, sem recarregar a página.
6. Testar o caso de bloqueio: usar um card cuja sprint seja a última cadastrada. Clicar no ícone e confirmar que aparece um toast de erro do tipo "Não há sprint cadastrada depois de X." e que nenhum card novo é criado.
7. Testar o caso de indisponibilidade: usar (ou configurar temporariamente) uma pessoa com `available_from` depois do início da próxima sprint. Confirmar o toast de erro nomeando a pessoa e a causa (janela de disponibilidade), e que nenhum card é criado.
8. Repetir o passo 2 com um usuário sem `canEdit` (somente leitura) e confirmar que o ícone **não aparece** em nenhum card.

- [ ] **Passo 5: Commit**

```bash
git add src/components/BoardGrid.tsx
git commit -m "feat(board): adiciona icone de replicar no hover do card de alocacao"
```

---

### Tarefa 4: Botão "Replicar na próxima sprint" no `AllocationDialog`

**Arquivos:**
- Modificar: `src/components/AllocationDialog.tsx`
- Modificar: `src/components/BoardGrid.tsx` (passar as novas props para `<AllocationDialog />`)

**Interfaces:**
- Consome: `replicate` e `buildReplicaBlockReason` (Tarefa 2, via props vindas de `BoardGrid.tsx`).
- Produz: nada consumido por tarefas futuras — última tarefa funcional do plano.

O `AllocationDialog` não tem acesso a `sprints`/`devs`/`allocations` hoje (só recebe `draft` e `project`). Em vez de fazer o diálogo buscar esses dados ou reimplementar a resolução, ele recebe do `BoardGrid` a função de replicar já pronta para o card atual, mais o motivo de bloqueio (ou `null`) já calculado — a mesma função `buildReplicaBlockReason` da Tarefa 2, chamada pelo `BoardGrid` com o `draft` atual sempre que ele muda.

- [ ] **Passo 1: Adicionar as novas props em `AllocationDialog`**

Em `src/components/AllocationDialog.tsx`, alterar a assinatura da função (linhas 46-55):

```typescript
export function AllocationDialog({
  draft,
  project,
  onOpenChange,
  onReplicate,
  replicateBlockReason,
  isReplicating,
}: {
  draft: AllocationDraft | null;
  /** Obrigatório no insert; o cartão nasce no projeto da tela. */
  project: JiraProjectKey;
  onOpenChange: (open: boolean) => void;
  /** Ausente (undefined) quando `draft` é um card novo, ainda sem `id`. */
  onReplicate?: () => void;
  /** Motivo do bloqueio vindo do BoardGrid (sem sprint seguinte, ou pessoa
   *  fora da janela de disponibilidade no destino). `null` quando pode
   *  replicar; `undefined` quando não se aplica (card novo). */
  replicateBlockReason?: string | null;
  isReplicating?: boolean;
}) {
```

- [ ] **Passo 2: Detectar formulário sujo**

O `draft` chega do banco (via `toDraft`, em `BoardGrid.tsx`) com os cinco campos: `title`, `tickets`, `status`, `tipo`, `notes`. O estado local (`title`, `tickets`, `status`, `tipo`, `notes`) é inicializado a partir dele no `useEffect` (linhas 65-76). "Sujo" significa que o estado local diverge do `draft`, usando a mesma normalização que o `payload` de `save` já aplica (trim, uppercase na chave do ticket, url vazia virando `null`) — sem essa normalização, espaço digitado e apagado marcaria sujo incorretamente.

Adicionar, logo depois da declaração de `save` (antes do `remove`, ou em qualquer ponto antes do JSX — inserir depois da linha 168, antes de `const remove = useMutation({`):

```typescript
  // Formulário "sujo" = estado local diverge do draft do banco, usando a
  // MESMA normalização do payload de `save` (trim, uppercase na key, url
  // vazia -> null) — sem isso, espaço digitado e apagado marcaria sujo à toa.
  const normalizedTickets = (list: AllocationTicket[]) =>
    list
      .filter((t) => t.key.trim() || t.url?.trim())
      .map((t) => ({ key: t.key.trim().toUpperCase(), url: t.url?.trim() || null }));

  const isDirty = (() => {
    if (!draft) return false;
    if (title.trim() !== (draft.title ?? "").trim()) return true;
    if (status !== (draft.status ?? "nao_especificada")) return true;
    if (tipo !== (draft.tipo ?? "planejado")) return true;
    if ((notes.trim() || null) !== (draft.notes ?? null)) return true;
    const a = normalizedTickets(tickets);
    const b = normalizedTickets(draft.tickets ?? []);
    if (a.length !== b.length) return true;
    return a.some((t, i) => t.key !== b[i]!.key || t.url !== b[i]!.url);
  })();
```

- [ ] **Passo 3: Adicionar o botão no rodapé**

No `DialogFooter` (linhas 295-315), o botão só faz sentido para um card existente (`draft?.id`), então entra ao lado de "Cancelar"/"Salvar", desabilitado quando: não há `onReplicate` (card novo), formulário sujo, `replicateBlockReason` é uma string (bloqueio ativo), ou a mutation está em andamento. Substituir o `DialogFooter` inteiro:

```typescript
        <DialogFooter className="sm:justify-between">
          {draft?.id ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => remove.mutate()}
            >
              <Trash2 className="size-4" /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {draft?.id && onReplicate ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* span: Button desabilitado não dispara eventos de hover,
                      o Tooltip precisa de um wrapper que sempre recebe o mouse. */}
                  <span tabIndex={isDirty || replicateBlockReason ? 0 : -1}>
                    <Button
                      variant="outline"
                      onClick={onReplicate}
                      disabled={isDirty || !!replicateBlockReason || isReplicating}
                    >
                      <Copy className="size-4" /> Replicar na próxima sprint
                    </Button>
                  </span>
                </TooltipTrigger>
                {isDirty || replicateBlockReason ? (
                  <TooltipContent>
                    {isDirty
                      ? "Salve as alterações antes de replicar."
                      : replicateBlockReason}
                  </TooltipContent>
                ) : null}
              </Tooltip>
            ) : null}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>
              Salvar
            </Button>
          </div>
        </DialogFooter>
```

Imports novos necessários no topo de `src/components/AllocationDialog.tsx`: `Copy` de `lucide-react` (linha 23) e `Tooltip`, `TooltipContent`, `TooltipTrigger` de `@/components/ui/tooltip`:

```typescript
import { Copy, Plus, Trash2 } from "lucide-react";
```

```typescript
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```

Nota: `TooltipProvider` já envolve a árvore em `BoardGrid.tsx` (linha 225), então `AllocationDialog` não precisa de um `TooltipProvider` próprio — ele é renderizado dentro dessa árvore (linha 444-448 de `BoardGrid.tsx`).

- [ ] **Passo 4: Conectar em `BoardGrid.tsx`**

Em `src/components/BoardGrid.tsx`, onde `<AllocationDialog />` é instanciado (linhas 444-448), passar as novas props:

```typescript
        <AllocationDialog
          draft={draft}
          project={project}
          onOpenChange={(o) => !o && setDraft(null)}
          onReplicate={
            draft?.id
              ? () => {
                  const allocation = allocations.find((a) => a.id === draft.id);
                  if (allocation) replicate.mutate(allocation);
                }
              : undefined
          }
          replicateBlockReason={
            draft?.id
              ? (() => {
                  const allocation = allocations.find((a) => a.id === draft.id);
                  return allocation ? buildReplicaBlockReason(allocation) : null;
                })()
              : undefined
          }
          isReplicating={replicate.isPending}
        />
```

Isto usa o registro do banco (`allocations`, vindo do cache do react-query), não o estado local do formulário — que é exatamente a regra fechada na issue ("a replicação sempre parte do estado gravado no banco"). Como o botão fica desabilitado enquanto o formulário está sujo, no momento em que o clique é possível o estado local e o `allocation` do banco já coincidem.

- [ ] **Passo 5: Verificar manualmente no navegador**

Com o dev server rodando:

1. Abrir um card existente (clicar nele) com sprint seguinte disponível e pessoa livre no destino. Confirmar que o botão "Replicar na próxima sprint" aparece no rodapé, habilitado.
2. Editar qualquer campo (por exemplo, digitar um espaço a mais no título) sem salvar. Confirmar que o botão fica desabilitado e, ao passar o mouse sobre ele, o tooltip mostra "Salve as alterações antes de replicar.".
3. Desfazer a edição manualmente até o campo voltar ao valor original salvo. Confirmar que o botão volta a ficar habilitado (a normalização não deve marcar sujo por espaços irrelevantes).
4. Salvar uma alteração de verdade. Confirmar que, após salvar, o botão está habilitado (o `draft` mais recente reflete o valor salvo).
5. Clicar em "Replicar na próxima sprint". Confirmar que:
   - A réplica é gravada (toast de sucesso nomeando a sprint de destino).
   - O diálogo **permanece aberto**, ainda mostrando o card de origem — não navega para a réplica.
6. Fechar o diálogo e reabrir o card de origem. Confirmar que ele não foi alterado (nem `sprint_id` nem qualquer outro campo mudou).
7. Clicar no novo card (a réplica) quando visível no quadro. Confirmar que abre no `AllocationDialog` normalmente, como qualquer outro card, editável e sem nenhuma marca especial.
8. Abrir um card cuja sprint seja a última cadastrada. Confirmar que o botão aparece desabilitado com o tooltip nomeando a ausência de próxima sprint.
9. Abrir um card criando uma **nova** demanda (clicar em "+ demanda" numa célula vazia, sem salvar ainda). Confirmar que o botão "Replicar na próxima sprint" não aparece (ou fica sem função) — a issue exige que ele não apareça para um card que ainda não existe no banco.
10. Repetir o passo 5 usando um card cuja próxima sprint cai no ano seguinte ao filtro atual. Confirmar que o toast nomeia a sprint de destino e que, ao trocar o filtro de ano para o ano seguinte, o card replicado aparece lá — sem que a ação tenha mudado o filtro sozinha.

- [ ] **Passo 6: Commit**

```bash
git add src/components/AllocationDialog.tsx src/components/BoardGrid.tsx
git commit -m "feat(board): adiciona botao Replicar na proxima sprint no dialogo de alocacao"
```

---

### Tarefa 5: Revisão final contra os critérios de aceite da issue

**Arquivos:** nenhum arquivo novo — esta tarefa é uma checagem cruzada, sem código.

- [ ] **Passo 1: Percorrer a lista de critérios de aceite da issue #42 e confirmar cada um**

Abrir a [issue #42](https://github.com/dbizfreitas/agile-assignment/issues/42) e, com o dev server rodando, confirmar manualmente item por item:

- Ícone aparece no hover, um clique replica.
- Clique no ícone não abre o diálogo do card de origem.
- Arrastar e o `HoverCard` de detalhe continuam funcionando com o ícone presente.
- Ícone não cobre o título na largura mínima da célula (testar com um título longo numa célula com várias pessoas).
- Ícone não aparece para quem não tem `canEdit`.
- Botão "Replicar na próxima sprint" no rodapé do diálogo de um card existente.
- Botão não aparece (ou fica inerte) ao criar um card novo.
- Botão desabilitado com formulário sujo, motivo visível.
- Com formulário limpo, réplica idêntica ao registro do banco.
- Sem próxima sprint, ou pessoa fora da janela, botão desabilitado com motivo visível.
- Replicar pelo diálogo grava e mantém o diálogo no card de origem.
- Os dois gatilhos chamam a mesma mutation (`replicate`) e a mesma resolução (`resolveNextSprint`/`buildReplicaBlockReason`) — confirmar por leitura de código, não há dois caminhos.
- Réplica com `title`, `tickets`, `tipo`, `status`, `notes` idênticos à origem, mesma pessoa, próxima sprint sequencial.
- Réplica gravada no mesmo gesto, sem diálogo intermediário.
- Réplica editável pelo fluxo normal.
- Editar/excluir a réplica não afeta a origem, e vice-versa (testar excluindo a réplica e confirmando que a origem permanece).
- Card de origem permanece inalterado após replicar.
- Réplica com `id` novo e `position` no final da célula de destino (testar replicando duas vezes seguidas — a segunda réplica deve aparecer depois da primeira na célula, não sobrepor).
- `jira_project` resolvido pelo trigger, não enviado no payload (confirmar por leitura do código da Tarefa 2 — o campo não está no objeto de insert).
- Sem próxima sprint: nada inserido, mensagem explicando o motivo.
- Pessoa fora da janela: nada inserido, mensagem nomeando a causa.
- Réplica em sprint de outro ano: gravada sem alterar o filtro de ano, mensagem de sucesso nomeia a sprint de destino.
- Quadro reflete o novo card sem recarregar a página.
- Erro na inserção mostra mensagem via `boardErrorMessage`.

- [ ] **Passo 2: Rodar o lint do projeto**

```bash
npm run lint
```

Nota: neste ambiente (Windows, `core.autocrlf=true`), o lint já falha na baseline antes de qualquer mudança desta feature, com milhares de erros `prettier/prettier: Delete '␍'` em praticamente todo arquivo do repositório — são finais de linha CRLF introduzidos no checkout local, não um problema do código. Confirme isso comparando a saída do lint ANTES e DEPOIS das mudanças desta feature: o número de erros nos arquivos tocados (`src/lib/board.ts`, `src/components/BoardGrid.tsx`, `src/components/AllocationDialog.tsx`) não deve aumentar por motivo diferente de CRLF. Se aparecer um erro de lint de outra natureza (variável não usada, regra de hooks, etc.) nesses três arquivos, ele deve ser corrigido.

- [ ] **Passo 3: Build de produção**

```bash
npm run build
```

Esperado: build conclui sem erros de TypeScript ou de bundling.

- [ ] **Passo 4: Commit final (se algum ajuste tiver sido feito durante a revisão)**

```bash
git add -A
git commit -m "fix(board): ajustes finais da replicacao de card apos revisao contra a issue #42"
```

Se nenhum ajuste foi necessário, pular este commit.

---

## Encerramento

Depois que a Tarefa 5 confirmar todos os critérios de aceite, a feature está pronta para virar Pull Request (usar a skill de criação de PR do projeto, se houver, ou `gh pr create` com resumo do que foi feito e referência a `Closes #42`).
