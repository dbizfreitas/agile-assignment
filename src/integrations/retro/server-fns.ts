// src/integrations/retro/server-fns.ts
// Stub de RPC client-safe, mesma convenção de src/integrations/jira/server-fns.ts.
//
// A foto de cada participante é gravada à mão em
// retro_participants.photo_data_url (Outlook Web → SQL Editor). A busca
// automática pelo Microsoft Graph foi removida na #106: o login entre
// tenants é bloqueado (AADSTS500213) e o token nunca chegou a existir.
// "" é o marcador de "sabidamente sem foto"; null, de "ainda não gravada".
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getParticipantPhoto = createServerFn({ method: "GET" })
  .validator((email: string) => email)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data: email }): Promise<string | null> => {
    const { assertRouteAccess } = await import("@/integrations/jira/access.server");
    await assertRouteAccess(context.supabase, context.userId, "retrospectivas");

    // A mesma pessoa pode estar na retro de mais de um projeto (uma linha
    // por projeto): a foto é da pessoa, então vale a gravação mais recente.
    const { data, error } = await context.supabase
      .from("retro_participants")
      .select("photo_data_url")
      .eq("email", email)
      .not("photo_data_url", "is", null)
      .order("photo_fetched_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.photo_data_url ?? null;
  });
