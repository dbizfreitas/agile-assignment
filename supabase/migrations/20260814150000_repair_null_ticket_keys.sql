-- A migration anterior (20260814140000) podia backfillar {"key": null, ...}
-- para linhas legadas onde só ticket_url estava preenchido (ticket_key e
-- ticket_url eram colunas independentemente anuláveis). Repara esses itens
-- para {"key": "", ...}, restaurando o contrato AllocationTicket.key: string.
UPDATE public.allocations
SET tickets = (
  SELECT jsonb_agg(
    CASE WHEN t->'key' = 'null'::jsonb THEN jsonb_set(t, '{key}', '""') ELSE t END
  )
  FROM jsonb_array_elements(tickets) AS t
)
WHERE tickets @> '[{"key": null}]'::jsonb;
