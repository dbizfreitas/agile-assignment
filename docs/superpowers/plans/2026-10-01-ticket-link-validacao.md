# Validação do link do ticket (issue #51): plano de implementação

> **Para execução agêntica:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam sintaxe de checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** O campo "link do ticket" passa a aceitar só um link `http://` ou `https://` por linha. O diálogo de demanda mostra o erro inline e não deixa salvar, o colar desfaz links concatenados, e o banco rejeita (e corrige, nos dados antigos) o que escapar.

**Arquitetura:** Uma função pura nova, `ticketUrlProblem`, em `src/lib/tickets.ts`, classifica o link (`"esquema"`, `"varios"` ou `null`), e `firstTicketUrl` extrai o primeiro link de um valor concatenado. O `parseTicketTokens` passa a quebrar também em cada `http(s)://` e a descartar repetidos. O `AllocationDialog` usa essas funções para o erro inline, o botão "Manter só o primeiro" e o bloqueio do Salvar. Uma migration conserta as linhas existentes (incluindo o card PIM-7477) e cria um `CHECK` já validado com a mesma regra. O `boardErrorMessage` traduz a violação do `CHECK` para cliente desatualizado.

**Tech Stack:** React 19, TypeScript, shadcn/ui, Tailwind, Supabase JS, Postgres (migrations em `supabase/migrations/`).

## Restrições globais

- Todo texto de UI e comentário em pt-BR com acentuação correta.
- **A regra de link válido é uma só, idêntica no cliente e no banco:** depois de `trim`, o valor (1) casa `^https?://[^\s/?#]+\S*$` sem diferenciar maiúsculas de minúsculas e (2) contém `http://` ou `https://` exatamente uma vez. Link vazio ou `null` é válido (linha só com chave).
- Efeito colateral aceito da regra (2): uma URL com outra URL dentro da query (`?next=https://...`) é recusada. Não existe esse caso no Jira nem no DevOps.
- **Sem aviso de host.** O critério opcional da issue (avisar quando o host não é `way2agile.atlassian.net`) foi descartado pelo usuário: cards também levam links do DevOps e de outros sites (issue #1).
- Erro de link **bloqueia** o Salvar. O aviso de chave divergente (#50, `ticketKeyMismatch`) continua não bloqueando e não muda.
- Tom de erro: `text-destructive`, como no resto do projeto.
- Não há framework de testes no projeto (nem `vitest`/`jest`, nem script `test`). As funções puras são verificadas com um script descartável rodado via `npx tsx`, que **não** deve ser commitado. O resto se verifica com `npm run build` e no navegador.
- Não há Postgres local (sem `psql`, `docker` nem `supabase` CLI). A migration não roda localmente: o SQL é revisado à mão e aplicado pelo Lovable no deploy.
- Baseline conhecida: `npm run lint` já falha no checkout local com `prettier/prettier: Delete '␍'` porque o Windows usa `core.autocrlf=true`. Isso não é responsabilidade deste plano. Nos arquivos `.ts`/`.tsx` tocados, rode `npx prettier --write <arquivo>` antes de commitar.
- Este repositório sincroniza com o Lovable. Trabalhe na branch `fix/ticket-link-validacao-51` (já criada), nunca reescreva histórico publicado e **não faça push**: o push e o PR ficam com o coordenador, depois da confirmação do usuário.
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Mapa de arquivos

- **Modificar `src/lib/tickets.ts`:** adicionar `ticketUrlProblem` e `firstTicketUrl`; `parseTicketTokens` quebra em cada `http(s)://` e remove repetidos.
- **Modificar `src/components/AllocationDialog.tsx`:** erro inline por linha, botão "Manter só o primeiro", colar de links concatenados e Salvar desabilitado.
- **Criar `supabase/migrations/20261001180000_allocation_ticket_urls.sql`:** funções de validação, reparo dos dados existentes e `CHECK allocations_ticket_urls_valid`.
- **Modificar `src/lib/board-errors.ts`:** mensagem pt-BR para `allocations_ticket_urls_valid`.

---

### Tarefa 1: funções puras de link em `tickets.ts`

**Arquivos:**
- Modificar: `src/lib/tickets.ts`
- Verificação: `src/lib/tickets.check.ts` (temporário, apagado no fim da tarefa)

**Interfaces:**
- Consome: `AllocationTicket` de `src/lib/board.ts` (`{ key: string; url: string | null }`) e `parseTicketToken(token: string): AllocationTicket`, que já existe em `tickets.ts`.
- Produz (usado pela Tarefa 2):
  - `type TicketUrlProblem = "esquema" | "varios"`
  - `ticketUrlProblem(url: string | null): TicketUrlProblem | null`: `null` para link vazio ou válido; `"varios"` quando há mais de um `http(s)://`; `"esquema"` para o resto.
  - `firstTicketUrl(url: string): string`: o primeiro trecho que começa em `http(s)://`, sem espaços nas pontas. Se não houver nenhum `http(s)://`, devolve o valor com `trim`.
  - `parseTicketTokens(text: string): AllocationTicket[]`: mesma assinatura de hoje, com o comportamento novo.

- [ ] **Passo 1: escrever o script de verificação (vai falhar)**

Criar `src/lib/tickets.check.ts`:

```typescript
import assert from "node:assert/strict";
import { firstTicketUrl, parseTicketTokens, ticketUrlProblem } from "./tickets";

const J = "https://way2agile.atlassian.net/browse/";

// válidos
assert.equal(ticketUrlProblem(null), null);
assert.equal(ticketUrlProblem(""), null);
assert.equal(ticketUrlProblem("   "), null);
assert.equal(ticketUrlProblem(`${J}PIM-7477`), null);
assert.equal(ticketUrlProblem(`  ${J}PIM-7477  `), null);
assert.equal(ticketUrlProblem("HTTPS://dev.azure.com/way2/x/_workitems/edit/123"), null);
assert.equal(ticketUrlProblem("http://exemplo.com"), null);
assert.equal(ticketUrlProblem(`${J}PIM-1?focusedCommentId=10`), null);

// esquema inválido
assert.equal(ticketUrlProblem("javascript:void(0)"), "esquema");
assert.equal(ticketUrlProblem("javascript:alert('https://x')"), "esquema");
assert.equal(ticketUrlProblem("ftp://exemplo.com"), "esquema");
assert.equal(ticketUrlProblem("way2agile.atlassian.net/browse/PIM-1"), "esquema");
assert.equal(ticketUrlProblem("https://"), "esquema");
assert.equal(ticketUrlProblem("https:///caminho"), "esquema");
assert.equal(ticketUrlProblem("https://exemplo.com/a b"), "esquema");

// mais de um link (o caso real do PIM-7477 e variações)
assert.equal(ticketUrlProblem(`${J}PIM-7477`.repeat(5)), "varios");
assert.equal(ticketUrlProblem(`${J}PIM-1 ${J}PIM-2`), "varios");
assert.equal(ticketUrlProblem(`${J}PIM-1http://x.com`), "varios");

// firstTicketUrl
assert.equal(firstTicketUrl(`${J}PIM-7477`.repeat(5)), `${J}PIM-7477`);
assert.equal(firstTicketUrl(`  ${J}PIM-1 ${J}PIM-2 `), `${J}PIM-1`);
assert.equal(firstTicketUrl(`${J}PIM-1HTTP://x.com`), `${J}PIM-1`);
assert.equal(firstTicketUrl(`  ${J}PIM-1  `), `${J}PIM-1`);
assert.equal(firstTicketUrl("  sem link  "), "sem link");

// parseTicketTokens: comportamento antigo preservado
assert.deepEqual(parseTicketTokens("pim-1, PIM-2"), [
  { key: "PIM-1", url: `${J}PIM-1` },
  { key: "PIM-2", url: `${J}PIM-2` },
]);

// parseTicketTokens: links colados sem separador viram linhas separadas
assert.deepEqual(parseTicketTokens(`${J}PIM-1${J}PIM-2`), [
  { key: "PIM-1", url: `${J}PIM-1` },
  { key: "PIM-2", url: `${J}PIM-2` },
]);

// parseTicketTokens: repetidos somem (sem diferenciar maiúsculas)
assert.deepEqual(parseTicketTokens(`${J}PIM-7477`.repeat(5)), [
  { key: "PIM-7477", url: `${J}PIM-7477` },
]);
assert.deepEqual(parseTicketTokens("PIM-1 pim-1"), [{ key: "PIM-1", url: `${J}PIM-1` }]);

console.log("ok");
```

- [ ] **Passo 2: rodar e confirmar que falha**

Run: `npx tsx src/lib/tickets.check.ts`
Expected: FAIL, com erro dizendo que `ticketUrlProblem` / `firstTicketUrl` não são exportados ou não são funções.

- [ ] **Passo 3: implementar as duas funções novas**

Em `src/lib/tickets.ts`, adicionar depois de `ticketKeyMismatch` (antes de `parseTicketToken`):

```typescript
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
```

Atenção: `"javascript:alert('https://x')"` tem um único `https://`, então cai em `SINGLE_URL_RE`, que falha por não começar com `http` → `"esquema"`. É o esperado.

Atenção 2: `firstTicketUrl("  sem link  ")` → o `split` não acha `http`, devolve `["sem link"]` → `"sem link"`.

- [ ] **Passo 4: trocar `parseTicketTokens`**

Substituir a função `parseTicketTokens` inteira (e o comentário JSDoc acima dela) por:

```typescript
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
```

`String.prototype.split` com regex pode inserir `undefined`? Não: a regex não tem grupo de captura, então só devolve strings.

- [ ] **Passo 5: rodar e confirmar que passa**

Run: `npx tsx src/lib/tickets.check.ts`
Expected: imprime `ok`.

- [ ] **Passo 6: apagar o script, formatar e commitar**

```bash
rm src/lib/tickets.check.ts
npx prettier --write src/lib/tickets.ts
git add src/lib/tickets.ts
git commit -m "fix(tickets): valida link do ticket e desfaz links colados concatenados (#51)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Confirme com `git status` que `tickets.check.ts` não ficou no working tree.

---

### Tarefa 2: erro inline e bloqueio do Salvar no diálogo

**Arquivos:**
- Modificar: `src/components/AllocationDialog.tsx` (import na linha 44, `handleTicketPaste` perto da linha 150, `isDirty` perto da linha 205, lista de tickets perto das linhas 304-358, botão Salvar perto da linha 430)

**Interfaces:**
- Consome (Tarefa 1): `ticketUrlProblem(url: string | null): "esquema" | "varios" | null`, `firstTicketUrl(url: string): string` e o `parseTicketTokens` novo. Usa também `setTicketAt(index, ticket)`, que já existe no arquivo (veio da #50).
- Produz: nada que outra tarefa use.

**Comportamento esperado:**
- Linha com `ticketUrlProblem(t.url) === "esquema"`: abaixo da linha, em `text-destructive text-xs`: `O link precisa começar com http:// ou https://.`
- Linha com `"varios"`: `Há mais de um link neste campo.` e, na mesma linha, um botão `variant="link"` pequeno `Manter só o primeiro`, que troca o link por `firstTicketUrl(t.url)` e mantém a chave.
- O input do link recebe `aria-invalid` quando há problema.
- O Salvar fica desabilitado enquanto qualquer linha tiver problema de link.
- Colar no campo um texto com mais de um `http(s)://` nunca usa o colar nativo: o texto passa por `parseTicketTokens` e substitui a linha (uma linha, se eram todos iguais; várias, se eram diferentes).
- O aviso âmbar da #50 continua aparecendo quando couber, abaixo do erro de link.

- [ ] **Passo 1: importar as funções**

Trocar a linha 44:

```typescript
import { extractJiraKey, jiraUrlFor, parseTicketTokens, ticketKeyMismatch } from "@/lib/tickets";
```

por:

```typescript
import {
  extractJiraKey,
  firstTicketUrl,
  jiraUrlFor,
  parseTicketTokens,
  ticketKeyMismatch,
  ticketUrlProblem,
} from "@/lib/tickets";
```

- [ ] **Passo 2: o colar trata links concatenados**

Em `handleTicketPaste`, trocar a linha:

```typescript
    if (parsed.length <= 1) {
```

por:

```typescript
    // Mais de um http(s):// no texto colado nunca vai para o colar nativo,
    // mesmo que vire uma linha só depois de tirar os repetidos (issue #51).
    if (parsed.length <= 1 && ticketUrlProblem(text) !== "varios") {
```

O resto da função não muda: o `splice(index, 1, ...parsed)` já substitui a linha por uma ou várias.

- [ ] **Passo 3: calcular o bloqueio do Salvar**

Logo depois do bloco `const isDirty = (() => { ... })();`, adicionar:

```typescript
  // Link inválido bloqueia o Salvar (issue #51); o erro aparece na própria
  // linha. O banco tem a mesma regra no CHECK allocations_ticket_urls_valid.
  const hasTicketUrlProblem = tickets.some((t) => ticketUrlProblem(t.url) !== null);
```

- [ ] **Passo 4: renderizar o erro na linha**

Na lista de tickets, dentro de `tickets.map((t, i) => {`, trocar:

```tsx
                    const linked = ticketKeyMismatch(t);
                    const typed = t.key.trim().toUpperCase();
```

por:

```tsx
                    const linked = ticketKeyMismatch(t);
                    const typed = t.key.trim().toUpperCase();
                    const urlProblem = ticketUrlProblem(t.url);
```

No input do link, trocar:

```tsx
                              placeholder="https://..."
                              aria-label="Link do ticket"
                            />
```

por:

```tsx
                              placeholder="https://..."
                              aria-label="Link do ticket"
                              aria-invalid={urlProblem ? true : undefined}
                            />
```

E, logo antes de `{linked ? (`, inserir:

```tsx
                        {urlProblem === "esquema" ? (
                          <p className="text-xs text-destructive">
                            O link precisa começar com http:// ou https://.
                          </p>
                        ) : null}
                        {urlProblem === "varios" ? (
                          <p className="flex flex-wrap items-center gap-x-2 text-xs text-destructive">
                            <span>Há mais de um link neste campo.</span>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              onClick={() =>
                                setTicketAt(i, { key: t.key, url: firstTicketUrl(t.url ?? "") })
                              }
                            >
                              Manter só o primeiro
                            </Button>
                          </p>
                        ) : null}
```

- [ ] **Passo 5: desabilitar o Salvar**

Trocar:

```tsx
              <Button onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>
```

por:

```tsx
              <Button
                onClick={() => save.mutate()}
                disabled={!title.trim() || hasTicketUrlProblem || save.isPending}
              >
```

- [ ] **Passo 6: build**

Run: `npm run build`
Expected: termina sem erro de TypeScript nem de bundle.

- [ ] **Passo 7: formatar e commitar**

```bash
npx prettier --write src/components/AllocationDialog.tsx
git add src/components/AllocationDialog.tsx
git commit -m "fix(alocacoes): bloqueia salvar com link de ticket inválido (#51)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3: reparo dos dados e `CHECK` no banco

**Arquivos:**
- Criar: `supabase/migrations/20261001180000_allocation_ticket_urls.sql`
- Modificar: `src/lib/board-errors.ts` (depois do bloco `sprints_project_code_key`, perto da linha 112)

**Interfaces:**
- Consome: coluna `public.allocations.tickets jsonb` (array de `{ "key": string, "url": string | null }`, com `CHECK allocations_tickets_is_array`).
- Produz: funções `public.ticket_url_is_valid(text)` e `public.allocation_ticket_urls_valid(jsonb)`, e a constraint `allocations_ticket_urls_valid`, cujo nome a mensagem de `board-errors.ts` usa.

- [ ] **Passo 1: escrever a migration**

Criar `supabase/migrations/20261001180000_allocation_ticket_urls.sql` com exatamente:

```sql
-- Link do ticket só aceita um link http(s) (issue #51). O campo gravava
-- qualquer texto: `javascript:`, sem esquema e o mesmo link colado várias
-- vezes seguidas (o card PIM-7477 tinha o link repetido 5 vezes). O
-- AllocationDialog barra isso antes de salvar; este CHECK cobre cliente
-- desatualizado e chamada direta. A mensagem pt-BR está em
-- src/lib/board-errors.ts.
--
-- A regra é a mesma de `ticketUrlProblem` em src/lib/tickets.ts: depois de
-- btrim, casa ^https?://[^[:space:]/?#]+[^[:space:]]*$ e tem um único
-- http(s)://. Link null ou vazio é válido. Se mudar lá, mude aqui.
--
-- Ordem de deploy: independente. O cliente novo não depende do CHECK; o
-- cliente antigo só passa a receber a mensagem mapeada ao salvar link
-- inválido.

CREATE OR REPLACE FUNCTION public.ticket_url_is_valid(url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT url IS NULL
    OR btrim(url) = ''
    OR (
      btrim(url) ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'
      AND btrim(url) !~* '.https?://'
    );
$$;

-- Guarda no jsonb_typeof: a ordem de avaliação entre este CHECK e o
-- allocations_tickets_is_array não é garantida, e jsonb_array_elements
-- falha em não-array.
CREATE OR REPLACE FUNCTION public.allocation_ticket_urls_valid(tickets jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(tickets) IS DISTINCT FROM 'array'
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(tickets) AS t
      WHERE jsonb_typeof(t -> 'url') = 'string'
        AND NOT public.ticket_url_is_valid(t ->> 'url')
    );
$$;

-- Reparo das linhas existentes, antes do CHECK. Para cada link inválido:
--   1. começa com http(s):// → fica só o primeiro link (o
--      regexp_replace troca "último caractere do 1º link + resto" pelo
--      próprio caractere);
--   2. se ainda assim for inválido, ou não começar com http(s):// (ex.:
--      javascript:), o link vira null e a linha fica só com a chave.
-- A ordem dos tickets no array é preservada (WITH ORDINALITY).
UPDATE public.allocations AS a
SET tickets = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(e.t -> 'url') <> 'string'
        OR public.ticket_url_is_valid(e.t ->> 'url')
        THEN e.t
      WHEN r.fixed IS NOT NULL AND public.ticket_url_is_valid(r.fixed)
        THEN jsonb_set(e.t, '{url}', to_jsonb(r.fixed))
      ELSE jsonb_set(e.t, '{url}', 'null'::jsonb)
    END
    ORDER BY e.ord
  )
  FROM jsonb_array_elements(a.tickets) WITH ORDINALITY AS e(t, ord)
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN btrim(e.t ->> 'url') ~* '^https?://'
        THEN regexp_replace(btrim(e.t ->> 'url'), '(.)https?://.*$', '\1', 'i')
    END AS fixed
  ) AS r
)
WHERE jsonb_typeof(a.tickets) = 'array'
  AND jsonb_array_length(a.tickets) > 0
  AND NOT public.allocation_ticket_urls_valid(a.tickets);

ALTER TABLE public.allocations
  ADD CONSTRAINT allocations_ticket_urls_valid
    CHECK (public.allocation_ticket_urls_valid(tickets));
```

Pontos para conferir na revisão do SQL (não há banco local):
- `regexp_replace(..., '(.)https?://.*$', '\1', 'i')`: a busca é pelo casamento mais à esquerda. Em `https://a/PIM-1https://a/PIM-1`, na posição 0 `(.)` = `h` e o resto precisa ser `https?://`, mas é `ttps://`, então não casa; o primeiro casamento é no `1` antes do segundo `https://`. O resultado é `https://a/PIM-1`. Sem a flag `g`, só esse casamento é trocado, e o `.*$` já engole o resto.
- `jsonb_array_length(a.tickets) > 0` no `WHERE` garante que o `jsonb_agg` nunca roda sobre zero linhas (devolveria `NULL` e violaria o `NOT NULL` da coluna).
- `fixed` é `NULL` quando o link não começa com `http(s)://`. Como `ticket_url_is_valid(NULL)` devolve `true` e `jsonb_set` com valor SQL `NULL` devolve `NULL` para o ticket inteiro, a 2ª cláusula exige `r.fixed IS NOT NULL`; sem isso, o ticket sumiria do array. Não remova essa condição.

- [ ] **Passo 2: mapear a mensagem do `CHECK`**

Em `src/lib/board-errors.ts`, logo depois do bloco:

```typescript
  if (code === "23505" && haystack.includes("sprints_project_code_key")) {
    return "Já existe uma sprint com este código neste projeto.";
  }
```

adicionar:

```typescript
  // Link do ticket (issue #51). O AllocationDialog barra antes de salvar;
  // isto cobre cliente desatualizado.
  if (code === "23514" && haystack.includes("allocations_ticket_urls_valid")) {
    return "Link de ticket inválido. Use um único link começando com http:// ou https://.";
  }
```

- [ ] **Passo 3: build**

Run: `npm run build`
Expected: termina sem erro.

- [ ] **Passo 4: formatar e commitar**

```bash
npx prettier --write src/lib/board-errors.ts
git add supabase/migrations/20261001180000_allocation_ticket_urls.sql src/lib/board-errors.ts
git commit -m "fix(tickets): CHECK de link http(s) único e reparo dos dados existentes (#51)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Verificação no navegador (coordenador)

Feita pelo coordenador depois das três tarefas, com `preview_start` em `lovable-dev` (porta 8081):

1. Abrir uma demanda e digitar `javascript:void(0)` no link: aparece `O link precisa começar com http:// ou https://.` e o Salvar fica desabilitado.
2. Digitar no link o valor de `https://way2agile.atlassian.net/browse/PIM-7477` repetido duas vezes: aparece `Há mais de um link neste campo.`; `Manter só o primeiro` deixa um link só, o erro some e o Salvar volta.
3. Colar o link do PIM-7477 repetido 5 vezes no campo: vira uma linha só, com chave `PIM-7477` e link único.
4. Colar dois links diferentes grudados: viram duas linhas.
5. Link do DevOps (`https://dev.azure.com/...`): sem erro e sem aviso.
6. Console sem erros novos.

Não salve nada no banco durante a verificação (use Cancelar), a menos que o usuário peça.

---

## Fora do código: dado em produção

A migration conserta o card PIM-7477 e qualquer outro com link repetido ou inválido no deploy, sem passo manual (decisão do usuário). Para conferir depois do deploy, o usuário pode rodar no SQL editor do Supabase (somente leitura; deve voltar vazio):

```sql
SELECT id, jira_project, title, tickets
FROM public.allocations
WHERE NOT public.allocation_ticket_urls_valid(tickets);
```
