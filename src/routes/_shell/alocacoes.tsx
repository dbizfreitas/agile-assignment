import { createFileRoute } from "@tanstack/react-router";
import { BoardGrid } from "@/components/BoardGrid";
import { useShell } from "@/components/shell/shell-context";

const DESCRIPTION =
  "Alocações de sprints × pessoas, com status coloridos, tickets, férias e realocação por arrastar e soltar.";

export const Route = createFileRoute("/_shell/alocacoes")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Alocações — Sprint Board" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Alocações — Sprint Board" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AlocacoesPage,
});

function AlocacoesPage() {
  // Sessão, papel e projeto já foram resolvidos pela casca. `email` e `isAdmin`
  // não são mais repassados: o logout e o link "Usuários" moram no cabeçalho
  // compartilhado.
  const { canEdit, project } = useShell();
  return <BoardGrid canEdit={canEdit} project={project} />;
}
