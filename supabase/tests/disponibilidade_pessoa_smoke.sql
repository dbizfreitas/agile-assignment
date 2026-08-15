-- Suíte de verificação da janela de disponibilidade da pessoa (issue #2).
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Seção N OK' por seção.
-- Falha = ERROR: com a mensagem da asserção.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura
-- ============================================================
DO $$
DECLARE
  c text;
  v_type text;
  v_nullable text;
BEGIN
  FOREACH c IN ARRAY ARRAY['available_from','available_to'] LOOP
    SELECT data_type, is_nullable INTO v_type, v_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'devs' AND column_name = c;

    IF v_type IS NULL THEN
      RAISE EXCEPTION 'FALHA 1.1: coluna public.devs.% ausente', c;
    END IF;

    IF v_type <> 'date' THEN
      RAISE EXCEPTION 'FALHA 1.2: public.devs.% deveria ser date, é %', c, v_type;
    END IF;

    -- Anulável é requisito, não descuido: NULL significa "sem restrição" e é
    -- o que mantém toda pessoa já cadastrada com o comportamento de antes.
    IF v_nullable <> 'YES' THEN
      RAISE EXCEPTION 'FALHA 1.3: public.devs.% precisa ser anulável', c;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'devs_availability_order'
       AND conrelid = 'public.devs'::regclass
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'FALHA 1.4: CHECK devs_availability_order ausente';
  END IF;

  RAISE NOTICE 'Seção 1 OK — colunas date anuláveis e CHECK presentes';
END $$;

-- ============================================================
-- Seção 2 — Comportamento do CHECK
-- ============================================================
DO $$
DECLARE
  v_team uuid;
BEGIN
  INSERT INTO public.teams (name, color, position, jira_project)
       VALUES ('Smoke time disponibilidade', '#0f766e', 910, 'PIM')
    RETURNING id INTO v_team;

  -- 2.1 Janela aberta dos dois lados (o caso de toda pessoa existente).
  INSERT INTO public.devs (name, initials, team_id, position)
       VALUES ('Smoke sem janela', 'SJ', v_team, 910);

  -- 2.2 Janela aberta de um lado só, nos dois sentidos.
  INSERT INTO public.devs (name, initials, team_id, position, available_from)
       VALUES ('Smoke só início', 'SI', v_team, 911, '2026-08-10');
  INSERT INTO public.devs (name, initials, team_id, position, available_to)
       VALUES ('Smoke só fim', 'SF', v_team, 912, '2026-09-30');

  -- 2.3 Janela fechada e válida.
  INSERT INTO public.devs (name, initials, team_id, position, available_from, available_to)
       VALUES ('Smoke janela', 'SW', v_team, 913, '2026-08-10', '2026-09-30');

  -- 2.4 Limite: início igual ao fim é janela de um dia, e é válida.
  INSERT INTO public.devs (name, initials, team_id, position, available_from, available_to)
       VALUES ('Smoke um dia', 'SU', v_team, 914, '2026-08-10', '2026-08-10');

  -- 2.5 Janela invertida tem de estourar.
  BEGIN
    INSERT INTO public.devs (name, initials, team_id, position, available_from, available_to)
         VALUES ('Smoke invertida', 'SX', v_team, 915, '2026-09-30', '2026-08-10');
    RAISE EXCEPTION 'FALHA 2.5: o CHECK aceitou janela invertida no INSERT';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- 2.6 E também no UPDATE, não só no INSERT.
  BEGIN
    UPDATE public.devs
       SET available_to = '2026-01-01'
     WHERE name = 'Smoke janela';
    RAISE EXCEPTION 'FALHA 2.6: o CHECK aceitou janela invertida no UPDATE';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'Seção 2 OK — CHECK aceita janela aberta e rejeita invertida';
END $$;

ROLLBACK;
