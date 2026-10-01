import type { AllocationTicket } from "@/lib/board";
import { JIRA_BASE } from "@/lib/jira-base";

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

export function jiraUrlFor(key: string): string {
  return `${JIRA_BASE}/browse/${key}`;
}

export function extractJiraKey(text: string): string | null {
  const match = text.toUpperCase().match(JIRA_KEY_RE);
  return match ? (match[1] ?? null) : null;
}

/**
 * Chave para a qual o link do Jira aponta, quando ela difere da chave
 * digitada (issue #50). `null` quando batem, quando falta um dos lados ou
 * quando o link não é do Jira — links de outros sites ficam livres.
 */
export function ticketKeyMismatch(ticket: AllocationTicket): string | null {
  const key = ticket.key.trim().toUpperCase();
  const url = ticket.url?.trim() ?? "";
  if (!key || !url.toLowerCase().startsWith(JIRA_BASE.toLowerCase())) return null;
  const linked = extractJiraKey(url);
  return linked && linked !== key ? linked : null;
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
