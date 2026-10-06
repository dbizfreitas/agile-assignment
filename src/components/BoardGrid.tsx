import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  CalendarPlus,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import {
  accentClassFor,
  chipClassFor,
  clampWeeksToSprint,
  compareAllocations,
  formatAvailability,
  formatRange,
  getSprintYear,
  hasSpecStatus,
  isDevAvailableInSprint,
  normalizeSearchText,
  resolveNextSprint,
  sameWeeks,
  sanitizeTickets,
  sprintWeeks,
  statusInfo,
  tipoInfo,
  washClassFor,
  weekBadge,
  teamMembers,
  moveInTeam,
  renumberChanges,
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
import type { BoardSearch } from "@/lib/board-search";
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";
import { useReorderDevs } from "@/hooks/use-reorder-devs";
import { useReorderAllocations } from "@/hooks/use-reorder-allocations";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AllocationDialog, toDraft, type AllocationDraft } from "./AllocationDialog";
import { DevDialog } from "./DevDialog";
import { SprintDialog } from "./SprintDialog";
import { TeamsDialog } from "./TeamsDialog";

// Larguras mínimas das colunas (issue #48). Abaixo disso a grade rola na
// horizontal, em vez de espremer os cards até ficarem ilegíveis.
const SPRINT_COL_MIN_PX = 128;
const DEV_COL_MIN_PX = 152;

// MIME próprio para arrastar a coluna da pessoa (#83). Separado de
// "text/allocation" para que o arraste de coluna nunca seja confundido com o de
// um card, e vice-versa.
const DEV_COLUMN_MIME = "text/dev-column";

// Faixa mínima de cada semana quando a sprint tem cards com semana (#91). Baixa
// de propósito: semana vazia deve ocupar pouco espaço, e as faixas com card
// crescem pelo conteúdo.
const WEEK_BAND_MIN_PX = 30;

type CardDnd = {
  /** Lado do indicador de soltar neste card, ou `null` se ele não é o alvo. */
  dropSide: (id: string) => "before" | "after" | null;
  start: (a: Allocation) => void;
  end: () => void;
  /** O card arrastado agora vem desta célula? (então soltar na célula não faz nada) */
  fromCell: (sprintId: string, devId: string) => boolean;
  over: (e: React.DragEvent<HTMLElement>, target: Allocation) => void;
  leave: (e: React.DragEvent<HTMLElement>, target: Allocation) => void;
  drop: (e: React.DragEvent<HTMLElement>, target: Allocation) => void;
};

export function BoardGrid({
  canEdit,
  project,
  filters,
  onFiltersChange,
}: {
  canEdit: boolean;
  /**
   * NÃO ANULÁVEL: a casca (`src/routes/_shell.tsx`) garante uma chave válida
   * de forma síncrona. O ramo "Selecione um projeto." e o `enabled: !!project`
   * que existiam aqui eram defesa contra um estado que não existe mais.
   *
   * `onProjectChange` saiu: o seletor mora no cabeçalho compartilhado, e um
   * segundo seletor dentro do quadro é exatamente o que esta frente desfaz.
   */
  project: JiraProjectKey;
  /**
   * Ano, busca, tipo e status vivem na URL (issue #55); a rota é dona do
   * estado e o board só o lê. Chave ausente = padrão.
   *
   * `onFiltersChange` recebe um patch parcial: valor padrão ("todos", busca
   * vazia) vai como `undefined`, o que remove a chave da URL.
   */
  filters: BoardSearch;
  onFiltersChange: (patch: Partial<BoardSearch>) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<AllocationDraft | null>(null);
  const [devDialog, setDevDialog] = useState<{ open: boolean; dev: Dev | null }>({
    open: false,
    dev: null,
  });
  const [sprintDialog, setSprintDialog] = useState<{ open: boolean; sprint: Sprint | null }>({
    open: false,
    sprint: null,
  });
  const [teamsDialog, setTeamsDialog] = useState(false);
  // Reordenação de colunas por arraste (#83).
  const [draggingDevId, setDraggingDevId] = useState<string | null>(null);
  const [columnDrop, setColumnDrop] = useState<{
    devId: string;
    side: "before" | "after";
  } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Reordenação de cards dentro da célula (#91). O card arrastado fica num ref
  // porque `dataTransfer.getData` não é legível durante o `dragover`; o
  // indicador (linha acima/abaixo do alvo) é estado, pois precisa renderizar.
  const draggingAllocation = useRef<Allocation | null>(null);
  const [cardDrop, setCardDrop] = useState<{
    id: string;
    side: "before" | "after";
  } | null>(null);
  // Filtros derivados da URL. Sem `ano`, vale o ano corrente do relógio, não o
  // da sprint mais próxima — decisão da spec.
  const urlQ = filters.q ?? "";
  const statusFilter: AllocationStatus | "todos" = filters.status ?? "todos";
  const tipoFilter: AllocationTipo | "todos" = filters.tipo ?? "todos";
  const yearFilter = filters.ano ?? new Date().getFullYear();

  // O input NÃO é controlado direto pela URL: o router aplica a navegação de
  // forma assíncrona (transition), então o valor voltaria atrasado e o cursor
  // pularia para o fim ao editar no meio do texto, perdendo teclas em digitação
  // rápida. O texto fica em estado local; a URL é só um espelho dele.
  const [search, setSearch] = useState(urlQ);
  // Valores que nós mesmos gravaram na URL e que ainda podem chegar de volta
  // (possivelmente fora de ordem). Não são mudança externa, então não mexem no
  // texto que o usuário está digitando.
  const pushedQ = useRef(new Set<string>());
  const onSearchChange = (text: string) => {
    setSearch(text);
    pushedQ.current.add(text.trim() === "" ? "" : text);
    onFiltersChange({ q: text || undefined });
  };
  // Ressincroniza quando `q` muda por fora (link, F5, voltar, reset na troca
  // de projeto). Só se diferir do texto atual, para não brigar com a digitação.
  useEffect(() => {
    if (pushedQ.current.has(urlQ)) {
      // Chegou o que gravamos; descarta o histórico se for o valor atual.
      if (urlQ === (search.trim() === "" ? "" : search)) pushedQ.current.clear();
      return;
    }
    pushedQ.current.clear();
    setSearch(urlQ);
    // Só reage à URL: `search` é lido apenas para comparar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  // As quatro queries são `select("*")` planas com um `.eq("jira_project", …)`
  // cada — sem `!inner`, sem query dependente: `devs` e `allocations` têm o
  // projeto denormalizado, derivado do pai por trigger no banco.
  //
  // O projeto entra na queryKey obrigatoriamente. DevDialog usa a MESMA chave
  // de `teams`; se as duas divergissem, os dois componentes brigariam pela
  // mesma entrada de cache e o diálogo listaria times do projeto errado.
  const devsQ = useQuery({
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

  const sprintsQ = useQuery({
    queryKey: ["board", "sprints", project],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sprints")
        .select("*")
        .eq("jira_project", project)
        .order("start_date")
        .order("position");
      if (error) throw error;
      return data as Sprint[];
    },
  });

  const allocQ = useQuery({
    queryKey: ["board", "allocations", project],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*")
        .eq("jira_project", project)
        .order("position");
      if (error) throw error;
      // `tickets` é jsonb (tipado como `Json` pelo codegen do Supabase) — cada
      // linha passa por `sanitizeTickets` para nunca expor `key: null` (dado
      // legado do backfill) ao resto da UI.
      return (data ?? []).map((a) => ({
        ...a,
        tickets: sanitizeTickets(a.tickets),
      })) as unknown as Allocation[];
    },
  });

  const teams = teamsQ.data ?? [];
  const sprints = sprintsQ.data ?? [];

  // Anos com pelo menos uma sprint, mais o ano corrente sempre presente — sem
  // isso, o valor padrão do dropdown (ano corrente) poderia não ter opção
  // correspondente na lista se nenhuma sprint cair nele. Ordem decrescente: o
  // ano mais recente primeiro, convenção usual em seletores de ano.
  const years = useMemo(() => {
    const set = new Set(sprints.map(getSprintYear));
    set.add(new Date().getFullYear());
    set.add(yearFilter); // o ano selecionado sempre tem opção correspondente
    return Array.from(set).sort((a, b) => b - a);
  }, [sprints, yearFilter]);

  const sprintsInYear = useMemo(
    () => sprints.filter((s) => getSprintYear(s) === yearFilter),
    [sprints, yearFilter],
  );

  const allocations = allocQ.data ?? [];

  // O projeto do cartão é recalculado pelo trigger a cada movimento, e
  // allocations_sprint_project_fkey valida o destino. As semanas vêm cortadas
  // para a sprint de destino (#91): a final além da última vira a última, e sem
  // a inicial o card fica sem semana.
  const move = useMutation({
    mutationFn: async (v: {
      id: string;
      sprint_id: string;
      dev_id: string;
      week_start: number | null;
      week_end: number | null;
    }) => {
      const { error } = await supabase
        .from("allocations")
        .update({
          sprint_id: v.sprint_id,
          dev_id: v.dev_id,
          week_start: v.week_start,
          week_end: v.week_end,
        })
        .eq("id", v.id);
      if (error) throw error;
    },
    // Invalida pelo PREFIXO, sem o projeto: derruba o cache do projeto atual e
    // o dos outros que estiverem em cache, que é o comportamento desejado.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", "allocations"] }),
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
  });

  // Motivo de bloqueio da replicação, ou `null` se pode replicar. Compartilhado
  // pelos dois gatilhos (ícone de hover e botão do diálogo) — nenhum dos dois
  // reimplementa esta checagem. Usa `sprints` (lista completa, sem filtro de
  // ano): a próxima sprint pode cair no ano seguinte.
  const buildReplicaBlockReason = (allocation: Allocation): string | null => {
    const nextSprint = resolveNextSprint(sprints, allocation.sprint_id);
    if (!nextSprint) {
      const current = sprints.find((s) => s.id === allocation.sprint_id);
      return `Não há sprint cadastrada depois de ${current?.code ?? "desta sprint"}.`;
    }
    const dev = devs.find((d) => d.id === allocation.dev_id);
    if (dev && !isDevAvailableInSprint(dev, nextSprint)) {
      return `${dev.name} está fora da janela de disponibilidade em ${nextSprint.code}.`;
    }
    return null;
  };

  // Insere uma cópia do card na próxima sprint sequencial, mesma pessoa.
  // `jira_project: project` é redundante em runtime — o trigger
  // `allocations_set_project` recalcula a coluna a partir de `dev_id` antes
  // do insert — mas a coluna é NOT NULL sem default, então o tipo `Insert`
  // gerado pelo Supabase exige o campo. Mesmo padrão de AllocationDialog
  // (linha ~160), que envia `jira_project` pelo mesmo motivo. `position` vai
  // para o final da célula de destino — maior posição já usada ali, mais 1
  // (ou 0 se a célula estiver vazia).
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
        // Semanas mantidas se existirem na sprint de destino (#91).
        ...clampWeeksToSprint(allocation, nextSprint),
        position,
        jira_project: project,
      });
      if (error) throw error;
      return nextSprint;
    },
    onSuccess: (nextSprint) => {
      toast.success(`Replicado em ${nextSprint.code}.`);
      // Retornar a promise faz a mutation só terminar após o refetch — assim
      // a trava de `requestReplicate` só solta com o cache atualizado e a
      // `position` da próxima réplica não é calculada com dados velhos.
      return qc.invalidateQueries({ queryKey: ["board", "allocations"] });
    },
    onError: (e: Error) => toast.error(boardErrorMessage(e, "allocation")),
  });

  // Trava SÍNCRONA contra cliques repetidos: `isPending` não basta, pois o
  // closure do onClick pode estar desatualizado entre cliques rápidos e
  // deixar passar várias chamadas antes do re-render. O ref bloqueia na hora;
  // o estado é só um espelho para renderizar o indicador de "replicando".
  const replicatingIds = useRef(new Set<string>());
  const [replicatingSet, setReplicatingSet] = useState<ReadonlySet<string>>(new Set());

  const requestReplicate = async (allocation: Allocation) => {
    if (replicatingIds.current.has(allocation.id)) return;
    replicatingIds.current.add(allocation.id);
    setReplicatingSet((prev) => new Set(prev).add(allocation.id));
    try {
      // mutateAsync (e não `mutate(a, { onSettled })`): no TanStack v5 os
      // callbacks por chamada só disparam para a última chamada.
      await replicate.mutateAsync(allocation);
    } catch {
      // Erro já tratado (toast) pelo onError da mutation.
    } finally {
      replicatingIds.current.delete(allocation.id);
      setReplicatingSet((prev) => {
        const next = new Set(prev);
        next.delete(allocation.id);
        return next;
      });
    }
  };

  const reorderDevs = useReorderDevs(project);
  const reorderAllocations = useReorderAllocations(project);

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const teamPosition = useMemo(() => new Map(teams.map((t, i) => [t.id, i])), [teams]);

  const devs = useMemo(() => {
    const list = devsQ.data ?? [];
    return [...list].sort((a, b) => {
      const teamDiff = (teamPosition.get(a.team_id) ?? 0) - (teamPosition.get(b.team_id) ?? 0);
      return teamDiff !== 0 ? teamDiff : a.position - b.position;
    });
  }, [devsQ.data, teamPosition]);

  const term = normalizeSearchText(search);
  const matches = (a: Allocation) => {
    // Férias não tem status: some quando há filtro de status específico.
    const okStatus =
      statusFilter === "todos" || (hasSpecStatus(a.tipo) && a.status === statusFilter);
    const okTipo = tipoFilter === "todos" || a.tipo === tipoFilter;
    const okTerm =
      !term ||
      normalizeSearchText(a.title).includes(term) ||
      a.tickets.some((t) => normalizeSearchText(t.key).includes(term));
    return okStatus && okTipo && okTerm;
  };

  const byCell = useMemo(() => {
    const map = new Map<string, Allocation[]>();
    for (const a of allocations) {
      const key = `${a.sprint_id}:${a.dev_id}`;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    // Ordem da célula (#91): semana inicial, semana final, `position`.
    for (const list of map.values()) list.sort(compareAllocations);
    return map;
  }, [allocations]);

  const sprintsWithCards = useMemo(
    () => new Set(allocations.map((a) => a.sprint_id)),
    [allocations],
  );

  // Layout por semanas (#91): sprint com pelo menos um card com semana (já
  // cortada ao tamanho atual da sprint) vira W faixas + 1 faixa "sem semana".
  // Calculado sobre TODOS os cards, não só os que passam no filtro — a busca
  // não deve rearrumar a altura das linhas.
  const sprintLayout = useMemo(() => {
    const map = new Map<string, { weekCount: number; hasWeeked: boolean }>();
    const byId = new Map(sprintsInYear.map((s) => [s.id, s]));
    for (const s of sprintsInYear) {
      map.set(s.id, { weekCount: sprintWeeks(s).length, hasWeeked: false });
    }
    for (const a of allocations) {
      const info = map.get(a.sprint_id);
      const sprint = byId.get(a.sprint_id);
      if (!info || !sprint || info.hasWeeked) continue;
      if (clampWeeksToSprint(a, sprint).week_start != null) info.hasWeeked = true;
    }
    return map;
  }, [sprintsInYear, allocations]);

  // Arraste de card sobre outro card da MESMA célula e mesmas semanas = reordenar
  // (#91). Qualquer outro caso não é tratado aqui e borbulha para a célula, que
  // segue a lógica de mover.
  const cardDnd: CardDnd = {
    dropSide: (id) => (cardDrop?.id === id ? cardDrop.side : null),
    start: (a) => {
      draggingAllocation.current = a;
    },
    end: () => {
      draggingAllocation.current = null;
      setCardDrop(null);
    },
    fromCell: (sprintId, devId) => {
      const a = draggingAllocation.current;
      return !!a && a.sprint_id === sprintId && a.dev_id === devId;
    },
    over: (e, target) => {
      const src = draggingAllocation.current;
      // Durante a gravação não reordena: as posições em cache ainda são
      // otimistas. Arrastar entre células continua liberado.
      if (!canEdit || reorderAllocations.isPending || !src || src.id === target.id) return;
      if (src.sprint_id !== target.sprint_id || src.dev_id !== target.dev_id) return;
      if (!sameWeeks(src, target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const side = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      if (cardDrop?.id !== target.id || cardDrop.side !== side) {
        setCardDrop({ id: target.id, side });
      }
    },
    leave: (e, target) => {
      // Passar para um filho do próprio card também dispara dragleave.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      if (cardDrop?.id === target.id) setCardDrop(null);
    },
    drop: (e, target) => {
      if (!cardDrop || cardDrop.id !== target.id) return;
      e.preventDefault();
      e.stopPropagation();
      const side = cardDrop.side;
      setCardDrop(null);
      const src = draggingAllocation.current;
      draggingAllocation.current = null;
      if (!src) return;
      const cell = (byCell.get(`${target.sprint_id}:${target.dev_id}`) ?? []).filter(
        (a) => a.id !== src.id,
      );
      const at = cell.findIndex((a) => a.id === target.id);
      if (at === -1) return;
      cell.splice(at + (side === "after" ? 1 : 0), 0, src);
      // Renumera a célula inteira: normaliza duplicatas e buracos herdados.
      const changes = renumberChanges(cell);
      if (changes.length > 0) reorderAllocations.mutate({ changes });
    },
  };

  const loading = devsQ.isLoading || teamsQ.isLoading || sprintsQ.isLoading || allocQ.isLoading;

  return (
    <TooltipProvider delayDuration={300}>
      {/* `min-h-0 flex-1` e não `h-screen`: a casca já ocupa a viewport, e um
          filho `h-screen` dentro dela produz rolagem dupla. O
          `overflow-y-auto` do container do grid continua sendo o que rola. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {/* Toolbar DO PAINEL: só controles do quadro. Navegação, projeto, tema,
            logout e "Usuários" moram no cabeçalho da casca. */}
        <div className="shrink-0 border-b border-border bg-surface-2">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Buscar demanda ou ticket"
                className="h-9 w-56 pl-8"
              />
            </div>

            {canEdit ? (
              <>
                {/* Times primeiro: é a raiz do eixo de colunas, e a ordem na
                    toolbar espelha a hierarquia dos dados (time → pessoa →
                    sprint são as três dimensões, mas o time governa as
                    outras). */}
                <Button size="sm" variant="secondary" onClick={() => setTeamsDialog(true)}>
                  <Users className="size-4" /> Times
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSprintDialog({ open: true, sprint: null })}
                >
                  <CalendarPlus className="size-4" /> Sprint
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDevDialog({ open: true, dev: null })}
                >
                  <UserPlus className="size-4" /> Pessoa
                </Button>
              </>
            ) : null}

            {/* Fora do bloco `canEdit`: filtrar por ano é ação de
                visualização, não de edição, e vale para leitor e editor. */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Ano</span>
              <Select
                value={String(yearFilter)}
                onValueChange={(v) => onFiltersChange({ ano: Number(v) })}
              >
                <SelectTrigger className="h-9 w-24" aria-label="Ano">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Tipo
            </span>
            <FilterChip
              active={tipoFilter === "todos"}
              onClick={() => onFiltersChange({ tipo: undefined })}
            >
              Todos
            </FilterChip>
            {TIPO_LIST.map((t) => (
              <FilterChip
                key={t.value}
                active={tipoFilter === t.value}
                onClick={() => onFiltersChange({ tipo: t.value })}
              >
                <span className={`size-2 rounded-full ${t.dot}`} />
                {t.label}
              </FilterChip>
            ))}

            <span className="mx-1 h-4 w-px bg-border" />

            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Status
            </span>
            <FilterChip
              active={statusFilter === "todos"}
              onClick={() => onFiltersChange({ status: undefined })}
            >
              Todos
            </FilterChip>
            {STATUS_LIST.map((s) => (
              <FilterChip
                key={s.value}
                active={statusFilter === s.value}
                onClick={() => onFiltersChange({ status: s.value })}
              >
                <span className={`size-2 rounded-full ${s.dot}`} />
                {s.label}
              </FilterChip>
            ))}
          </div>
        </div>

        <main className="min-h-0 flex-1 p-4">
          {loading ? (
            <p className="py-20 text-center text-sm text-muted-foreground">Carregando alocações…</p>
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
                As alocações do {project} ainda não foram montadas.
              </p>
            )
          ) : sprintsInYear.length === 0 ? (
            <EmptyYearState
              year={yearFilter}
              canEdit={canEdit}
              onAddSprint={() => setSprintDialog({ open: true, sprint: null })}
            />
          ) : (
            <div className="h-full w-full overflow-auto rounded-xl border border-grid-line bg-surface shadow-card board-scroll">
              <div
                className="grid w-full"
                style={{
                  // `minWidth` força o grid a ficar mais largo que o container
                  // quando a soma dos mínimos não cabe, e é isso que liga o
                  // scroll horizontal. Em telas largas as colunas continuam
                  // esticando (`1fr`) e preenchem o espaço.
                  minWidth: SPRINT_COL_MIN_PX + devs.length * DEV_COL_MIN_PX,
                  gridTemplateColumns: `minmax(${SPRINT_COL_MIN_PX}px, 1fr) repeat(${devs.length}, minmax(${DEV_COL_MIN_PX}px, 1fr))`,
                  gridTemplateRows: [
                    "auto",
                    ...sprintsInYear.map((s) => {
                      const layout = sprintLayout.get(s.id);
                      if (layout?.hasWeeked) {
                        return `repeat(${layout.weekCount}, minmax(${WEEK_BAND_MIN_PX}px, auto)) auto`;
                      }
                      return sprintsWithCards.has(s.id) ? "minmax(104px, auto)" : "auto";
                    }),
                  ].join(" "),
                }}
              >
                <div className="board-sticky-col sticky left-0 top-0 z-40 border-b border-r border-grid-line px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Sprint
                </div>
                {devs.map((d) => {
                  const team = teamById.get(d.team_id);
                  const availability = formatAvailability(d);
                  const dropSide = columnDrop?.devId === d.id ? columnDrop.side : null;
                  const clearColumnDrag = () => {
                    setDraggingDevId(null);
                    setColumnDrop(null);
                  };
                  // Só reordena dentro do mesmo time (#83): a posição é por time.
                  const sourceInSameTeam = () => {
                    const src = devsQ.data?.find((x) => x.id === draggingDevId);
                    return !!src && src.team_id === d.team_id;
                  };
                  return (
                    <Tooltip key={d.id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            if (!canEdit) return;
                            setDevDialog({ open: true, dev: d });
                          }}
                          draggable={canEdit && !reorderDevs.isPending}
                          onDragStart={(e) => {
                            if (!canEdit) return;
                            e.dataTransfer.setData(DEV_COLUMN_MIME, d.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDraggingDevId(d.id);
                          }}
                          onDragOver={(e) => {
                            if (!canEdit) return;
                            if (!e.dataTransfer.types.includes(DEV_COLUMN_MIME)) return;
                            // Sem preventDefault o navegador mostra o cursor de
                            // "proibido" — é o que queremos em outro time.
                            if (!sourceInSameTeam()) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            const rect = e.currentTarget.getBoundingClientRect();
                            const side =
                              e.clientX < rect.left + rect.width / 2 ? "before" : "after";
                            if (columnDrop?.devId !== d.id || columnDrop.side !== side) {
                              setColumnDrop({ devId: d.id, side });
                            }
                          }}
                          onDragLeave={() => {
                            if (columnDrop?.devId === d.id) setColumnDrop(null);
                          }}
                          onDrop={(e) => {
                            if (!canEdit) return;
                            e.preventDefault();
                            const id = e.dataTransfer.getData(DEV_COLUMN_MIME);
                            const side = columnDrop?.devId === d.id ? columnDrop.side : "before";
                            clearColumnDrag();
                            if (!id || id === d.id) return;
                            const all = devsQ.data ?? [];
                            const src = all.find((x) => x.id === id);
                            if (!src || src.team_id !== d.team_id) return;
                            const members = teamMembers(all, d.team_id);
                            const without = members.filter((m) => m.id !== id);
                            const targetIdx = without.findIndex((m) => m.id === d.id);
                            const toIndex =
                              targetIdx === -1
                                ? members.findIndex((m) => m.id === id)
                                : targetIdx + (side === "after" ? 1 : 0);
                            const changes = renumberChanges(moveInTeam(members, id, toIndex));
                            if (changes.length > 0) reorderDevs.mutate({ changes });
                          }}
                          onDragEnd={clearColumnDrag}
                          style={{ boxShadow: `inset 0 -3px 0 0 ${team?.color ?? "transparent"}` }}
                          className={`group sticky top-0 z-30 flex items-center gap-2 overflow-hidden border-b border-r border-grid-line bg-surface-2 px-3 py-2 text-left last:border-r-0 hover:bg-secondary ${
                            canEdit ? "cursor-grab active:cursor-grabbing" : ""
                          } ${draggingDevId === d.id ? "opacity-50" : ""}`}
                        >
                          {dropSide ? (
                            <span
                              aria-hidden
                              className={`pointer-events-none absolute inset-y-0 w-0.5 bg-primary ${
                                dropSide === "before" ? "left-0" : "right-0"
                              }`}
                            />
                          ) : null}
                          <span
                            className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                            style={{ backgroundColor: team?.color ?? "#94a3b8" }}
                          >
                            {d.initials || d.name.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-medium">{d.name}</span>
                            {team ? (
                              <span className="truncate text-[10px] text-muted-foreground">
                                {team.name}
                              </span>
                            ) : null}
                          </span>
                          <Pencil className="ml-auto size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {d.name}
                        {availability ? (
                          <span className="block text-muted-foreground">{availability}</span>
                        ) : null}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}

                {sprintsInYear.map((s) => (
                  <SprintRow
                    key={s.id}
                    sprint={s}
                    devs={devs}
                    byCell={byCell}
                    weekCount={sprintLayout.get(s.id)?.weekCount ?? 0}
                    hasWeeked={sprintLayout.get(s.id)?.hasWeeked ?? false}
                    cardDnd={cardDnd}
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
                      requestReplicate(a);
                    }}
                    onDrop={(id, devId) => {
                      if (!canEdit) return;
                      const allocation = allocations.find((a) => a.id === id);
                      if (!allocation) return;
                      // Soltar na própria célula não move nada (#91).
                      if (allocation.sprint_id === s.id && allocation.dev_id === devId) return;
                      move.mutate({
                        id,
                        sprint_id: s.id,
                        dev_id: devId,
                        ...clampWeeksToSprint(allocation, s),
                      });
                    }}
                    replicatingIds={replicatingSet}
                  />
                ))}
              </div>
            </div>
          )}
        </main>

        {/* AllocationDialog fica fora do condicional: não depende de projeto
            (o cartão herda o da pessoa no banco) e envolvê-lo remontaria o
            diálogo sem motivo. */}
        <AllocationDialog
          draft={draft}
          sprint={sprints.find((s) => s.id === draft?.sprint_id) ?? null}
          project={project}
          onOpenChange={(o) => !o && setDraft(null)}
          onReplicate={
            draft?.id
              ? () => {
                  const allocation = allocations.find((a) => a.id === draft.id);
                  if (allocation) requestReplicate(allocation);
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
          isReplicating={!!draft?.id && replicatingSet.has(draft.id)}
        />
        <DevDialog
          dev={devDialog.dev}
          open={devDialog.open}
          count={devs.length}
          allocationCount={
            devDialog.dev ? allocations.filter((a) => a.dev_id === devDialog.dev?.id).length : 0
          }
          devs={devsQ.data ?? []}
          project={project}
          onOpenChange={(o) => setDevDialog({ open: o, dev: o ? devDialog.dev : null })}
        />
        <SprintDialog
          sprint={sprintDialog.sprint}
          open={sprintDialog.open}
          count={sprints.length}
          sprints={sprints}
          allocationCount={
            sprintDialog.sprint
              ? allocations.filter((a) => a.sprint_id === sprintDialog.sprint?.id).length
              : 0
          }
          project={project}
          onOpenChange={(o) => setSprintDialog({ open: o, sprint: o ? sprintDialog.sprint : null })}
        />
        <TeamsDialog open={teamsDialog} project={project} onOpenChange={setTeamsDialog} />
      </div>
    </TooltipProvider>
  );
}

function SprintRow({
  sprint,
  devs,
  byCell,
  weekCount,
  hasWeeked,
  cardDnd,
  matches,
  dragOver,
  setDragOver,
  canEdit,
  onEditSprint,
  onAdd,
  onEdit,
  onReplicate,
  onDrop,
  replicatingIds,
}: {
  sprint: Sprint;
  devs: Dev[];
  byCell: Map<string, Allocation[]>;
  /** Nº de semanas da sprint (W). */
  weekCount: number;
  /** Algum card da sprint tem semana: a linha vira W faixas + "sem semana". */
  hasWeeked: boolean;
  cardDnd: CardDnd;
  matches: (a: Allocation) => boolean;
  dragOver: string | null;
  setDragOver: (v: string | null) => void;
  canEdit: boolean;
  onEditSprint: () => void;
  onAdd: (devId: string) => void;
  onEdit: (a: Allocation) => void;
  onReplicate: (a: Allocation) => void;
  onDrop: (allocationId: string, devId: string) => void;
  replicatingIds: ReadonlySet<string>;
}) {
  // Com semanas, o botão da sprint e cada célula cobrem as W+1 linhas da grade
  // externa (#91); as células viram subgrid para que a mesma semana tenha a
  // mesma altura em todas as pessoas.
  const spanStyle = hasWeeked ? { gridRow: `span ${weekCount + 1}` } : undefined;
  return (
    <>
      <button
        onClick={onEditSprint}
        style={spanStyle}
        title={[sprint.quarter, sprint.code, formatRange(sprint.start_date, sprint.end_date)]
          .filter(Boolean)
          .join(" · ")}
        className="board-sticky-col group sticky left-0 z-20 overflow-hidden border-b border-r border-grid-line px-3 py-1.5 text-left hover:bg-secondary"
      >
        <div className="flex items-start gap-2">
          {sprint.quarter ? (
            <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {sprint.quarter}
            </span>
          ) : null}
          <span className="min-w-0 break-words text-sm font-semibold">{sprint.code}</span>
          <Pencil className="ml-auto size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
        </div>
        {/* Em 128px o período não cabe em uma linha: ele quebra no espaço
            depois do "–" em vez de truncar (issue #56). */}
        <p className="text-[11px] leading-tight text-muted-foreground">
          {formatRange(sprint.start_date, sprint.end_date)}
        </p>
      </button>

      {devs.map((d) => {
        const key = `${sprint.id}:${d.id}`;
        const items = byCell.get(key) ?? [];
        // A célula fora da janela não some nem esvazia: ela só deixa de
        // aceitar entrada. Cartões que já estavam ali continuam renderizando,
        // abrem no diálogo e podem ser arrastados PARA FORA — que é a ação
        // que corrige a inconsistência.
        const available = isDevAvailableInSprint(d, sprint);

        const renderChip = (a: Allocation, fill: boolean) => (
          <AllocationChip
            key={a.id}
            allocation={a}
            dimmed={!matches(a)}
            allowWrap={items.length === 1}
            fill={fill}
            canEdit={canEdit}
            dnd={cardDnd}
            onEdit={() => onEdit(a)}
            onReplicate={() => onReplicate(a)}
            isReplicating={replicatingIds.has(a.id)}
          />
        );

        let body: React.ReactNode;
        if (!hasWeeked) {
          body = (
            <div className="flex w-full flex-1 flex-col gap-1">
              {items.map((a) => renderChip(a, items.length === 1))}
            </div>
          );
        } else {
          // Semana já cortada ao tamanho atual da sprint (pode ter sido
          // encurtada depois de o card ser salvo).
          const placed = items.map((a) => ({ a, w: clampWeeksToSprint(a, sprint) }));
          const weeked = placed.filter((p) => p.w.week_start != null);
          if (weeked.length === 0) {
            // Célula sem semana mantém o layout de antes, ocupando todas as faixas.
            body = (
              <div className="flex min-w-0 flex-col gap-1" style={{ gridRow: "1 / -1" }}>
                {items.map((a) => renderChip(a, items.length === 1))}
              </div>
            );
          } else {
            const groups = new Map<number, { a: Allocation; end: number }[]>();
            for (const { a, w } of weeked) {
              const list = groups.get(w.week_start!) ?? [];
              list.push({ a, end: w.week_end ?? w.week_start! });
              groups.set(w.week_start!, list);
            }
            const starts = [...groups.keys()].sort((x, y) => x - y);
            const unweeked = placed.filter((p) => p.w.week_start == null);
            body = (
              <>
                {starts.map((k, i) => {
                  const list = groups.get(k)!;
                  // A área do grupo vai da semana inicial até a final mais
                  // distante, mas nunca invade o grupo seguinte.
                  const next = starts[i + 1] ?? weekCount + 1;
                  const end = Math.min(Math.max(...list.map((x) => x.end)), next - 1);
                  return (
                    <div
                      key={k}
                      className="flex min-h-0 min-w-0 flex-col gap-1 pb-1"
                      style={{ gridRow: `${k} / ${end + 1}` }}
                    >
                      {/* O último card estica para ocupar as faixas do grupo. */}
                      {list.map((x, j) => renderChip(x.a, j === list.length - 1))}
                    </div>
                  );
                })}
                {unweeked.length > 0 ? (
                  <div className="flex min-w-0 flex-col gap-1" style={{ gridRow: weekCount + 1 }}>
                    {unweeked.map((x) => renderChip(x.a, false))}
                  </div>
                ) : null}
              </>
            );
          }
        }

        return (
          <div
            key={key}
            onDragOver={(e) => {
              // Só arraste de card acende a célula; o de coluna (#83) não.
              if (!e.dataTransfer.types.includes("text/allocation")) return;
              // Card da própria célula: soltar aqui não move nada, então não
              // acende nem aceita (#91) — a reordenação é sobre os outros cards.
              if (cardDnd.fromCell(sprint.id, d.id)) return;
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
            style={
              hasWeeked ? {
                    ...spanStyle,
                    display: "grid",
                    gridTemplateRows: "subgrid",
                    // Coluna única limitada: sem isto a coluna implícita (auto) cresce até o
                    // min-content e notas/tickets longos vazam sobre as colunas vizinhas.
                    gridTemplateColumns: "minmax(0, 1fr)",
                  } : undefined
            }
            className={`group/cell relative border-b border-r border-grid-line p-1.5 last:border-r-0 ${
              hasWeeked ? "" : "flex flex-col gap-1"
            } ${available ? "" : "cursor-not-allowed bg-muted-foreground/15"} ${
              dragOver === key ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""
            }`}
          >
            {body}
            {/* :focus-visible em vez de focus-within: foco por clique (ex.: após replicar) não deve manter o botão visível */}
            {canEdit && available ? (
              <button
                onClick={() => onAdd(d.id)}
                aria-label={`Adicionar demanda para ${d.name} em ${sprint.code}`}
                className="pointer-events-none absolute inset-x-1.5 top-full z-10 mt-0 flex items-center justify-center gap-1 rounded-md border border-dashed border-grid-line bg-surface/90 py-1 text-[11px] text-muted-foreground opacity-0 shadow-card backdrop-blur-sm transition-opacity hover:border-primary hover:text-primary focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/cell:pointer-events-auto group-hover/cell:opacity-100 group-has-[:focus-visible]/cell:pointer-events-auto group-has-[:focus-visible]/cell:opacity-100"
              >
                <Plus className="size-3" /> demanda
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** Chave de um ticket: link (com ícone) quando há `url`, senão só o texto. */
function TicketKey({
  ticket,
  stopPropagation,
}: {
  ticket: AllocationTicket;
  stopPropagation?: boolean | undefined;
}) {
  if (!ticket.url) return <span className="font-mono">{ticket.key}</span>;
  return (
    <a
      href={ticket.url}
      target="_blank"
      rel="noreferrer"
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      className="inline-flex items-center gap-0.5 font-mono underline underline-offset-2"
    >
      {ticket.key}
      <ExternalLink className="size-2.5" />
    </a>
  );
}

/**
 * Resumo dos tickets. Por padrão, 1º ticket + contador (`PIM-7862 +2`);
 * com `showAll`, lista todas as chaves (quebrando linha quando faltar espaço).
 */
function TicketSummary({
  tickets,
  className,
  stopPropagation,
  showAll = false,
}: {
  tickets: AllocationTicket[];
  className?: string;
  stopPropagation?: boolean;
  showAll?: boolean;
}) {
  if (tickets.length === 0) return null;
  if (showAll) {
    return (
      <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${className ?? ""}`}>
        {tickets.map((t) => (
          <TicketKey key={t.key} ticket={t} stopPropagation={stopPropagation} />
        ))}
      </div>
    );
  }
  return (
    <span className={`inline-flex items-center gap-0.5 ${className ?? ""}`}>
      <TicketKey ticket={tickets[0]!} stopPropagation={stopPropagation} />
      {tickets.length > 1 ? <span className="font-mono">+{tickets.length - 1}</span> : null}
    </span>
  );
}

function AllocationChip({
  allocation,
  dimmed,
  allowWrap,
  fill,
  canEdit,
  dnd,
  onEdit,
  onReplicate,
  isReplicating,
}: {
  allocation: Allocation;
  dimmed: boolean;
  /** Texto até 4 linhas + tickets: só quando é o único card da célula. */
  allowWrap: boolean;
  /** Estica (flex-1) para ocupar a altura que sobra no contêiner. */
  fill: boolean;
  canEdit: boolean;
  dnd: CardDnd;
  onEdit: () => void;
  onReplicate: () => void;
  isReplicating: boolean;
}) {
  const chipClass = chipClassFor(allocation);
  const washClass = washClassFor(allocation);
  const accentClass = accentClassFor(allocation);
  const badge = weekBadge(allocation);
  const dropSide = dnd.dropSide(allocation.id);
  return (
    <HoverCard openDelay={300}>
      <HoverCardTrigger asChild>
        {/* group/chip: escopo próprio de hover, para não conflitar com
            group/cell (o "+ demanda" da célula) nem acender o ícone de outro
            card na mesma célula. */}
        <div
          draggable={canEdit}
          onDragStart={(e) => {
            e.dataTransfer.setData("text/allocation", allocation.id);
            dnd.start(allocation);
          }}
          onDragEnd={dnd.end}
          onDragOver={(e) => dnd.over(e, allocation)}
          onDragLeave={(e) => dnd.leave(e, allocation)}
          onDrop={(e) => dnd.drop(e, allocation)}
          onClick={onEdit}
          // Teclado: o card é o gatilho de edição, então precisa ser focável e
          // acionável por Enter/Espaço (o arrastar continua só com mouse; a
          // alternativa por teclado é o Sprint/Pessoa do diálogo).
          role="button"
          tabIndex={0}
          aria-label={`Editar demanda: ${allocation.title}`}
          onKeyDown={(e) => {
            // Só reage ao foco no próprio card: Enter/Espaço no "Replicar" ou
            // no link do ticket (filhos) têm a ação nativa deles.
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              // Sem isto o Espaço também rolaria a página.
              e.preventDefault();
              onEdit();
            }
          }}
          // `fill`: cresce (flex-1) para ocupar a altura que sobra (card único da
          // célula, ou último card do grupo de semanas).
          className={`group/chip relative shrink-0 overflow-hidden rounded-md border-l-[3px] px-2 py-1.5 text-left text-foreground shadow-card transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default"
          } ${fill ? "flex-1" : ""} ${washClass} ${accentClass} ${dimmed ? "opacity-25" : ""}`}
        >
          {dropSide ? (
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-primary ${
                dropSide === "before" ? "top-0" : "bottom-0"
              }`}
            />
          ) : null}
          {badge ? (
            // Some no hover do card quando editável: o botão de replicar ocupa o
            // mesmo canto.
            <span
              className={`pointer-events-none absolute right-1.5 top-1 text-[10px] font-medium tabular-nums text-foreground/50 transition-opacity ${
                canEdit
                  ? "group-hover/chip:opacity-0 group-has-[:focus-visible]/chip:opacity-0"
                  : ""
              }`}
            >
              {badge}
            </span>
          ) : null}
          {canEdit ? (
            <button
              onClick={(e) => {
                // Sem isto, o clique no ícone também dispara o onClick do
                // card (linha acima) e abre o AllocationDialog junto.
                e.stopPropagation();
                // Replicação em andamento: ignora o clique (evita cópias
                // duplicadas por cliques rápidos).
                if (isReplicating) return;
                onReplicate();
              }}
              aria-disabled={isReplicating}
              title={isReplicating ? "Replicando…" : "Replicar na próxima sprint"}
              aria-label={isReplicating ? "Replicando…" : "Replicar na próxima sprint"}
              className={`absolute right-1 top-1 z-10 rounded p-0.5 text-foreground/60 transition-opacity hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/chip:opacity-100 group-focus-visible/chip:opacity-100 group-has-[:focus-visible]/chip:opacity-100 ${
                isReplicating ? "cursor-wait opacity-100" : "opacity-0"
              }`}
            >
              {isReplicating ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
          ) : null}
          <p
            className={`text-xs font-medium leading-snug ${allowWrap ? "line-clamp-4" : "line-clamp-2"} ${badge ? "pr-9" : canEdit ? "pr-4" : ""}`}
          >
            {allocation.title}
          </p>
          {allowWrap && (allocation.tickets.length > 0 || allocation.notes) ? (
            allocation.tickets.length > 1 ? (
              // Vários tickets: ocupam linha própria (todos visíveis, com quebra)
              // e as notas descem para a linha de baixo.
              <>
                <TicketSummary
                  tickets={allocation.tickets}
                  stopPropagation
                  showAll
                  className="mt-1 text-[10px] opacity-80"
                />
                {allocation.notes ? (
                  <p className="truncate text-[10px] opacity-80">{allocation.notes}</p>
                ) : null}
              </>
            ) : (
              <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-80">
                <TicketSummary tickets={allocation.tickets} stopPropagation />
                {allocation.notes ? <span className="truncate">{allocation.notes}</span> : null}
              </div>
            )
          ) : null}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-72 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {hasSpecStatus(allocation.tipo) ? (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusInfo(allocation.status).chip}`}
            >
              {statusInfo(allocation.status).label}
            </span>
          ) : null}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${chipClass}`}>
            {tipoInfo(allocation.tipo).label}
          </span>
          {badge ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        <TicketSummary tickets={allocation.tickets} className="text-xs" showAll />
        <p className="text-sm font-medium leading-snug">{allocation.title}</p>
        {allocation.notes ? (
          <p className="text-xs text-muted-foreground">{allocation.notes}</p>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-primary/15 text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

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
      <h2 className="text-lg font-semibold">Vamos montar as alocações do {project}</h2>
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

/** Projeto tem sprint/pessoa cadastrada, só não nenhuma sprint no ano filtrado. */
function EmptyYearState({
  year,
  canEdit,
  onAddSprint,
}: {
  year: number;
  canEdit: boolean;
  onAddSprint: () => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed border-grid-line bg-surface p-10 text-center">
      <h2 className="text-lg font-semibold">Nenhuma sprint cadastrada em {year}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Troque o ano no filtro acima ou cadastre uma sprint com datas dentro de {year}.
      </p>
      {canEdit ? (
        <div className="mt-6 flex justify-center">
          <Button onClick={onAddSprint}>
            <CalendarPlus className="size-4" /> Adicionar sprint
          </Button>
        </div>
      ) : null}
    </div>
  );
}
