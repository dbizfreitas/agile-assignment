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
      // A PRIMEIRA página é o que responde se dá pra falar com o Jira:
      // credencial ausente, token expirado, 403, Jira fora do ar. Engolir esse
      // erro devolvia `[]` como se o projeto simplesmente não tivesse board —
      // e a tela mostrava o seletor de sprint cinza, vazio e sem dizer por quê.
      // Da segunda página em diante o erro continua tolerado: uma lista parcial
      // de boards ainda rende sprints, e é melhor que a tela inteira cair.
      if (pageNum === 0) throw err;
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

/**
 * Devolve o erro em vez de o esconder. Um board sozinho pode falhar de forma
 * legítima (403 num board restrito) sem que o projeto inteiro esteja quebrado
 * — quem decide se aquilo é "resultado parcial" ou "falha" é
 * `fetchSprintsForProject`, que enxerga todos os boards de uma vez.
 */
async function fetchSprintsForBoard(
  boardId: number,
): Promise<{ sprints: JiraSprintRaw[]; error: unknown }> {
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
      return { sprints, error: err };
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
  return { sprints, error: null };
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
  const results = await Promise.all(boards.map((b) => fetchSprintsForBoard(b.id)));

  // Um board falhar sozinho é resultado parcial; TODOS falharem não é
  // resultado nenhum — é a falha que precisa chegar à tela, em vez de virar
  // uma lista vazia indistinguível de "esse projeto não tem sprint".
  const failed = results.filter((r) => r.error !== null);
  if (results.length > 0 && failed.length === results.length) throw failed[0]!.error;

  const seen = new Map<number, JiraSprintRaw>();
  for (const r of results) {
    for (const s of r.sprints) seen.set(s.id, s);
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
