import type { AppRoute } from "@/components/shell/tabs";

export type AppRole = "admin" | "editor" | "viewer";

export type PlatformUser = {
  id: string;
  email: string;
  role: AppRole | null;
  routes: AppRoute[];
  createdAt: string;
  lastSignInAt: string | null;
  pendingInvite: boolean;
};

export type AuditEntry = {
  id: string;
  action: "invite" | "grant" | "revoke" | "bootstrap" | "cancel" | "route_grant" | "route_revoke";
  target_email: string | null;
  actor_email: string | null;
  previous_role: AppRole | null;
  new_role: AppRole | null;
  route: AppRoute | null;
  created_at: string;
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  editor: "Editor",
  viewer: "Leitor",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "Gerencia usuários e edita as alocações",
  editor: "Edita as alocações",
  // Não "visualiza as alocações": can_view_board também libera as server
  // functions do Jira (Compromisso e Cycle Time), então restringir a frase às
  // alocações descreveria um papel mais estreito do que o que existe.
  viewer: "Apenas visualiza, não edita",
};

export const ACTION_LABELS: Record<AuditEntry["action"], string> = {
  invite: "Convite",
  grant: "Concessão",
  revoke: "Revogação",
  bootstrap: "Bootstrap",
  cancel: "Convite cancelado",
  route_grant: "Rota concedida",
  route_revoke: "Rota revogada",
};
