-- Pagina o expurgo de public.role_audit_log em lotes (issue #28).
--
-- private.purge_role_audit_log() (20260902140819_role_audit_log_retention.sql)
-- ate aqui apagava tudo com created_at < now() - 90 dias em um unico DELETE.
-- Com o indice em created_at DESC (20260808120000_rbac_foundation.sql) isso e
-- um index scan eficiente, e a cadencia diaria as 03:00 UTC mantem o backlog
-- pequeno hoje -- nao ha bug em producao. Mas se o volume de eventos de
-- auditoria crescer (operacoes em lote gerando muitas linhas por segundo,
-- cenario ja previsto na issue #28), um DELETE unico apagando dezenas de
-- milhares de linhas de uma vez pode segurar lock por mais tempo e inchar o
-- indice antes do autovacuum limpar. Pagina em lotes de 5000 para manter
-- cada DELETE curto, com commit implicito entre lotes (o loop roda direto,
-- sem transacao aberta ao redor de cron.schedule).
CREATE OR REPLACE FUNCTION private.purge_role_audit_log()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_size constant integer := 5000;
  v_deleted_batch bigint;
  v_deleted_total bigint := 0;
BEGIN
  LOOP
    DELETE FROM public.role_audit_log
     WHERE id IN (
       SELECT id
         FROM public.role_audit_log
        WHERE created_at < now() - interval '90 days'
        LIMIT v_batch_size
     );

    GET DIAGNOSTICS v_deleted_batch = ROW_COUNT;
    v_deleted_total := v_deleted_total + v_deleted_batch;

    EXIT WHEN v_deleted_batch < v_batch_size;
  END LOOP;

  RAISE NOTICE 'purge_role_audit_log: % linha(s) apagada(s) em lotes de % (corte: 90 dias)', v_deleted_total, v_batch_size;
END;
$$;

REVOKE ALL ON FUNCTION private.purge_role_audit_log() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.purge_role_audit_log() TO service_role;
