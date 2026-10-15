-- Verificação da remoção de public.devs.active (issue #105).
-- Colar no SQL Editor do Supabase e executar por completo, DEPOIS de aplicar
-- 20261015120000_drop_devs_active.sql. Só lê o catálogo: não deixa resíduo.
-- Sucesso = "Success. No rows returned" + NOTICE 'devs.active removida OK'.
-- Falha = ERROR: com a mensagem do ASSERT que falhou.
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'devs'
      AND column_name = 'active'
  ), 'public.devs.active ainda existe';
  RAISE NOTICE 'devs.active removida OK';
END
$$;
