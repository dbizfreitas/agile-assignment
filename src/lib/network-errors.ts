// Falha de rede: a conexão caiu antes de qualquer resposta chegar (servidor de
// dev reiniciou no meio da requisição, rede oscilou, máquina offline). Tentar
// de novo pode resolver, ao contrário de um erro que o servidor devolveu.
//
// Chega em dois formatos:
// - `TypeError` lançado pelo `fetch` do navegador: "Failed to fetch"
//   (Chrome/Edge), "NetworkError when attempting to fetch resource" (Firefox)
//   ou "Load failed" (Safari).
// - Objeto de erro do postgrest-js 2.x, que NÃO lança: captura o TypeError e
//   devolve `{ message: "TypeError: Failed to fetch", code: "" }`. Não é
//   instância de Error, então só dá para reconhecer pela forma.
const NETWORK_MESSAGE = /fetch|network|load failed/i;
const WRAPPED_PREFIX = /^(TypeError|FetchError): /;

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return NETWORK_MESSAGE.test(err.message);
  const e = err as { code?: string; message?: unknown } | null;
  if (!e || e.code || typeof e.message !== "string") return false;
  return WRAPPED_PREFIX.test(e.message) && NETWORK_MESSAGE.test(e.message);
}
