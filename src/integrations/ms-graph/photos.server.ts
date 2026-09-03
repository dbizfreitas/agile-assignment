// src/integrations/ms-graph/photos.server.ts
// Server-only. Cache de foto em coluna de public.retro_participants (não
// em memória do processo — o runtime é serverless, sem garantia de
// memória compartilhada entre invocações, diferente do processo Node de
// vida longa do jira-live original).
import { isAllowedEmail } from "./config.server";

const PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias: fotos corporativas mudam raramente
// Achado do code review do PR #38: sem isto, uma falha persistente (token
// quebrado, Graph fora do ar) fazia TODA requisição futura tentar de novo
// na hora — nada marcava photo_fetched_at no caminho de erro, então
// isFresh nunca ficava true e o fetch falho se repetia para sempre. TTL
// de negative-cache bem mais curto que o de sucesso: tenta de novo em 1h
// em vez de martelar a cada request, mas sem esperar 7 dias inteiros.
const PHOTO_FAILURE_TTL_MS = 60 * 60 * 1000;

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

  const ageMs =
    data.photo_fetched_at !== null ? Date.now() - new Date(data.photo_fetched_at).getTime() : null;
  // Cache de sucesso (tem foto) usa o TTL longo; cache de falha (última
  // tentativa não achou/errou, sem foto) usa o TTL curto de retry — os
  // dois casos são distinguíveis só por photo_data_url ser null ou não,
  // já que ambos gravam photo_fetched_at.
  const ttl = data.photo_data_url !== null ? PHOTO_TTL_MS : PHOTO_FAILURE_TTL_MS;
  const isFresh = ageMs !== null && ageMs < ttl;
  if (isFresh) return data.photo_data_url;

  let dataUrl: string | null;
  try {
    dataUrl = await fetchParticipantPhoto(email);
  } catch (err) {
    console.error(`[ms-graph/photos] falha ao buscar foto de ${email}`, err);
    // Grava photo_fetched_at mesmo na falha (mantendo photo_data_url como
    // já estava) — sem isto, toda requisição futura reativa o mesmo fetch
    // fadado a falhar, pra sempre, até alguém notar manualmente.
    const { error: markError } = await supabaseAdmin
      .from("retro_participants")
      .update({ photo_fetched_at: new Date().toISOString() })
      .eq("email", email);
    if (markError)
      console.error(`[ms-graph/photos] falha ao marcar tentativa de ${email}`, markError);
    return data.photo_data_url;
  }

  const { error: updateError } = await supabaseAdmin
    .from("retro_participants")
    .update({ photo_data_url: dataUrl, photo_fetched_at: new Date().toISOString() })
    .eq("email", email);
  if (updateError) throw updateError;

  return dataUrl;
}
