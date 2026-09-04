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
