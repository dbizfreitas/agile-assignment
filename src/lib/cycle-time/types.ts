/**
 * Contrato público do Cycle Time — compartilhado entre a server function e os
 * componentes React. Mesma disciplina de src/lib/compromisso/types.ts: nenhum
 * tipo interno do Jira (changelog, campos crus) aparece aqui. O dado bruto é
 * reduzido no servidor, em cycle-time.server.ts.
 *
 * Idêntico ao shared/types.ts do jira-live — o front portado consome sem
 * tradução, e a comparação de paridade contra a porta 8000 é campo a campo.
 */

/**
 * As duas sub-visões portadas do original: "Em Andamento" (`standard`, corte
 * de 200 itens no servidor) e "Histórico Completo" (`full`, sem corte).
 * O modo `extended` do original não tem chamador em lugar nenhum e não vem.
 */
export type CycleTimeMode = "standard" | "full";

export interface CycleTimeIssue {
  key: string;
  url: string;
  summary: string;
  type: string;
  assignee: string;
  current_status: string;
  fix_versions: string;
  /** Dias por status, arredondados a 1 casa decimal. */
  status_days: Record<string, number>;
  /** Soma de `status_days`, arredondada a 1 casa decimal. */
  total_days: number;
}

export interface CycleTimeResponse {
  /** Ordem de colunas vinda dos status do projeto; `[]` se a consulta falhar. */
  statuses: string[];
  /** Já ordenadas por `total_days` desc. */
  issues: CycleTimeIssue[];
}
