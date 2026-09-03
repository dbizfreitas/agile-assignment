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
// Achado do code review do PR #39: a correção acima conflava dois casos
// bem diferentes só por ambos deixarem photo_data_url null — "o Graph
// respondeu e a pessoa genuinamente não tem foto" (fato estável, devia
// respeitar o TTL de 7 dias) e "a tentativa falhou/lançou" (transiente,
// TTL curto de retry). String vazia é o sentinel para o primeiro caso —
// distinto de null (nunca tentamos, ou a tentativa lançou) — sem precisar
// de coluna nova; o client trata "" como "sem foto" (mesmo fallback de
// iniciais que null/undefined), ver use-retro-photos.ts.
const NO_PHOTO_SENTINEL = "";

// Retorna a data-URI da foto, NO_PHOTO_SENTINEL ("") se o Graph confirmou
// que a pessoa não tem foto (resposta não-OK — tipicamente 404), ou lança
// se a chamada em si falhar (rede, token, timeout) — esses dois casos
// precisam ser distinguíveis para getCachedOrFetchPhoto aplicar o TTL
// certo (ver comentário de NO_PHOTO_SENTINEL acima).
export async function fetchParticipantPhoto(email: string): Promise<string> {
  if (!isAllowedEmail(email)) return NO_PHOTO_SENTINEL;

  const { getAccessToken } = await import("./token.server");
  const token = await getAccessToken();

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/photo/$value`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) return NO_PHOTO_SENTINEL;

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
  // TTL longo para qualquer resultado que o Graph já confirmou (foto real
  // OU NO_PHOTO_SENTINEL, "sabidamente sem foto") — ambos são fatos
  // estáveis. TTL curto só quando photo_data_url é null: a tentativa
  // anterior lançou (falha transiente) ou nunca foi feita.
  const ttl = data.photo_data_url !== null ? PHOTO_TTL_MS : PHOTO_FAILURE_TTL_MS;
  const isFresh = ageMs !== null && ageMs < ttl;
  if (isFresh) return data.photo_data_url;

  let dataUrl: string;
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
