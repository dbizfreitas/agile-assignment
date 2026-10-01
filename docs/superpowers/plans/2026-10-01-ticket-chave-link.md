# Chave e link do ticket divergindo (issue #50): plano de implementação

> **Para execução agêntica:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam sintaxe de checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** Quando o link de um ticket é do Jira e aponta para uma chave diferente da digitada, o diálogo de demanda mostra um aviso inline na própria linha, com dois botões de correção em um clique: adotar a chave do link ou refazer o link a partir da chave.

**Arquitetura:** Uma função pura nova, `ticketKeyMismatch`, em `src/lib/tickets.ts`, recebe um `AllocationTicket` e devolve a chave que o link aponta quando ela diverge da digitada (ou `null`). O `AllocationDialog` chama essa função para cada linha e, quando ela devolve algo, renderiza um aviso âmbar abaixo da linha. O aviso não bloqueia o Salvar: links fora do Jira continuam livres, e o aviso só existe para que a divergência não passe despercebida. A derivação automática atual (`handleTicketKeyChange`/`handleTicketUrlChange`) não muda.

**Tech Stack:** React 19, TypeScript, shadcn/ui (`Button` em `src/components/ui/button.tsx`), Tailwind, lucide-react.

## Restrições globais

- Todo texto de UI e comentário em pt-BR com acentuação correta.
- Tom de aviso âmbar já usado no projeto: `text-amber-600 dark:text-amber-400`.
- O aviso **não bloqueia** o Salvar.
- Só links do Jira entram na checagem: URL que começa com `JIRA_BASE` (`src/lib/jira-base.ts`), sem diferenciar maiúsculas de minúsculas. Links de outros sites nunca geram aviso.
- Linha sem chave, sem link ou com link do Jira sem chave reconhecível: sem aviso. O caso "link sem chave" já tem toast próprio no paste.
- A comparação normaliza a chave digitada com `trim().toUpperCase()`, a mesma normalização do payload de `save`.
- Não há framework de testes no projeto (nem `vitest`/`jest`, nem script `test`). A função pura é verificada com um script descartável rodado via `npx tsx`, que **não** deve ser commitado. O resto se verifica com `npm run build` e no navegador.
- Baseline conhecida: `npm run lint` já falha no checkout local com `prettier/prettier: Delete '␍'` porque o Windows usa `core.autocrlf=true`. Isso não é responsabilidade deste plano. Nos arquivos tocados, rode `npx prettier --write <arquivo>` antes de commitar.
- Este repositório sincroniza com o Lovable. Trabalhe na branch `fix/ticket-chave-link-50` (já criada), nunca reescreva histórico publicado e **não faça push**: o push e o PR ficam com o coordenador, depois da confirmação do usuário.
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Mapa de arquivos

- **Modificar `src/lib/tickets.ts`:** adicionar `ticketKeyMismatch`.
- **Modificar `src/components/AllocationDialog.tsx`:** aviso inline por linha de ticket e os dois botões de correção.

O critério "corrigir o card PIM-7559 em produção" é um ajuste de dado, não de código. Ele fica com o usuário, depois do deploy (veja "Fora do código" no fim).

---

### Tarefa 1: função pura `ticketKeyMismatch`

**Arquivos:**
- Modificar: `src/lib/tickets.ts`
- Verificação: `src/lib/tickets.check.ts` (temporário, apagado no fim da tarefa)

**Interfaces:**
- Consome: `AllocationTicket` de `src/lib/board.ts` (`{ key: string; url: string | null }`), `JIRA_BASE` de `src/lib/jira-base.ts` (`"https://way2agile.atlassian.net"`) e `extractJiraKey(text: string): string | null`, que já existe em `tickets.ts`.
- Produz (usado pela Tarefa 2):
  - `ticketKeyMismatch(ticket: AllocationTicket): string | null`: a chave (em maiúsculas) que o link do Jira aponta, quando ela difere da chave digitada; `null` em qualquer outro caso.

- [ ] **Passo 1: escrever o script de verificação (vai falhar)**

Criar `src/lib/tickets.check.ts`:

```typescript
import assert from "node:assert/strict";
import { ticketKeyMismatch } from "./tickets";

const J = "https://way2agile.atlassian.net/browse/";

// divergência real (o caso da issue)
assert.equal(ticketKeyMismatch({ key: "PIM-4", url: `${J}PIM-3` }), "PIM-3");
assert.equal(ticketKeyMismatch({ key: "PIM-7559", url: `${J}PIM-6665` }), "PIM-6665");

// chave e link batem, inclusive com caixa/espaço diferentes na chave digitada
assert.equal(ticketKeyMismatch({ key: "PIM-3", url: `${J}PIM-3` }), null);
assert.equal(ticketKeyMismatch({ key: " pim-3 ", url: `${J}PIM-3` }), null);

// host em caixa diferente continua sendo Jira
assert.equal(ticketKeyMismatch({ key: "PIM-4", url: "HTTPS://WAY2AGILE.ATLASSIAN.NET/browse/PIM-3" }), "PIM-3");

// link do Jira com query string
assert.equal(ticketKeyMismatch({ key: "PIM-4", url: `${J}PIM-3?focusedCommentId=1` }), "PIM-3");

// link fora do Jira: nunca avisa
assert.equal(ticketKeyMismatch({ key: "PIM-4", url: "https://github.com/x/y/issues/PIM-3" }), null);

// sem chave, sem link, link vazio ou link Jira sem chave reconhecível: sem aviso
assert.equal(ticketKeyMismatch({ key: "", url: `${J}PIM-3` }), null);
assert.equal(ticketKeyMismatch({ key: "   ", url: `${J}PIM-3` }), null);
assert.equal(ticketKeyMismatch({ key: "PIM-4", url: null }), null);
assert.equal(ticketKeyMismatch({ key: "PIM-4", url: "  " }), null);
assert.equal(ticketKeyMismatch({ key: "PIM-4", url: "https://way2agile.atlassian.net/jira/your-work" }), null);

console.log("ok");
```

- [ ] **Passo 2: rodar e confirmar que falha**

Run: `npx tsx src/lib/tickets.check.ts`
Expected: FAIL, com erro dizendo que `ticketKeyMismatch` não é exportado / não é uma função.

- [ ] **Passo 3: implementar**

Em `src/lib/tickets.ts`, adicionar depois de `extractJiraKey` (sem mexer no resto do arquivo):

```typescript
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
```

Observação: `extractJiraKey` já faz `toUpperCase()` no texto inteiro antes de casar a regex, então `WAY2AGILE` (sem `-<número>`) não casa e a chave devolvida já vem em maiúsculas.

- [ ] **Passo 4: rodar e confirmar que passa**

Run: `npx tsx src/lib/tickets.check.ts`
Expected: imprime `ok`.

- [ ] **Passo 5: apagar o script, formatar e commitar**

```bash
rm src/lib/tickets.check.ts
npx prettier --write src/lib/tickets.ts
git add src/lib/tickets.ts
git commit -m "fix(tickets): detecta chave digitada diferente da chave do link Jira (#50)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Confirme com `git status` que `tickets.check.ts` não ficou no working tree.

---

### Tarefa 2: aviso inline no diálogo de demanda

**Arquivos:**
- Modificar: `src/components/AllocationDialog.tsx` (import na linha 44, handlers perto das linhas 113-142, renderização da lista de tickets nas linhas 294-323)

**Interfaces:**
- Consome: `ticketKeyMismatch(ticket: AllocationTicket): string | null` (Tarefa 1) e `jiraUrlFor(key: string): string`, que já existe em `src/lib/tickets.ts`.
- Produz: nada que outra tarefa use.

**Comportamento esperado:**
- Para cada linha em que `ticketKeyMismatch(t)` devolve `linked`, aparece abaixo da linha (dentro da mesma área rolável) um texto âmbar: `O link aponta para {linked}, não para {CHAVE}.`, onde `{CHAVE}` é `t.key.trim().toUpperCase()`.
- Na mesma linha do aviso, dois botões `variant="link"` pequenos:
  - `Usar {linked}`: troca a chave da linha para `linked` e mantém o link.
  - `Trocar link para {CHAVE}`: troca o link da linha para `jiraUrlFor(CHAVE)` e mantém a chave.
- Qualquer um dos dois faz o aviso sumir, porque chave e link passam a bater.
- O Salvar continua habilitado com aviso presente.

- [ ] **Passo 1: importar a função**

Trocar a linha 44:

```typescript
import { extractJiraKey, jiraUrlFor, parseTicketTokens } from "@/lib/tickets";
```

por:

```typescript
import {
  extractJiraKey,
  jiraUrlFor,
  parseTicketTokens,
  ticketKeyMismatch,
} from "@/lib/tickets";
```

- [ ] **Passo 2: adicionar o handler de correção**

Logo depois de `handleTicketUrlChange` (termina na linha 142), adicionar:

```typescript
  // Correções em um clique do aviso de divergência (issue #50). Cada uma
  // alinha um lado ao outro; a derivação automática acima não entra aqui.
  const setTicketAt = (index: number, ticket: AllocationTicket) =>
    setTickets((prev) => prev.map((t, i) => (i === index ? ticket : t)));
```

- [ ] **Passo 3: renderizar o aviso**

Na lista de tickets, o bloco atual é:

```tsx
                  {tickets.map((t, i) => (
                    <div key={i} className="flex gap-2">
                      <div className="grid flex-1 grid-cols-2 gap-2">
```

e termina em:

```tsx
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
```

Substituir esse bloco inteiro (do `{tickets.map(` até o `))}`) por:

```tsx
                  {tickets.map((t, i) => {
                    const linked = ticketKeyMismatch(t);
                    const typed = t.key.trim().toUpperCase();
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex gap-2">
                          <div className="grid flex-1 grid-cols-2 gap-2">
                            <Input
                              value={t.key}
                              onChange={(e) => handleTicketKeyChange(i, e.target.value)}
                              onPaste={(e) => handleTicketPaste(i, e)}
                              placeholder="PIM-7862"
                              aria-label="Chave do ticket"
                            />
                            <Input
                              value={t.url ?? ""}
                              onChange={(e) => handleTicketUrlChange(i, e.target.value)}
                              onPaste={(e) => handleTicketPaste(i, e)}
                              placeholder="https://..."
                              aria-label="Link do ticket"
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => removeTicketRow(i)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                        {linked ? (
                          <p className="flex flex-wrap items-center gap-x-2 text-xs text-amber-600 dark:text-amber-400">
                            <span>
                              O link aponta para {linked}, não para {typed}.
                            </span>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => setTicketAt(i, { key: linked, url: t.url })}
                            >
                              Usar {linked}
                            </Button>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() => setTicketAt(i, { key: typed, url: jiraUrlFor(typed) })}
                            >
                              Trocar link para {typed}
                            </Button>
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
```

Observação: a área rolável é `max-h-32` (cerca de 3 linhas). Uma linha com aviso fica mais alta, então a lista rola um pouco antes. É esperado e não precisa ajuste.

- [ ] **Passo 4: atualizar o comentário da derivação automática**

O comentário acima de `handleTicketKeyChange` (linhas 117-122) termina em `— corrige o link "congelar" na 1ª tecla digitada na chave).`. Acrescentar ao fim desse mesmo bloco de comentário, como nova linha:

```typescript
  // Quando os dois lados já foram editados e divergem, o aviso inline
  // (`ticketKeyMismatch`, issue #50) é que aponta o problema.
```

- [ ] **Passo 5: build**

Run: `npm run build`
Expected: termina sem erro de TypeScript nem de bundle.

- [ ] **Passo 6: formatar e commitar**

```bash
npx prettier --write src/components/AllocationDialog.tsx
git add src/components/AllocationDialog.tsx
git commit -m "fix(alocacoes): avisa quando chave e link do ticket divergem (#50)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Verificação no navegador (coordenador)

Feita pelo coordenador depois das duas tarefas, com `preview_start` em `lovable-dev` (porta 8081):

1. Abrir uma demanda e reproduzir a issue: chave `PIM-2`, link `https://way2agile.atlassian.net/browse/PIM-3`, chave `PIM-4`. O aviso `O link aponta para PIM-3, não para PIM-4.` aparece.
2. `Usar PIM-3`: a chave vira `PIM-3` e o aviso some.
3. Repetir e usar `Trocar link para PIM-4`: o link vira `…/browse/PIM-4` e o aviso some.
4. Link fora do Jira (por exemplo `https://github.com/x`) com chave qualquer: sem aviso.
5. Salvar com o aviso presente continua possível.
6. Console sem erros novos.

Não salve nada no banco durante a verificação (use Cancelar), a menos que o usuário peça.

---

## Fora do código: dado em produção

O card "Tratamento adequado de medidores 2 e 3 elementos" (PIM-7559 / PIM-6665) é corrigido pelo usuário no app publicado, depois do deploy: abrir o card, ver o aviso novo e escolher o lado certo. Só o usuário sabe se o ticket correto é o PIM-7559 ou o PIM-6665.

Para achar outros cards no mesmo estado, o usuário pode rodar esta consulta, somente leitura, no SQL editor do Supabase:

```sql
SELECT a.id, a.jira_project, a.title, t->>'key' AS chave, t->>'url' AS link
FROM allocations a
CROSS JOIN LATERAL jsonb_array_elements(a.tickets) AS t
WHERE lower(t->>'url') LIKE 'https://way2agile.atlassian.net/%'
  AND substring(upper(t->>'url') FROM '([A-Z][A-Z0-9]+-[0-9]+)') IS NOT NULL
  AND substring(upper(t->>'url') FROM '([A-Z][A-Z0-9]+-[0-9]+)') <> upper(trim(t->>'key'))
  AND trim(coalesce(t->>'key', '')) <> '';
```
