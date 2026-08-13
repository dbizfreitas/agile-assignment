-- Dimensão de projeto no quadro de alocação — parte B (muda comportamento de
-- escrita). Só aplicar depois que a parte A estiver aplicada e o backfill
-- conferido: são estas restrições que recusam linha órfã.

-- ============================================================
-- 1. NOT NULL, formato e a chave única que a FK composta exige
-- ============================================================
-- Sem DEFAULT: teams e sprints são as raízes e o projeto é escolha explícita
-- de quem cria; um default silenciosamente colocaria a linha no projeto errado.
--
-- UNIQUE (id, jira_project) é redundante com a PK, mas o Postgres exige uma
-- restrição única sobre as colunas referenciadas para aceitar a FK composta.
-- Custo: um índice pequeno em três tabelas de dezenas de linhas.
--
-- O banco valida só o FORMATO da chave, não a lista: a lista mora em
-- src/lib/projects.ts e um enum aqui criaria uma terceira fonte de verdade.
ALTER TABLE public.teams
  ALTER COLUMN jira_project SET NOT NULL,
  ADD CONSTRAINT teams_jira_project_format
    CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$'),
  ADD CONSTRAINT teams_id_project_key UNIQUE (id, jira_project);

ALTER TABLE public.sprints
  ALTER COLUMN jira_project SET NOT NULL,
  ADD CONSTRAINT sprints_jira_project_format
    CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$'),
  ADD CONSTRAINT sprints_id_project_key UNIQUE (id, jira_project);

ALTER TABLE public.devs
  ALTER COLUMN jira_project SET NOT NULL,
  ADD CONSTRAINT devs_jira_project_format
    CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$'),
  ADD CONSTRAINT devs_id_project_key UNIQUE (id, jira_project);

ALTER TABLE public.allocations
  ALTER COLUMN jira_project SET NOT NULL,
  ADD CONSTRAINT allocations_jira_project_format
    CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$');

-- ============================================================
-- 2. As três FKs compostas — onde a coerência é enforçada
-- ============================================================
-- As FKs simples de 20260801002005/20260803233437 PERMANECEM e continuam
-- definindo o ON DELETE: devs_team_id_fkey com RESTRICT (não se apaga um time
-- com gente) e allocations_*_fkey com CASCADE. Nas compostas, o ON DELETE da
-- FK para teams é NO ACTION de propósito: RESTRICT não pode ser combinado com
-- DEFERRABLE, e a trava de exclusão já vem da FK simples.
--
-- DEFERRABLE INITIALLY IMMEDIATE não muda nada no comportamento da aplicação
-- (a violação estoura no mesmo lugar), mas permite a curadoria descrita ao pé
-- deste arquivo: mover um time inteiro de projeto numa transação só.
ALTER TABLE public.devs
  ADD CONSTRAINT devs_team_project_fkey
  FOREIGN KEY (team_id, jira_project) REFERENCES public.teams (id, jira_project)
  ON UPDATE NO ACTION ON DELETE NO ACTION
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE public.allocations
  ADD CONSTRAINT allocations_dev_project_fkey
  FOREIGN KEY (dev_id, jira_project) REFERENCES public.devs (id, jira_project)
  ON UPDATE NO ACTION ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE,
  ADD CONSTRAINT allocations_sprint_project_fkey
  FOREIGN KEY (sprint_id, jira_project) REFERENCES public.sprints (id, jira_project)
  ON UPDATE NO ACTION ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- ============================================================
-- 3. Derivação por trigger — o cliente não envia o projeto dos filhos
-- ============================================================
-- Dispara em TODO INSERT e UPDATE, não em UPDATE OF team_id/dev_id: o valor
-- enviado pelo cliente é sempre sobrescrito, então a coluna é inforjável por
-- construção. SECURITY DEFINER porque a função precisa ler a linha do pai
-- independentemente do que a RLS venha a permitir no futuro; segue o padrão
-- dos helpers em private (SET search_path = public).
--
-- O ganho prático: AllocationDialog.tsx não muda em nada, e a mutação de
-- drag-and-drop update({ sprint_id, dev_id }) em BoardGrid.tsx também não — o
-- projeto é recalculado a cada movimento e a FK para sprints valida o destino.
CREATE OR REPLACE FUNCTION private.set_dev_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT t.jira_project INTO NEW.jira_project
    FROM public.teams t WHERE t.id = NEW.team_id;
  IF NEW.jira_project IS NULL THEN
    RAISE EXCEPTION 'Time não encontrado' USING ERRCODE = 'W3001';
  END IF;
  RETURN NEW;
END $$;

-- Trigger functions não têm o EXECUTE checado em tempo de execução (a
-- verificação acontece no CREATE TRIGGER), então revogar é seguro e mantém a
-- disciplina das outras funções novas do projeto.
REVOKE ALL ON FUNCTION private.set_dev_project() FROM public, anon;

CREATE TRIGGER devs_set_project
BEFORE INSERT OR UPDATE ON public.devs
FOR EACH ROW EXECUTE FUNCTION private.set_dev_project();

CREATE OR REPLACE FUNCTION private.set_allocation_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT d.jira_project INTO NEW.jira_project
    FROM public.devs d WHERE d.id = NEW.dev_id;
  IF NEW.jira_project IS NULL THEN
    RAISE EXCEPTION 'Pessoa não encontrada' USING ERRCODE = 'W3001';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.set_allocation_project() FROM public, anon;

CREATE TRIGGER allocations_set_project
BEFORE INSERT OR UPDATE ON public.allocations
FOR EACH ROW EXECUTE FUNCTION private.set_allocation_project();

-- ============================================================
-- 4. Índices — cada um casa o ORDER BY da query correspondente
-- ============================================================
-- allocations_sprint_dev_idx (20260801002005) continua servindo o acesso por
-- célula do grid.
CREATE INDEX teams_project_position_idx ON public.teams       (jira_project, position);
CREATE INDEX sprints_project_start_idx  ON public.sprints     (jira_project, start_date, position);
CREATE INDEX devs_project_position_idx  ON public.devs        (jira_project, position);
CREATE INDEX allocations_project_idx    ON public.allocations (jira_project);

-- ============================================================
-- Curadoria: mover um time inteiro de projeto depois (operador, não a tela)
-- ============================================================
-- Se o backfill errar, ou se um time realmente mudar de projeto, a operação é
-- coerente por natureza (time + pessoas + cartões + sprints juntos) e por isso
-- precisa que as FKs sejam diferidas. Receita, no SQL Editor:
--
--   BEGIN;
--   SET CONSTRAINTS ALL DEFERRED;
--   UPDATE public.teams       SET jira_project = 'PH' WHERE id = :time;
--   UPDATE public.devs        SET jira_project = 'PH' WHERE team_id = :time;
--   UPDATE public.allocations SET jira_project = 'PH'
--    WHERE dev_id IN (SELECT id FROM public.devs WHERE team_id = :time);
--   -- as sprints usadas por esses cartões também precisam ser do projeto de
--   -- destino: mova-as, ou crie as sprints do destino e repontue os cartões.
--   COMMIT;   -- as três FKs compostas são checadas aqui, tudo ou nada
--
-- SET CONSTRAINTS ALL DEFERRED não afeta os triggers de derivação, que
-- sobrescrevem devs.jira_project e allocations.jira_project a partir do pai —
-- e é por isso que os UPDATEs precisam subir na ordem time -> pessoas ->
-- cartões.
