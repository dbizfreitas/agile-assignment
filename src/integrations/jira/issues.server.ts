// Server-only.
import { jiraGet } from "./client.server";
import { getCache, setCache } from "./cache.server";
import { withConcurrencyGate } from "./concurrency-gate.server";
import {
  ISSUE_FIELDS,
  SPRINT_FLD,
  SP_FIELD,
  REVIEWER_FIELD,
  CHAMADOS_FIELD,
  JIRA_BASE,
} from "./config.server";
import type { IssueResponse } from "@/lib/compromisso/types";

export interface JiraIssueRaw {
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory: { key: string } };
    issuetype: { name: string; subtask: boolean };
    assignee: { displayName: string } | null;
    /** Campo "Categorias" no Jira (nome de exibição do campo de sistema `labels`) */
    labels?: string[];
    parent?: {
      key: string;
      fields?: {
        summary?: string;
        status?: { name: string; statusCategory: { key: string } };
        issuetype?: { name: string };
      };
    };
    resolutiondate?: string;
    created?: string;
    [key: string]: unknown;
  };
  changelog?: {
    histories: Array<{
      created: string;
      items: Array<{
        field: string;
        from?: string;
        fromString?: string;
        to?: string;
        toString?: string;
      }>;
    }>;
  };
}

interface JiraIssuesPage {
  issues: JiraIssueRaw[];
  total: number;
  maxResults: number;
}

interface JiraStatusRaw {
  id: string;
  statusCategory: { key: string };
}

const DONE_STATUS_IDS_CACHE_KEY = "done-status-ids";

// IDs (estáveis) de todos os status da instância que pertencem à categoria
// "done". Usar ID em vez de nome é essencial: o Jira grava no changelog o
// nome do status como ele estava NO MOMENTO da transição, e esse nome pode
// divergir do nome atual por tradução de locale ou renomeação. Comparar por
// ID evita falsos-negativos causados por essa divergência de string.
async function fetchDoneStatusIds(): Promise<Set<string>> {
  const cached = getCache<string[]>(DONE_STATUS_IDS_CACHE_KEY);
  if (cached) return new Set(cached);
  try {
    const statuses = await jiraGet<JiraStatusRaw[]>("/rest/api/3/status");
    const ids = statuses.filter((s) => s.statusCategory?.key === "done").map((s) => s.id);
    setCache(DONE_STATUS_IDS_CACHE_KEY, ids, 60 * 60_000); // status muda raramente: cache de 1h
    return new Set(ids);
  } catch {
    return new Set();
  }
}

// Momento em que a issue entrou (e permaneceu até agora) na categoria "done".
// Usa o changelog: caminha de trás pra frente e acha a transição mais recente
// de um status NÃO-done para um status done (esse é o instante em que "ficou
// pronta"). `doneNames` é o conjunto de NOMES de status done (derivado dos
// status atuais das issues da sprint) — usado apenas como fallback.
export function computeDoneAt(
  iss: JiraIssueRaw,
  doneNames: Set<string>,
  doneStatusIds?: Set<string>,
): string | null {
  if (iss.fields.status.statusCategory.key !== "done") return null;

  const isDone = (id: string | undefined, name: string | undefined): boolean => {
    if (id != null && doneStatusIds && doneStatusIds.size > 0) return doneStatusIds.has(id);
    return !!name && doneNames.has(name);
  };

  const transitions: Array<{
    at: string;
    fromId?: string | undefined;
    from?: string | undefined;
    toId?: string | undefined;
    to?: string | undefined;
  }> = [];
  const histories = [...(iss.changelog?.histories ?? [])].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
  );
  for (const h of histories) {
    for (const item of h.items) {
      if (item.field === "status") {
        transitions.push({
          at: h.created,
          fromId: item.from,
          from: item.fromString,
          toId: item.to,
          to: item.toString,
        });
      }
    }
  }

  // Nunca transitou de status mas já está done → foi criada nesse estado.
  if (transitions.length === 0) return iss.fields.created ?? null;

  // Transição mais recente de NÃO-done → done (entrou em done e permaneceu).
  for (let i = transitions.length - 1; i >= 0; i--) {
    const t = transitions[i];
    if (!t) continue;
    if (isDone(t.toId, t.to) && !isDone(t.fromId, t.from)) return t.at;
  }
  // Fallback: primeira transição para algum status done.
  for (const t of transitions) if (isDone(t.toId, t.to)) return t.at;
  return null;
}

// Casa tanto a label genérica "compromisso" quanto variantes escopadas por
// sprint ("compromisso-26.3.2" etc.) como a MESMA família.
const COMMIT_LABEL_RE = /^compromisso(-.+)?$/i;

// Momento em que a issue passou a ter, de forma ININTERRUPTA até agora,
// alguma label da família "compromisso" — via changelog do campo "labels".
export function computeCommitmentAt(iss: JiraIssueRaw): string | null {
  const hasFamily = (labels: string[]) => labels.some((l) => COMMIT_LABEL_RE.test(l));
  if (!hasFamily(iss.fields.labels ?? [])) return null;

  const transitions: Array<{ at: string; added: boolean }> = [];
  const histories = [...(iss.changelog?.histories ?? [])].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
  );
  for (const h of histories) {
    for (const item of h.items) {
      if (item.field !== "labels") continue;
      const before = (item.fromString ?? "").split(/\s+/).filter(Boolean);
      const after = (item.toString ?? "").split(/\s+/).filter(Boolean);
      const hadBefore = hasFamily(before);
      const hasAfter = hasFamily(after);
      if (hadBefore !== hasAfter) transitions.push({ at: h.created, added: hasAfter });
    }
  }

  if (transitions.length === 0) return iss.fields.created ?? null;
  const last = transitions[transitions.length - 1];
  if (!last) return iss.fields.created ?? null;
  return last.added ? last.at : (iss.fields.created ?? null);
}

// Pontos de partida (startAt) das páginas restantes, usando o pageSize REAL
// que o Jira devolveu na 1ª página — não o maxResults que a gente pediu.
function computePageStarts(total: number, pageSize: number): number[] {
  const starts: number[] = [];
  if (pageSize <= 0) return starts;
  for (let start = pageSize; start < total; start += pageSize) starts.push(start);
  return starts;
}

function issueInSprint(fields: Record<string, unknown>, sprintId: number): boolean {
  const sprintData = fields[SPRINT_FLD];
  if (sprintData == null) return false;
  const sprints = Array.isArray(sprintData) ? sprintData : [sprintData];
  for (const s of sprints) {
    if (typeof s === "object" && s !== null && (s as { id?: number }).id === sprintId) return true;
    if (
      typeof s === "string" &&
      (s.includes(`id=${sprintId},`) ||
        s.includes(`id=${sprintId}]`) ||
        s.trimEnd().endsWith(`id=${sprintId}`))
    )
      return true;
  }
  return false;
}

async function fetchAllSprintIssues(
  sprintId: number,
): Promise<{ allIssues: JiraIssueRaw[]; doneStatusIds: Set<string> }> {
  const baseParams = { fields: ISSUE_FIELDS.join(","), maxResults: "100", expand: "changelog" };

  const [first, doneStatusIds] = await Promise.all([
    jiraGet<JiraIssuesPage>(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
      ...baseParams,
      startAt: "0",
    }),
    fetchDoneStatusIds(),
  ]);

  const allIssues = [...first.issues];
  const total = first.total;
  const pageSize = first.maxResults || first.issues.length || 100;

  if (total > pageSize) {
    const CONCURRENCY = 3;
    const pageStarts = computePageStarts(total, pageSize);
    for (let i = 0; i < pageStarts.length; i += CONCURRENCY) {
      const batch = pageStarts.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((startAt) =>
          jiraGet<JiraIssuesPage>(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
            ...baseParams,
            startAt: String(startAt),
          }),
        ),
      );
      for (const page of results) allIssues.push(...page.issues);
    }
  }

  return { allIssues, doneStatusIds };
}

export async function fetchIssuesForSprint(sprintId: number): Promise<IssueResponse[]> {
  const { allIssues, doneStatusIds } = await withConcurrencyGate(() =>
    fetchAllSprintIssues(sprintId),
  );

  const doneNames = new Set<string>();
  for (const iss of allIssues) {
    const st = iss.fields.status;
    if (st?.statusCategory?.key === "done" && st.name) doneNames.add(st.name);
  }

  const seen = new Set<string>();
  const result: IssueResponse[] = [];

  for (const iss of allIssues) {
    if (seen.has(iss.key)) continue;
    seen.add(iss.key);
    try {
      const f = iss.fields;
      if (!issueInSprint(f as Record<string, unknown>, sprintId)) continue;

      // Última transição de status no changelog = momento em que entrou no
      // estado atual (sem comparar nomes — evita quebrar com renomeação).
      const histories = [...(iss.changelog?.histories ?? [])].sort(
        (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
      );
      let lastEntered: Date | null = null;
      for (const h of histories) {
        for (const item of h.items) {
          if (item.field === "status") lastEntered = new Date(h.created);
        }
      }
      if (!lastEntered && f.created) lastEntered = new Date(f.created);
      const daysInStatus = lastEntered
        ? Math.floor((Date.now() - lastEntered.getTime()) / 86_400_000)
        : null;

      result.push({
        key: iss.key,
        url: `${JIRA_BASE}/browse/${iss.key}`,
        summary: f.summary ?? "",
        type: f.issuetype?.name ?? "—",
        isSubtask: f.issuetype?.subtask ?? false,
        status: f.status.name,
        statusCategory: f.status.statusCategory.key,
        assignee: f.assignee?.displayName ?? "—",
        categories: f.labels ?? [],
        chamados: ((f[CHAMADOS_FIELD] as string[] | null) ?? []).filter(Boolean),
        parent: f.parent?.key,
        parentType: f.parent?.fields?.issuetype?.name,
        parentSummary: f.parent?.fields?.summary,
        parentStatus: f.parent?.fields?.status?.name,
        parentStatusCategory: f.parent?.fields?.status?.statusCategory?.key,
        parentUrl: f.parent ? `${JIRA_BASE}/browse/${f.parent.key}` : undefined,
        sp: (f[SP_FIELD] as number | null) ?? null,
        resolved: f.resolutiondate,
        created: f.created,
        doneAt: computeDoneAt(iss, doneNames, doneStatusIds),
        commitmentAt: computeCommitmentAt(iss),
        days_in_status: daysInStatus,
        reviewer: (f[REVIEWER_FIELD] as { displayName?: string } | null)?.displayName ?? null,
      });
    } catch (err) {
      // Um campo inesperado numa única issue não pode derrubar a resposta
      // inteira — pula só essa issue e segue as demais.
      console.error(`[jira/issues] Falha ao processar ${iss.key}, issue ignorada:`, err);
    }
  }

  return result;
}
