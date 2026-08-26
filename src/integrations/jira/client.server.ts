// Server-only — mesma convenção de src/integrations/supabase/client.server.ts:
// importar dinamicamente dentro de handlers de createServerFn, nunca no topo
// de um arquivo isomórfico.
import { JIRA_BASE } from "./config.server";

function genericMessageFor(status: number): string {
  // 401 e 403 apontam para causas OPOSTAS e a frase única mandava quem fosse
  // arrumar procurar no lugar errado. 401: o Jira nem reconheceu a conta —
  // token inválido/expirado, e-mail que não corresponde ao token, ou
  // JIRA_BASE_URL apontando para outro site (todos verificados contra a API,
  // todos devolvem 401). 403: a conta é válida, mas não alcança o recurso —
  // tipicamente token com escopos insuficientes para a API Agile (boards e
  // sprints), ou sem acesso ao projeto.
  if (status === 401)
    return "O Jira recusou as credenciais do servidor (token inválido ou expirado, e-mail que não corresponde ao token, ou site do Jira errado).";
  if (status === 403)
    return "A conta do Jira está autenticada, mas sem permissão para esse recurso — verifique os escopos do token e o acesso ao projeto.";
  if (status === 404) return "Recurso não encontrado no Jira.";
  if (status === 429) return "O Jira recebeu requisições demais. Tente novamente em instantes.";
  if (status >= 500) return "O Jira está indisponível no momento. Tente novamente em instantes.";
  return "Erro ao comunicar com o Jira.";
}

export class JiraError extends Error {
  public readonly status: number;
  /** Mensagem segura pra mostrar ao cliente. `message` (herdado de Error)
   * continua com o detalhe técnico/cru, só pra log do servidor. */
  public readonly clientMessage: string;

  constructor(status: number, message: string, clientMessage?: string) {
    super(message);
    this.name = "JiraError";
    this.status = status;
    this.clientMessage = clientMessage ?? genericMessageFor(status);
  }
}

function buildAuthHeader(): string {
  const email = process.env["JIRA_EMAIL"];
  const token = process.env["JIRA_API_TOKEN"];
  if (!email || !token) {
    throw new JiraError(
      503,
      "JIRA_EMAIL / JIRA_API_TOKEN não configurados.",
      "Credenciais do Jira não configuradas no servidor.",
    );
  }
  return `Basic ${btoa(`${email}:${token}`)}`;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function jiraGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  // Defesa em profundidade: todo caminho passado aqui vem de código nosso, mas
  // barra ".." e garante que a URL final continua dentro de /rest/ no host do
  // Jira — nunca noutro endpoint ou host.
  if (path.includes("..") || !path.startsWith("/rest/")) {
    throw new JiraError(
      500,
      "Caminho de API do Jira inválido.",
      "Caminho de API do Jira inválido.",
    );
  }
  const url = new URL(JIRA_BASE + path);
  if (url.origin !== new URL(JIRA_BASE).origin || !url.pathname.startsWith("/rest/")) {
    throw new JiraError(
      500,
      "Caminho de API do Jira inválido.",
      "Caminho de API do Jira inválido.",
    );
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: buildAuthHeader(), Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return res.json() as Promise<T>;

    const text = await res.text();
    const err = new JiraError(res.status, text.slice(0, 300));
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= MAX_RETRIES) throw err;

    // Respeita Retry-After quando o Jira manda (comum em 429); senão, backoff
    // exponencial simples: 500ms, 1s, 2s.
    const retryAfterSec = Number(res.headers.get("Retry-After"));
    const waitMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : BASE_BACKOFF_MS * 2 ** attempt;
    await sleep(waitMs);
  }
}
