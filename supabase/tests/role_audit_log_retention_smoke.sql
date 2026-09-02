-- Suite de verificacao da retencao de role_audit_log (issue #28,
-- migration 20260902140819_role_audit_log_retention.sql).
-- Roda inteiramente dentro de uma transacao com ROLLBACK: nao deixa residuo.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Secao N OK' por secao
-- (mais os NOTICE do proprio private.purge_role_audit_log()).
-- Falha = ERROR: com a mensagem da secao que falhou.
BEGIN;

SET LOCAL plpgsql.check_asserts = on;

-- ============================================================
-- Secao 1 -- setup: uma linha com 4 meses (deve ser apagada) e uma com
-- 2 meses (deve sobreviver). INSERT direto via owner da transacao --
-- dentro do SQL Editor isso roda como superuser/postgres, que ainda tem
-- INSERT mesmo com o REVOKE de authenticated/anon/service_role (o REVOKE
-- da 20260808120000/20260828135000 nunca mirou o role de administracao do
-- SQL Editor). Usa id fixo para poder identificar as linhas nas secoes
-- seguintes sem depender de order.
-- ============================================================
DO $$
DECLARE
  v_id_antiga uuid := 'b1111111-1111-1111-1111-111111111111';
  v_id_recente uuid := 'b2222222-2222-2222-2222-222222222222';
BEGIN
  INSERT INTO public.role_audit_log (id, action, target_email, created_at)
  VALUES (v_id_antiga, 'grant', 'antigo@example.com', now() - interval '4 months');

  INSERT INTO public.role_audit_log (id, action, target_email, created_at)
  VALUES (v_id_recente, 'grant', 'recente@example.com', now() - interval '2 months');

  IF NOT EXISTS (SELECT 1 FROM public.role_audit_log WHERE id = v_id_antiga) THEN
    RAISE EXCEPTION 'FALHA 1.1: linha antiga nao foi inserida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.role_audit_log WHERE id = v_id_recente) THEN
    RAISE EXCEPTION 'FALHA 1.2: linha recente nao foi inserida';
  END IF;

  RAISE NOTICE 'Secao 1 OK';
END $$;

-- ============================================================
-- Secao 2 -- executa o expurgo e confirma o corte: linha de 4 meses some,
-- linha de 2 meses sobrevive.
-- ============================================================
DO $$
DECLARE
  v_id_antiga uuid := 'b1111111-1111-1111-1111-111111111111';
  v_id_recente uuid := 'b2222222-2222-2222-2222-222222222222';
BEGIN
  PERFORM private.purge_role_audit_log();

  IF EXISTS (SELECT 1 FROM public.role_audit_log WHERE id = v_id_antiga) THEN
    RAISE EXCEPTION 'FALHA 2.1: linha com 4 meses deveria ter sido apagada pelo expurgo';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.role_audit_log WHERE id = v_id_recente) THEN
    RAISE EXCEPTION 'FALHA 2.2: linha com 2 meses nao deveria ter sido apagada pelo expurgo';
  END IF;

  RAISE NOTICE 'Secao 2 OK';
END $$;

-- ============================================================
-- Secao 3 -- authenticated, anon e service_role continuam sem
-- INSERT/UPDATE/DELETE direto em role_audit_log, e o EXECUTE de
-- private.purge_role_audit_log() continua fora do alcance de anon/PUBLIC
-- (a funcao de expurgo nao pode ter reaberto nenhum desses caminhos).
--
-- Reutiliza private.assert_security_invariants() (SEC-C1 e SEC-B5, ver
-- 20260902172122_security_invariants_role_audit_retention.sql) em vez de
-- reimplementar a checagem aqui -- essas duas linhas de defesa ja sao o
-- checker central do projeto, e duplicar a logica so criaria uma segunda
-- fonte de verdade para o mesmo invariante (exatamente o padrao que ja
-- causou regressoes silenciosas antes, ver cabecalho de 20260831160000).
-- Chama a funcao inteira aqui: ela cobre bem mais que so retencao (todos os
-- invariantes A-J), o que e aceitavel neste smoke test porque uma falha em
-- qualquer invariante de seguranca do sistema e, de qualquer forma, motivo
-- valido para este teste falhar tambem.
-- ============================================================
DO $$
BEGIN
  PERFORM private.assert_security_invariants();
  RAISE NOTICE 'Secao 3 OK';
END $$;

ROLLBACK;
