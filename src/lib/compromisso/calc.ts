/**
 * Lógica de negócio pura da aba Compromisso — port de jira-live
 * (static/utils.js + static/components/table.js). Sem DOM, sem HTML: só
 * transforma IssueResponse[] em dados prontos para os componentes React
 * renderizarem. Isomórfico (roda no cliente, igual ao jira-live original).
 */
import type { IssueResponse } from "./types";

// ── Compromisso da sprint ─────────────────────────────────────────────────────
// "Compromisso" é a label genérica COMPROMISSO — sem escopo de sprint no nome
// (o Jira grava, via changelog, o instante em que ela foi declarada). O que
// evita o vazamento entre sprints (campo Sprint do Jira é cumulativo) é um
// intervalo de tempo: a issue conta como compromisso da sprint [start, end]
// quando `commitmentAt` é <= end da sprint E (ainda não concluída OU `doneAt`
// >= start da sprint).
const COMMIT_LABEL = "compromisso";

const normLabel = (s: string | null | undefined) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
const labelsOf = (issue: IssueResponse) => (issue?.categories ?? []).map(normLabel);

export function doneDateOf(i: IssueResponse): string | null | undefined {
  return i?.doneAt ?? i?.resolved ?? null;
}

// Verdadeiro só se a issue está na categoria "done" E ficou pronta DENTRO da
// sprint (entre startDate e sprintEnd, se informado). Itens concluídos em
// sprint anterior e arrastados para a atual NÃO contam como concluídos aqui.
export function isDoneInSprint(
  i: IssueResponse,
  sprintStart?: string,
  sprintEnd?: string | null,
): boolean {
  if (!i || i.statusCategory !== "done") return false;
  const d = doneDateOf(i);
  if (sprintStart && d && new Date(d).getTime() < new Date(sprintStart).getTime()) return false;
  if (sprintEnd && d && new Date(d).getTime() > new Date(sprintEnd).getTime()) return false;
  return true;
}

export interface SprintLike {
  state: string;
  completeDate?: string | undefined;
  endDate?: string | undefined;
}

// Limite superior do "concluído dentro da sprint" — só existe para sprint já
// ENCERRADA. Sprint ativa não tem limite: conclusões de hoje devem contar.
export function sprintDoneBound(sprintData?: SprintLike | null): string | null {
  if (!sprintData || sprintData.state !== "closed") return null;
  return sprintData.completeDate ?? sprintData.endDate ?? null;
}

function makeIsCommitmentIssue(sprintStart?: string, sprintEnd?: string | null) {
  return (issue: IssueResponse) => {
    if (!labelsOf(issue).includes(COMMIT_LABEL)) return false;
    const committedAt = issue?.commitmentAt;
    if (!committedAt) return false;
    if (sprintEnd && new Date(committedAt).getTime() > new Date(sprintEnd).getTime()) return false;
    if (issue?.statusCategory === "done") {
      const d = doneDateOf(issue);
      if (sprintStart && d && new Date(d).getTime() < new Date(sprintStart).getTime()) return false;
    }
    return true;
  };
}

// Correção pontual para sprints já ENCERRADAS cuja label COMPROMISSO só foi
// aplicada no Jira DEPOIS do fim da sprint (backfill manual). Mapeado por ID
// de sprint (Jira Agile API) para a lista de chaves extraída do goal da sprint.
export const SPRINT_COMMITMENT_OVERRIDES: Record<number, string[]> = {
  4967: [
    // PDC-26.2.5 (25/06–16/07/2026) — label aplicada retroativamente em 29/07/2026
    "PDC-1590",
    "PDC-2068",
    "PDC-1952",
    "PDC-2022",
    "PDC-2023",
    "PDC-2024",
    "PDC-2025",
    "PDC-2034",
    "PDC-2008",
    "PDC-1981",
    "PDC-2045",
    "PDC-2044",
    "PDC-2006",
    "PDC-2007",
    "PDC-2009",
    "PDC-2010",
  ],
};

export interface SprintDataLike extends SprintLike {
  id: number;
  startDate?: string | undefined;
}

export function makeIsCommitmentIssueForSprint(sprintData?: SprintDataLike | null) {
  const override = sprintData ? SPRINT_COMMITMENT_OVERRIDES[sprintData.id] : undefined;
  if (override) {
    const keys = new Set(override);
    return (issue: IssueResponse) => keys.has(issue?.key);
  }
  return makeIsCommitmentIssue(sprintData?.startDate, sprintDoneBound(sprintData));
}

// ── Cabeçalhos / rollup de SP ──────────────────────────────────────────────────
// Cabeçalho = item que TEM filhas na sprint. O SP do pai é rollup das filhas
// (a Automation do Jira soma o SP das filhas no pai), então contar os dois
// lados duplicaria — o pai vira cabeçalho com SP ignorado e só as filhas
// contam. Duas formas de filha: subtask (qualquer pai com subtarefa na
// sprint), ou issue não-subtask pontuada cujo pai também está na sprint (ex.:
// Épico que entrou na sprint junto com as filhas).
export function computeIssueGroups(all: IssueResponse[]) {
  const list = all ?? [];
  const parentsWithSubs = new Set(
    list.filter((i) => i.isSubtask && i.parent).map((i) => i.parent as string),
  );
  const epicsWithScoredChildren = new Set(
    list.filter((i) => !i.isSubtask && i.parent && i.sp != null).map((i) => i.parent as string),
  );
  return { parentsWithSubs, epicsWithScoredChildren };
}

export function makeIsHeader({
  parentsWithSubs,
  epicsWithScoredChildren,
}: ReturnType<typeof computeIssueGroups>) {
  return (i: IssueResponse) =>
    !i.isSubtask && (parentsWithSubs.has(i.key) || epicsWithScoredChildren.has(i.key));
}

// Cabeçalho conta 0; toda filha (subtask ou não) conta o próprio SP.
export function computeContabilizados(items: IssueResponse[], all: IssueResponse[]): number {
  const isHeader = makeIsHeader(computeIssueGroups(all));
  return items.reduce((total, i) => total + (isHeader(i) ? 0 : (i.sp ?? 0)), 0);
}

const STORY_TYPES = ["História", "Historia", "Story", "Estória"];
export function isStoryType(t: string): boolean {
  return STORY_TYPES.includes(t);
}

export interface SPSummaryRow {
  label: string;
  labelHref?: string;
  items: string | number;
  sp: number;
}

export interface SPSummaryData {
  rows: SPSummaryRow[];
  totalSP: number;
  ignoredSP: number;
  noSPItems: IssueResponse[];
  headers: number;
  countable: number;
}

function truncate(s: string | undefined, n: number): string {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n) + "…" : str;
}

// Detalhamento de SP por origem (subtasks de história, histórias sem
// subtasks, melhorias, tarefas, bugs, subtasks órfãs) — port de
// computeSPSummaryData em table.js.
export function computeSPSummaryData(vis: IssueResponse[], all: IssueResponse[]): SPSummaryData {
  const groups = computeIssueGroups(all);
  const { parentsWithSubs } = groups;
  const isHeader = makeIsHeader(groups);

  let totalSP = 0;
  let ignoredSP = 0;
  const rows: SPSummaryRow[] = [];
  const handledSubs = new Set<string>();

  const doneParents = vis
    .filter((i) => !i.isSubtask && parentsWithSubs.has(i.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  doneParents.forEach((parent) => {
    const doneSubs = vis.filter((i) => i.isSubtask && i.parent === parent.key);
    doneSubs.forEach((s) => handledSubs.add(s.key));
    const subSP = doneSubs.reduce((s, i) => s + (i.sp ?? 0), 0);
    const label =
      doneSubs.length > 0
        ? `Subtasks de ${parent.key} (${truncate(parent.summary, 55)})`
        : `${parent.key} (${truncate(parent.summary, 55)}) — subtasks não concluídas`;
    rows.push({
      label,
      labelHref: parent.url,
      items: doneSubs.length > 0 ? `${doneSubs.length} subtasks` : "0 subtasks concluídas",
      sp: subSP,
    });
    totalSP += subSP;
    if (parent.sp) ignoredSP += parent.sp;
  });

  const rollupHeaders = vis.filter((i) => isHeader(i) && !parentsWithSubs.has(i.key));
  rollupHeaders.forEach((h) => {
    if (h.sp) ignoredSP += h.sp;
  });

  const orphanSubs = vis.filter((i) => i.isSubtask && !handledSubs.has(i.key));
  if (orphanSubs.length) {
    const oSP = orphanSubs.reduce((s, i) => s + (i.sp ?? 0), 0);
    rows.push({
      label: "Subtarefas independentes (pai fora da sprint ou não concluído)",
      items: `${orphanSubs.length} subtasks`,
      sp: oSP,
    });
    totalSP += oSP;
  }

  const storiesNoSub = vis.filter((i) => isStoryType(i.type) && !isHeader(i));
  const snsSP = storiesNoSub.reduce((s, i) => s + (i.sp ?? 0), 0);
  rows.push({ label: "Histórias sem subtasks", items: storiesNoSub.length, sp: snsSP });
  totalSP += snsSP;

  const melh = vis.filter(
    (i) => !i.isSubtask && i.type.toLowerCase().includes("melho") && !isHeader(i),
  );
  if (melh.length) {
    const mSP = melh.reduce((s, i) => s + (i.sp ?? 0), 0);
    rows.push({
      label: "Melhorias (com SP)",
      items: melh.filter((i) => i.sp != null).length,
      sp: mSP,
    });
    totalSP += mSP;
  }

  const tasks = vis.filter(
    (i) =>
      !i.isSubtask &&
      !isStoryType(i.type) &&
      i.type !== "Bug" &&
      !i.type.toLowerCase().includes("melho") &&
      !isHeader(i),
  );
  const tasksComSP = tasks.filter((i) => i.sp != null);
  const tSP = tasksComSP.reduce((s, i) => s + (i.sp ?? 0), 0);
  rows.push({ label: "Tarefas (com SP)", items: tasksComSP.length, sp: tSP });
  totalSP += tSP;

  const bugs = vis.filter((i) => i.type === "Bug" && !i.isSubtask && !isHeader(i));
  const bSP = bugs.reduce((s, i) => s + (i.sp ?? 0), 0);
  rows.push({ label: "Bugs", items: bugs.length, sp: bSP });
  totalSP += bSP;

  // Cabeçalho não é item contável; bug nunca é estimado por convenção do
  // time — não entra como gap.
  const noSPItems = vis.filter((i) => i.sp == null && !isHeader(i) && i.type !== "Bug");
  const headers = doneParents.length + rollupHeaders.length;
  return { rows, totalSP, ignoredSP, noSPItems, headers, countable: vis.length - headers };
}

// Carimbo de hora vivo: "há Xmin" muda sozinho e comunica a defasagem de
// forma honesta (em vez de um horário fixo escrito uma vez).
export function fmtRelativeTime(ts: number | null): string {
  if (!ts) return "—";
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 10) return "agora mesmo";
  if (diffSec < 60) return `há ${diffSec}s`;
  const min = Math.round(diffSec / 60);
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin === 0 ? `há ${h}h` : `há ${h}h${remMin}min`;
}
