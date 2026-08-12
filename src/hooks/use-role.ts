import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/admin";

// Lê o papel do próprio usuário — permitido pela policy user_roles_select_own.
// O resultado é conveniência de UI; a autorização real está na RLS.
export function useRole(userId: string | undefined) {
  const q = useQuery({
    queryKey: ["user-role", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AppRole | null> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as AppRole | undefined) ?? null;
    },
  });

  const role = q.data ?? null;

  return {
    role,
    isAdmin: role === "admin",
    canEdit: role === "admin" || role === "editor",
    canView: role !== null,
    loading: q.isLoading,
  };
}
