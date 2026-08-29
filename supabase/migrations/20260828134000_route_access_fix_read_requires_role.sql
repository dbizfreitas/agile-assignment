-- Correção crítica (revisão final da issue #23): a migration
-- 20260828131000_route_access_rls.sql trocou a checagem de leitura das 4
-- tabelas do board de "tem papel" (private.can_view_board) por "tem a rota
-- alocacoes" (private.has_route), em vez de exigir as DUAS coisas — que é
-- exatamente o que as policies de escrita já faziam corretamente
-- (private.can_edit_board(...) AND private.has_route(...)).
--
-- Como o backfill da Task 1 (20260828130000) deu as 4 rotas para todo
-- usuário que tinha QUALQUER papel na época, e nada removia linhas de
-- user_route_access quando o papel era revogado via public.set_user_role,
-- um usuário desativado (papel definido como NULL em /admin) mantinha
-- leitura total de Alocações via RLS — a UI mostrava "Acesso negado", mas
-- isso é só client-side; uma chamada direta à API continuava funcionando.
-- A escrita já estava corretamente bloqueada (sempre exigiu as duas coisas).
--
-- Esta migration fecha os dois lados do problema:
--   1. As 4 policies de SELECT passam a exigir papel E rota, como as de
--      escrita sempre exigiram.
--   2. public.set_user_role, ao revogar o papel (_role IS NULL), agora
--      também apaga as linhas de user_route_access do usuário — a trigger
--      private.audit_user_route_access (Task 3, AFTER DELETE, já ativa)
--      gera sozinha as linhas 'route_revoke' na auditoria, atribuídas ao
--      ator correto porque app.actor_id já foi setado antes deste DELETE.

-- ============================================================
-- 1. Leitura — volta a exigir papel (can_view_board) E a rota alocacoes,
-- mantendo os MESMOS NOMES de policy criados em 20260828131000 (não
-- renomeia de novo).
-- ============================================================
DROP POLICY devs_select_route ON public.devs;
CREATE POLICY devs_select_route ON public.devs
  FOR SELECT TO authenticated
  USING (
    private.can_view_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY teams_select_route ON public.teams;
CREATE POLICY teams_select_route ON public.teams
  FOR SELECT TO authenticated
  USING (
    private.can_view_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY sprints_select_route ON public.sprints;
CREATE POLICY sprints_select_route ON public.sprints
  FOR SELECT TO authenticated
  USING (
    private.can_view_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY allocations_select_route ON public.allocations;
CREATE POLICY allocations_select_route ON public.allocations
  FOR SELECT TO authenticated
  USING (
    private.can_view_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

-- ============================================================
-- 2. set_user_role — revogar o papel (_role IS NULL) agora cascateia para
-- user_route_access. Corpo idêntico ao de 20260808121000_rbac_rpc_policies.sql
-- (guardas W2001/W2002 preservados; W2003, o último-admin, mora no trigger
-- guard_last_admin e não é tocado aqui), com uma única adição: o novo
-- DELETE FROM public.user_route_access logo após o DELETE de user_roles,
-- dentro do mesmo branch _role IS NULL.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_user_role(_target uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current public.app_role;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  SELECT role INTO v_current FROM public.user_roles WHERE user_id = _target;

  IF v_actor = _target
     AND v_current = 'admin'::public.app_role
     AND _role IS DISTINCT FROM 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Você não pode remover seu próprio acesso de administrador'
      USING ERRCODE = 'W2002';
  END IF;

  PERFORM set_config('app.actor_id', v_actor::text, true);

  IF _role IS NULL THEN
    DELETE FROM public.user_roles WHERE user_id = _target;
    -- Fecha o gap desta migration: sem isto, o usuário ficava sem papel mas
    -- mantinha as linhas de user_route_access, e a leitura sob RLS
    -- continuava liberada. O DELETE dispara private.audit_user_route_access
    -- (AFTER DELETE), que grava 'route_revoke' para cada rota removida,
    -- atribuído a v_actor via app.actor_id (setado acima).
    DELETE FROM public.user_route_access WHERE user_id = _target;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target, _role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
    WHERE user_roles.role IS DISTINCT FROM EXCLUDED.role;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_user_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) TO authenticated;
