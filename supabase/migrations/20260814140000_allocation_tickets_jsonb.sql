-- Substitui os campos escalares ticket_key/ticket_url por uma lista de
-- tickets (chave + link) por demanda, permitindo vincular N issues
-- Jira/DevOps a um mesmo cartão do quadro (issue #1 do repo).
--
-- NOTA para migrations futuras desse tipo: como o DROP COLUMN roda no mesmo
-- deploy da troca de payload no cliente, uma aba aberta com o bundle antigo
-- pode falhar ao salvar até dar refresh (o insert/update antigo ainda manda
-- ticket_key/ticket_url). Considerar manter as colunas antigas por um
-- deploy e derrubá-las numa migration separada, se o volume de usuários
-- simultâneos crescer.
ALTER TABLE public.allocations
  ADD COLUMN tickets jsonb NOT NULL DEFAULT '[]'::jsonb;

-- COALESCE na key: ticket_key/ticket_url eram anuláveis independentemente, e
-- o UPDATE roda pelo OR — sem o COALESCE, uma linha com só ticket_url
-- preenchido vira {"key": null, ...}, violando o contrato "key: string" que
-- todo o código do cliente assume (ver migration de reparo 20260814150000
-- para linhas já migradas antes deste fix).
UPDATE public.allocations
SET tickets = jsonb_build_array(jsonb_build_object('key', coalesce(ticket_key, ''), 'url', ticket_url))
WHERE ticket_key IS NOT NULL OR ticket_url IS NOT NULL;

ALTER TABLE public.allocations
  ADD CONSTRAINT allocations_tickets_is_array CHECK (jsonb_typeof(tickets) = 'array'),
  DROP COLUMN ticket_key,
  DROP COLUMN ticket_url;
