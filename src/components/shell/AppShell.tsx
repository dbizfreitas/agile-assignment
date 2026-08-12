import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { LayoutGrid, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectSelect, type ProjectOption } from "@/components/ProjectSelect";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { TABS } from "./tabs";

const TAB_BASE =
  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors";

export function AppShell({
  email,
  isAdmin,
  project,
  options,
  onProjectChange,
  children,
}: {
  email: string;
  isAdmin: boolean;
  /** `string` e não `JiraProjectKey`: é o contrato do ProjectSelect. */
  project: string;
  options: readonly ProjectOption[];
  onProjectChange: (key: string) => void;
  children: ReactNode;
}) {
  // Só para o `aria-labelledby` do tabpanel. O estado visual de cada guia sai
  // de `activeProps`/`inactiveProps` do próprio <Link>, que é o roteador
  // respondendo — não um segundo cálculo nosso.
  const pathname = useLocation({ select: (l) => l.pathname });
  const activeTab = TABS.find((t) => (t.to === "/" ? pathname === "/" : pathname.startsWith(t.to)));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-header text-header-foreground">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <LayoutGrid className="size-4" />
          </span>
          {/* "Sprint Board" é o nome do PRODUTO e continua aqui: Alocações é
              uma das quatro coisas que ele faz, não o todo. */}
          <h1 className="mr-auto text-base font-semibold leading-tight">Sprint Board</h1>

          <ProjectSelect value={project} options={options} onChange={onProjectChange} />

          {isAdmin ? (
            <Button size="sm" variant="ghost" asChild>
              <Link to="/admin">
                <Users className="size-4" /> Usuários
              </Link>
            </Button>
          ) : null}
          <ThemeToggle />
          <Button size="sm" variant="ghost" onClick={() => supabase.auth.signOut()} title={email}>
            <LogOut className="size-4" />
          </Button>
        </div>

        {/* Marcação do jira-live (`static/index.html` 116-120). Desvio de
            acessibilidade registrado na spec: são links reais, que respondem a
            Tab + Enter e alimentam o histórico; ficam SEM navegação por setas
            de propósito, porque meia implementação de roving tabindex seria
            pior que nenhuma. */}
        <nav
          role="tablist"
          aria-label="Navegação principal"
          className="flex flex-wrap items-center gap-1 border-t border-border px-4 py-1.5"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                key={tab.id}
                id={`tab-${tab.id}`}
                role="tab"
                to={tab.to}
                // `exact` é obrigatório para a guia `/`: sem ele, o casamento
                // por prefixo deixaria Alocações ativa em todas as rotas.
                activeOptions={{ exact: true }}
                activeProps={{
                  "aria-selected": true,
                  className: `${TAB_BASE} bg-primary/15 text-foreground`,
                }}
                inactiveProps={{
                  "aria-selected": false,
                  className: `${TAB_BASE} text-muted-foreground hover:bg-accent hover:text-foreground`,
                }}
              >
                <Icon className="size-4" /> {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* `min-h-0 flex-1` + `overflow-hidden`: a casca ocupa a viewport e cada
          painel controla a própria rolagem. É o que permite tirar o `h-screen`
          dos quatro painéis sem produzir barra de rolagem dupla. */}
      <div
        role="tabpanel"
        {...(activeTab ? { "aria-labelledby": `tab-${activeTab.id}` } : {})}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {children}
      </div>
    </div>
  );
}
