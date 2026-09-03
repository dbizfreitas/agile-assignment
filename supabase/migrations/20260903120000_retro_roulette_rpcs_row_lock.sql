-- supabase/migrations/20260903120000_retro_roulette_rpcs_row_lock.sql
-- Achado do code review do PR #38: as 5 RPCs de
-- 20260902182000_retro_roulette_rpcs.sql liam retro_roulette_state sem
-- travar a linha antes de decidir o efeito (spin_roulette sorteando o
-- vencedor, skip/unskip/unmark/reset mutando os arrays). Sob READ
-- COMMITTED (padrão do Postgres), duas chamadas concorrentes de
-- spin_roulette() podem ambas ler o mesmo drawn_emails/skipped_emails
-- pré-UPDATE, ambas sortear o MESMO vencedor ainda elegível, e ambas
-- fazerem append — duplicando o e-mail em drawn_emails e dessincronizando
-- o contador "X / Y sorteados" da UI.
--
-- Fix: cada função agora começa travando a linha singleton com
-- `SELECT ... FOR UPDATE` antes de qualquer leitura de drawn_emails/
-- skipped_emails. Como a tabela tem exatamente uma linha (CHECK (id) do
-- singleton), isso serializa toda chamada concorrente às 5 RPCs sem
-- nenhum custo real de contenção (não há múltiplas linhas disputando o
-- lock) — a segunda transação simplesmente espera a primeira commitar
-- antes de ler o estado já atualizado.
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

  -- Trava a linha singleton ANTES de decidir o vencedor: qualquer outra
  -- chamada concorrente a estas 5 RPCs bloqueia aqui até este commit,
  -- então a leitura de drawn_emails/skipped_emails abaixo já reflete
  -- qualquer sorteio/skip que tenha vencido a corrida por este lock.
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

  PERFORM 1 FROM public.retro_roulette_state WHERE id FOR UPDATE;

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

  PERFORM 1 FROM public.retro_roulette_state WHERE id FOR UPDATE;

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

  PERFORM 1 FROM public.retro_roulette_state WHERE id FOR UPDATE;

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

  PERFORM 1 FROM public.retro_roulette_state WHERE id FOR UPDATE;

  UPDATE public.retro_roulette_state
     SET drawn_emails = '{}', skipped_emails = '{}', last_winner_email = NULL, updated_at = now();
END;
$$;
