import { useMemo, useState } from "react";
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
import { CalendarPlus, ExternalLink, Pencil, Plus, Search, UserPlus, Users } from "lucide-react";
import {
  accentClassFor,
  chipClassFor,
  formatAvailability,
  formatRange,
  getSprintYear,
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
import type { JiraProjectKey } from "@/lib/projects";
import { boardErrorMessage } from "@/lib/board-errors";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AllocationDialog, toDraft, type AllocationDraft } from "./AllocationDialog";
import { DevDialog } from "./DevDialog";
import { SprintDialog } from "./SprintDialog";
import { TeamsDialog } from "./TeamsDialog";

export function BoardGrid({
  canEdit,
  project,
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AllocationStatus | "todos">("todos");
  const [tipoFilter, setTipoFilter] = useState<AllocationTipo | "todos">("todos");
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Ano corrente do relógio, não o da sprint mais próxima — decisão da spec.
  // Filtro local, sem persistência: reseta a cada carregamento, igual aos
  // filtros de busca/status/tipo já existentes neste componente.
  const [yearFilter, setYearFilter] = useState<number>(() => new Date().getFullYear());

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
    onError: (e: Error) => toast.error(boardErrorMessage(e)),
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

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const teamPosition = useMemo(() => new Map(teams.map((t, i) => [t.id, i])), [teams]);

  const devs = useMemo(() => {
    const list = devsQ.data ?? [];
    return [...list].sort((a, b) => {
      const teamDiff = (teamPosition.get(a.team_id) ?? 0) - (teamPosition.get(b.team_id) ?? 0);
      return teamDiff !== 0 ? teamDiff : a.position - b.position;
    });
  }, [devsQ.data, teamPosition]);

  const term = search.trim().toLowerCase();
  const matches = (a: Allocation) => {
    const okStatus = statusFilter === "todos" || a.status === statusFilter;
    const okTipo = tipoFilter === "todos" || a.tipo === tipoFilter;
    const okTerm =
      !term ||
      a.title.toLowerCase().includes(term) ||
      a.tickets.some((t) => t.key.toLowerCase().includes(term));
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
    return map;
  }, [allocations]);

  const sprintsWithCards = useMemo(
    () => new Set(allocations.map((a) => a.sprint_id)),
    [allocations],
  );

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
                onChange={(e) => setSearch(e.target.value)}
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
              <Select value={String(yearFilter)} onValueChange={(v) => setYearFilter(Number(v))}>
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
            <FilterChip active={tipoFilter === "todos"} onClick={() => setTipoFilter("todos")}>
              Todos
            </FilterChip>
            {TIPO_LIST.map((t) => (
              <FilterChip
                key={t.value}
                active={tipoFilter === t.value}
                onClick={() => setTipoFilter(t.value)}
              >
                <span className={`size-2 rounded-full ${t.dot}`} />
                {t.label}
              </FilterChip>
            ))}

            <span className="mx-1 h-4 w-px bg-border" />

            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Status
            </span>
            <FilterChip active={statusFilter === "todos"} onClick={() => setStatusFilter("todos")}>
              Todos
            </FilterChip>
            {STATUS_LIST.map((s) => (
              <FilterChip
                key={s.value}
                active={statusFilter === s.value}
                onClick={() => setStatusFilter(s.value)}
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
            <div className="h-full w-full overflow-x-hidden overflow-y-auto rounded-xl border border-grid-line bg-surface shadow-card board-scroll">
              <div
                className="grid w-full"
                style={{
                  gridTemplateColumns: `minmax(0, 1fr) repeat(${devs.length}, minmax(0, 1fr))`,
                  gridTemplateRows: [
                    "auto",
                    ...sprintsInYear.map((s) =>
                      sprintsWithCards.has(s.id) ? "minmax(104px, auto)" : "auto",
                    ),
                  ].join(" "),
                }}
              >
                <div className="sticky top-0 z-20 border-b border-r border-grid-line bg-muted-foreground/15 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Sprint
                </div>
                {devs.map((d) => {
                  const team = teamById.get(d.team_id);
                  const availability = formatAvailability(d);
                  return (
                    <Tooltip key={d.id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            if (!canEdit) return;
                            setDevDialog({ open: true, dev: d });
                          }}
                          style={{ boxShadow: `inset 0 -3px 0 0 ${team?.color ?? "transparent"}` }}
                          className="group sticky top-0 z-10 flex items-center gap-2 overflow-hidden border-b border-r border-grid-line bg-surface-2 px-3 py-2 text-left last:border-r-0 hover:bg-secondary"
                        >
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
                    onDrop={(id, devId) => {
                      if (!canEdit) return;
                      move.mutate({ id, sprint_id: s.id, dev_id: devId });
                    }}
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
          project={project}
          onOpenChange={(o) => !o && setDraft(null)}
        />
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
  matches,
  dragOver,
  setDragOver,
  canEdit,
  onEditSprint,
  onAdd,
  onEdit,
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
  onDrop: (allocationId: string, devId: string) => void;
}) {
  return (
    <>
      <button
        onClick={onEditSprint}
        className="group overflow-hidden border-b border-r border-grid-line bg-muted-foreground/15 px-3 py-1.5 text-left hover:bg-secondary"
      >
        <div className="flex items-center gap-2">
          {sprint.quarter ? (
            <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {sprint.quarter}
            </span>
          ) : null}
          <span className="truncate text-sm font-semibold">{sprint.code}</span>
          <Pencil className="ml-auto size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
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
        return (
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
              available ? "" : "cursor-not-allowed bg-muted-foreground/15"
            } ${dragOver === key ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}`}
          >
            <div className="flex min-h-full w-full flex-col gap-1">
              {items.map((a) => (
                <AllocationChip
                  key={a.id}
                  allocation={a}
                  dimmed={!matches(a)}
                  allowWrap={items.length === 1}
                  canEdit={canEdit}
                  onEdit={() => onEdit(a)}
                />
              ))}
            </div>
            {canEdit && available ? (
              <button
                onClick={() => onAdd(d.id)}
                className="pointer-events-none absolute inset-x-1.5 top-full z-10 mt-0 flex items-center justify-center gap-1 rounded-md border border-dashed border-grid-line bg-surface/90 py-1 text-[11px] text-muted-foreground opacity-0 shadow-card backdrop-blur-sm transition-opacity hover:border-primary hover:text-primary group-hover/cell:pointer-events-auto group-hover/cell:opacity-100"
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

/** 1º ticket + contador (`PIM-7862 +2`) — mesmo resumo no card e no hover, nunca a lista inteira. */
function TicketSummary({
  tickets,
  className,
  stopPropagation,
}: {
  tickets: AllocationTicket[];
  className?: string;
  stopPropagation?: boolean;
}) {
  if (tickets.length === 0) return null;
  const first = tickets[0]!;
  return (
    <span className={`inline-flex items-center gap-0.5 ${className ?? ""}`}>
      {first.url ? (
        <a
          href={first.url}
          target="_blank"
          rel="noreferrer"
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
          className="inline-flex items-center gap-0.5 font-mono underline underline-offset-2"
        >
          {first.key}
          <ExternalLink className="size-2.5" />
        </a>
      ) : (
        <span className="font-mono">{first.key}</span>
      )}
      {tickets.length > 1 ? <span className="font-mono">+{tickets.length - 1}</span> : null}
    </span>
  );
}

function AllocationChip({
  allocation,
  dimmed,
  allowWrap,
  canEdit,
  onEdit,
}: {
  allocation: Allocation;
  dimmed: boolean;
  allowWrap: boolean;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const chipClass = chipClassFor(allocation);
  const washClass = washClassFor(allocation);
  const accentClass = accentClassFor(allocation);
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
      <HoverCardContent side="right" className="w-72 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusInfo(allocation.status).chip}`}
          >
            {statusInfo(allocation.status).label}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${chipClass}`}>
            {tipoInfo(allocation.tipo).label}
          </span>
        </div>
        <TicketSummary tickets={allocation.tickets} className="text-xs" />
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
