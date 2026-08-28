import { useSession } from "./use-session";
import { useRole } from "./use-role";
import { useRoutes } from "./use-routes";

// Consolida o preâmbulo repetido em toda rota autenticada: sessão + papel +
// rotas liberadas. loading cobre a resolução da sessão e, uma vez logado, a
// do papel e a das rotas.
export function useAuthorizedSession() {
  const { session, loading: sessionLoading } = useSession();
  const { role, isAdmin, canEdit, canView, loading: roleLoading } = useRole(session?.user.id);
  const { routes, loading: routesLoading } = useRoutes(session?.user.id);

  return {
    session,
    role,
    isAdmin,
    canEdit,
    canView,
    routes,
    loading: sessionLoading || (Boolean(session) && (roleLoading || routesLoading)),
  };
}
