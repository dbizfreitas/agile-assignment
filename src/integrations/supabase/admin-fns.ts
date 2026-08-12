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
