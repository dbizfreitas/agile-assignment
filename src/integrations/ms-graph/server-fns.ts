// src/integrations/ms-graph/server-fns.ts
// Stub de RPC client-safe — só o createServerFn fica exposto aqui, mesma
// convenção de src/integrations/jira/server-fns.ts. A lógica real
// (photos.server/token.server) é importada dinamicamente dentro do
// handler.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getParticipantPhoto = createServerFn({ method: "GET" })
  .validator((email: string) => email)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data: email }): Promise<string | null> => {
    const { assertRouteAccess } = await import("@/integrations/jira/access.server");
    await assertRouteAccess(context.supabase, context.userId, "retrospectivas");

    const { getCachedOrFetchPhoto } = await import("./photos.server");
    return getCachedOrFetchPhoto(email);
  });
