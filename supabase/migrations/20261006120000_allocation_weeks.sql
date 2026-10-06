-- Semanas da sprint por card (issue #91). `week_start`/`week_end` guardam o
-- intervalo contínuo de semanas (1ª, 2ª, 3ª…) em que a demanda é trabalhada;
-- ambos nulos = card sem semana (todos os cards existentes continuam assim).
-- `week_end` nulo com `week_start` preenchido vale uma semana só.
--
-- O teto (nº de semanas da sprint) NÃO é validado aqui: depende das datas da
-- sprint, que podem ser editadas depois. O cliente limita as opções no
-- diálogo e, ao mover/replicar para outra sprint, corta o intervalo com
-- `clampWeeksToSprint` (src/lib/board.ts). O banco só garante a forma.
--
-- Ordem de deploy: aplicar pelo SQL Editor do Supabase ANTES do merge — o
-- cliente novo envia as duas colunas em todo insert/update de card, e o merge
-- não aplica migration.

ALTER TABLE public.allocations
  ADD COLUMN week_start smallint NULL,
  ADD COLUMN week_end smallint NULL;

ALTER TABLE public.allocations
  ADD CONSTRAINT allocations_week_start_positive
    CHECK (week_start IS NULL OR week_start >= 1),
  ADD CONSTRAINT allocations_week_end_valid
    CHECK (week_end IS NULL OR (week_start IS NOT NULL AND week_end >= week_start));
