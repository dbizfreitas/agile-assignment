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

export function formatRange(start: string, end: string) {
  const f = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y?.slice(2)}`;
  };
  return `${f(start)} – ${f(end)}`;
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
