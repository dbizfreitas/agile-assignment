import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Mesmo padrão de src/integrations/supabase/admin.server.ts::assertAdmin,
// mas exige apenas algum papel (não especificamente admin) — usa o client
// do próprio usuário (sob RLS), nunca a service_role.
export async function assertCanViewBoard(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Não foi possível validar suas permissões");
  if (!data) throw new Error("Sem permissão");
}
