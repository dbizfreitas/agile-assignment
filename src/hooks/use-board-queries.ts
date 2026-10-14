import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Dev, Team } from "@/lib/board";
import type { JiraProjectKey } from "@/lib/projects";

/**
 * Leituras de `teams` e `devs` compartilhadas por BoardGrid, DevDialog e
 * TeamsDialog (#109). Ficam num lugar só porque a chave, o select, os filtros,
 * a ordenação e o cast PRECISAM ser idênticos em todos os componentes.
 *
 * O TanStack Query v5 guarda uma única entrada por chave e usa a `queryFn` do
 * observer que renderizou por último. Se um componente registrasse um select
 * mais estreito sob a mesma chave, um refetch em segundo plano rodaria essa
 * versão e sobrescreveria o cache com linhas parciais. E o projeto entra na
 * chave obrigatoriamente: sem ele, um diálogo listaria times do projeto errado.
 *
 * As mutações invalidam pelo prefixo (`["board", "teams"]`, `["board", "devs"]`),
 * então criar ou editar um time ou uma pessoa atualiza todos os observers.
 */
export function useTeamsQuery(project: JiraProjectKey) {
  return useQuery({
    queryKey: ["board", "teams", project],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("jira_project", project)
        .order("position");
      if (error) throw error;
      return data as Team[];
    },
  });
}

export function useDevsQuery(project: JiraProjectKey) {
  return useQuery({
    queryKey: ["board", "devs", project],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devs")
        .select("*")
        .eq("jira_project", project)
        .order("position")
        .order("name");
      if (error) throw error;
      return data as Dev[];
    },
  });
}
