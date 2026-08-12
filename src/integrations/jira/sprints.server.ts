// Server-only.
import { jiraGet } from "./client.server";
import { ALLOWED_PROJECTS } from "./config.server";
import { getCache, setCache } from "./cache.server";
import type { SprintResponse } from "@/lib/compromisso/types";

export interface JiraSprintRaw {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
  originBoardId?: number;
}

interface JiraBoardPage {
  values: Array<{ id: number; name: string }>;
  isLast: boolean;
  maxResults: number;
}

interface JiraSprintPage {
  values: JiraSprintRaw[];
  isLast: boolean;
  maxResults: number;
}

// Guarda contra loop infinito — mesma razão de projects.server.ts.
const MAX_PAGES = 200;

async function fetchBoards(project: string): Promise<Array<{ id: number }>> {
  const boards: Array<{ id: number }> = [];
  let start = 0;
  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    let page: JiraBoardPage;
    try {
      page = await jiraGet<JiraBoardPage>("/rest/agile/1.0/board", {
        projectKeyOrId: project,
        startAt: String(start),
        maxResults: "50",
        type: "scrum",
      });
    } catch (err) {
      console.warn(
        `[jira/sprints] Falha ao buscar boards para projeto "${project}" (startAt=${start}):`,
        err,
      );
      break;
    }
    boards.push(...page.values);
    if (page.isLast || page.maxResults <= 0) break;
    start += page.maxResults;
    if (pageNum === MAX_PAGES - 1) {
      console.error(
        `[jira/sprints] fetchBoards("${project}") atingiu o limite de ${MAX_PAGES} páginas — resultado pode estar incompleto.`,
      );
    }
  }
  return boards;
}

async function fetchSprintsForBoard(boardId: number): Promise<JiraSprintRaw[]> {
  const sprints: JiraSprintRaw[] = [];
  let start = 0;
  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    let page: JiraSprintPage;
    try {
      page = await jiraGet<JiraSprintPage>(`/rest/agile/1.0/board/${boardId}/sprint`, {
        state: "active,closed",
        startAt: String(start),
        maxResults: "50",
      });
    } catch (err) {
      console.warn(
        `[jira/sprints] Falha ao buscar sprints do board ${boardId} (startAt=${start}):`,
        err,
      );
      break;
    }
    sprints.push(...page.values);
    if (page.isLast || page.maxResults <= 0) break;
    start += page.maxResults;
    if (pageNum === MAX_PAGES - 1) {
      console.error(
        `[jira/sprints] fetchSprintsForBoard(${boardId}) atingiu o limite de ${MAX_PAGES} páginas — resultado pode estar incompleto.`,
      );
    }
  }
  return sprints;
}

// Projeto (via board de origem) da sprint — usado só pra validar que
// fetchSprintById não devolve sprint de fora dos 4 projetos permitidos.
// Board raramente muda de projeto, então cache de 1h é seguro.
async function boardProjectKey(boardId: number): Promise<string | null> {
  const cacheKey = `board-project:${boardId}`;
  const cached = getCache<string>(cacheKey);
  if (cached) return cached;
  try {
    const board = await jiraGet<{ location?: { projectKey?: string } }>(
      `/rest/agile/1.0/board/${boardId}`,
    );
    const key = board.location?.projectKey ?? null;
    if (key) setCache(cacheKey, key, 60 * 60_000);
    return key;
  } catch {
    return null;
  }
}

function toSprintResponse(s: JiraSprintRaw): SprintResponse {
  return {
    id: s.id,
    name: s.name,
    state: s.state,
    startDate: s.startDate,
    endDate: s.endDate,
    completeDate: s.completeDate,
    goal: s.goal ?? "",
  };
}

export async function fetchSprintsForProject(project: string): Promise<SprintResponse[]> {
  if (!ALLOWED_PROJECTS.has(project.toUpperCase())) {
    throw new Error("projeto inválido ou não permitido");
  }

  const boards = await fetchBoards(project);
  const sprintArrays = await Promise.all(boards.map((b) => fetchSprintsForBoard(b.id)));

  const seen = new Map<number, JiraSprintRaw>();
  for (const arr of sprintArrays) {
    for (const s of arr) seen.set(s.id, s);
  }

  const all = Array.from(seen.values());
  const actives = all.filter((s) => s.state === "active");
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const closeds = all
    .filter((s) => {
      if (s.state !== "closed") return false;
      const start = s.startDate ?? s.completeDate ?? "";
      return !start || new Date(start) >= oneYearAgo;
    })
    .sort((a, b) =>
      (b.completeDate ?? b.endDate ?? "").localeCompare(a.completeDate ?? a.endDate ?? ""),
    );

  return [...actives, ...closeds].map(toSprintResponse);
}

export async function fetchSprintById(id: number): Promise<SprintResponse> {
  const data = await jiraGet<JiraSprintRaw>(`/rest/agile/1.0/sprint/${id}`);
  // Board raramente muda de projeto — sem essa checagem, qualquer sprint do
  // tenant (de projeto fora de PIM/PH/INTFLOW/PDC) seria servida.
  const projectKey = data.originBoardId != null ? await boardProjectKey(data.originBoardId) : null;
  if (!projectKey || !ALLOWED_PROJECTS.has(projectKey.toUpperCase())) {
    throw new Error("sprint não encontrada");
  }
  return toSprintResponse(data);
}
