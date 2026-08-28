import { AlertCircle, CheckCircle2, ListChecks, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  computeIssueGroups,
  isDoneInSprint,
  makeIsCommitmentIssueForSprint,
  makeIsHeader,
  sprintDoneBound,
  type SprintDataLike,
} from "@/lib/compromisso/calc";
import type { IssueResponse } from "@/lib/compromisso/types";
import { JIRA_BASE } from "@/lib/jira-base";
import type { ViewMode } from "./CompromissoSidebar";

function openJql(keys: string[]) {
  const jql = `key in (${keys.join(", ")})`;
  window.open(
    `${JIRA_BASE}/issues/?jql=${encodeURIComponent(jql)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

export function StatsCards({
  vis,
  all,
  doneSP,
  viewMode,
  sprintData,
}: {
  vis: IssueResponse[];
  all: IssueResponse[];
  doneSP: number;
  viewMode: ViewMode;
  sprintData: SprintDataLike | null | undefined;
}) {
  const isHeader = makeIsHeader(computeIssueGroups(all));
  const countableSP = (i: IssueResponse) => (isHeader(i) ? 0 : (i.sp ?? 0));

  const doneBound = sprintDoneBound(sprintData);
  const done = vis.filter((i) => isDoneInSprint(i, sprintData?.startDate, doneBound));
  const sp = vis.reduce((s, i) => s + countableSP(i), 0);
  const pct = vis.length ? Math.round((done.length / vis.length) * 100) : 0;

  // Na visão "Concluídos", `vis` já É o conjunto de itens atendidos — o corte
  // entre "do compromisso" e "extra" é só a tag COMPROMISSO em categorias.
  const isCommitment = makeIsCommitmentIssueForSprint(sprintData);
  const commitDoneItems = viewMode === "done" ? vis.filter(isCommitment) : [];
  const extraDoneItems = viewMode === "done" ? vis.filter((i) => !isCommitment(i)) : [];
  const commitDoneSP = commitDoneItems.reduce((s, i) => s + countableSP(i), 0);
  const extraDoneSP = extraDoneItems.reduce((s, i) => s + countableSP(i), 0);

  // Bug nunca é estimado por convenção do time — SP em bug é a exceção, não a
  // regra; contá-lo aqui como "gap" apontaria um problema que não existe.
  const noSPItems = vis.filter((i) => i.sp == null && !isHeader(i) && i.type !== "Bug");

  let doneLabel = "Concluído";
  let doneValue = `${pct}%`;
  let doneSub = `${done.length} de ${vis.length} itens`;
  let doneKeys: string[] | null = null;

  if (viewMode === "done") {
    const commitItems = (all ?? []).filter(makeIsCommitmentIssueForSprint(sprintData));
    const commitDone = commitItems.filter((i) =>
      isDoneInSprint(i, sprintData?.startDate, doneBound),
    );
    const commitPct = commitItems.length
      ? Math.round((commitDone.length / commitItems.length) * 100)
      : 0;
    if (commitItems.length) {
      doneLabel = "Concluído do compromisso";
      doneValue = `${commitPct}%`;
      doneSub = `${commitDone.length} de ${commitItems.length} itens`;
      doneKeys = commitItems.map((i) => i.key);
    }
  }

  return (
    <div
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${viewMode === "done" ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
    >
      <StatCard
        icon={<ListChecks className="size-4 text-blue-500" />}
        label={
          viewMode === "done" ? "Total de itens concluídos na sprint" : "Total de itens na sprint"
        }
        value={vis.length}
        sub="itens na sprint"
      />
      {viewMode === "done" ? (
        <>
          <StatCard
            icon={<Sparkles className="size-4 text-purple-500" />}
            label="SPs Compromisso Atendidos"
            value={commitDoneSP}
            sub={`${commitDoneItems.length} item${commitDoneItems.length !== 1 ? "s" : ""}`}
            onClick={
              commitDoneItems.length
                ? () => openJql(commitDoneItems.map((i) => i.key))
                : undefined
            }
          />
          <StatCard
            icon={<Sparkles className="size-4 text-purple-500" />}
            label="Extras"
            value={extraDoneSP}
            sub={`${extraDoneItems.length} item${extraDoneItems.length !== 1 ? "s" : ""}`}
            onClick={
              extraDoneItems.length ? () => openJql(extraDoneItems.map((i) => i.key)) : undefined
            }
          />
        </>
      ) : (
        <StatCard
          icon={<Sparkles className="size-4 text-purple-500" />}
          label="SP Total"
          value={sp}
          sub={`${doneSP} SP concluídos`}
        />
      )}
      <StatCard
        icon={<CheckCircle2 className="size-4 text-green-500" />}
        label={doneLabel}
        value={doneValue}
        sub={doneSub}
        onClick={doneKeys?.length ? () => openJql(doneKeys!) : undefined}
      />
      <StatCard
        icon={<AlertCircle className="size-4 text-amber-500" />}
        label="Sem SP"
        value={noSPItems.length}
        sub={
          noSPItems.length === 0
            ? "todos estimados ✓"
            : `${noSPItems.length} iten${noSPItems.length !== 1 ? "s" : ""} sem estimativa`
        }
        onClick={noSPItems.length ? () => openJql(noSPItems.map((i) => i.key)) : undefined}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  onClick?: (() => void) | undefined;
}) {
  return (
    <Card
      className={`flex flex-col gap-2 p-4 ${onClick ? "cursor-pointer transition-colors hover:bg-accent" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon}
      </div>
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-[11px] text-muted-foreground">{sub}</span>
    </Card>
  );
}
