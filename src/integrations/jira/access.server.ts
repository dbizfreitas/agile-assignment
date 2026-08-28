import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRoute } from "@/components/shell/tabs";

// Mesmo padrão de src/integrations/supabase/admin.server.ts::assertAdmin —
// usa o client do PRÓPRIO usuário (sob RLS), nunca a service_role — mas
// mira uma rota específica em vez de "algum papel".
export async function assertRouteAccess(
  client: SupabaseClient<Database>,
  userId: string,
  route: AppRoute,
): Promise<void> {
  const { data, error } = await client
    .from("user_route_access")
    .select("route")
    .eq("user_id", userId)
    .eq("route", route)
    .maybeSingle();

  if (error) throw new Error("Não foi possível validar suas permissões");
  if (!data) throw new Error("Sem permissão");
}

// getJiraProjects alimenta tanto Compromisso quanto Cycle Time — basta UMA
// das rotas estar liberada.
export async function assertAnyRouteAccess(
  client: SupabaseClient<Database>,
  userId: string,
  routes: readonly AppRoute[],
): Promise<void> {
  const { data, error } = await client
    .from("user_route_access")
    .select("route")
    .eq("user_id", userId)
    .in("route", routes);

  if (error) throw new Error("Não foi possível validar suas permissões");
  if (!data || data.length === 0) throw new Error("Sem permissão");
}
