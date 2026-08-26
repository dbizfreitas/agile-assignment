import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtRelativeTime } from "@/lib/compromisso/calc";
import type { SprintResponse } from "@/lib/compromisso/types";

export type ViewMode = "all" | "done";

interface CompromissoSidebarProps {
  sprints: SprintResponse[];
  sprintId: number | null;
  onSprintChange: (id: number) => void;
  sprintsLoading: boolean;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  statusOptions: string[];
  statusSel: Set<string>;
  onToggleStatus: (s: string) => void;
  assigneeOptions: string[];
  assigneeSel: Set<string>;
  onToggleAssignee: (a: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  lastUpdate: number | null;
}

export function CompromissoSidebar({
  sprints,
  sprintId,
  onSprintChange,
  sprintsLoading,
  viewMode,
  onViewModeChange,
  statusOptions,
  statusSel,
  onToggleStatus,
  assigneeOptions,
  assigneeSel,
  onToggleAssignee,
  onRefresh,
  refreshing,
  lastUpdate,
}: CompromissoSidebarProps) {
  return (
    <nav className="flex h-full w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground">
      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sprint
        </div>
        <Select
          {...(sprintId != null ? { value: String(sprintId) } : {})}
          onValueChange={(v) => onSprintChange(Number(v))}
          disabled={sprintsLoading || sprints.length === 0}
        >
          <SelectTrigger>
            {/* Três estados, não dois: "sem nenhuma sprint" era mostrado com o
                mesmo "Selecione uma sprint…" de quando há o que selecionar —
                e o combo desabilitado ficava sem explicação nenhuma. */}
            <SelectValue
              placeholder={
                sprintsLoading
                  ? "Carregando sprints…"
                  : sprints.length === 0
                    ? "Nenhuma sprint encontrada"
                    : "Selecione uma sprint…"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {sprints.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name} ({s.state === "active" ? "ativa" : "encerrada"})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Visão
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          <button
            type="button"
            aria-pressed={viewMode === "all"}
            onClick={() => onViewModeChange("all")}
            className={`rounded-sm px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === "all"
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Todos
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "done"}
            onClick={() => onViewModeChange("done")}
            className={`rounded-sm px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === "done"
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Concluídos
          </button>
        </div>
      </div>

      {statusOptions.length > 0 ? (
        <FilterChipGroup
          title="Status"
          options={statusOptions}
          selected={statusSel}
          onToggle={onToggleStatus}
        />
      ) : null}

      {assigneeOptions.length > 0 ? (
        <FilterChipGroup
          title="Responsável"
          options={assigneeOptions}
          selected={assigneeSel}
          onToggle={onToggleAssignee}
        />
      ) : null}

      <div className="mt-auto flex flex-col gap-1.5 border-t border-sidebar-border pt-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={onRefresh}
          disabled={!sprintId || refreshing}
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> Atualizar dados
        </Button>
        <span className="text-center text-[11px] text-muted-foreground">
          {lastUpdate ? `Atualizado ${fmtRelativeTime(lastUpdate)}` : ""}
        </span>
      </div>
    </nav>
  );
}

function FilterChipGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.has(opt);
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(opt)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
