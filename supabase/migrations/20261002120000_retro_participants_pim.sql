-- supabase/migrations/20261002120000_retro_participants_pim.sql
-- Atualiza a lista da roleta de Retrospectivas para o time do projeto PIM.
-- Quem permanece não é tocado: nome, sort_order (logo, cor) e o estado do
-- sorteio (sorteado/pulado) ficam como estão. Quem sai é removido da tabela
-- e também dos arrays de estado, para não sobrar e-mail órfão em
-- drawn_emails/skipped_emails/last_winner_email. Quem entra começa elegível.
--
-- Idempotente: rodar duas vezes dá o mesmo resultado.

BEGIN;

CREATE TEMP TABLE _retro_pim (ord serial, name text, email text, color text) ON COMMIT DROP;

INSERT INTO _retro_pim (name, email, color) VALUES
  ('Fernando Gaio', 'fernando.gaio@way2.com.br', NULL),
  ('Jaicon Algir Marmitt', 'jaicon.marmitt@way2.com.br', NULL),
  ('André Secco', 'andre.secco@way2.com.br', NULL),
  ('Daniel Alves', 'daniel.alves@way2.com.br', NULL),
  ('Diego Freitas', 'diego.freitas@way2.com.br', NULL),
  ('Guilherme de Oliveira França', 'guilherme.franca@way2.com.br', NULL),
  ('Diego Martini Longhi', 'diego.longhi@way2.com.br', NULL),
  ('Daniel Heler Pohlmann', 'daniel.heler@way2.com.br', NULL),
  ('Warley Thales da Silva Lopes', 'warley.lopes@way2.com.br', NULL),
  ('Vitor Junior de Oliveira Souza', 'vitor.souza@way2.com.br', NULL),
  ('Christian Leonardo Chiavelli', 'christian.chiavelli@way2.com.br', NULL),
  ('Rafaello Valladares Bertolini', 'rafaello.bertolini@way2.com.br', NULL),
  ('Gilcelaine Portela da Luz', 'gilcelaine.luz@way2.com.br', NULL),
  ('Lais Caroline Ortiz', 'lais.ortiz@way2.com.br', NULL),
  ('Rinaldo Ferreira Junior', 'rinaldo.junior@way2.com.br', NULL),
  ('Luiz Berti', 'luizberti@shippit.app', '#0ea5e9'),
  ('Fábio Meira de Almeida', 'fabio.almeida@way2.com.br', NULL),
  ('Euclisio Mendes', 'euclisio.mendes@way2.com.br', NULL),
  ('Vinicius Menezes', 'vinicius.menezes@shippit.app', '#0ea5e9'),
  ('Davy Carvalho Ribeiro', 'davy.ribeiro@way2.com.br', NULL),
  ('Francisco das Chagas', 'francisco.chagas@way2.com.br', NULL);

-- Trava o estado antes de mexer, como fazem as RPCs do sorteio.
SELECT 1 FROM public.retro_roulette_state WHERE id FOR UPDATE;

-- 1) Quem saiu: limpa o estado do sorteio...
UPDATE public.retro_roulette_state s
   SET drawn_emails = ARRAY(
         SELECT e FROM unnest(s.drawn_emails) AS e
          WHERE e IN (SELECT email FROM _retro_pim)),
       skipped_emails = ARRAY(
         SELECT e FROM unnest(s.skipped_emails) AS e
          WHERE e IN (SELECT email FROM _retro_pim)),
       last_winner_email = CASE
         WHEN s.last_winner_email IN (SELECT email FROM _retro_pim) THEN s.last_winner_email
         ELSE NULL END,
       updated_at = now()
 WHERE id = true;

-- ...e sai da tabela.
DELETE FROM public.retro_participants
 WHERE email NOT IN (SELECT email FROM _retro_pim);

-- 2) Quem entrou: vai para o fim da fila de cores (sort_order após o maior
-- atual), na ordem da lista acima. ON CONFLICT DO NOTHING preserva quem já
-- existe.
INSERT INTO public.retro_participants (name, email, color, sort_order)
SELECT n.name, n.email, n.color,
       (SELECT coalesce(max(sort_order), -1) FROM public.retro_participants)
         + row_number() OVER (ORDER BY n.ord)
  FROM _retro_pim n
 WHERE n.email NOT IN (SELECT email FROM public.retro_participants)
ON CONFLICT (email) DO NOTHING;

COMMIT;
