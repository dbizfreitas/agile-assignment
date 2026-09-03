// src/integrations/ms-graph/photos.server.ts
// Server-only. Cache de foto em coluna de public.retro_participants (não
// em memória do processo — o runtime é serverless, sem garantia de
// memória compartilhada entre invocações, diferente do processo Node de
// vida longa do jira-live original).
import { isAllowedEmail } from "./config.server";

const PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias: fotos corporativas mudam raramente

export async function fetchParticipantPhoto(email: string): Promise<string | null> {
  if (!isAllowedEmail(email)) return null;

  const { getAccessToken } = await import("./token.server");
  const token = await getAccessToken();

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/photo/$value`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) return null;

  const buf = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const base64 = Buffer.from(buf).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

export async function getCachedOrFetchPhoto(email: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin
    .from("retro_participants")
    .select("photo_data_url, photo_fetched_at")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const isFresh =
    data.photo_fetched_at !== null && Date.now() - new Date(data.photo_fetched_at).getTime() < PHOTO_TTL_MS;
  if (isFresh && data.photo_data_url) return data.photo_data_url;

  let dataUrl: string | null;
  try {
    dataUrl = await fetchParticipantPhoto(email);
  } catch (err) {
    console.error(`[ms-graph/photos] falha ao buscar foto de ${email}`, err);
    return data.photo_data_url; // mantém o que já havia em cache, se houver
  }

  const { error: updateError } = await supabaseAdmin
    .from("retro_participants")
    .update({ photo_data_url: dataUrl, photo_fetched_at: new Date().toISOString() })
    .eq("email", email);
  if (updateError) throw updateError;

  return dataUrl;
}
