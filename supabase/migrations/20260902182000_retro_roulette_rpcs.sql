-- supabase/migrations/20260902182000_retro_roulette_rpcs.sql
-- RPCs do sorteio de Retrospectivas (issue #24). O vencedor é sorteado NO
-- SERVIDOR — se o client escolhesse e só enviasse o resultado para
-- persistir, qualquer usuário poderia forjar quem "ganhou" chamando a RPC
-- direto. A animação visual de 18 flashes (use-roulette.ts, puramente
-- estética) continua rodando no client depois que o servidor já decidiu.
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
         updated_at = now();

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

  UPDATE public.retro_roulette_state
     SET skipped_emails = array_append(skipped_emails, _email), updated_at = now()
   WHERE NOT (_email = ANY(skipped_emails)) AND NOT (_email = ANY(drawn_emails));
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

  UPDATE public.retro_roulette_state
     SET skipped_emails = array_remove(skipped_emails, _email), updated_at = now();
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

  UPDATE public.retro_roulette_state
     SET drawn_emails = array_remove(drawn_emails, _email),
         last_winner_email = CASE WHEN last_winner_email = _email THEN NULL ELSE last_winner_email END,
         updated_at = now();
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

  UPDATE public.retro_roulette_state
     SET drawn_emails = '{}', skipped_emails = '{}', last_winner_email = NULL, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.spin_roulette() FROM public, anon;
REVOKE ALL ON FUNCTION public.skip_participant(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unskip_participant(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unmark_participant(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.reset_roulette() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.spin_roulette() TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_participant(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unskip_participant(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmark_participant(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_roulette() TO authenticated;
