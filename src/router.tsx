import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// "Failed to fetch" (Chrome/Edge) / "NetworkError when attempting to fetch
// resource" (Firefox) / "Load failed" (Safari): a TypeError que o `fetch` do
// navegador lança quando a conexão cai antes de qualquer resposta chegar —
// ex.: o servidor de dev reiniciou no meio da requisição, ou a rede oscilou.
// Diferente de um erro que o server function mapeou (credencial inválida,
// projeto não encontrado etc.), que é determinístico e tentar de novo não
// muda o resultado.
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => isNetworkError(error) && failureCount < 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
