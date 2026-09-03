-- supabase/tests/retro_participants_smoke.sql
-- Suíte de verificação de participantes/sorteio de Retrospectivas (issue #24).
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura e seed
-- ============================================================
DO $$
DECLARE
  v_count int;
BEGIN
  IF to_regclass('public.retro_participants') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.1: tabela public.retro_participants não existe';
  END IF;
  IF to_regclass('public.retro_roulette_state') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.2: tabela public.retro_roulette_state não existe';
  END IF;

  SELECT count(*) INTO v_count FROM public.retro_participants;
  IF v_count <> 20 THEN
    RAISE EXCEPTION 'FALHA 1.3: esperava 20 participantes no seed, achou %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.retro_roulette_state;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 1.4: retro_roulette_state deveria ter exatamente 1 linha, tem %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.retro_participants WHERE email = 'bruno@shippit.app' AND color = '#0ea5e9'
  ) THEN
    RAISE EXCEPTION 'FALHA 1.5: participante externo (Shippit) sem a cor fixa esperada';
  END IF;

  RAISE NOTICE 'Seção 1 OK';
END $$;

ROLLBACK;
