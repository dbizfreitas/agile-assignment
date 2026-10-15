-- supabase/migrations/20261015120000_drop_devs_active.sql
-- #105: devs.active é uma coluna sem leitores nem escritores desde o schema
-- inicial (inventário da #19, docs/saneamento/2026-10-08-inventario.md).
-- Produção (08/10/2026): 14 linhas, todas true; nenhuma função, view, policy
-- ou trigger depende dela. A janela available_from/available_to (#2) cobre o
-- caso "a pessoa não está mais no time".
--
-- Aplicar pelo SQL Editor DEPOIS do deploy do front sem o campo.
-- Rollback: ALTER TABLE public.devs ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE public.devs DROP COLUMN IF EXISTS active;
