// SQLSTATE customizados definidos nas migrations de RBAC.
const MESSAGES: Record<string, string> = {
  W2001: "Você não tem permissão para esta ação.",
  W2002: "Você não pode remover seu próprio acesso de administrador.",
  W2003: "É necessário ao menos um administrador na plataforma.",
  W2005: "Você não pode excluir a própria conta.",
};

export function adminErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;

  if (code && MESSAGES[code]) return MESSAGES[code];

  // W2004 carrega a mensagem específica do caso (e-mail inválido,
  // convite duplicado, usuário já existente).
  if (code === "W2004") {
    return (error as { message?: string }).message ?? "Convite inválido.";
  }

  console.error("[admin]", error);
  return error instanceof Error && !code ? error.message : "Não foi possível concluir a operação.";
}
