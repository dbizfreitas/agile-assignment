-- supabase/migrations/20260902180000_retro_participants_foundation.sql
-- Issue #24: participantes e estado do sorteio de Retrospectivas saem do
-- bundle JS (src/lib/retrospectivas/participants.ts) e do localStorage
-- (src/hooks/use-roulette.ts) para tabelas protegidas por RLS na mesma
-- linha da #23: has_route(uid, 'retrospectivas'). sort_order existe porque
-- a cor de cada pessoa hoje deriva da posição no array
-- (AVATAR_COLORS[index % 21]) — sem essa coluna a cor mudaria conforme o
-- Postgres decidisse devolver as linhas.
CREATE TABLE public.retro_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  color text,
  sort_order int NOT NULL,
  photo_data_url text,
  photo_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.retro_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_participants_select_route ON public.retro_participants
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'retrospectivas'::public.app_route));
-- Sem policy de INSERT/UPDATE/DELETE para authenticated: gestão de
-- participantes é manual (SQL/editor Supabase), decisão explícita do
-- escopo da issue #24. A única escrita automática (cache de foto) usa
-- supabaseAdmin (service role), que bypassa RLS.

-- Linha única (singleton): hoje existe um sorteio só, sem conceito de
-- retros paralelas. `id boolean CHECK (id)` é o truque padrão para travar
-- a tabela em exatamente uma linha.
CREATE TABLE public.retro_roulette_state (
  id boolean PRIMARY KEY DEFAULT true,
  drawn_emails text[] NOT NULL DEFAULT '{}',
  skipped_emails text[] NOT NULL DEFAULT '{}',
  last_winner_email text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retro_roulette_state_singleton CHECK (id)
);

INSERT INTO public.retro_roulette_state (id) VALUES (true);

ALTER TABLE public.retro_roulette_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_roulette_state_select_route ON public.retro_roulette_state
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'retrospectivas'::public.app_route));
-- Sem policy de escrita: só as RPCs SECURITY DEFINER da Task 3 gravam.

-- Seed: os 20 participantes hoje hardcoded em
-- src/lib/retrospectivas/participants.ts, na mesma ordem (sort_order
-- preserva a cor de cada pessoa para quem já está acostumado com ela).
INSERT INTO public.retro_participants (name, email, color, sort_order) VALUES
  ('André Secco', 'andre.secco@way2.com.br', NULL, 0),
  ('Bruno Shippit', 'bruno@shippit.app', '#0ea5e9', 1),
  ('Christian Leonardo Chiavelli', 'christian.chiavelli@way2.com.br', NULL, 2),
  ('Daniel Alves', 'daniel.alves@way2.com.br', NULL, 3),
  ('Daniel Heler Pohlmann', 'daniel.heler@way2.com.br', NULL, 4),
  ('Diego Freitas', 'diego.freitas@way2.com.br', NULL, 5),
  ('Diego Martini Longhi', 'diego.longhi@way2.com.br', NULL, 6),
  ('Fábio Meira de Almeida', 'fabio.almeida@way2.com.br', NULL, 7),
  ('Fernando Gaio', 'fernando.gaio@way2.com.br', NULL, 8),
  ('Francisco das Chagas', 'francisco.chagas@way2.com.br', NULL, 9),
  ('Gilcelaine Portela da Luz', 'gilcelaine.luz@way2.com.br', NULL, 10),
  ('Guilherme de Oliveira França', 'guilherme.franca@way2.com.br', NULL, 11),
  ('Jaicon Algir Marmitt', 'jaicon.marmitt@way2.com.br', NULL, 12),
  ('José Shippit', 'jose@shippit.app', '#0ea5e9', 13),
  ('Lais Caroline Ortiz', 'lais.ortiz@way2.com.br', NULL, 14),
  ('Luiz Berti', 'luizberti@shippit.app', '#0ea5e9', 15),
  ('Rafaello Valladares Bertolini', 'rafaello.bertolini@way2.com.br', NULL, 16),
  ('Rinaldo Ferreira Junior', 'rinaldo.junior@way2.com.br', NULL, 17),
  ('Vitor Junior de Oliveira Souza', 'vitor.souza@way2.com.br', NULL, 18),
  ('Warley Thales da Silva Lopes', 'warley.lopes@way2.com.br', NULL, 19);
