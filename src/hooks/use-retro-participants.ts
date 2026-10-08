import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withRetroTypes } from "@/integrations/supabase/retro-types";
import type { JiraProjectKey } from "@/lib/projects";

const retroSupabase = withRetroTypes(supabase);

export type RetroParticipant = {
  id: string;
  name: string;
  email: string;
  color: string | null;
  sortOrder: number;
};

// Lê os participantes protegidos por has_route(uid, 'retrospectivas') —
// policy retro_participants_select_route. staleTime alto: a lista muda por
// edição manual no banco, não por ação do usuário durante a sessão.
// Cada projeto Jira tem o seu time: o projeto entra na queryKey para que
// trocar de projeto na casca busque (e cacheie) a lista certa.
export function useRetroParticipants(project: JiraProjectKey) {
  const q = useQuery({
    queryKey: ["retro-participants", project],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<RetroParticipant[]> => {
      const { data, error } = await retroSupabase
        .from("retro_participants")
        .select("id, name, email, color, sort_order")
        .eq("jira_project", project)
        .order("sort_order");
      if (error) throw error;
      return data.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        color: p.color,
        sortOrder: p.sort_order,
      }));
    },
  });

  return { participants: q.data ?? [], loading: q.isLoading };
}
