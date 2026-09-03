/**
 * Marca um erro cuja causa e configuracao ausente (variavel de ambiente), nao
 * um bug no codigo. A pagina de erro do SSR usa isso para trocar o generico
 * "tente de novo" -- que nunca resolve config faltando -- por instrucao util.
 *
 * Vive num modulo proprio, sem HTML, porque e importado pelo client Supabase
 * que vai no bundle do browser.
 */
export const CONFIG_ERROR_MARKER = "[config]";

export function isConfigError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(CONFIG_ERROR_MARKER);
}
