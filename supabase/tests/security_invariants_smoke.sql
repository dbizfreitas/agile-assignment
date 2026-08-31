-- Suite de verificacao de private.assert_security_invariants() (issue #31,
-- migration 20260831160000_security_invariants_check.sql).
-- Prova o caminho positivo (estado atual intacto) e o negativo (o checker
-- realmente detecta cada categoria de regressao, nao so passa vazio) -- as
-- Secoes 2-6 quebram um invariante de proposito e o proprio EXCEPTION WHEN
-- desfaz a quebra antes da secao seguinte rodar.
-- Colar no SQL Editor do Supabase e executar por completo.
-- Sucesso = "Success. No rows returned" + um NOTICE 'Secao N OK' por secao.
-- Falha = ERROR: com a mensagem da secao que falhou.
BEGIN;

SET LOCAL plpgsql.check_asserts = on;

-- ============================================================
-- Secao 1 -- caminho positivo: o estado atual do banco esta intacto
-- ============================================================
DO $$
BEGIN
  PERFORM private.assert_security_invariants();
  RAISE NOTICE 'Secao 1 OK (invariantes intactos)';
END $$;

-- ============================================================
-- Secao 2 -- prova negativa: remove o trigger guard_last_admin (como a
-- ocorrencia 2 da #31, so que com outro trigger) e confirma que o checker
-- acusa SEC-A3
-- ============================================================
DO $$
BEGIN
  BEGIN
    DROP TRIGGER guard_last_admin ON public.user_roles;
    PERFORM private.assert_security_invariants();
    RAISE EXCEPTION 'Secao 2 FALHOU: assert_security_invariants nao detectou a remocao do trigger guard_last_admin';
  EXCEPTION WHEN sqlstate 'W5000' THEN
    RAISE NOTICE 'Secao 2 OK (checker detectou trigger guard_last_admin removido)';
  END;
END $$;

-- ============================================================
-- Secao 3 -- prova negativa: libera EXECUTE de create_invitation para anon
-- (como a ocorrencia 1 da #31) e confirma que o checker acusa SEC-B2
-- ============================================================
DO $$
BEGIN
  BEGIN
    GRANT EXECUTE ON FUNCTION public.create_invitation(text, public.app_role, public.app_route[]) TO anon;
    PERFORM private.assert_security_invariants();
    RAISE EXCEPTION 'Secao 3 FALHOU: assert_security_invariants nao detectou EXECUTE liberado para anon em create_invitation';
  EXCEPTION WHEN sqlstate 'W5000' THEN
    RAISE NOTICE 'Secao 3 OK (checker detectou EXECUTE liberado para anon)';
  END;
END $$;

-- ============================================================
-- Secao 4 -- prova negativa: desabilita RLS em devs e confirma que o
-- checker acusa SEC-D1
-- ============================================================
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.devs DISABLE ROW LEVEL SECURITY;
    PERFORM private.assert_security_invariants();
    RAISE EXCEPTION 'Secao 4 FALHOU: assert_security_invariants nao detectou RLS desabilitado em devs';
  EXCEPTION WHEN sqlstate 'W5000' THEN
    RAISE NOTICE 'Secao 4 OK (checker detectou RLS desabilitado)';
  END;
END $$;

-- ============================================================
-- Secao 5 -- prova negativa: enfraquece o USING de devs_select_route para
-- (true) -- nome da policy certo, condicao errada -- e confirma que o
-- checker acusa SEC-E1
-- ============================================================
DO $$
BEGIN
  BEGIN
    ALTER POLICY devs_select_route ON public.devs USING (true);
    PERFORM private.assert_security_invariants();
    RAISE EXCEPTION 'Secao 5 FALHOU: assert_security_invariants nao detectou USING enfraquecido em devs_select_route';
  EXCEPTION WHEN sqlstate 'W5000' THEN
    RAISE NOTICE 'Secao 5 OK (checker detectou USING enfraquecido)';
  END;
END $$;

-- ============================================================
-- Secao 6 -- prova negativa: substitui o corpo de guard_last_admin por um
-- que nunca bloqueia nada -- trigger continua existindo com o nome certo,
-- mas a logica sumiu -- e confirma que o checker acusa SEC-I1
-- ============================================================
DO $$
BEGIN
  BEGIN
    CREATE OR REPLACE FUNCTION private.guard_last_admin()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    BEGIN
      RETURN NEW;
    END $body$;

    PERFORM private.assert_security_invariants();
    RAISE EXCEPTION 'Secao 6 FALHOU: assert_security_invariants nao detectou o corpo de guard_last_admin alterado';
  EXCEPTION WHEN sqlstate 'W5000' THEN
    RAISE NOTICE 'Secao 6 OK (checker detectou corpo de guard_last_admin alterado)';
  END;
END $$;

ROLLBACK;
