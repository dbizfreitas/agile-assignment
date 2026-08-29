import { ClipboardList, Dices, LayoutGrid, Timer, type LucideIcon } from "lucide-react";

/**
 * A ordem das guias vive AQUI e em nenhum outro lugar. Antes desta demanda ela
 * estava replicada em quatro `<header>` que já haviam divergido entre si
 * (RouletteView só linkava para `/`, CompromissoView não linkava para
 * Retrospectivas, "Usuários" existia só no BoardGrid).
 *
 * A ordem é a do jira-live (`static/index.html` 112-115, no commit 7d6b618):
 * Compromisso → Cycle Time → Retrospectivas → Alocação. "Alocações" é a QUARTA
 * guia e agora mora em `/alocacoes`, como as outras três — `/` passou a ser só
 * um redirect para `/alocacoes` (ver `_shell/index.tsx`), preservado como alias
 * porque `admin`/`aceitar-convite`/404 apontam para `/`.
 *
 * `id` existe para a marcação ARIA: cada guia recebe `id={"tab-" + id}` e o
 * `role="tabpanel"` aponta para o `id` da guia ativa via `aria-labelledby`.
 */
export type TabDef = {
  id: string;
  to: "/compromisso" | "/cycle-time" | "/retrospectivas" | "/alocacoes";
  label: string;
  icon: LucideIcon;
};

export const TABS = [
  { id: "compromisso", to: "/compromisso", label: "Compromisso", icon: ClipboardList },
  { id: "cycle-time", to: "/cycle-time", label: "Cycle Time", icon: Timer },
  { id: "retrospectivas", to: "/retrospectivas", label: "Retrospectivas", icon: Dices },
  { id: "alocacoes", to: "/alocacoes", label: "Alocações", icon: LayoutGrid },
] as const satisfies readonly TabDef[];

// Os 4 ids de TABS, na mesma ordem — é o mesmo conjunto de valores do enum
// public.app_route (supabase/migrations/20260828130000_route_access_foundation.sql).
// Derivado em vez de redeclarado: TABS já é a fonte única da lista de guias.
export type AppRoute = (typeof TABS)[number]["id"];
