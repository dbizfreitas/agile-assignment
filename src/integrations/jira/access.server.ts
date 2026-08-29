import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRoute } from "@/components/shell/tabs";

// Mesmo padrão de src/integrations/supabase/admin.server.ts::assertAdmin —
// usa o client do PRÓPRIO usuário (sob RLS), nunca a service_role — mas
// mira uma rota específica em vez de "algum papel".
//
// Correção (revisão final da issue #23, mesma causa raiz do fix de RLS em
// 20260828134000): checar só user_route_access aqui tinha o mesmo defeito
// das policies de SELECT antes do fix — um usuário desativado (papel
// removido via /admin) mas que nunca teve suas linhas de rota apagadas
// continuava passando nesta checagem e lendo dados do Jira via server
// function. A checagem de papel abaixo usa o mesmo client (sob RLS) e a
// mesma forma de query que a antiga assertCanViewBoard (pré-Task 5) usava.
export async function assertRouteAccess(
  client: SupabaseClient<Database>,
  userId: string,
  route: AppRoute,
): Promise<void> {
  const { data: roleRow, error: roleError } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (roleError) throw new Error("Não foi possível validar suas permissões");
  if (!roleRow) throw new Error("Sem permissão");

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
// das rotas estar liberada. Mesma correção acima: papel é pré-requisito,
// não apenas a rota.
export async function assertAnyRouteAccess(
  client: SupabaseClient<Database>,
  userId: string,
  routes: readonly AppRoute[],
): Promise<void> {
  const { data: roleRow, error: roleError } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (roleError) throw new Error("Não foi possível validar suas permissões");
  if (!roleRow) throw new Error("Sem permissão");

  const { data, error } = await client
    .from("user_route_access")
    .select("route")
    .eq("user_id", userId)
    .in("route", routes);

  if (error) throw new Error("Não foi possível validar suas permissões");
  if (!data || data.length === 0) throw new Error("Sem permissão");
}
