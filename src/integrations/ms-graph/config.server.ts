// src/integrations/ms-graph/config.server.ts
// Server-only: nunca importar no topo de um arquivo isomórfico (route
// files, componentes) — só dentro de handlers de createServerFn, via
// import dinâmico. Mesma convenção de src/integrations/jira/config.server.ts.
//
// Mesmas credenciais do app registration já aprovado no Entra ID para o
// projeto jira-live (server/routes/photos.ts) — evita repetir o processo
// de admin consent para um app novo.
export const MS_TENANT_ID = process.env["MS_TENANT_ID"]?.trim();
export const MS_CLIENT_ID = process.env["MS_CLIENT_ID"]?.trim();
export const MS_GRAPH_SCOPE = "https://graph.microsoft.com/User.ReadBasic.All offline_access";

// Mesma allowlist do jira-live: sem isso, buscar foto por e-mail vira um
// proxy autenticado para consultar QUALQUER e-mail via Graph API.
const ALLOWED_EMAIL_DOMAINS = new Set(["way2.com.br", "shippit.app"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isAllowedEmail(email: string): boolean {
  if (!EMAIL_RE.test(email)) return false;
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && ALLOWED_EMAIL_DOMAINS.has(domain);
}
