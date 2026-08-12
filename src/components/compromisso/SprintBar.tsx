import { Badge } from "@/components/ui/badge";
import type { SprintResponse } from "@/lib/compromisso/types";

export function SprintBar({ sprint }: { sprint: SprintResponse }) {
  const start = sprint.startDate ? sprint.startDate.slice(0, 10) : "?";
  const end = (sprint.completeDate ?? sprint.endDate ?? "").slice(0, 10) || "?";

  let progress: { pct: number; label: string } | null = null;
  if (sprint.startDate && (sprint.endDate || sprint.completeDate)) {
    const s = new Date(sprint.startDate).getTime();
    const e = new Date(sprint.completeDate ?? sprint.endDate!).getTime();
    const now = Date.now();
    const total = Math.max(1, (e - s) / 86_400_000);
    const elapsed = Math.max(0, (now - s) / 86_400_000);
    const pct = Math.min(100, Math.round((elapsed / total) * 100));
    const remaining = Math.max(0, Math.ceil((e - now) / 86_400_000));
    const label =
      sprint.state === "active"
        ? `${pct}% · ${remaining}d restante${remaining !== 1 ? "s" : ""}`
        : `${pct}% · Encerrada`;
    progress = { pct, label };
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
      <span className="text-sm font-semibold">{sprint.name}</span>
      <Badge variant={sprint.state === "active" ? "default" : "secondary"}>
        {sprint.state === "active" ? "Ativa" : "Encerrada"}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {start} → {end}
      </span>
      {progress ? (
        <div
          className="flex min-w-32 items-center gap-2"
          title={`${progress.pct}% do tempo da sprint decorrido`}
        >
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress.pct}%` }} />
          </div>
          <span className="text-[11px] text-muted-foreground">{progress.label}</span>
        </div>
      ) : null}
      {sprint.goal ? (
        <span
          className="ml-auto max-w-lg truncate text-xs text-muted-foreground"
          title={sprint.goal}
        >
          {sprint.goal}
        </span>
      ) : null}
    </div>
  );
}
