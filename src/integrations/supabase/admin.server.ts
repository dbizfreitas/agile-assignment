// Server-only admin logic — usa a service_role key. Só é seguro de importar
// estaticamente a partir de outro "*.server.ts"; admin-fns.ts (que vai para o
// bundle do cliente) carrega este módulo via await import() dentro dos
// handlers, seguindo a mesma convenção de src/integrations/jira/server-fns.ts.
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./client.server";
import type { Database } from "./types";
import type { AppRole, PlatformUser } from "@/lib/admin";
import type { AppRoute } from "@/components/shell/tabs";

// Reconfirma o papel usando o client do PRÓPRIO usuário (sob RLS), antes de
// qualquer uso da service_role. Não é spoofável pelo cliente.
export async function assertAdmin(client: SupabaseClient<Database>, userId: string): Promise<void> {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Não foi possível validar suas permissões");
  if (data?.role !== "admin") throw new Error("Sem permissão");
}

const PER_PAGE = 200;

export async function fetchPlatformUsers(): Promise<PlatformUser[]> {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: PER_PAGE,
  });
  if (error) {
    console.error("[admin] listUsers falhou:", error);
    throw new Error("Não foi possível carregar a lista de usuários");
  }

  if (data.users.length === PER_PAGE) {
    console.warn(
      `[admin] listUsers retornou ${PER_PAGE} usuários — pode existir mais de uma página. Implementar paginação.`,
    );
  }

  const { data: roles, error: rolesError } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role");
  if (rolesError) {
    console.error("[admin] leitura de user_roles falhou:", rolesError);
    throw new Error("Não foi possível carregar os papéis dos usuários");
  }

  const { data: routeRows, error: routesError } = await supabaseAdmin
    .from("user_route_access")
    .select("user_id, route");
  if (routesError) {
    console.error("[admin] leitura de user_route_access falhou:", routesError);
    throw new Error("Não foi possível carregar as rotas dos usuários");
  }

  const roleByUser = new Map<string, AppRole>(roles.map((r) => [r.user_id, r.role as AppRole]));

  const routesByUser = new Map<string, AppRoute[]>();
  for (const r of routeRows) {
    const list = routesByUser.get(r.user_id) ?? [];
    list.push(r.route as AppRoute);
    routesByUser.set(r.user_id, list);
  }

  return data.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      role: roleByUser.get(u.id) ?? null,
      routes: routesByUser.get(u.id) ?? [],
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      // generateLink já cria a linha em auth.users, então "nunca entrou"
      // é o sinal de convite ainda não aceito.
      pendingInvite: !u.last_sign_in_at,
    }))
    .sort((a, b) => a.email.localeCompare(b.email, "pt-BR"));
}

export async function createInviteLink(input: {
  email: string;
  kind: "invite" | "magiclink";
}): Promise<{ link: string }> {
  // A origem vem do próprio request, nunca do cliente: evita open redirect.
  const origin = getRequest()?.headers.get("origin");
  if (!origin) throw new Error("Origem da requisição não identificada");

  const email = input.email.toLowerCase().trim();
  const options = { redirectTo: `${origin}/aceitar-convite` };

  const { data, error } =
    input.kind === "invite"
      ? await supabaseAdmin.auth.admin.generateLink({ type: "invite", email, options })
      : await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email, options });

  if (error) {
    console.error("[admin] generateLink falhou:", error);
    throw new Error("Não foi possível gerar o link de convite");
  }

  const link = data.properties?.action_link;
  if (!link) throw new Error("O Supabase não retornou o link de convite");

  return { link };
}
