import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/` deixou de renderizar Alocações diretamente e passou a redirecionar para
 * `/alocacoes`. Fica como alias: `admin.tsx` ("Voltar para Alocações"),
 * `aceitar-convite.tsx` (pós-convite) e o 404 do `__root.tsx` apontam para `/`
 * e continuam funcionando sem alteração.
 */
export const Route = createFileRoute("/_shell/")({
  beforeLoad: () => {
    throw redirect({ to: "/alocacoes" });
  },
});
