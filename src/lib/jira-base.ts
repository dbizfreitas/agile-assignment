/**
 * Base da instância Jira usada em código que roda no browser. O valor
 * canônico (com override via `JIRA_BASE_URL`) vive em
 * `src/integrations/jira/config.server.ts`, mas aquele módulo é `.server.ts`
 * e fica de fora do bundle do cliente — daqui em diante, todo código de
 * cliente que precisa montar/ler um link Jira importa esta constante em vez
 * de repetir o literal.
 */
export const JIRA_BASE = "https://way2agile.atlassian.net";
