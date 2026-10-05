import { AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SCOPES } from "./config";

const ALLOWED_DOMAINS = new Set(["way2.com.br", "shippit.app"]);
const ALLOWED_REDIRECT = [
  /^https:\/\/[a-z0-9-]+\.lovable\.app\/auth\/callback$/,
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com\/auth\/callback$/,
  /^https:\/\/[a-z0-9.-]+\.way2\.com\.br\/auth\/callback$/,
  /^http:\/\/localhost:\d+\/auth\/callback$/,
];

export async function exchangeMicrosoftCode(code: string, redirectUri: string) {
  if (!ALLOWED_REDIRECT.some((r) => r.test(redirectUri))) throw new Error("Redirecionamento inválido");
  const secret = process.env["AZURE_CLIENT_SECRET"]?.trim();
  if (!secret) throw new Error("Login Microsoft não configurado no servidor");

  const res = await fetch(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: AZURE_CLIENT_ID,
      client_secret: secret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: AZURE_SCOPES,
    }),
  });
  if (!res.ok) {
    console.error("[sso] token exchange", res.status, await res.text());
    throw new Error("A Microsoft recusou o login. Tente novamente.");
  }
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("Resposta inválida da Microsoft");

  // Token obtido server-to-server via TLS direto da Microsoft; validamos as claims.
  const payload = JSON.parse(
    Buffer.from(tokens.id_token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
  ) as Record<string, string | number | undefined>;
  if (payload["aud"] !== AZURE_CLIENT_ID) throw new Error("Token inválido");
  if (!String(payload["iss"] ?? "").includes(AZURE_TENANT_ID)) throw new Error("Token inválido");
  if (Number(payload["exp"] ?? 0) < Date.now() / 1000) throw new Error("Token expirado");

  const email = String(payload["email"] ?? payload["preferred_username"] ?? "").toLowerCase().trim();
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (!email.includes("@") || !ALLOWED_DOMAINS.has(domain)) {
    throw new Error("Apenas contas corporativas Way2 podem entrar.");
  }
  const name = payload["name"] ? String(payload["name"]) : undefined;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Procura usuário existente pelo e-mail.
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("Não foi possível validar o usuário");
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (data.users.length < 200) break;
  }

  if (!userId) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: name, provider: "azure" },
    });
    if (error || !data.user) throw new Error("Não foi possível criar o usuário");
    userId = data.user.id;
  }

  // Mesmo padrão dos convites: papel leitor + guia Alocações, só se ainda não tiver papel.
  const { data: role } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (!role) {
    await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "viewer" });
    await supabaseAdmin.from("user_route_access").insert({ user_id: userId, route: "alocacoes" });
  }

  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new Error("Não foi possível iniciar a sessão");
  return { tokenHash };
}
