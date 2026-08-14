-- Substitui os campos escalares ticket_key/ticket_url por uma lista de
-- tickets (chave + link) por demanda, permitindo vincular N issues
-- Jira/DevOps a um mesmo cartão do quadro (issue #1 do repo).
ALTER TABLE public.allocations
  ADD COLUMN tickets jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.allocations
SET tickets = jsonb_build_array(jsonb_build_object('key', ticket_key, 'url', ticket_url))
WHERE ticket_key IS NOT NULL OR ticket_url IS NOT NULL;

ALTER TABLE public.allocations
  ADD CONSTRAINT allocations_tickets_is_array CHECK (jsonb_typeof(tickets) = 'array'),
  DROP COLUMN ticket_key,
  DROP COLUMN ticket_url;
