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

// Regra única de link válido (issue #51). A migration
// 20261001180000_allocation_ticket_urls.sql aplica a mesma regra no banco:
// se mudar aqui, mude lá também.
const URL_START_RE = /https?:\/\//gi;
const SINGLE_URL_RE = /^https?:\/\/[^\s/?#]+\S*$/i;

export type TicketUrlProblem = "esquema" | "varios";

/**
 * Problema do link do ticket, ou `null` quando ele está vazio ou é um único
 * link `http(s)://`. "varios" vem antes de "esquema" para o diálogo poder
 * oferecer "Manter só o primeiro" no caso de link colado repetido.
 */
export function ticketUrlProblem(url: string | null): TicketUrlProblem | null {
  const value = url?.trim() ?? "";
  if (!value) return null;
  if ((value.match(URL_START_RE) ?? []).length > 1) return "varios";
  return SINGLE_URL_RE.test(value) ? null : "esquema";
}

/** Primeiro link de um valor com vários `http(s)://` concatenados. */
export function firstTicketUrl(url: string): string {
  const [first] = url.trim().split(/(?=https?:\/\/)/i);
  return (first ?? "").trim();
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

/**
 * Quebra um texto colado com vários tickets (um por linha/espaço/vírgula, ou
 * links grudados sem separador) e descarta repetidos (issue #51: o mesmo link
 * colado várias vezes seguidas virava um link só, inválido).
 */
export function parseTicketTokens(text: string): AllocationTicket[] {
  const seen = new Set<string>();
  return text
    .split(/[\s,]+|(?=https?:\/\/)/i)
    .map((t) => t.trim())
    .filter((t) => {
      const id = t.toLowerCase();
      if (!t || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(parseTicketToken);
}
