// Server-only: nunca importar no topo de um arquivo isomórfico (route files,
// componentes) — só dentro de handlers de createServerFn, via import dinâmico.
// Mesma convenção de src/integrations/supabase/client.server.ts.
import { JIRA_PROJECTS } from "@/lib/projects";

export const JIRA_BASE = (
  process.env["JIRA_BASE_URL"] ?? "https://way2agile.atlassian.net"
).replace(/\/$/, "");
export const SP_FIELD = process.env["JIRA_SP_FIELD"] ?? "customfield_10005";
export const SPRINT_FLD = process.env["JIRA_SPRINT_FIELD"] ?? "customfield_10007";
export const REVIEWER_FIELD = process.env["JIRA_REVIEWER_FIELD"] ?? "customfield_10200";
// Deriva da lista única do cliente (src/lib/projects.ts) em vez de repetir as
// quatro chaves: um projeto novo entra em um lugar só. `Set<string>` explícito
// porque os chamadores testam `.has(key.toUpperCase())`, cujo argumento é
// `string` — com o tipo inferido (`Set<"PIM" | "PH" | …>`) isso não compila.
export const ALLOWED_PROJECTS = new Set<string>(JIRA_PROJECTS.map((p) => p.key));
export const ISSUE_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "assignee",
  "parent",
  "resolutiondate",
  "created",
  "labels",
  SP_FIELD,
  SPRINT_FLD,
  REVIEWER_FIELD,
];
