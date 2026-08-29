// Stubs de RPC client-safe — só os createServerFn ficam expostos aqui. A
// lógica real (client.server/projects.server/sprints.server/issues.server)
// é importada dinamicamente dentro de cada handler, nunca no topo deste
// arquivo, seguindo a mesma convenção de src/integrations/supabase/client.server.ts:
// arquivos "*.server.ts" só são seguros de importar estaticamente a partir de
// outro "*.server.ts" — este arquivo é importado pelos componentes React.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { IssueResponse, JiraProject, SprintResponse } from "@/lib/compromisso/types";
import type { CycleTimeMode, CycleTimeResponse } from "@/lib/cycle-time/types";

/**
 * Erro que cruza a fronteira do RPC é serializado por `message` — sem este
 * mapeamento a UI mostraria o corpo cru da resposta do Jira (ou, pior, um
 * "Erro ao carregar dados do Jira" genérico) em vez de dizer que a credencial
 * não está configurada, que o token expirou ou que o Jira está fora do ar. O
 * detalhe técnico fica só no log do servidor.
 */
async function mapJiraError<T>(scope: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const { JiraError } = await import("./client.server");
    if (err instanceof JiraError) {
      console.error(`[jira/${scope}]`, err.status, err.message);
      throw new Error(err.clientMessage);
    }
    throw err;
  }
}

export const getJiraProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JiraProject[]> => {
    const { assertAnyRouteAccess } = await import("./access.server");
    await assertAnyRouteAccess(context.supabase, context.userId, ["compromisso", "cycle-time"]);
    const { fetchAllowedProjects } = await import("./projects.server");
    return mapJiraError("projects", () => fetchAllowedProjects());
  });

export const getJiraSprints = createServerFn({ method: "GET" })
  .validator((data: { project: string }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<SprintResponse[]> => {
    const { assertRouteAccess } = await import("./access.server");
    await assertRouteAccess(context.supabase, context.userId, "compromisso");
    const { fetchSprintsForProject } = await import("./sprints.server");
    return mapJiraError("sprints", () => fetchSprintsForProject(data.project));
  });

export const getJiraSprint = createServerFn({ method: "GET" })
  .validator((data: { id: number }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<SprintResponse> => {
    const { assertRouteAccess } = await import("./access.server");
    await assertRouteAccess(context.supabase, context.userId, "compromisso");
    const { fetchSprintById } = await import("./sprints.server");
    return mapJiraError("sprint", () => fetchSprintById(data.id));
  });

export const getJiraIssues = createServerFn({ method: "GET" })
  .validator((data: { sprintId: number }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<IssueResponse[]> => {
    const { assertRouteAccess } = await import("./access.server");
    await assertRouteAccess(context.supabase, context.userId, "compromisso");
    const { fetchIssuesForSprint } = await import("./issues.server");
    return mapJiraError("issues", () => fetchIssuesForSprint(data.sprintId));
  });

export const getJiraCycleTime = createServerFn({ method: "GET" })
  .validator((data: { project: string; mode: CycleTimeMode; force?: boolean }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<CycleTimeResponse> => {
    const { assertRouteAccess } = await import("./access.server");
    await assertRouteAccess(context.supabase, context.userId, "cycle-time");
    const { fetchCycleTime } = await import("./cycle-time.server");
    return mapJiraError("cycle-time", () =>
      fetchCycleTime(data.project, data.mode, data.force ?? false),
    );
  });
