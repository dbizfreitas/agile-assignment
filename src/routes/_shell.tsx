import { useMemo, useState } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuthorizedSession } from "@/hooks/use-authorized-session";
import { AuthCard } from "@/components/AuthCard";
import { AccessDenied } from "@/components/AccessDenied";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getJiraProjects } from "@/integrations/jira/server-fns";
import { JIRA_PROJECTS, isJiraProjectKey, type JiraProjectKey } from "@/lib/projects";
import type { ProjectOption } from "@/components/ProjectSelect";
import { AppShell } from "@/components/shell/AppShell";
import { ShellProvider } from "@/components/shell/shell-context";

/**
 * UMA chave, global, com o mesmo nome do jira-live (`app.js` 207-216, 264).
 * As três de tela (`compromissoLastProject`, `cycleTimeLastProject`,
 * `alocacoesLastProject`) ficam órfãs sem migração: `localStorage` tolera
 * chave não lida, e o efeito de não migrar é uma escolha de projeto a mais no
 * primeiro acesso depois do deploy. Código de migração não paga o próprio
 * custo de leitura.
 */
const LS_PROJECT = "lastProject";

const ls = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

/**
 * Resolução SÍNCRONA e sempre válida: chave inválida no `localStorage` cai no
 * primeiro item da lista. `null` só com `JIRA_PROJECTS` vazia — erro de
 * configuração, tratado uma vez no componente.
 *
 * Degradação registrada na spec/plano: o projeto NÃO fica na URL
 * (`?project=`) porque `validateSearch` numa rota de layout se mostrou hostil
 * — o esquema de busca vazou para rotas fora da casca (`admin.tsx`,
 * `aceitar-convite.tsx`, `__root.tsx`), exigindo `search` em `<Link to="/">`
 * em todo o app. `localStorage["lastProject"]` continua sendo a única fonte —
 * é a mesma chave, só sem o espelho na URL.
 *
 * É esta função que faz o estado "nenhum projeto selecionado" não existir, e é
 * por isso que o contexto declara `project` não anulável.
 */
function resolveProject(): JiraProjectKey | null {
  const stored = ls(LS_PROJECT);
  if (isJiraProjectKey(stored)) return stored;
  return JIRA_PROJECTS[0]?.key ?? null;
}

export const Route = createFileRoute("/_shell")({
  // A casca lê localStorage e a sessão do Supabase no boot. Os `ssr: false`
  // dos quatro filhos FICAM: são redundantes sob um pai client-only, e
  // mantê-los evita que mover um arquivo para fora da casca no futuro reative
  // SSR em silêncio.
  ssr: false,
  component: Shell,
});

function Shell() {
  const { session, loading, canEdit, isAdmin, canView } = useAuthorizedSession();
  const [project, setProject] = useState<JiraProjectKey | null>(() => resolveProject());

  /**
   * As CHAVES vêm de `JIRA_PROJECTS`; só o RÓTULO vem do Jira. Não existe
   * fallback a executar: com token expirado, Atlassian instável ou a query em
   * voo, o seletor está completo e as Alocações funcionam. `enabled: canView`
   * porque `getJiraProjects` exige sessão + papel — sem isso a tela de login
   * dispararia uma server function que só pode falhar.
   */
  const projectsQ = useQuery({
    queryKey: ["jira", "projects"],
    queryFn: () => getJiraProjects(),
    enabled: canView,
    // A lista de projetos praticamente não muda, e com guia = rota cada troca
    // de guia remontaria esta query. Ver "Remontagem dos painéis" na spec.
    staleTime: 30 * 60_000,
  });

  const options = useMemo<ProjectOption[]>(
    () =>
      JIRA_PROJECTS.map((p) => ({
        key: p.key,
        name: projectsQ.data?.find((j) => j.key === p.key)?.name ?? p.name,
      })),
    [projectsQ.data],
  );

  function handleProjectChange(key: string) {
    // O Radix devolve `string`; isJiraProjectKey é o portão.
    if (!isJiraProjectKey(key)) return;
    save(LS_PROJECT, key);
    setProject(key);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
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

  // O único estado sem projeto que existe: erro de configuração. A barra de
  // guias desaparece aqui e SÓ aqui — quatro guias clicáveis sobre painéis que
  // não têm o que mostrar é pior que uma frase.
  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Nenhum projeto configurado.</p>
      </div>
    );
  }

  const email = session.user.email ?? "";

  return (
    <ShellProvider value={{ email, canEdit, isAdmin, project }}>
      <AppShell
        email={email}
        isAdmin={isAdmin}
        project={project}
        options={options}
        onProjectChange={handleProjectChange}
      >
        <Outlet />
      </AppShell>
    </ShellProvider>
  );
}
