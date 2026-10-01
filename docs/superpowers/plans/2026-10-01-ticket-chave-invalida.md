# Validação da chave do ticket (issue #52): plano de implementação

**Objetivo:** Texto qualquer colado ou digitado como ticket (ex.: `foo`) deixa de virar chave Jira (`FOO`) com link automático. A chave inválida é marcada na linha e bloqueia o Salvar; ticket de outro projeto do board gera só um aviso.

**Arquitetura:** `normalizeJiraKey` (em `src/lib/tickets.ts`) aceita só `trim().toUpperCase()` casando `^[A-Z][A-Z0-9]+-\d+$`. `parseTicketToken` usa essa função e, para texto que não é chave, mantém o texto digitado e `url: null`. `ticketKeyProblem` e `ticketProjectMismatch` alimentam o `AllocationDialog`.

## Decisões

1. Chave válida = `trim().toUpperCase()` casando `^[A-Z][A-Z0-9]+-\d+$`. "pim-12" vira PIM-12 (válido); "foo", "PIM", "PIM-", "PIM-12." e "(PIM-12)" são inválidos. `JIRA_KEY_RE` (com `\b`) continua só para extrair a chave de uma URL (`extractJiraKey`) e para `ticketKeyMismatch`.
2. A chave só é validada quando o link está vazio ou é do Jira (começa com `JIRA_BASE`). Com link de outro site (DevOps…) a chave é rótulo livre (#50/#51). Link inválido já é tratado por `ticketUrlProblem`.
3. Chave inválida bloqueia o Salvar (como na #51), com erro inline `text-destructive` e `aria-invalid`. Nunca gera link automático. No colar, o token inválido fica na linha com o texto original e `url: null`.
4. Aviso de outro projeto: âmbar, não bloqueante ("PH-123 é do projeto PH, não do PIM."), por linha, mais um toast no colar múltiplo.
5. Toasts: no colar múltiplo, dois toasts novos (chaves inválidas; outro projeto), no padrão de contagem existente. No colar único o erro inline basta.
6. Sem migration nem CHECK no banco: o dano é de UX, a regra teria de duplicar a exceção "fora do Jira", não há reparo automático seguro e as migrations são manuais. Em troca, o cliente bloqueia o Salvar e uma query read-only acha os cards antigos.
7. Card antigo "FOO" + `/browse/FOO`: mostra o erro e bloqueia até corrigir. Ao corrigir a chave para PIM-1 o link se refaz, porque a comparação de "link derivado" em `handleTicketKeyChange` usa `jiraUrlFor(t.key.trim().toUpperCase())` sem validar a chave antiga.

## Passos

1. `src/lib/tickets.ts`: `normalizeJiraKey`, `isJiraUrl`, `ticketKeyProblem`, `ticketProjectMismatch`; `parseTicketToken` passa a usar `normalizeJiraKey`.
2. `src/components/AllocationDialog.tsx`: `handleTicketKeyChange` valida a chave, erro inline por linha, Salvar desabilitado com chave inválida, "Trocar link para" só com chave válida.
3. `src/components/AllocationDialog.tsx`: aviso âmbar de outro projeto por linha e toasts no colar múltiplo.

## Verificação

Não há framework de testes. As funções puras são verificadas com um script descartável (`npx tsx`), não commitado. Antes de cada commit: `prettier --write`, `eslint` nos arquivos tocados e `npm run build`.

Query read-only para achar cards antigos afetados (não executada pelo plano):

```sql
SELECT a.id, a.jira_project, a.title, t->>'key' AS key, t->>'url' AS url
FROM public.allocations a, jsonb_array_elements(a.tickets) t
WHERE jsonb_typeof(a.tickets) = 'array'
  AND coalesce(btrim(t->>'key'), '') <> ''
  AND upper(btrim(t->>'key')) !~ '^[A-Z][A-Z0-9]+-[0-9]+$'
  AND (coalesce(btrim(t->>'url'), '') = '' OR t->>'url' ILIKE 'https://way2agile.atlassian.net%');
```
