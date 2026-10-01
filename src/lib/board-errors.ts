import { isNetworkError } from "./network-errors";

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
  {
    // .from("teams").delete() direto, fora da RPC — a RPC valida antes e nunca chega aqui.
    constraint: "devs_team_id_fkey",
    message: "Este time tem pessoas; escolha para qual time elas devem ir antes de excluí-lo.",
  },
];

// Mesmas FKs vistas por quem está salvando, excluindo ou replicando uma
// demanda (AllocationDialog e o "Replicar" do BoardGrid). Sem este mapa,
// allocations_dev_project_fkey cairia na mensagem de FK_MESSAGES, que fala em
// mover a pessoa de time — o caso do DevDialog, não o de quem edita um card.
// Todas indicam dado velho na tela: algo mudou em outra aba ou por outra pessoa.
const ALLOCATION_FK_MESSAGES: { constraint: string; message: string }[] = [
  {
    constraint: "allocations_dev_project_fkey",
    message: "Esta pessoa não está mais neste projeto. Recarregue a página.",
  },
  {
    constraint: "allocations_sprint_project_fkey",
    message: "Esta sprint não é do projeto desta pessoa. Recarregue a página.",
  },
  {
    constraint: "allocations_sprint_id_fkey",
    message: "Esta sprint foi excluída. Recarregue a página.",
  },
  {
    // O trigger allocations_set_project costuma barrar antes com W3001; isto
    // cobre a corrida em que a pessoa some entre o trigger e a checagem da FK.
    constraint: "allocations_dev_id_fkey",
    message: "Esta pessoa foi excluída. Recarregue a página.",
  },
];

// Quem chama diz de onde veio o erro quando a mesma violação precisa de um
// texto diferente conforme a tela. Sem contexto = mensagens genéricas do board.
export type BoardErrorContext = "allocation";

// W4xxx: public.delete_team. Os três primeiros são alcançáveis pela tela
// (sessão que expirou, papel revogado no meio do caminho, dado velho); os
// três últimos não são — o Select só oferece times do mesmo projeto e o botão
// fica desabilitado sem destino. Existem porque a RPC é SECURITY DEFINER e
// precisa se defender de um cliente desatualizado ou de uma chamada direta.
const TEAM_CODES: Record<string, string> = {
  W4001: "Sessão expirada. Entre novamente.",
  W4002: "Você não tem permissão para excluir times.",
  W4003: "Time não encontrado. Recarregue a página.",
  W4004: "Escolha para qual time as pessoas devem ir.",
  W4005: "O time de destino precisa ser diferente do time excluído.",
  W4006: "O time de destino precisa ser do mesmo projeto.",
};

export function boardErrorMessage(error: unknown, context?: BoardErrorContext): string {
  if (isNetworkError(error)) return "Sem conexão. Tente novamente.";

  const e = error as { code?: string; message?: string; details?: string } | null;
  const code = e?.code;
  const haystack = `${e?.message ?? ""} ${e?.details ?? ""}`;

  // W3001: os triggers de derivação não acharam o time ou a pessoa — a tela
  // está com dado velho.
  if (code === "W3001") return "Time ou pessoa não encontrado. Recarregue a página.";

  if (code && TEAM_CODES[code]) return TEAM_CODES[code];

  if (code === "23503") {
    const specific =
      context === "allocation"
        ? ALLOCATION_FK_MESSAGES.find((m) => haystack.includes(m.constraint))
        : undefined;
    const hit = specific ?? FK_MESSAGES.find((m) => haystack.includes(m.constraint));
    if (hit) return hit.message;
  }

  // O diálogo já barra janela invertida no `canSave`; isto cobre o caminho de
  // um cliente desatualizado, para o usuário não ver o texto cru do Postgres.
  if (code === "23514" && haystack.includes("devs_availability_order")) {
    return "A data de fim da disponibilidade não pode ser anterior à de início.";
  }

  // Constraints de sprints (issue #47). O SprintDialog barra isso antes de
  // salvar; aqui cobrimos cliente desatualizado e corrida entre duas abas.
  if (code === "23514" && haystack.includes("sprints_date_order")) {
    return "A data de fim da sprint não pode ser anterior à de início.";
  }

  if (code === "23514" && haystack.includes("sprints_quarter_format")) {
    return "Quarter inválido. Use Q1, Q2, Q3 ou Q4.";
  }

  if (code === "23505" && haystack.includes("sprints_project_code_key")) {
    return "Já existe uma sprint com este código neste projeto.";
  }

  if (code === "23514" && haystack.includes("_jira_project_format")) {
    return "Chave de projeto inválida.";
  }

  console.error("[board]", error);
  return error instanceof Error && !code ? error.message : "Não foi possível salvar a alteração.";
}
