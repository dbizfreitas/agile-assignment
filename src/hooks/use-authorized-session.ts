import { useSession } from "./use-session";
import { useRole } from "./use-role";

// Consolida o preâmbulo repetido em toda rota autenticada: sessão + papel.
// loading cobre tanto a resolução da sessão quanto, uma vez logado, a do papel.
export function useAuthorizedSession() {
  const { session, loading: sessionLoading } = useSession();
  const { role, isAdmin, canEdit, canView, loading: roleLoading } = useRole(session?.user.id);

  return {
    session,
    role,
    isAdmin,
    canEdit,
    canView,
    loading: sessionLoading || (Boolean(session) && roleLoading),
  };
}
