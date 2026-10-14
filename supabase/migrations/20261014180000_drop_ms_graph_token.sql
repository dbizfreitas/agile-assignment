-- supabase/migrations/20261014180000_drop_ms_graph_token.sql
-- #106: a busca de fotos pelo Microsoft Graph foi abandonada. O login por
-- device code é bloqueado entre tenants (AADSTS500213) e a tabela nunca
-- recebeu refresh token (produção, 08/10/2026: 1 linha, sem token).
--
-- Aplicar pelo SQL Editor DEPOIS do deploy do front que deixou de ler a
-- tabela. As funções private.can_view_retrospectivas e
-- private.can_edit_retrospectivas, criadas na mesma migration da tabela
-- (20260902181000_retro_ms_graph_token.sql), continuam em uso e ficam.
DROP TABLE IF EXISTS public.ms_graph_token;
