// src/integrations/ms-graph/token.server.ts
// Server-only. Token OAuth do Microsoft Graph, persistido em
// public.ms_graph_token (não em arquivo — o runtime é Cloudflare Workers
// via Nitro, sem disco persistente). getAccessToken() só faz REFRESH em
// runtime; o device-code flow inicial roda fora daqui, em
// scripts/ms-graph-auth.ts (rodado localmente uma vez).
import { MS_TENANT_ID, MS_CLIENT_ID, MS_GRAPH_SCOPE } from "./config.server";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class MsGraphAuthError extends Error {}

export async function getAccessToken(): Promise<string> {
  if (!MS_TENANT_ID || !MS_CLIENT_ID) {
    throw new MsGraphAuthError("MS_TENANT_ID/MS_CLIENT_ID não configurados no ambiente");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("ms_graph_token")
    .select("access_token, refresh_token, expires_at")
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;

  const now = Date.now();
  if (data?.access_token && data.expires_at && new Date(data.expires_at).getTime() > now) {
    return data.access_token;
  }

  if (!data?.refresh_token) {
    throw new MsGraphAuthError(
      "Sem token do Microsoft Graph configurado. Rode `npm run ms-graph:auth` localmente.",
    );
  }

  const res = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: data.refresh_token,
      scope: MS_GRAPH_SCOPE,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new MsGraphAuthError(
      `Falha ao renovar token do Microsoft Graph: ${json.error ?? res.status} — rode npm run ms-graph:auth novamente`,
    );
  }

  const expiresAt = new Date(now + (json.expires_in ?? 3600) * 1000 - 60_000).toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("ms_graph_token")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? data.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (updateError) throw updateError;

  return json.access_token;
}
