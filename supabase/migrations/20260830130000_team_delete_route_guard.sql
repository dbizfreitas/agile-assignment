-- Corrige delete_team (issue #14): a funcao e SECURITY DEFINER, entao RLS nao
-- se aplica a nada que ela leia ou escreva. Isso significa que o UNICO portao
-- de autorizacao e o que a funcao mesma verifica no corpo dela — e por isso
-- esse portao precisa reproduzir o predicado INTEIRO das policies que ela
-- contorna, nao um subconjunto dele. A versao aplicada checava so
-- private.can_edit_board(v_actor) (papel admin/editor), mas as policies reais
-- em public.teams e public.devs (20260828131000_route_access_rls.sql:72-78,
-- teams_delete_editors e devs_update_editors) exigem papel E ALEM DISSO a
-- rota 'alocacoes' (private.has_route). Papel e rota sao eixos independentes
-- (20260828130000_route_access_foundation.sql): nada concede rota
-- automaticamente quando um papel e definido, e um admin pode chamar
-- set_user_routes(alvo, ARRAY['compromisso']) sem tirar o papel editor de
-- ninguem. Um usuario nessas condicoes nao consegue nem fazer SELECT de uma
-- linha de teams, nem fazer DELETE direto — mas conseguia chamar esta RPC e
-- apagar um time inteiro, realocando e renumerando as pessoas dele. Isso
-- reabre exatamente o buraco que 20260828134000_route_access_fix_read_
-- requires_role.sql foi escrita para fechar, so que pelo caminho da RPC em
-- vez do caminho direto da tabela.
--
-- NOTA de ordem de deploy: esta migration precisa ser aplicada no SQL Editor
-- do Supabase ANTES que o bundle do front-end que depende dela chegue aos
-- usuarios — mas repare que a EXPOSICAO DE SEGURANCA em si ja esta aberta
-- desde que a migration ANTERIOR (20260830120000_team_delete_rpc.sql) foi
-- aplicada, nao desde que algum bundle novo for publicado: a funcao ja esta
-- com GRANT EXECUTE para authenticated, entao nenhum front-end e necessario
-- para chama-la (um cliente supabase-js generico, ou o proprio SQL Editor
-- com um JWT de teste, ja bastam). Aplicar esta correcao o quanto antes fecha
-- a exposicao independente de quando o bundle atualizado chegar.
-- Quanto a ordem inversa (bundle novo primeiro, funcao corrigida so depois):
-- ela nao quebra nada, porque a assinatura de delete_team nao muda aqui. Mas
-- se por algum motivo a funcao estivesse AUSENTE (por exemplo, banco
-- restaurado sem esta migration), o botao "Excluir" do TeamsDialog falharia
-- com o codigo PostgREST PGRST202 (funcao nao encontrada) — que nao esta em
-- TEAM_CODES, nao e 23503 nem 23514 — e boardErrorMessage cairia no texto
-- generico "Nao foi possivel salvar a alteracao.": o dialogo de Times
-- funcionaria em tudo, menos na sua unica acao destrutiva, falhando de forma
-- opaca em vez de dizer o que realmente aconteceu.
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

  -- Reproduz o predicado INTEIRO de teams_delete_editors/devs_update_editors:
  -- papel de edicao E a rota 'alocacoes'. So o papel (versao anterior) era
  -- estritamente mais fraco que a policy que esta funcao contorna.
  IF NOT (private.can_edit_board(v_actor)
          AND private.has_route(v_actor, 'alocacoes'::public.app_route)) THEN
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
