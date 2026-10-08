-- supabase/migrations/20261008120000_retro_por_projeto.sql
-- A roleta de Retrospectivas deixa de ser única e global: cada projeto Jira
-- tem o seu time de participantes e o seu estado de sorteio. Tudo que existe
-- hoje (lista e estado atuais, já atualizados para o time do PIM em
-- 20261002120000) passa a ser do projeto PIM; os demais projetos começam
-- vazios — gestão de participantes continua manual (decisão da issue #24).
--
-- Mesma dimensão `jira_project text` de teams/sprints/devs
-- (20260810121000_board_project_constraints.sql): o banco valida só o
-- formato; a lista de projetos mora em src/lib/projects.ts.
--
-- ATENÇÃO: as assinaturas antigas das 5 RPCs somem (ganham `_project` como
-- primeiro parâmetro). Esta migration e o frontend novo dependem um do
-- outro — rodar a migration e fazer o merge em seguida.

BEGIN;

-- 1) Participantes: a mesma pessoa pode estar na retro de dois projetos,
-- então o e-mail deixa de ser único sozinho e passa a ser único POR projeto.
-- O UNIQUE novo já começa por jira_project, então cobre a busca por projeto
-- (sem índice extra).
ALTER TABLE public.retro_participants ADD COLUMN jira_project text;
UPDATE public.retro_participants SET jira_project = 'PIM' WHERE jira_project IS NULL;
ALTER TABLE public.retro_participants
  ALTER COLUMN jira_project SET NOT NULL,
  ADD CONSTRAINT retro_participants_jira_project_format
    CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$'),
  DROP CONSTRAINT retro_participants_email_key,
  ADD CONSTRAINT retro_participants_project_email_key UNIQUE (jira_project, email);

-- 2) Estado do sorteio: deixa de ser singleton (id boolean) e passa a ter uma
-- linha por projeto. Dropar a PK e a coluna `id` leva junto o CHECK
-- retro_roulette_state_singleton. A policy de SELECT não depende de `id` e
-- continua valendo.
ALTER TABLE public.retro_roulette_state ADD COLUMN jira_project text;
UPDATE public.retro_roulette_state SET jira_project = 'PIM' WHERE jira_project IS NULL;
ALTER TABLE public.retro_roulette_state
  DROP CONSTRAINT retro_roulette_state_pkey,
  DROP COLUMN id,
  ALTER COLUMN jira_project SET NOT NULL,
  ADD PRIMARY KEY (jira_project),
  ADD CONSTRAINT retro_roulette_state_jira_project_format
    CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$');

-- 3) RPCs: as assinaturas antigas saem e entram as novas com `_project` como
-- primeiro parâmetro. O corpo é o da versão vigente
-- (20260903133600_retro_roulette_rpcs_explicit_where.sql) mais: validação do
-- projeto, estado criado sob demanda (projeto novo não precisa de seed) e
-- lock/UPDATE/sorteio restritos ao projeto. WHERE explícito em todo UPDATE
-- continua obrigatório (PostgREST/pg-safeupdate, ver a migration acima).
DROP FUNCTION public.spin_roulette();
DROP FUNCTION public.skip_participant(text);
DROP FUNCTION public.unskip_participant(text);
DROP FUNCTION public.unmark_participant(text);
DROP FUNCTION public.reset_roulette();

CREATE FUNCTION public.spin_roulette(_project text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_winner text;
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF _project IS NULL OR _project !~ '^[A-Z][A-Z0-9]{1,9}$' THEN
    RAISE EXCEPTION 'Projeto inválido' USING ERRCODE = 'W2403';
  END IF;
  -- Estado nasce sob demanda: projeto novo não precisa de seed.
  INSERT INTO public.retro_roulette_state (jira_project) VALUES (_project)
  ON CONFLICT (jira_project) DO NOTHING;
  PERFORM 1 FROM public.retro_roulette_state WHERE jira_project = _project FOR UPDATE;

  SELECT p.email INTO v_winner
    FROM public.retro_participants p, public.retro_roulette_state s
   WHERE p.jira_project = _project
     AND s.jira_project = _project
     AND NOT (p.email = ANY(s.drawn_emails))
     AND NOT (p.email = ANY(s.skipped_emails))
   ORDER BY random()
   LIMIT 1;

  IF v_winner IS NULL THEN
    RAISE EXCEPTION 'Nenhum participante elegível' USING ERRCODE = 'W2402';
  END IF;

  UPDATE public.retro_roulette_state
     SET drawn_emails = array_append(drawn_emails, v_winner),
         last_winner_email = v_winner,
         updated_at = now()
   WHERE jira_project = _project;

  RETURN v_winner;
END;
$$;

CREATE FUNCTION public.skip_participant(_project text, _email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF _project IS NULL OR _project !~ '^[A-Z][A-Z0-9]{1,9}$' THEN
    RAISE EXCEPTION 'Projeto inválido' USING ERRCODE = 'W2403';
  END IF;
  INSERT INTO public.retro_roulette_state (jira_project) VALUES (_project)
  ON CONFLICT (jira_project) DO NOTHING;
  PERFORM 1 FROM public.retro_roulette_state WHERE jira_project = _project FOR UPDATE;

  UPDATE public.retro_roulette_state
     SET skipped_emails = array_append(skipped_emails, _email), updated_at = now()
   WHERE jira_project = _project
     AND NOT (_email = ANY(skipped_emails)) AND NOT (_email = ANY(drawn_emails));
END;
$$;

CREATE FUNCTION public.unskip_participant(_project text, _email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF _project IS NULL OR _project !~ '^[A-Z][A-Z0-9]{1,9}$' THEN
    RAISE EXCEPTION 'Projeto inválido' USING ERRCODE = 'W2403';
  END IF;
  INSERT INTO public.retro_roulette_state (jira_project) VALUES (_project)
  ON CONFLICT (jira_project) DO NOTHING;
  PERFORM 1 FROM public.retro_roulette_state WHERE jira_project = _project FOR UPDATE;

  UPDATE public.retro_roulette_state
     SET skipped_emails = array_remove(skipped_emails, _email), updated_at = now()
   WHERE jira_project = _project;
END;
$$;

CREATE FUNCTION public.unmark_participant(_project text, _email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF _project IS NULL OR _project !~ '^[A-Z][A-Z0-9]{1,9}$' THEN
    RAISE EXCEPTION 'Projeto inválido' USING ERRCODE = 'W2403';
  END IF;
  INSERT INTO public.retro_roulette_state (jira_project) VALUES (_project)
  ON CONFLICT (jira_project) DO NOTHING;
  PERFORM 1 FROM public.retro_roulette_state WHERE jira_project = _project FOR UPDATE;

  UPDATE public.retro_roulette_state
     SET drawn_emails = array_remove(drawn_emails, _email),
         last_winner_email = CASE WHEN last_winner_email = _email THEN NULL ELSE last_winner_email END,
         updated_at = now()
   WHERE jira_project = _project;
END;
$$;

CREATE FUNCTION public.reset_roulette(_project text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF _project IS NULL OR _project !~ '^[A-Z][A-Z0-9]{1,9}$' THEN
    RAISE EXCEPTION 'Projeto inválido' USING ERRCODE = 'W2403';
  END IF;
  INSERT INTO public.retro_roulette_state (jira_project) VALUES (_project)
  ON CONFLICT (jira_project) DO NOTHING;
  PERFORM 1 FROM public.retro_roulette_state WHERE jira_project = _project FOR UPDATE;

  UPDATE public.retro_roulette_state
     SET drawn_emails = '{}', skipped_emails = '{}', last_winner_email = NULL, updated_at = now()
   WHERE jira_project = _project;
END;
$$;

REVOKE ALL ON FUNCTION public.spin_roulette(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.skip_participant(text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unskip_participant(text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unmark_participant(text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.reset_roulette(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.spin_roulette(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_participant(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unskip_participant(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmark_participant(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_roulette(text) TO authenticated;

COMMIT;
