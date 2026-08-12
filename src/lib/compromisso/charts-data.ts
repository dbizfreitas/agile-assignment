/**
 * Preparo de dados (sem renderização) para os gráficos de Status e SP por
 * Responsável — port de renderStatusChart/renderSPChart em
 * jira-live/static/components/charts.js.
 */
import { isDoneInSprint, sprintDoneBound, type SprintDataLike } from "./calc";
import type { IssueResponse } from "./types";

export interface StatusChartDatum {
  status: string;
  count: number;
  category: string;
}

export function computeStatusChartData(vis: IssueResponse[]): StatusChartDatum[] {
  const counts = new Map<string, number>();
  const catMap = new Map<string, string>();
  vis.forEach((i) => {
    counts.set(i.status, (counts.get(i.status) ?? 0) + 1);
    catMap.set(i.status, i.statusCategory);
  });
  return [...counts.entries()].map(([status, count]) => ({
    status,
    count,
    category: catMap.get(status) ?? "new",
  }));
}

export interface SPChartDatum {
  assignee: string;
  done: number;
  resto: number;
}

export function computeSPChartData(
  vis: IssueResponse[],
  all: IssueResponse[],
  sprintData: SprintDataLike | null | undefined,
): SPChartDatum[] {
  const storiesWithSubs = new Set(
    (all ?? []).filter((i) => i.isSubtask && i.parent).map((i) => i.parent as string),
  );
  const byA = new Map<string, { total: number; done: number }>();
  const doneBound = sprintDoneBound(sprintData);
  vis.forEach((i) => {
    if (!i.sp) return;
    if (!i.isSubtask && storiesWithSubs.has(i.key)) return;
    const bucket = byA.get(i.assignee) ?? { total: 0, done: 0 };
    bucket.total += i.sp;
    if (isDoneInSprint(i, sprintData?.startDate, doneBound)) bucket.done += i.sp;
    byA.set(i.assignee, bucket);
  });
  return [...byA.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([assignee, v]) => ({
      assignee: assignee.split(" ")[0] ?? assignee,
      done: v.done,
      resto: v.total - v.done,
    }));
}
