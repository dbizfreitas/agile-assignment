// IDs públicos do App Registration Way2 no Azure AD (o client secret fica no servidor).
export const AZURE_CLIENT_ID = "d6df7882-49dc-4500-8c27-618e1f31d7d7";
export const AZURE_TENANT_ID = "d2261f50-5591-4083-846d-acd4477aeca0";
export const AZURE_SCOPES = "openid profile email";
export const AZURE_STATE_KEY = "azure_auth_state";
export const AZURE_RETURN_KEY = "azure_auth_return";

export function azureRedirectUri() {
  return `${window.location.origin}/auth/callback`;
}

export function buildAzureAuthorizeUrl(state: string) {
  const url = new URL(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", AZURE_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", azureRedirectUri());
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", AZURE_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}
