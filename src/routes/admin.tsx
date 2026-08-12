import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuthorizedSession } from "@/hooks/use-authorized-session";
import { AuthCard } from "@/components/AuthCard";
import { AccessDenied } from "@/components/AccessDenied";
import { AdminView } from "@/components/admin/AdminView";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Usuários — Sprint Board" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { session, loading, isAdmin } = useAuthorizedSession();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!session) return <AuthCard />;

  if (!isAdmin) {
    return (
      <AccessDenied
        title="Acesso restrito"
        description="Esta área é exclusiva para administradores da plataforma."
        action={
          <Button className="w-full" asChild>
            <Link to="/">Voltar para Alocações</Link>
          </Button>
        }
      />
    );
  }

  return <AdminView currentUserId={session.user.id} />;
}
