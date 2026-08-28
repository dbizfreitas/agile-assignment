import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRoute } from "@/components/shell/tabs";

// Lê as rotas liberadas para o próprio usuário — permitido pela policy
// route_access_select_own. Mesmo staleTime de useRole: as duas convivem no
// boot de useAuthorizedSession.
export function useRoutes(userId: string | undefined) {
  const q = useQuery({
    queryKey: ["user-routes", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Set<AppRoute>> => {
      const { data, error } = await supabase
        .from("user_route_access")
        .select("route")
        .eq("user_id", userId!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.route as AppRoute));
    },
  });

  return {
    routes: q.data ?? new Set<AppRoute>(),
    loading: q.isLoading,
  };
}
