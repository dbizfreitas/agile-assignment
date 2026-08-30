-- Exclusao de time com realocacao explicita das pessoas (issue #14).
--
-- Por que uma RPC e nao duas chamadas do supabase-js: mover as pessoas e
-- apagar o time PRECISAM estar na mesma transacao. Em duas chamadas, uma
-- falha na segunda deixa as pessoas ja movidas e o time vivo — e como teams e
-- a raiz do eixo de colunas do quadro, isso e estado silenciosamente errado,
-- sem nada na tela para denuncia-lo.
--
-- SECURITY DEFINER com verificacao explicita de permissao (mesmo padrao de
-- public.delete_platform_user): a funcao e chamada com o client do PROPRIO
-- usuario, para auth.uid() resolver o ator. As policies teams_delete_editors
-- e devs_update_editors permanecem, cobrindo o caminho direto.
CREATE OR REPLACE FUNCTION public.delete_team(_team uuid, _target uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_project text;
  v_target_project text;
  v_people int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida' USING ERRCODE = 'W4001';
  END IF;

  IF NOT private.can_edit_board(v_actor) THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = 'W4002';
  END IF;

  -- Trava as duas linhas de uma vez e SEMPRE na mesma ordem (por id). Sem o
  -- ORDER BY, duas exclusoes cruzadas simultaneas (A->B e B->A) travariam em
  -- ordem oposta e produziriam deadlock.
  PERFORM 1 FROM public.teams
   WHERE id IN (_team, _target)
   ORDER BY id
     FOR UPDATE;

  SELECT jira_project INTO v_project FROM public.teams WHERE id = _team;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'Time nao encontrado' USING ERRCODE = 'W4003';
  END IF;

  SELECT count(*) INTO v_people FROM public.devs WHERE team_id = _team;

  IF v_people > 0 THEN
    IF _target IS NULL THEN
      RAISE EXCEPTION 'Time com pessoas exige destino' USING ERRCODE = 'W4004';
    END IF;

    IF _target = _team THEN
      RAISE EXCEPTION 'Destino igual a origem' USING ERRCODE = 'W4005';
    END IF;

    SELECT jira_project INTO v_target_project FROM public.teams WHERE id = _target;
    IF v_target_project IS NULL THEN
      RAISE EXCEPTION 'Time de destino nao encontrado' USING ERRCODE = 'W4003';
    END IF;

    -- A ultima palavra continua sendo devs_team_project_fkey; esta checagem
    -- existe para a violacao virar um codigo com mensagem propria em vez de
    -- um 23503 cru, e para fechar a invariante no servidor — a tela ja a
    -- fecha por cima oferecendo so times do mesmo projeto.
    IF v_target_project IS DISTINCT FROM v_project THEN
      RAISE EXCEPTION 'Destino em outro projeto' USING ERRCODE = 'W4006';
    END IF;

    -- Redispara devs_set_project, que recalcula jira_project a partir do novo
    -- time. Origem e destino sao do mesmo projeto, entao o valor nao muda.
    -- allocations nao e tocada: os cartoes seguem a PESSOA, nao o time.
    UPDATE public.devs SET team_id = _target WHERE team_id = _team;
  END IF;

  DELETE FROM public.teams WHERE id = _team;

  -- Renumeracao (a): pessoas realocadas chegam ao destino com as position que
  -- tinham na origem e colidem com as de la; duas pessoas com position = 0
  -- ficam em ordem indefinida e a coluna troca de ordem entre recargas.
  IF v_people > 0 AND _target IS NOT NULL THEN
    WITH ord AS (
      SELECT id, (row_number() OVER (ORDER BY position, name)) - 1 AS pos
        FROM public.devs WHERE team_id = _target
    )
    UPDATE public.devs d SET position = ord.pos
      FROM ord
     WHERE d.id = ord.id AND d.position IS DISTINCT FROM ord.pos;
  END IF;

  -- Renumeracao (b): a exclusao abre um buraco na sequencia de position dos
  -- times do projeto, e a proxima insercao usa `position: teams.length`.
  WITH ord AS (
    SELECT id, (row_number() OVER (ORDER BY position, name)) - 1 AS pos
      FROM public.teams WHERE jira_project = v_project
  )
  UPDATE public.teams t SET position = ord.pos
    FROM ord
   WHERE t.id = ord.id AND t.position IS DISTINCT FROM ord.pos;
END $$;

REVOKE ALL ON FUNCTION public.delete_team(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_team(uuid, uuid) TO authenticated, service_role;
