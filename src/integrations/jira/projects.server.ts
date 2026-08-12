// Server-only.
import { jiraGet } from "./client.server";
import { ALLOWED_PROJECTS } from "./config.server";
import type { JiraProject } from "@/lib/compromisso/types";

interface JiraProjectRaw {
  key: string;
  name: string;
}

interface JiraProjectPage {
  values: JiraProjectRaw[];
  isLast: boolean;
  maxResults: number;
}

// Guarda contra loop infinito: se a API nunca devolver isLast:true (bug,
// resposta inesperada) ou maxResults vier 0/negativo (start nunca avança), o
// laço rodaria pra sempre em vez de só devolver o que já tinha.
const MAX_PAGES = 200;

export async function fetchAllowedProjects(): Promise<JiraProject[]> {
  const out: JiraProjectRaw[] = [];
  let start = 0;
  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const page = await jiraGet<JiraProjectPage>("/rest/api/3/project/search", {
      startAt: String(start),
      maxResults: "50",
      action: "view",
    });
    out.push(...page.values);
    if (page.isLast || page.maxResults <= 0) break;
    start += page.maxResults;
    if (pageNum === MAX_PAGES - 1) {
      console.error(
        `[jira/projects] atingiu o limite de ${MAX_PAGES} páginas — resultado pode estar incompleto.`,
      );
    }
  }
  return out
    .filter((p) => ALLOWED_PROJECTS.has(p.key.toUpperCase()))
    .map((p) => ({ key: p.key, name: p.name }));
}
