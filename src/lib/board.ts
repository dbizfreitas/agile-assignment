import type { JiraProjectKey } from "@/lib/projects";

export type AllocationStatus = "nao_especificada" | "especificada";

export type AllocationTipo = "planejado" | "bug" | "evolutiva" | "ferias";

// jira_project é `text` no banco (a lista mora em src/lib/projects.ts, o banco
// valida só o formato), mas do lado do cliente só as quatro chaves conhecidas
// chegam a ser desenhadas — daí o tipo estreito. As queries usam
// `data as Dev[]`, como já usavam.
export type Team = {
  id: string;
  name: string;
  color: string;
  position: number;
  jira_project: JiraProjectKey;
};

export type Dev = {
  id: string;
  name: string;
  initials: string;
  team_id: string;
  position: number;
  active: boolean;
  jira_project: JiraProjectKey;
  /**
   * Janela de disponibilidade (issue #2). `null` desliga o lado
   * correspondente da regra — pessoa sem janela aparece habilitada em todas
   * as sprints, que é o comportamento de antes destas colunas existirem.
   */
  available_from: string | null;
  available_to: string | null;
};

export type Sprint = {
  id: string;
  code: string;
  quarter: string;
  start_date: string;
  end_date: string;
  days: number;
  position: number;
  jira_project: JiraProjectKey;
};

export type AllocationTicket = {
  key: string;
  url: string | null;
};

export type Allocation = {
  id: string;
  sprint_id: string;
  dev_id: string;
  title: string;
  tickets: AllocationTicket[];
  status: AllocationStatus;
  tipo: AllocationTipo;
  notes: string | null;
  position: number;
  jira_project: JiraProjectKey;
  /**
   * Intervalo contínuo de semanas da sprint (#91), 1-based. Ambos nulos = sem
   * semana; `week_end` nulo com `week_start` preenchido = uma semana só.
   */
  week_start: number | null;
  week_end: number | null;
};

/**
 * `tickets` chega do banco como `Json` não tipado — linhas legadas migradas
 * de `ticket_key`/`ticket_url` podem ter `key: null` (o par antigo era
 * independentemente anulável). Normaliza para o contrato `key: string` antes
 * de qualquer código de UI confiar nele (ex.: `.toLowerCase()` na busca).
 */
export function sanitizeTickets(raw: unknown): AllocationTicket[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => ({
    key: typeof t?.key === "string" ? t.key : "",
    url: typeof t?.url === "string" ? t.url : null,
  }));
}

/**
 * Normaliza texto para a busca do board: remove acentos (só marcas
 * combinantes — `^`, `` ` `` e `~` digitados continuam valendo), ignora
 * maiúsculas e colapsa espaços repetidos.
 */
export function normalizeSearchText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const STATUS_LIST: {
  value: AllocationStatus;
  label: string;
  chip: string;
  dot: string;
}[] = [
  {
    value: "nao_especificada",
    label: "Não especificada",
    chip: "bg-st-nao-especificada text-st-nao-especificada-fg",
    dot: "bg-st-nao-especificada-fg",
  },
  {
    value: "especificada",
    label: "Especificada",
    chip: "bg-st-especificada text-st-especificada-fg",
    dot: "bg-st-especificada-fg",
  },
];

export const TIPO_LIST: {
  value: AllocationTipo;
  label: string;
  dot: string;
}[] = [
  { value: "planejado", label: "Planejado", dot: "bg-muted-foreground/50" },
  { value: "bug", label: "Bug", dot: "bg-st-bug-fg" },
  { value: "evolutiva", label: "Evolutiva", dot: "bg-muted-foreground/50" },
  { value: "ferias", label: "Férias / ausência", dot: "bg-st-ferias-fg" },
];

export const statusInfo = (s: AllocationStatus) =>
  STATUS_LIST.find((x) => x.value === s) ?? STATUS_LIST[0]!;

/** Férias/ausência não têm status de especificação (a coluna segue gravada, mas é ignorada). */
export const hasSpecStatus = (t: AllocationTipo) => t !== "ferias";

export const tipoInfo = (t: AllocationTipo) =>
  TIPO_LIST.find((x) => x.value === t) ?? TIPO_LIST[0]!;

/** Bug/Férias carry their own fixed color; Planejado/Evolutiva follow the status instead. */
export function chipClassFor(a: Pick<Allocation, "tipo" | "status">) {
  if (a.tipo === "bug") return "bg-st-bug text-st-bug-fg";
  if (a.tipo === "ferias") return "bg-st-ferias text-st-ferias-fg";
  return statusInfo(a.status).chip;
}

/** Background-only wash for the allocation card body (translucent tint over the dark surface behind it). */
export function washClassFor(a: Pick<Allocation, "tipo" | "status">) {
  if (a.tipo === "bug") return "bg-st-bug";
  if (a.tipo === "ferias") return "bg-st-ferias";
  return a.status === "especificada" ? "bg-st-especificada" : "bg-st-nao-especificada";
}

/** Solid left-border accent using the same semantic color as washClassFor. */
export function accentClassFor(a: Pick<Allocation, "tipo" | "status">) {
  if (a.tipo === "bug") return "border-st-bug-fg";
  if (a.tipo === "ferias") return "border-st-ferias-fg";
  return a.status === "especificada"
    ? "border-st-especificada-fg"
    : "border-st-nao-especificada-fg";
}

/**
 * `2026-08-15` → `15/08/26`. Fatia a string em vez de construir um `Date`:
 * `new Date("2026-08-15")` é meia-noite UTC e vira 14/08 em `UTC-3`.
 */
export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y?.slice(2)}`;
}

export function formatRange(start: string, end: string) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/**
 * Ano da sprint = ano do início, por fatiamento de string — mesmo cuidado de
 * `formatDate`: `new Date("2026-08-15")` é meia-noite UTC e pode virar o dia
 * (e, na virada do ano, o próprio ano) anterior em fusos negativos.
 */
export function getSprintYear(sprint: Pick<Sprint, "start_date">): number {
  return Number(sprint.start_date.slice(0, 4));
}

/**
 * Uma sprint só é oferecida a uma pessoa quando cabe INTEIRA na janela de
 * disponibilidade dela — quem entra no meio de uma sprint aparece a partir da
 * seguinte. É contenção total, não sobreposição: quem tem meia sprint não
 * deveria receber demanda de sprint cheia. A escolha diverge do texto literal
 * da issue #2 e está justificada na spec.
 *
 * Compara strings `YYYY-MM-DD` diretamente, sem `Date`: nesse formato a ordem
 * lexicográfica É a cronológica, e não passar por `Date` evita o erro de fuso
 * descrito em `formatDate`.
 *
 * Recebe `Pick<…>` e não as entidades inteiras porque depende só das quatro
 * datas — a assinatura estreita diz isso, e mantém a função utilizável pelo
 * novo layout da grade quando a issue #12 reescrever o `BoardGrid`.
 */
export function isDevAvailableInSprint(
  dev: Pick<Dev, "available_from" | "available_to">,
  sprint: Pick<Sprint, "start_date" | "end_date">,
) {
  if (dev.available_from && sprint.start_date < dev.available_from) return false;
  if (dev.available_to && sprint.end_date > dev.available_to) return false;
  return true;
}

/** Período para o tooltip do cabeçalho da coluna; `null` quando não há janela. */
export function formatAvailability(dev: Pick<Dev, "available_from" | "available_to">) {
  if (dev.available_from && dev.available_to) {
    return `Disponível de ${formatDate(dev.available_from)} a ${formatDate(dev.available_to)}`;
  }
  if (dev.available_from) return `Disponível a partir de ${formatDate(dev.available_from)}`;
  if (dev.available_to) return `Disponível até ${formatDate(dev.available_to)}`;
  return null;
}

export function initialsFrom(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export const TEAM_COLORS = [
  "#0f766e",
  "#1d4ed8",
  "#b45309",
  "#be123c",
  "#4d7c0f",
  "#7c2d12",
  "#0369a1",
  "#9333ea",
  "#475569",
];

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

/**
 * Membros de um time na ordem em que as colunas aparecem (#83): `position` e,
 * no empate, o nome — o mesmo desempate do `.order("position").order("name")`
 * da query, para que posições duplicadas não mudem a ordem entre telas.
 */
export function teamMembers(devs: Dev[], teamId: string): Dev[] {
  return devs
    .filter((d) => d.team_id === teamId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** Move `devId` para `toIndex` (0-based, limitado a [0, len]) sem mutar a lista (#83). */
export function moveInTeam(members: Dev[], devId: string, toIndex: number): Dev[] {
  const moving = members.find((m) => m.id === devId);
  if (!moving) return members;
  const rest = members.filter((m) => m.id !== devId);
  const at = Math.max(0, Math.min(toIndex, rest.length));
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/**
 * Só as linhas cuja `position` difere do índice (#83). Renumerar tudo de 0 a
 * N-1 também normaliza duplicatas e buracos herdados, e evita escrever em quem
 * não mudou.
 */
export function renumberChanges<T extends { id: string; position: number }>(
  ordered: T[],
): { id: string; position: number }[] {
  const changes: { id: string; position: number }[] = [];
  ordered.forEach((d, i) => {
    if (d.position !== i) changes.push({ id: d.id, position: i });
  });
  return changes;
}

export type SprintWeek = {
  number: number;
  /** `YYYY-MM-DD`. */
  start: string;
  /** `YYYY-MM-DD`; a última semana pode ser mais curta que 7 dias. */
  end: string;
};

const DAY_MS = 86_400_000;

// Aritmética de data em UTC puro (ver `formatDate`): `new Date("2026-10-05")`
// é meia-noite UTC e o fuso local poderia deslocar o dia.
function isoToDayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY_MS;
}

function dayNumberToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Semanas da sprint (#91): a n-ésima começa em `start + 7(n−1)` dias e vai até
 * `start + 7n − 1`, limitada ao fim da sprint — período que não é múltiplo de
 * 7 deixa a última semana mais curta. Datas inválidas ou fim antes do início
 * resultam em lista vazia.
 */
export function sprintWeeks(sprint: Pick<Sprint, "start_date" | "end_date">): SprintWeek[] {
  const start = isoToDayNumber(sprint.start_date);
  const end = isoToDayNumber(sprint.end_date);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const count = Math.ceil((end - start + 1) / 7);
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    start: dayNumberToIso(start + 7 * i),
    end: dayNumberToIso(Math.min(start + 7 * (i + 1) - 1, end)),
  }));
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * `1ª semana · 05/10 – 09/10`. O intervalo mostra só os dias úteis (início +
 * 4 dias, limitado ao fim da sprint); a semana continua tendo 7 dias para
 * efeito de cálculo.
 */
export function weekLabel(week: SprintWeek): string {
  const lastShown = dayNumberToIso(
    Math.min(isoToDayNumber(week.start) + 4, isoToDayNumber(week.end)),
  );
  return `${week.number}ª semana · ${ddmm(week.start)} – ${ddmm(lastShown)}`;
}

/** Marcador do card: `S1`, `S1–S2`, ou `null` sem semana. */
export function weekBadge(a: Pick<Allocation, "week_start" | "week_end">): string | null {
  if (a.week_start == null) return null;
  const end = a.week_end ?? a.week_start;
  return end === a.week_start ? `S${a.week_start}` : `S${a.week_start}–S${end}`;
}

/**
 * Ordem dos cards na célula (#91): semana inicial (sem semana por último),
 * depois semana final efetiva (a que termina antes vem primeiro) e por fim a
 * ordem manual (`position`).
 */
export function compareAllocations(
  a: Pick<Allocation, "week_start" | "week_end" | "position">,
  b: Pick<Allocation, "week_start" | "week_end" | "position">,
): number {
  const as = a.week_start ?? Number.POSITIVE_INFINITY;
  const bs = b.week_start ?? Number.POSITIVE_INFINITY;
  if (as !== bs) return as < bs ? -1 : 1;
  const ae = a.week_end ?? a.week_start ?? Number.POSITIVE_INFINITY;
  const be = b.week_end ?? b.week_start ?? Number.POSITIVE_INFINITY;
  if (ae !== be) return ae < be ? -1 : 1;
  return a.position - b.position;
}

/**
 * Ajusta as semanas de um card à sprint de destino (#91): semana final além
 * da última vira a última; se nem a inicial existir, o card fica sem semana.
 */
export function clampWeeksToSprint(
  weeks: Pick<Allocation, "week_start" | "week_end">,
  sprint: Pick<Sprint, "start_date" | "end_date">,
): Pick<Allocation, "week_start" | "week_end"> {
  const total = sprintWeeks(sprint).length;
  if (weeks.week_start == null || weeks.week_start > total) {
    return { week_start: null, week_end: null };
  }
  return {
    week_start: weeks.week_start,
    week_end: Math.min(weeks.week_end ?? weeks.week_start, total),
  };
}

/** Mesmas semanas (comparando a final efetiva) — só esses cards se reordenam entre si (#91). */
export function sameWeeks(
  a: Pick<Allocation, "week_start" | "week_end">,
  b: Pick<Allocation, "week_start" | "week_end">,
): boolean {
  if (a.week_start !== b.week_start) return false;
  return (a.week_end ?? a.week_start) === (b.week_end ?? b.week_start);
}
