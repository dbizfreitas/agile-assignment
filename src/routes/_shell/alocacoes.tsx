import { useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BoardGrid } from "@/components/BoardGrid";
import { useShell } from "@/components/shell/shell-context";
import { parseBoardSearch, type BoardSearch } from "@/lib/board-search";

const DESCRIPTION =
  "Alocações de sprints × pessoas, com status coloridos, tickets, férias e realocação por arrastar e soltar.";

export const Route = createFileRoute("/_shell/alocacoes")({
  ssr: false,
  // Ano, busca, tipo e status na URL (issue #55). Rota folha e chaves todas
  // opcionais: `<Link to="/alocacoes">` e o redirect da casca seguem sem
  // `search`. O projeto NÃO entra aqui: é da casca (seletor do cabeçalho).
  validateSearch: parseBoardSearch,
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
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();

  // `replace`: não polui o histórico a cada tecla/clique. O patch com valor
  // padrão traz `undefined`, que remove a chave da URL.
  const onFiltersChange = (patch: Partial<BoardSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  // Trocar de projeto zera os filtros. `key={project}` remonta o board, mas com
  // o estado na URL isso não basta: sem limpar a URL, o filtro do projeto
  // anterior vazaria para o próximo. Ignora a montagem inicial para não apagar
  // os filtros de um link compartilhado.
  const previousProject = useRef(project);
  useEffect(() => {
    if (previousProject.current === project) return;
    previousProject.current = project;
    void navigate({ search: {}, replace: true });
  }, [project, navigate]);

  // `key={project}`: remonta o BoardGrid ao trocar de projeto, resetando o
  // estado local (diálogos, drag); os filtros são limpos pelo efeito acima.
  return (
    <BoardGrid
      canEdit={canEdit}
      project={project}
      filters={filters}
      onFiltersChange={onFiltersChange}
      key={project}
    />
  );
}
