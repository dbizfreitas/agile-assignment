import type { Sprint } from "@/lib/board";

// Regras do diálogo de sprint (issue #47). Puras e sem React, para o
// SprintDialog e o script de verificação usarem a mesma lógica. O banco tem
// as constraints equivalentes (sprints_date_order, sprints_quarter_format,
// sprints_project_code_key); isto aqui existe para avisar antes de salvar.

export const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

/** Vazio é permitido: a coluna nasce com DEFAULT '' e o quadro só mostra quarter preenchido. */
export function isValidQuarter(q: string): boolean {
  return q === "" || (QUARTERS as readonly string[]).includes(q);
}

export type SprintDraft = {
  /** `null` para sprint nova; o id da sprint em edição para ela não colidir consigo mesma. */
  id: string | null;
  code: string;
  start: string;
  end: string;
};

export type SprintIssues = {
  /** Fim antes do início: bloqueia o salvar. */
  inverted: boolean;
  /** Outra sprint do projeto com o mesmo código: bloqueia o salvar. */
  duplicate: Sprint | null;
  /** Sprints do projeto cujas datas cruzam com as do rascunho: só aviso. */
  overlaps: Sprint[];
};

/**
 * `sprints` precisa ser a lista do projeto atual, como `sprintsQ` traz em
 * BoardGrid (já filtrada por `jira_project`). Datas em `YYYY-MM-DD`, então a
 * comparação de strings é cronológica, a mesma técnica do DevDialog.
 * Sobreposição é inclusiva: as duas datas fazem parte da sprint.
 */
export function sprintIssues(draft: SprintDraft, sprints: Sprint[]): SprintIssues {
  const others = sprints.filter((s) => s.id !== draft.id);
  const code = draft.code.trim();
  const inverted = Boolean(draft.start && draft.end && draft.end < draft.start);
  const duplicate = code ? (others.find((s) => s.code.trim() === code) ?? null) : null;
  const overlaps =
    draft.start && draft.end && !inverted
      ? others.filter((s) => s.start_date <= draft.end && draft.start <= s.end_date)
      : [];
  return { inverted, duplicate, overlaps };
}
