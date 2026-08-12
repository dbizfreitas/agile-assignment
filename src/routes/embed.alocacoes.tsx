import { createFileRoute } from "@tanstack/react-router";
import { BoardGrid } from "@/components/BoardGrid";
import { AuthCard } from "@/components/AuthCard";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuthorizedSession } from "@/hooks/use-authorized-session";
import { JIRA_PROJECTS, isJiraProjectKey, type JiraProjectKey } from "@/lib/projects";

const DESCRIPTION =
  "Quadro de alocações em tela cheia, sem cabeçalho nem guias — para incorporar em iframe ou painel.";

/**
 * Versão ISOLADA do quadro: mesma `<BoardGrid />` da aba Alocações, sem a casca
 * (`_shell`) — logo, sem cabeçalho, sem barra de guias e sem seletor de
 * projeto. O projeto vem da URL (`?project=PIM`), com o mesmo encadeamento de
 * fallback da casca: URL → `localStorage["lastProject"]` → primeiro da lista.
 *
 * `validateSearch` é seguro AQUI porque esta não é rota de layout: o esquema
 * não vaza para rotas irmãs, que foi o problema registrado em `_shell.tsx`.
 */
const LS_PROJECT = "lastProject";

function storedProject(): JiraProjectKey | null {
  try {
    const value = localStorage.getItem(LS_PROJECT);
    return isJiraProjectKey(value) ? value : null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/embed/alocacoes")({
  // Sessão do Supabase e localStorage são lidos no boot, como na casca.
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => {
    const raw = search["project"];
    return {
      project: isJiraProjectKey(typeof raw === "string" ? raw : null)
        ? (raw as JiraProjectKey)
        : undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Alocações (embed) — Sprint Board" },
      { name: "description", content: DESCRIPTION },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Alocações (embed) — Sprint Board" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EmbedAlocacoes,
});

function EmbedAlocacoes() {
  const { project: fromUrl } = Route.useSearch();
  const { session, loading, canEdit, canView } = useAuthorizedSession();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!session) return <AuthCard />;

  if (!canView) {
    return (
      <AccessDenied
        title="Acesso ainda não liberado"
        description="Sua conta existe, mas nenhum papel foi atribuído. Peça acesso a um administrador da plataforma."
        action={
          <Button variant="outline" className="w-full" onClick={() => supabase.auth.signOut()}>
            Sair
          </Button>
        }
      />
    );
  }

  const project = fromUrl ?? storedProject() ?? JIRA_PROJECTS[0]?.key ?? null;

  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Nenhum projeto configurado.</p>
      </div>
    );
  }

  // `h-screen overflow-hidden`: o quadro controla a própria rolagem, igual ao
  // painel dentro da casca — sem barra de rolagem dupla.
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <BoardGrid canEdit={canEdit} project={project} />
    </div>
  );
}
