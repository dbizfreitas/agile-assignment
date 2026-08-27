/**
 * Tipos do contrato público da integração com Jira — compartilhados entre
 * server functions e componentes React. Nenhum tipo interno do Jira
 * (changelog, campos crus) aparece aqui.
 */

export interface JiraProject {
  key: string;
  name: string;
}

export interface SprintResponse {
  id: number;
  name: string;
  state: string;
  startDate?: string | undefined;
  endDate?: string | undefined;
  completeDate?: string | undefined;
  goal: string;
}

export interface IssueResponse {
  key: string;
  url: string;
  summary: string;
  type: string;
  isSubtask: boolean;
  status: string;
  statusCategory: string;
  assignee: string;
  /** Campo "Categorias" do Jira (labels); usado p/ identificar itens de compromisso da sprint */
  categories: string[];
  /** Campo "Chamados" do Jira (customfield_12449); tickets de incidente vinculados */
  chamados: string[];
  parent?: string | undefined;
  parentType?: string | undefined;
  parentSummary?: string | undefined;
  parentStatus?: string | undefined;
  parentStatusCategory?: string | undefined;
  parentUrl?: string | undefined;
  sp: number | null;
  resolved?: string | undefined;
  created?: string | undefined;
  /** Momento em que entrou (e permaneceu) na categoria "done"; null se não concluída */
  doneAt?: string | null;
  /** Momento em que a label "compromisso" foi (re)adicionada; null se a issue não tem a label */
  commitmentAt?: string | null;
  /** Dias desde que a issue entrou no status atual */
  days_in_status: number | null;
  /** Nome do revisor (customfield_10200) */
  reviewer: string | null;
}
