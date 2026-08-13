-- Split allocations.status (7 values, mixing workflow + category) into
-- status (2 values: workflow) and tipo (4 values: category).

CREATE TYPE public.allocation_status_v2 AS ENUM ('nao_especificada', 'especificada');
CREATE TYPE public.allocation_tipo AS ENUM ('planejado', 'bug', 'evolutiva', 'ferias');

ALTER TABLE public.allocations
  ADD COLUMN status_v2 public.allocation_status_v2 NOT NULL DEFAULT 'nao_especificada';
ALTER TABLE public.allocations
  ADD COLUMN tipo public.allocation_tipo NOT NULL DEFAULT 'planejado';

-- Every existing row already has real content, so it counts as "especificada".
UPDATE public.allocations SET status_v2 = 'especificada';

-- Category is only recoverable for rows that were already bug/evolutiva/ferias;
-- everything else (planejado/em_andamento/concluido/risco) defaults to "planejado".
UPDATE public.allocations SET tipo = CASE status
  WHEN 'bug' THEN 'bug'::public.allocation_tipo
  WHEN 'evolutiva' THEN 'evolutiva'::public.allocation_tipo
  WHEN 'ferias' THEN 'ferias'::public.allocation_tipo
  ELSE 'planejado'::public.allocation_tipo
END;

ALTER TABLE public.allocations DROP COLUMN status;
DROP TYPE public.allocation_status;

ALTER TABLE public.allocations RENAME COLUMN status_v2 TO status;
ALTER TYPE public.allocation_status_v2 RENAME TO allocation_status;
