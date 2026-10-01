-- Integridade de sprints (issue #47). O diálogo aceitava fim antes do início,
-- código repetido no mesmo projeto e quarter livre ("Q9"). O SprintDialog
-- passa a barrar isso antes de salvar; estas constraints cobrem cliente
-- desatualizado, chamada direta e corrida entre duas abas. As mensagens
-- pt-BR de cada uma estão em src/lib/board-errors.ts.
--
-- Os dois CHECKs entram NOT VALID: valem para todo INSERT/UPDATE daqui em
-- diante, mas não reprovam a migration por causa de linha antiga. Para
-- validá-los depois, confira que as consultas abaixo voltam vazias e rode:
--   ALTER TABLE public.sprints VALIDATE CONSTRAINT sprints_date_order;
--   ALTER TABLE public.sprints VALIDATE CONSTRAINT sprints_quarter_format;
--
--   SELECT id, code, start_date, end_date FROM public.sprints WHERE end_date < start_date;
--   SELECT id, code, quarter FROM public.sprints WHERE quarter !~ '^(Q[1-4])?$';
--
-- O UNIQUE não tem NOT VALID. Antes de aplicar, confira no SQL Editor que
-- esta consulta volta vazia; se voltar linha, renomeie ou exclua as
-- duplicadas antes, ou a migration inteira é revertida:
--   SELECT jira_project, code, count(*) FROM public.sprints
--   GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Sobreposição de datas entre sprints NÃO vira constraint: a issue pede
-- só aviso, e o diálogo avisa sem bloquear.
--
-- Ordem de deploy: independente. O cliente novo não depende destas
-- constraints, e o cliente antigo só passa a ver as mensagens mapeadas.
ALTER TABLE public.sprints
  ADD CONSTRAINT sprints_date_order
    CHECK (end_date >= start_date) NOT VALID,
  ADD CONSTRAINT sprints_quarter_format
    CHECK (quarter ~ '^(Q[1-4])?$') NOT VALID,
  ADD CONSTRAINT sprints_project_code_key
    UNIQUE (jira_project, code);
