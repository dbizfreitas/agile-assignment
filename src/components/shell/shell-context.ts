import { createContext, useContext, type ReactNode } from "react";
import type { JiraProjectKey } from "@/lib/projects";
import type { AppRoute } from "./tabs";

/**
 * O que a casca garante aos painéis. `project` é NÃO ANULÁVEL de propósito: a
 * resolução em `_shell.tsx` é síncrona e sempre cai numa chave válida
 * (`search.project ?? localStorage["lastProject"] ?? JIRA_PROJECTS[0].key`), e
 * o único caminho sem projeto — `JIRA_PROJECTS` vazia — é tratado na casca,
 * antes de o provider existir.
 *
 * É esse tipo que apaga os quatro ramos `!project` de hoje como código morto,
 * em vez de os deixar como defesa duplicada dentro de cada painel.
 *
 * Contexto e não prop porque `<Outlet/>` não aceita props.
 */
export type ShellContextValue = {
  email: string;
  canEdit: boolean;
  isAdmin: boolean;
  project: JiraProjectKey;
  routes: Set<AppRoute>;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({
  value,
  children,
}: {
  value: ShellContextValue;
  children: ReactNode;
}) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  // Lançar em vez de devolver um default: um painel fora da casca não tem
  // projeto nem papel, e um default silencioso esconderia o erro de rota.
  if (!ctx) {
    throw new Error("useShell() só funciona dentro da rota de layout _shell.");
  }
  return ctx;
}
