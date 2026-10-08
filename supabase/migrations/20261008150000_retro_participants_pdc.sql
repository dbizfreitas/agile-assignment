-- supabase/migrations/20261008150000_retro_participants_pdc.sql
-- Cadastra o time da retrospectiva do projeto PDC, conforme os convidados da
-- agenda "Retrospectiva PDC" do Outlook (organizador: Carlos Rustick).
-- O projeto PDC ainda não tem participantes nem estado de sorteio: a linha de
-- retro_roulette_state nasce sob demanda na primeira RPC (ver
-- 20261008120000_retro_por_projeto.sql), então não há estado para limpar.
--
-- sort_order na ordem da agenda, começando em 0 (a cor de cada pessoa deriva
-- dele). Externos da Shippit com a cor fixa '#0ea5e9', como no PIM.
--
-- Idempotente: ON CONFLICT preserva quem já estiver cadastrado no PDC.

BEGIN;

INSERT INTO public.retro_participants (jira_project, name, email, color, sort_order) VALUES
  ('PDC', 'Carlos Eduardo Rustick', 'carlos.rustick@way2.com.br', NULL, 0),
  ('PDC', 'Robison Ribeiro da Rosa', 'robison.ribeiro@way2.com.br', NULL, 1),
  ('PDC', 'Nicolas Ferreira Villela Pereira', 'nicolas.pereira@way2.com.br', NULL, 2),
  ('PDC', 'Wesley Paulo da Silva', 'wesley.silva@way2.com.br', NULL, 3),
  ('PDC', 'Alex dos Santos Xavier', 'alex.xavier@way2.com.br', NULL, 4),
  ('PDC', 'Renan Osório da Rosa', 'renan.rosa@way2.com.br', NULL, 5),
  ('PDC', 'Renan Shippit', 'renan@shippit.app', '#0ea5e9', 6),
  ('PDC', 'Diego Freitas', 'diego.freitas@way2.com.br', NULL, 7),
  ('PDC', 'Diogo Amarante', 'diogo.amarante@way2.com.br', NULL, 8),
  ('PDC', 'Diego Schefer', 'diego.schefer@way2.com.br', NULL, 9)
ON CONFLICT (jira_project, email) DO NOTHING;

COMMIT;

-- Conferência (rodar depois):
--   SELECT sort_order, name, email, color FROM public.retro_participants
--    WHERE jira_project = 'PDC' ORDER BY sort_order;   -- 10 linhas
