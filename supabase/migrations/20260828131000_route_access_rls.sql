-- ============================================================
-- 1. Leitura — troca can_view_board (qualquer papel) por has_route (a rota
-- específica de Alocações)
-- ============================================================
DROP POLICY devs_select_viewers ON public.devs;
CREATE POLICY devs_select_route ON public.devs
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'alocacoes'::public.app_route));

DROP POLICY teams_select_viewers ON public.teams;
CREATE POLICY teams_select_route ON public.teams
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'alocacoes'::public.app_route));

DROP POLICY sprints_select_viewers ON public.sprints;
CREATE POLICY sprints_select_route ON public.sprints
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'alocacoes'::public.app_route));

DROP POLICY allocations_select_viewers ON public.allocations;
CREATE POLICY allocations_select_route ON public.allocations
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'alocacoes'::public.app_route));

-- ============================================================
-- 2. Escrita — exige as duas coisas: papel editor/admin E a rota
-- ============================================================
DROP POLICY devs_insert_editors ON public.devs;
CREATE POLICY devs_insert_editors ON public.devs
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY devs_update_editors ON public.devs;
CREATE POLICY devs_update_editors ON public.devs
  FOR UPDATE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  )
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY devs_delete_editors ON public.devs;
CREATE POLICY devs_delete_editors ON public.devs
  FOR DELETE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY teams_insert_editors ON public.teams;
CREATE POLICY teams_insert_editors ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY teams_update_editors ON public.teams;
CREATE POLICY teams_update_editors ON public.teams
  FOR UPDATE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  )
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY teams_delete_editors ON public.teams;
CREATE POLICY teams_delete_editors ON public.teams
  FOR DELETE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY sprints_insert_editors ON public.sprints;
CREATE POLICY sprints_insert_editors ON public.sprints
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY sprints_update_editors ON public.sprints;
CREATE POLICY sprints_update_editors ON public.sprints
  FOR UPDATE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  )
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY sprints_delete_editors ON public.sprints;
CREATE POLICY sprints_delete_editors ON public.sprints
  FOR DELETE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY allocations_insert_editors ON public.allocations;
CREATE POLICY allocations_insert_editors ON public.allocations
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY allocations_update_editors ON public.allocations;
CREATE POLICY allocations_update_editors ON public.allocations
  FOR UPDATE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  )
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
DROP POLICY allocations_delete_editors ON public.allocations;
CREATE POLICY allocations_delete_editors ON public.allocations
  FOR DELETE TO authenticated
  USING (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
