/**
 * Cálculo puro do burndown do compromisso — port de renderBurndown em
 * jira-live/static/components/charts.js, sem a parte de renderização
 * (Chart.js lá, recharts aqui).
 */
import {
  doneDateOf,
  isDoneInSprint,
  makeIsCommitmentIssueForSprint,
  sprintDoneBound,
  type SprintDataLike,
} from "./calc";
import type { IssueResponse } from "./types";

export interface BurndownKey {
  key: string;
  sp: number | null;
  resolved: boolean;
}

export interface BurndownPoint {
  label: string;
  ideal: number;
  actual: number | null;
}

export interface BurndownData {
  totalSP: number;
  keys: BurndownKey[];
  points: BurndownPoint[];
}

export function computeBurndownData(
  sprintData: SprintDataLike | null | undefined,
  all: IssueResponse[],
): BurndownData | null {
  if (!sprintData?.startDate) return null;

  const isCommitmentIssue = makeIsCommitmentIssueForSprint(sprintData);
  const seen = new Set<string>();
  const commitment = (all ?? []).filter((i) => {
    if (!isCommitmentIssue(i) || seen.has(i.key)) return false;
    seen.add(i.key);
    return true;
  });
  if (!commitment.length) return null;

  const totalSP = commitment.reduce((s, i) => s + (i.sp ?? 0), 0);
  const isResolved = (i: IssueResponse) => i.statusCategory === "done";

  const keys: BurndownKey[] = [...commitment]
    .sort((a, b) => {
      const rank = (i: IssueResponse) => {
        if (isResolved(i)) return 0;
        if (i.sp != null && i.sp > 0) return 1;
        return 2;
      };
      return rank(a) - rank(b);
    })
    .map((i) => ({ key: i.key, sp: i.sp, resolved: isResolved(i) }));

  const startDate = new Date(sprintData.startDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(sprintData.completeDate ?? sprintData.endDate ?? sprintData.startDate);
  endDate.setHours(23, 59, 59, 999);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const cutoff = today < endDate ? today : endDate;

  const dates: Date[] = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }

  const doneBound = sprintDoneBound(sprintData);
  const lastIdx = Math.max(dates.length - 1, 1);

  const points: BurndownPoint[] = dates.map((d, idx) => {
    const label = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const ideal = +(totalSP - (totalSP * idx) / lastIdx).toFixed(1);

    const dayEnd = new Date(d);
    dayEnd.setHours(23, 59, 59, 999);
    if (dayEnd > cutoff) return { label, ideal, actual: null };

    const burnedSP = commitment
      .filter((i) => {
        if (!isDoneInSprint(i, sprintData.startDate, doneBound)) return false;
        const dt = doneDateOf(i);
        return dt ? new Date(dt) <= dayEnd : cutoff <= dayEnd;
      })
      .reduce((s, i) => s + (i.sp ?? 0), 0);
    return { label, ideal, actual: totalSP - burnedSP };
  });

  return { totalSP, keys, points };
}
