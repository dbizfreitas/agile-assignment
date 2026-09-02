-- Retenção de 3 meses para public.role_audit_log (issue #28).
--
-- role_audit_log é append-only por design (20260808120000_rbac_foundation.sql
-- revoga INSERT/UPDATE/DELETE de authenticated/service_role; só os triggers
-- SECURITY DEFINER escrevem nela). Isso protege o histórico contra
-- reescrita, mas também significa que hoje nada nunca é removido: cada
-- concessão/revogação de papel e cada mudança de rota por usuário gera uma
-- linha para sempre, guardando target_email/actor_email sem prazo de
-- guarda (LGPD).
--
-- private.purge_role_audit_log() é SECURITY DEFINER, com o mesmo owner das
-- demais funções de private. (ver private.audit_user_roles() em
-- 20260808120000_rbac_foundation.sql) — o DELETE funciona por ela rodar como
-- owner da função, e não porque algum papel da aplicação ganhou grant de
-- DELETE na tabela. Os REVOKE de 20260808120000/20260828135000 continuam
-- intactos: nenhum GRANT novo é adicionado aqui.
--
-- Corte fixo de 90 dias (não 'interval 3 months' de calendário), para um
-- corte previsível independente do tamanho variável dos meses.
--
-- pg_cron ainda não é usado em nenhuma migration deste projeto — esta é a
-- primeira. CREATE EXTENSION IF NOT EXISTS cobre tanto o caso de já estar
-- habilitada quanto o de precisar ser habilitada agora; se o projeto
-- Supabase não permitir habilitar extensões via migration, este DDL falha
-- na aplicação com um erro claro (ver alternativa de Edge Function agendada
-- na issue #28, fora de escopo aqui).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION private.purge_role_audit_log()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  DELETE FROM public.role_audit_log
   WHERE created_at < now() - interval '90 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE 'purge_role_audit_log: % linha(s) apagada(s) (corte: 90 dias)', v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION private.purge_role_audit_log() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.purge_role_audit_log() TO service_role;

-- Roda uma vez por dia às 03:00 UTC. cron.schedule é idempotente por nome
-- de job só a partir de pg_cron 1.5 (unschedule + schedule explícito abaixo
-- é o padrão seguro para qualquer versão: remove o job antigo se existir,
-- depois recria).
--
-- O job pg_cron roda como o role que aplicou esta migration (tipicamente
-- postgres, superuser no Supabase, dono desta função) — não como
-- service_role. O GRANT EXECUTE ... TO service_role acima documenta quem
-- a aplicação usaria se chamasse a função diretamente; o cron não passa
-- por esse grant porque roda como owner/superuser, o que já basta para
-- executar a função independente de GRANT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-role-audit-log') THEN
    PERFORM cron.unschedule('purge-role-audit-log');
  END IF;
END $$;

SELECT cron.schedule(
  'purge-role-audit-log',
  '0 3 * * *',
  $$SELECT private.purge_role_audit_log();$$
);

-- Verificação pós-aplicação (rodar no dia seguinte, para confirmar que o
-- job não só foi registrado mas também executou com sucesso às 03:00 UTC):
--
-- SELECT status, return_message, start_time
--   FROM cron.job_run_details
--  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'purge-role-audit-log')
--  ORDER BY start_time DESC LIMIT 5;
