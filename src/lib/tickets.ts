import type { AllocationTicket } from "@/lib/board";

// Duplicado deliberadamente do `JIRA_BASE` de integrations/jira/config.server.ts:
// aquele módulo é `.server.ts` (fica de fora do bundle do cliente), e este
// arquivo precisa rodar no browser, dentro do AllocationDialog. Mesma
// duplicação já existe em components/compromisso/StatsCards.tsx.
const JIRA_BASE = "https://way2agile.atlassian.net";

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

export function jiraUrlFor(key: string): string {
  return `${JIRA_BASE}/browse/${key}`;
}

export function extractJiraKey(text: string): string | null {
  const match = text.toUpperCase().match(JIRA_KEY_RE);
  return match ? (match[1] ?? null) : null;
}

/** Interpreta um token colado (URL do Jira ou chave solta) como um ticket. */
export function parseTicketToken(token: string): AllocationTicket {
  const trimmed = token.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return { key: extractJiraKey(trimmed) ?? "", url: trimmed };
  }
  const key = extractJiraKey(trimmed) ?? trimmed.toUpperCase();
  return { key, url: key ? jiraUrlFor(key) : null };
}

/** Quebra um texto colado com vários tickets (um por linha/espaço/vírgula). */
export function parseTicketTokens(text: string): AllocationTicket[] {
  return text
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(parseTicketToken);
}
