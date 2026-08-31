-- Suite de verificacao do trigger private.set_team_position (achado do code
-- review do PR #33, migration 20260831120000_team_insert_position_trigger.sql).
-- Roda inteiramente dentro de uma transacao com ROLLBACK: nao deixa residuo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Secao N OK' por secao.
-- Falha = ERROR: com a mensagem do ASSERT que falhou.
--
-- Projetos sinteticos (SMOKEC/SMOKED), nao PIM/PH/INTFLOW/PDC: o trigger le
-- o `max(position)` de todo o projeto a cada insert, e um projeto real ja
-- tem times cadastrados -- rodar contra um projeto real faria o valor
-- esperado depender de quantos times ja existem la, em vez de ser um numero
-- fixo e legivel na asercao (mesma razao registrada em team_delete_smoke.sql
-- para SMOKEA/SMOKEB).
BEGIN;

SET LOCAL plpgsql.check_asserts = on;

-- ============================================================
-- Secao 1 -- primeiro time do projeto nasce em position 0, mesmo mandando
-- um valor explicito diferente (o trigger ignora o payload do cliente)
-- ============================================================
DO $$
DECLARE
  v_pos int;
BEGIN
  INSERT INTO public.teams (name, color, position, jira_project)
    VALUES ('_SMOKE_C1_', '#000000', 999, 'SMOKEC')
    RETURNING position INTO v_pos;

  ASSERT v_pos = 0,
    format('Secao 1: primeiro time do projeto deveria nascer em position 0, achou %s', v_pos);

  RAISE NOTICE 'Secao 1 OK';
END $$;

-- ============================================================
-- Secao 2 -- segundo time do MESMO projeto nasce em position 1
-- ============================================================
DO $$
DECLARE
  v_pos int;
BEGIN
  INSERT INTO public.teams (name, color, jira_project)
    VALUES ('_SMOKE_C2_', '#000000', 'SMOKEC')
    RETURNING position INTO v_pos;

  ASSERT v_pos = 1,
    format('Secao 2: segundo time do projeto deveria nascer em position 1, achou %s', v_pos);

  RAISE NOTICE 'Secao 2 OK';
END $$;

-- ============================================================
-- Secao 3 -- terceiro time, mandando position explicito de novo: continua
-- sendo ignorado, e o calculo usa o estado real do banco (0,1 -> 2), nao
-- `count(*)` (que coincidiria aqui, mas nao depois de uma exclusao no meio)
-- ============================================================
DO $$
DECLARE
  v_pos int;
BEGIN
  INSERT INTO public.teams (name, color, position, jira_project)
    VALUES ('_SMOKE_C3_', '#000000', -1, 'SMOKEC')
    RETURNING position INTO v_pos;

  ASSERT v_pos = 2,
    format('Secao 3: terceiro time do projeto deveria nascer em position 2, achou %s', v_pos);

  RAISE NOTICE 'Secao 3 OK';
END $$;

-- ============================================================
-- Secao 4 -- projeto DIFERENTE comeca do zero: o calculo e escopado por
-- jira_project, nao e um contador global da tabela
-- ============================================================
DO $$
DECLARE
  v_pos int;
BEGIN
  INSERT INTO public.teams (name, color, jira_project)
    VALUES ('_SMOKE_D1_', '#000000', 'SMOKED')
    RETURNING position INTO v_pos;

  ASSERT v_pos = 0,
    format('Secao 4: primeiro time de um projeto diferente deveria nascer em position 0, achou %s', v_pos);

  RAISE NOTICE 'Secao 4 OK';
END $$;

ROLLBACK;
