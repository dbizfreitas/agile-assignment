/**
 * Camada pura do Cycle Time — sem DOM, sem HTML, isomórfica. Segue o
 * precedente de src/lib/compromisso/calc.ts e recebe o que em
 * jira-live/static/components/cycle-time.js estava misturado com geração de
 * innerHTML.
 *
 * Os conjuntos e ordens abaixo decidem QUAIS COLUNAS DESENHAR. São distintos,
 * de propósito, dos conjuntos de exclusão de cycle-time.server.ts, que decidem
 * QUAIS ISSUES BUSCAR E QUE TEMPO SOMAR. Fundir os dois trocaria dois
 * conceitos por um errado.
 *
 * O cálculo de tempo por status (buildCtPayload) NÃO vem para cá: depende do
 * changelog cru, que nunca cruza a fronteira — igual computeDoneAt fica em
 * issues.server.ts.
 */
import type { CycleTimeIssue, CycleTimeMode } from "./types";

const normKey = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/** Colunas escondidas na sub-visão "Em Andamento". */
const CT_EXCLUDED_COLS = new Set([
  "to do",
  "todo",
  "backlog",
  "tarefas pendentes",
  "tarefas_pendentes",
  "done",
  "concluído",
  "concluido",
  "rejeitada",
  "rejeitado",
  "rejected",
  "cancelada",
  "cancelado",
  "cancelled",
  "ready to dev",
  "em análise",
  "em analise",
  "ready to specify",
  "to research",
  "to discover",
  "in discover",
]);

/** Ordem preferida das colunas em "Em Andamento" (minúsculas). */
const CT_COL_ORDER = [
  "in progress",
  "em andamento",
  "pull request",
  "ready for test",
  "test",
  "qa blocked",
  "qa approved",
];

/** No "Histórico Completo" só os terminais somem — o resto do fluxo aparece. */
const CT_EXCLUDED_COLS2 = new Set([
  "done",
  "concluído",
  "concluido",
  "rejeitada",
  "rejeitado",
  "rejected",
  "cancelada",
  "cancelado",
  "cancelled",
]);

const CT_COL_ORDER2 = [
  "em análise",
  "em analise",
  "ready to dev",
  "todo",
  "to do",
  "backlog",
  "tarefas pendentes",
  "tarefas_pendentes",
  "to research",
  "to discover",
  "to discovery",
  "in discover",
  "in research",
  "in discovery",
  "blocked in discovery",
  "blocked in discover",
  "waiting priorization",
  "waiting prioritization",
  "blocked",
  "ready to specify",
  "doing",
  "in progress",
  "em andamento",
  "pull request",
  "ready for test",
  "test",
  "qa blocked",
  "qa approved",
];

/**
 * "3d 4h". `—` quando não há valor.
 *
 * O original testa `if (!d && d !== 0)`; aqui a checagem é explícita por
 * `undefined`/`NaN` para que o TypeScript estreite o tipo — o resultado é o
 * mesmo em todos os valores possíveis (0 continua virando "0h").
 */
export function fmtDays(d: number | undefined): string {
  if (d === undefined || Number.isNaN(d)) return "—";
  const days = Math.floor(d);
  const hours = Math.round((d - days) * 24);
  if (days === 0) return `${hours}h`;
  if (hours === 0) return `${days}d`;
  return `${days}d ${hours}h`;
}

/** Igual a fmtDays, mas colapsa acima de 365 dias em "2a 130d". */
export function fmtDays2(d: number | undefined): string {
  if (d === undefined || Number.isNaN(d)) return "—";
  const totalDays = Math.floor(d);
  const hours = Math.round((d - totalDays) * 24);
  if (totalDays === 0) return `${hours}h`;
  if (totalDays < 365) return hours === 0 ? `${totalDays}d` : `${totalDays}d ${hours}h`;
  const years = Math.floor(totalDays / 365);
  const remDays = totalDays % 365;
  return remDays === 0 ? `${years}a` : `${years}a ${remDays}d`;
}

export type SpeedTier = "rápido" | "médio" | "lento";

/** Limiares de UMA CÉLULA — tempo parado num único status. */
export function speedTier(d: number): SpeedTier {
  return d <= 1 ? "rápido" : d <= 3 ? "médio" : "lento";
}

/**
 * Limiares do CICLO INTEIRO — diferentes dos da célula, de propósito: um é
 * tempo num status, o outro é o ciclo todo. (Também são diferentes dos de
 * DaysInStatus em IssuesTable, que mede "dias no status atual" — outra
 * grandeza.)
 *
 * Divergência deliberada do original: lá a COR do total usava estes limiares
 * mas o RÓTULO usava os da célula, então uma issue de 5 dias saía amarela
 * descrita como "lento". Cor e rótulo passam a concordar.
 */
export function totalTier(d: number): SpeedTier {
  return d <= 3 ? "rápido" : d <= 7 ? "médio" : "lento";
}

/**
 * Funde variantes do mesmo status numa coluna só ("Em andamento"/"In
 * Progress", "QA"/"In Test"). O nome canônico é o primeiro que aparecer,
 * varrendo os status do projeto antes dos que só existem nas issues.
 *
 * Divergência deliberada do original: lá a função MUTAVA `row.status_days` in
 * place. Aqui devolve issues novas — o array vem do cache do TanStack Query e
 * é compartilhado entre renders; mutá-lo faria a fusão rodar em cima de si
 * mesma a cada re-render.
 */
export function mergeStatusVariants(
  issues: CycleTimeIssue[],
  projectStatuses: string[],
  aliases: Record<string, string>,
): CycleTimeIssue[] {
  const resolve = (k: string) => aliases[k] ?? k;
  const canonical = new Map<string, string>();
  for (const st of [...projectStatuses, ...issues.flatMap((r) => Object.keys(r.status_days))]) {
    const k = resolve(normKey(st));
    if (k && !canonical.has(k)) canonical.set(k, st);
  }
  return issues.map((row) => {
    const merged: Record<string, number> = {};
    for (const [st, days] of Object.entries(row.status_days)) {
      const key = canonical.get(resolve(normKey(st))) ?? st;
      merged[key] = Math.round(((merged[key] ?? 0) + days) * 10) / 10;
    }
    return { ...row, status_days: merged };
  });
}

/**
 * Ordem das colunas: status do projeto primeiro, depois os que só aparecem nas
 * issues. Quando a listagem de status do projeto falha e vem `[]`, este é o
 * fallback — "ordem de aparição nas issues".
 */
export function buildStatusOrder(
  projectStatuses: string[],
  issues: CycleTimeIssue[],
  excluded: Set<string>,
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const st of [...projectStatuses, ...issues.flatMap((r) => Object.keys(r.status_days))]) {
    if (!seen.has(st) && !excluded.has(st.toLowerCase().trim())) {
      seen.add(st);
      order.push(st);
    }
  }
  return order;
}

export interface CycleTimeViewConfig {
  /** Chave normalizada → chave canônica, para fundir variantes do mesmo status. */
  aliases: Record<string, string>;
  /** Colunas que nunca aparecem nesta sub-visão. */
  excludedCols: Set<string>;
  /** Ordem preferida (minúsculas); o que não estiver aqui vai para o fim. */
  colOrder: string[];
  /**
   * "Histórico Completo" só mostra coluna com algum valor > 0; "Em Andamento"
   * aceita a chave existir. É assim no original, e a diferença importa: com o
   * arredondamento a 1 casa, um status de poucos minutos vira 0.
   */
  requirePositive: boolean;
  fmt: (d: number | undefined) => string;
  /** `null` = sem paginação (no modo standard o servidor já corta em 200). */
  pageSize: number | null;
}

export function buildColumns(
  issues: CycleTimeIssue[],
  projectStatuses: string[],
  config: CycleTimeViewConfig,
): string[] {
  const active = new Set<string>();
  for (const row of issues) {
    for (const [st, days] of Object.entries(row.status_days)) {
      if (!config.requirePositive || days > 0) active.add(st);
    }
  }
  return buildStatusOrder(projectStatuses, issues, config.excludedCols)
    .filter((st) => active.has(st))
    .sort((a, b) => {
      const ia = config.colOrder.indexOf(a.toLowerCase().trim());
      const ib = config.colOrder.indexOf(b.toLowerCase().trim());
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
}

export type CycleTimeFixedCol = "key" | "summary" | "current_status" | "fix_versions" | "total";

/**
 * Coluna fixa ou coluna de status, discriminadas. O original guardava um único
 * `sortCol: string`, o que confundia um status chamado "Total" ou "Chave" com
 * a coluna homônima; o discriminante elimina a ambiguidade sem mudar
 * comportamento em nenhum dado real.
 */
export type CycleTimeSort =
  | { kind: "fixed"; col: CycleTimeFixedCol; dir: 1 | -1 }
  | { kind: "status"; col: string; dir: 1 | -1 };

export function sortIssues(issues: CycleTimeIssue[], sort: CycleTimeSort | null): CycleTimeIssue[] {
  if (!sort) return issues;
  const value = (i: CycleTimeIssue): string | number => {
    if (sort.kind === "status") return i.status_days[sort.col] ?? 0;
    if (sort.col === "key") return i.key;
    if (sort.col === "summary") return i.summary;
    if (sort.col === "current_status") return i.current_status;
    if (sort.col === "fix_versions") return i.fix_versions;
    return i.total_days;
  };
  return [...issues].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === "string") return sort.dir * va.localeCompare(String(vb), "pt-BR");
    return sort.dir * (va - Number(vb));
  });
}

/**
 * Uma entrada por sub-visão. Os aliases são os mesmos do original: "Em
 * Andamento" funde pouca coisa; "Histórico Completo" colapsa toda a
 * pré-esteira ("Backlog", "To Research", "Blocked"…) numa coluna "todo" só,
 * senão a tabela ganharia quinze colunas quase vazias.
 */
export const CYCLE_TIME_CONFIG: Record<CycleTimeMode, CycleTimeViewConfig> = {
  standard: {
    aliases: { emandamento: "inprogress", intest: "test", qa: "test" },
    excludedCols: CT_EXCLUDED_COLS,
    colOrder: CT_COL_ORDER,
    requirePositive: false,
    fmt: fmtDays,
    pageSize: null,
  },
  full: {
    aliases: {
      tarefaspendentes: "todo",
      backlog: "todo",
      toresearch: "todo",
      todiscover: "todo",
      todiscovery: "todo",
      indiscover: "todo",
      inresearch: "todo",
      indiscovery: "todo",
      blockedindiscovery: "todo",
      blockedindiscover: "todo",
      waitingpriorization: "todo",
      waitingprioritization: "todo",
      blocked: "todo",
      readytospecify: "todo",
      readytoespecify: "todo",
      doing: "todo",
      emandamento: "inprogress",
      intest: "test",
      qa: "test",
    },
    excludedCols: CT_EXCLUDED_COLS2,
    colOrder: CT_COL_ORDER2,
    requirePositive: true,
    fmt: fmtDays2,
    pageSize: 100,
  },
};
