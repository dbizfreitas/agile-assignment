// scripts/ms-graph-auth.ts
// Script local, rodado manualmente uma vez (`npm run ms-graph:auth`, via
// tsx): faz o device-code flow completo do Microsoft
// Graph (com polling real, sem a limitação de timeout de uma invocação
// serverless) e grava o token resultante em public.ms_graph_token via
// service role. Depois disso o app em produção só faz refresh automático
// (src/integrations/ms-graph/token.server.ts).
//
// Pré-requisitos em .env.local (NUNCA em .env, que é versionado no git):
// MS_TENANT_ID, MS_CLIENT_ID (mesmos valores do app registration usado pelo
// jira-live), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (pegar no painel do
// Supabase, projeto nuvrdppxecbowxopbqcr, em Project Settings > API >
// service_role — NUNCA commitar esse valor).
import { createClient } from "@supabase/supabase-js";

// tsx roda em Node puro e não carrega .env* automaticamente como o Vite
// faz para o resto do app — sem isso, rodar `npm run ms-graph:auth` sem
// exportar as variáveis manualmente no shell falharia com "ausente(s)"
// mesmo com o arquivo preenchido. Silencioso se o arquivo não existir
// (variáveis já podem vir do ambiente, ex. CI).
try {
  process.loadEnvFile(".env.local");
} catch {
  // sem .env.local — segue com o que já estiver em process.env
}

const TENANT_ID = process.env["MS_TENANT_ID"]?.trim();
const CLIENT_ID = process.env["MS_CLIENT_ID"]?.trim();
const SUPABASE_URL = process.env["SUPABASE_URL"]?.trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
const SCOPE = "https://graph.microsoft.com/User.ReadBasic.All offline_access";

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function main(): Promise<void> {
  const missing = [
    ...(!TENANT_ID ? ["MS_TENANT_ID"] : []),
    ...(!CLIENT_ID ? ["MS_CLIENT_ID"] : []),
    ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
    ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
  ];
  if (missing.length > 0) {
    console.error(`Variável(is) de ambiente ausente(s) no .env.local: ${missing.join(", ")}`);
    process.exit(1);
  }

  const dcRes = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID!, scope: SCOPE }),
    },
  );
  const dc = (await dcRes.json()) as DeviceCodeResponse;
  if (dc.error || !dc.verification_uri || !dc.user_code || !dc.device_code) {
    console.error(
      `Erro ao pedir device code: ${dc.error ?? "resposta incompleta"} — ${dc.error_description ?? ""}`,
    );
    process.exit(1);
  }

  console.log("\n=== Autenticação Microsoft necessária ===");
  console.log(`1. Acesse: ${dc.verification_uri}`);
  console.log(`2. Código: ${dc.user_code}`);
  console.log("Aguardando autorização...\n");

  const interval = (dc.interval ?? 5) * 1000;
  const deadline = Date.now() + (dc.expires_in ?? 900) * 1000;
  let token: TokenResponse | null = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const tr = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID!,
        grant_type: "urn:ietf:params:oauth2:grant-type:device_code",
        device_code: dc.device_code,
      }),
    });
    const tj = (await tr.json()) as TokenResponse;
    if (tj.access_token) {
      token = tj;
      break;
    }
    if (tj.error !== "authorization_pending" && tj.error !== "slow_down") {
      console.error(`Autenticação falhou: ${tj.error} — ${tj.error_description}`);
      process.exit(1);
    }
  }

  if (!token?.access_token || !token.refresh_token) {
    console.error("Timeout esperando autorização.");
    process.exit(1);
  }

  const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000 - 60_000).toISOString();
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await supabase
    .from("ms_graph_token")
    .update({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) {
    console.error("Falha ao gravar token no Supabase:", error.message);
    process.exit(1);
  }

  console.log("✓ Token gravado em public.ms_graph_token. As fotos já podem ser buscadas pelo app.");
}

void main();
