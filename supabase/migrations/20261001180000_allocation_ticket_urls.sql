-- Link do ticket só aceita um link http(s) (issue #51). O campo gravava
-- qualquer texto: `javascript:`, sem esquema e o mesmo link colado várias
-- vezes seguidas (o card PIM-7477 tinha o link repetido 5 vezes). O
-- AllocationDialog barra isso antes de salvar; este CHECK cobre cliente
-- desatualizado e chamada direta. A mensagem pt-BR está em
-- src/lib/board-errors.ts.
--
-- A regra é a mesma de `ticketUrlProblem` em src/lib/tickets.ts: depois de
-- btrim de espaço, tab, CR, LF, FF e VT (o mesmo que `trim()` do JS para ASCII),
-- casa ^https?://[^[:space:]/?#]+[^[:space:]]*$ e tem um único
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
    OR btrim(url, E' \t\r\n\f\v') = ''
    OR (
      btrim(url, E' \t\r\n\f\v') ~* '^https?://[^[:space:]/?#]+[^[:space:]]*$'
      AND btrim(url, E' \t\r\n\f\v') !~* '.https?://'
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
      WHEN btrim(e.t ->> 'url', E' \t\r\n\f\v') ~* '^https?://'
        THEN regexp_replace(btrim(e.t ->> 'url', E' \t\r\n\f\v'), '(.)https?://.*$', '\1', 'i')
    END AS fixed
  ) AS r
)
WHERE jsonb_typeof(a.tickets) = 'array'
  AND jsonb_array_length(a.tickets) > 0
  AND NOT public.allocation_ticket_urls_valid(a.tickets);

ALTER TABLE public.allocations
  ADD CONSTRAINT allocations_ticket_urls_valid
    CHECK (public.allocation_ticket_urls_valid(tickets));
