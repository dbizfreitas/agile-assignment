/**
 * Fonte de verdade única das chaves de projeto Jira no cliente.
 *
 * Por que uma constante local e não `getJiraProjects()`: Compromisso e Cycle
 * Time chamam o Jira porque os dados deles *são* do Jira — sem Jira não há
 * tela. O quadro de alocação é o oposto: funciona com zero dependência do
 * Jira, o dado é próprio e mora no Supabase. Fazer o seletor esperar uma ida à
 * Atlassian significaria que um token expirado derruba o *planejamento*.
 *
 * Além disso a constante é necessária de qualquer forma: `ALLOWED_PROJECTS`
 * mora em `src/integrations/jira/config.server.ts`, que é server-only e não
 * pode ser importado por um componente. Com esta lista aqui, o `config.server`
 * passa a derivar dela e a lista existe UMA vez. A direção do import é a única
 * legal: o proibido é componente importar `*.server.ts`, não o contrário.
 *
 * A ordem importa: `JIRA_PROJECTS[0]` é o projeto padrão do seletor de
 * Alocações, e o backfill da migration levou o quadro existente para `PIM` —
 * então o primeiro acesso depois da migration mostra o quadro de hoje,
 * inalterado.
 */
export const JIRA_PROJECTS = [
  { key: "PIM", name: "PIM" },
  { key: "PH", name: "PowerHub" },
  { key: "INTFLOW", name: "IntegraFlow" },
  { key: "PDC", name: "PDC" },
] as const satisfies readonly { key: string; name: string }[];

export type JiraProjectKey = (typeof JIRA_PROJECTS)[number]["key"];

const KEYS: readonly string[] = JIRA_PROJECTS.map((p) => p.key);

/**
 * Valida a chave que volta do `localStorage` e a que volta do `<Select>` do
 * Radix (que devolve `string`). Sem isto, uma chave antiga — projeto removido
 * da lista — entraria no estado e o `.eq("jira_project", …)` pediria um
 * projeto que o seletor não mostra.
 */
export function isJiraProjectKey(value: string | null | undefined): value is JiraProjectKey {
  return typeof value === "string" && KEYS.includes(value);
}
