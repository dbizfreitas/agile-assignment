import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getJiraIssues, getJiraSprint, getJiraSprints } from "@/integrations/jira/server-fns";
import { computeContabilizados, isDoneInSprint, sprintDoneBound } from "@/lib/compromisso/calc";
import type { IssueResponse, SprintResponse } from "@/lib/compromisso/types";
import { useShell } from "@/components/shell/shell-context";
import { CompromissoSidebar, type ViewMode } from "./CompromissoSidebar";
import { SprintBar } from "./SprintBar";
import { StatsCards } from "./StatsCards";
import { BurndownCard } from "./BurndownCard";
import { IssuesTable } from "./IssuesTable";
import { SPSummaryCard } from "./SPSummaryCard";
import { ChartsRow } from "./ChartsRow";

const REJECTED_STATUSES = new Set([
  "Rejeitada",
  "Rejeitado",
  "Rejected",
  "Cancelada",
  "Cancelado",
  "Cancelled",
  "Won't Do",
  "Wont Do",
  "Descartada",
  "Descartado",
]);

const AUTO_REFRESH_MS = 10 * 60_000;

export function CompromissoView() {
  const qc = useQueryClient();

  // Projeto e sessão vêm da casca. Foram-se: o estado `project`, a query
  // ["jira","projects"] duplicada, o efeito "se não tem projeto, pega o
  // primeiro" e a chave `compromissoLastProject`.
  const { project } = useShell();

  const [sprintId, setSprintId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [assigneeSel, setAssigneeSel] = useState<Set<string>>(new Set());
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const sprintsQ = useQuery({
    queryKey: ["jira", "sprints", project],
    queryFn: () => getJiraSprints({ data: { project } }),
  });

  // Ao trocar de projeto, esquece a sprint selecionada — evita mostrar dados
  // do projeto anterior como se fossem do novo até a nova lista carregar.
  useEffect(() => {
    setSprintId(null);
    setStatusSel(new Set());
    setAssigneeSel(new Set());
  }, [project]);

  useEffect(() => {
    if (sprintId != null) return;
    const first = sprintsQ.data?.[0];
    if (!first) return;
    const active = sprintsQ.data?.find((s) => s.state === "active");
    setSprintId((active ?? first).id);
  }, [sprintId, sprintsQ.data]);

  const sprintQ = useQuery({
    queryKey: ["jira", "sprint", sprintId],
    queryFn: () => getJiraSprint({ data: { id: sprintId! } }),
    enabled: sprintId != null,
    // O auto-refresh desta tela é de 10 min; 1 min só cobre o bate-volta entre
    // guias, sem atrasar o que o usuário espera ver atualizado.
    staleTime: 60_000,
  });

  const issuesQ = useQuery({
    queryKey: ["jira", "issues", sprintId],
    queryFn: () => getJiraIssues({ data: { sprintId: sprintId! } }),
    enabled: sprintId != null,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (issuesQ.data) setLastUpdate(Date.now());
  }, [issuesQ.data]);

  // Re-renderiza a cada 15s só pra atualizar o texto "há Xmin" — não refaz
  // nenhuma chamada de rede.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const sprintData = sprintQ.data;
  const issues = useMemo(() => issuesQ.data ?? [], [issuesQ.data]);

  const statusOptions = useMemo(() => [...new Set(issues.map((i) => i.status))].sort(), [issues]);
  const assigneeOptions = useMemo(
    () => [...new Set(issues.map((i) => i.assignee))].sort(),
    [issues],
  );

  // Sprint encerrada sem nenhum status escolhido ainda: pré-seleciona todos
  // os status não-rejeitados (mesmo comportamento do jira-live).
  useEffect(() => {
    if (sprintData?.state === "closed" && statusSel.size === 0 && statusOptions.length > 0) {
      const hasRejected = statusOptions.some((s) => REJECTED_STATUSES.has(s));
      if (hasRejected)
        setStatusSel(new Set(statusOptions.filter((s) => !REJECTED_STATUSES.has(s))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintData?.state, statusOptions.join("|")]);

  // Filtro de responsável persiste por projeto (não por sprint) — quem você
  // costuma filtrar tende a se repetir sprint a sprint.
  useEffect(() => {
    if (!project || assigneeSel.size > 0 || assigneeOptions.length === 0) return;
    try {
      const saved: string[] = JSON.parse(
        localStorage.getItem(`compromissoAssignee:${project}`) ?? "[]",
      );
      const restored = saved.filter((a) => assigneeOptions.includes(a));
      if (restored.length) setAssigneeSel(new Set(restored));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, assigneeOptions.join("|")]);

  function toggleStatus(s: string) {
    setStatusSel((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function toggleAssignee(a: string) {
    setAssigneeSel((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      try {
        localStorage.setItem(`compromissoAssignee:${project}`, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }

  const vis = useMemo(() => {
    let list = issues;
    if (viewMode === "done") {
      list = list.filter((i) =>
        isDoneInSprint(i, sprintData?.startDate, sprintDoneBound(sprintData)),
      );
    }
    if (statusSel.size > 0) list = list.filter((i) => statusSel.has(i.status));
    if (assigneeSel.size > 0) list = list.filter((i) => assigneeSel.has(i.assignee));
    return list;
  }, [issues, viewMode, statusSel, assigneeSel, sprintData]);

  const doneSP = useMemo(() => {
    let doneVis = issues.filter((i) =>
      isDoneInSprint(i, sprintData?.startDate, sprintDoneBound(sprintData)),
    );
    if (statusSel.size > 0) doneVis = doneVis.filter((i) => statusSel.has(i.status));
    if (assigneeSel.size > 0) doneVis = doneVis.filter((i) => assigneeSel.has(i.assignee));
    return computeContabilizados(doneVis, issues);
  }, [issues, statusSel, assigneeSel, sprintData]);

  const showReviewer =
    viewMode === "all" &&
    statusSel.size >= 1 &&
    [...statusSel].some((s) => s.toUpperCase() === "PULL REQUEST");
  const singleStatus = statusSel.size === 1;

  const refreshing = sprintQ.isFetching || issuesQ.isFetching;

  async function handleRefresh() {
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["jira", "sprint", sprintId] }),
        qc.invalidateQueries({ queryKey: ["jira", "issues", sprintId] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar");
    }
  }

  // Auto-refresh silencioso: só com a sprint ativa e a aba visível — evita
  // gastar chamadas ao Jira com a aba em segundo plano.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (sprintData?.state !== "active") return;
      handleRefresh();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintData?.state, sprintId]);

  const loadError = issuesQ.error ?? sprintQ.error ?? sprintsQ.error;

  return (
    // `min-h-0 flex-1` em vez de `h-screen`: quem ocupa a viewport é a casca.
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <CompromissoSidebar
        sprints={sprintsQ.data ?? []}
        sprintId={sprintId}
        onSprintChange={setSprintId}
        sprintsLoading={sprintsQ.isLoading}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        statusOptions={statusOptions}
        statusSel={statusSel}
        onToggleStatus={toggleStatus}
        assigneeOptions={assigneeOptions}
        assigneeSel={assigneeSel}
        onToggleAssignee={toggleAssignee}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        lastUpdate={lastUpdate}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <main className="flex-1 space-y-4 p-4">
          {loadError ? (
            <p className="py-20 text-center text-sm text-destructive">
              {loadError instanceof Error ? loadError.message : "Erro ao carregar dados do Jira."}
            </p>
          ) : issuesQ.isLoading || sprintQ.isLoading ? (
            <p className="py-20 text-center text-sm text-muted-foreground">Carregando sprint…</p>
          ) : !sprintData ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              Selecione uma sprint na barra lateral.
            </p>
          ) : (
            <CompromissoContent
              sprintData={sprintData}
              issues={issues}
              vis={vis}
              doneSP={doneSP}
              viewMode={viewMode}
              singleStatus={singleStatus}
              showReviewer={showReviewer}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function CompromissoContent({
  sprintData,
  issues,
  vis,
  doneSP,
  viewMode,
  singleStatus,
  showReviewer,
}: {
  sprintData: SprintResponse;
  issues: IssueResponse[];
  vis: IssueResponse[];
  doneSP: number;
  viewMode: ViewMode;
  singleStatus: boolean;
  showReviewer: boolean;
}) {
  return (
    <>
      <SprintBar sprint={sprintData} />
      <StatsCards
        vis={vis}
        all={issues}
        doneSP={doneSP}
        viewMode={viewMode}
        sprintData={sprintData}
      />
      <BurndownCard sprintData={sprintData} all={issues} />
      <IssuesTable vis={vis} all={issues} singleStatus={singleStatus} showReviewer={showReviewer} />
      <SPSummaryCard vis={vis} all={issues} viewMode={viewMode} />
      <ChartsRow vis={vis} all={issues} sprintData={sprintData} />
    </>
  );
}
