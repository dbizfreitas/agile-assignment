-- Troca a checagem inline de delete_team pelo helper compartilhado
-- (private.can_edit_alocacoes), criado em
-- 20260831140000_alocacoes_auth_helpers.sql. Nenhum outro comportamento
-- muda -- o corpo abaixo, fora da guarda, e identico ao de
-- 20260830130000_team_delete_route_guard.sql.
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

  IF NOT private.can_edit_alocacoes(v_actor) THEN
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

  -- O destino e validado sempre que informado, independente de quantas
  -- pessoas a origem tem: o contrato da RPC e "se _target veio, tem que ser
  -- um time valido do mesmo projeto", nao "so valida se a origem tiver
  -- gente". Sem isto, delete_team(<time vazio>, <uuid invalido ou de outro
  -- projeto>) apagava a origem e ignorava o destino em silencio.
  IF _target IS NOT NULL THEN
    IF _target = _team THEN
      RAISE EXCEPTION 'Destino igual a origem' USING ERRCODE = 'W4005';
    END IF;

    SELECT jira_project INTO v_target_project FROM public.teams WHERE id = _target;
    IF v_target_project IS NULL THEN
      RAISE EXCEPTION 'Time de destino nao encontrado' USING ERRCODE = 'W4003';
    END IF;

    -- A ultima palavra continua sendo devs_team_project_fkey; esta checagem
    -- existe para a violacao virar um codigo com mensagem propria em vez de
    -- um 23503 cru, e para fechar a invariante no servidor - a tela ja a
    -- fecha por cima oferecendo so times do mesmo projeto.
    IF v_target_project IS DISTINCT FROM v_project THEN
      RAISE EXCEPTION 'Destino em outro projeto' USING ERRCODE = 'W4006';
    END IF;
  ELSIF v_people > 0 THEN
    RAISE EXCEPTION 'Time com pessoas exige destino' USING ERRCODE = 'W4004';
  END IF;

  IF v_people > 0 THEN
    -- Redispara devs_set_project, que recalcula jira_project a partir do novo
    -- time. Origem e destino sao do mesmo projeto, entao o valor nao muda.
    -- allocations nao e tocada: os cartoes seguem a PESSOA, nao o time.
    UPDATE public.devs SET team_id = _target WHERE team_id = _team;
  END IF;

  DELETE FROM public.teams WHERE id = _team;

  -- Renumeracao (a): pessoas realocadas chegam ao destino com as position que
  -- tinham na origem e colidem com as de la; duas pessoas com position = 0
  -- ficam em ordem indefinida e a coluna troca de ordem entre recargas.
  -- v_people > 0 basta como guarda: se _target viesse NULL com a origem
  -- povoada, W4004 ja teria interrompido a funcao antes daqui.
  IF v_people > 0 THEN
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
