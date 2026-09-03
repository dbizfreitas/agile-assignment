-- supabase/migrations/20260903133600_retro_roulette_rpcs_explicit_where.sql
-- Achado da validação manual pós-deploy da issue #24: as 5 RPCs do sorteio
-- funcionam perfeitamente quando chamadas via SQL puro simulando o
-- usuário autenticado (SET LOCAL ROLE authenticated + request.jwt.claims),
-- mas falham com "ERROR 21000: UPDATE requires a WHERE clause" quando
-- chamadas pelo app via PostgREST (a API REST real do Supabase).
--
-- Causa: os 5 `UPDATE public.retro_roulette_state SET ...` (sem cláusula
-- WHERE, corretos em SQL puro porque a tabela é um singleton de uma linha
-- só — CHECK (id) garante isso) disparam uma proteção do PostgREST/
-- pg-safeupdate contra updates de tabela inteira quando a chamada passa
-- pela camada REST, mesmo dentro de uma função SECURITY DEFINER chamada
-- via RPC.
--
-- Fix: WHERE id = true explícito em cada UPDATE — comportamento idêntico
-- (a tabela só tem essa linha), mas deixa de acionar essa proteção.
CREATE OR REPLACE FUNCTION public.spin_roulette()
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

  PERFORM 1 FROM public.retro_roulette_state WHERE id FOR UPDATE;

  SELECT p.email INTO v_winner
    FROM public.retro_participants p, public.retro_roulette_state s
   WHERE NOT (p.email = ANY(s.drawn_emails))
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
   WHERE id = true;

  RETURN v_winner;
END;
$$;

CREATE OR REPLACE FUNCTION public.skip_participant(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  PERFORM 1 FROM public.retro_roulette_state WHERE id FOR UPDATE;

  UPDATE public.retro_roulette_state
     SET skipped_emails = array_append(skipped_emails, _email), updated_at = now()
   WHERE id = true
     AND NOT (_email = ANY(skipped_emails)) AND NOT (_email = ANY(drawn_emails));
END;
$$;

CREATE OR REPLACE FUNCTION public.unskip_participant(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  PERFORM 1 FROM public.retro_roulette_state WHERE id FOR UPDATE;

  UPDATE public.retro_roulette_state
     SET skipped_emails = array_remove(skipped_emails, _email), updated_at = now()
   WHERE id = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.unmark_participant(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  PERFORM 1 FROM public.retro_roulette_state WHERE id FOR UPDATE;

  UPDATE public.retro_roulette_state
     SET drawn_emails = array_remove(drawn_emails, _email),
         last_winner_email = CASE WHEN last_winner_email = _email THEN NULL ELSE last_winner_email END,
         updated_at = now()
   WHERE id = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_roulette()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  PERFORM 1 FROM public.retro_roulette_state WHERE id FOR UPDATE;

  UPDATE public.retro_roulette_state
     SET drawn_emails = '{}', skipped_emails = '{}', last_winner_email = NULL, updated_at = now()
   WHERE id = true;
END;
$$;
