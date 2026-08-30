// Stubs de RPC client-safe. A lógica que usa service_role vive em
// admin.server.ts e só é importada dinamicamente dentro dos handlers.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlatformUser } from "@/lib/admin";

export const listPlatformUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformUser[]> => {
    const { assertAdmin, fetchPlatformUsers } = await import("./admin.server");
    await assertAdmin(context.supabase, context.userId);
    return fetchPlatformUsers();
  });

export const generateInviteLink = createServerFn({ method: "POST" })
  .validator((data: { email: string; kind: "invite" | "magiclink" }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<{ link: string }> => {
    const { assertAdmin, createInviteLink } = await import("./admin.server");
    await assertAdmin(context.supabase, context.userId);
    return createInviteLink(data);
  });

export const deletePlatformUser = createServerFn({ method: "POST" })
  .validator((data: { userId: string }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<void> => {
    const { assertAdmin, deleteAuthUser } = await import("./admin.server");
    await assertAdmin(context.supabase, context.userId);

    // A RPC roda com o client do PRÓPRIO usuário, não com supabaseAdmin: é o
    // que faz auth.uid() resolver o ator dentro da função (com service_role
    // ela levantaria W2001). Ela valida as invariantes, apaga convite
    // pendente, papel e rotas, e grava a auditoria.
    const { error } = await context.supabase.rpc("delete_platform_user", {
      _target: data.userId,
    });
    if (error) throw error;

    // Só depois de a auditoria estar gravada. Não inverter.
    await deleteAuthUser(data.userId);
  });
