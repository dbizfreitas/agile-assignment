// SQLSTATE + nome da restrição -> mensagem pt-BR, para as violações que a
// dimensão de projeto introduziu. Mesmo padrão de src/lib/admin-errors.ts:
// nenhuma dependência de tipo do supabase-js, só a forma estrutural do
// PostgrestError (code, message, details, hint). O nome da restrição vem
// dentro de `message`, então o casamento é por code + substring.
const FK_MESSAGES: { constraint: string; message: string }[] = [
  {
    constraint: "allocations_sprint_project_fkey",
    message: "Não é possível mover uma demanda para a sprint de outro projeto.",
  },
  {
    constraint: "allocations_dev_project_fkey",
    message:
      "Esta pessoa tem demandas alocadas; remova-as antes de movê-la para um time de outro projeto.",
  },
  {
    constraint: "devs_team_project_fkey",
    message: "Este time já tem pessoas; não é possível trocar o projeto dele.",
  },
];

export function boardErrorMessage(error: unknown): string {
  const e = error as { code?: string; message?: string; details?: string } | null;
  const code = e?.code;
  const haystack = `${e?.message ?? ""} ${e?.details ?? ""}`;

  // W3001: os triggers de derivação não acharam o time ou a pessoa — a tela
  // está com dado velho.
  if (code === "W3001") return "Time ou pessoa não encontrado. Recarregue a página.";

  if (code === "23503") {
    const hit = FK_MESSAGES.find((m) => haystack.includes(m.constraint));
    if (hit) return hit.message;
  }

  if (code === "23514" && haystack.includes("_jira_project_format")) {
    return "Chave de projeto inválida.";
  }

  console.error("[board]", error);
  return error instanceof Error && !code ? error.message : "Não foi possível salvar a alteração.";
}
