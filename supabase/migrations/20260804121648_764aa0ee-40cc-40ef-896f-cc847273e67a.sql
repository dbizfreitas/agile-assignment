CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM public, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION private.can_edit_board(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin', 'editor')
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM public, anon;
REVOKE ALL ON FUNCTION private.can_edit_board(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_edit_board(uuid) TO authenticated, service_role;

-- Recreate policies against the private helpers
DROP POLICY IF EXISTS user_roles_admin_manage ON public.user_roles;
DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
CREATE POLICY user_roles_admin_manage ON public.user_roles FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY user_roles_select_own ON public.user_roles FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS teams_insert_editors ON public.teams;
DROP POLICY IF EXISTS teams_update_editors ON public.teams;
DROP POLICY IF EXISTS teams_delete_editors ON public.teams;
CREATE POLICY teams_insert_editors ON public.teams FOR INSERT TO authenticated WITH CHECK (private.can_edit_board(auth.uid()));
CREATE POLICY teams_update_editors ON public.teams FOR UPDATE TO authenticated USING (private.can_edit_board(auth.uid())) WITH CHECK (private.can_edit_board(auth.uid()));
CREATE POLICY teams_delete_editors ON public.teams FOR DELETE TO authenticated USING (private.can_edit_board(auth.uid()));

DROP POLICY IF EXISTS devs_insert_editors ON public.devs;
DROP POLICY IF EXISTS devs_update_editors ON public.devs;
DROP POLICY IF EXISTS devs_delete_editors ON public.devs;
CREATE POLICY devs_insert_editors ON public.devs FOR INSERT TO authenticated WITH CHECK (private.can_edit_board(auth.uid()));
CREATE POLICY devs_update_editors ON public.devs FOR UPDATE TO authenticated USING (private.can_edit_board(auth.uid())) WITH CHECK (private.can_edit_board(auth.uid()));
CREATE POLICY devs_delete_editors ON public.devs FOR DELETE TO authenticated USING (private.can_edit_board(auth.uid()));

DROP POLICY IF EXISTS sprints_insert_editors ON public.sprints;
DROP POLICY IF EXISTS sprints_update_editors ON public.sprints;
DROP POLICY IF EXISTS sprints_delete_editors ON public.sprints;
CREATE POLICY sprints_insert_editors ON public.sprints FOR INSERT TO authenticated WITH CHECK (private.can_edit_board(auth.uid()));
CREATE POLICY sprints_update_editors ON public.sprints FOR UPDATE TO authenticated USING (private.can_edit_board(auth.uid())) WITH CHECK (private.can_edit_board(auth.uid()));
CREATE POLICY sprints_delete_editors ON public.sprints FOR DELETE TO authenticated USING (private.can_edit_board(auth.uid()));

DROP POLICY IF EXISTS allocations_insert_editors ON public.allocations;
DROP POLICY IF EXISTS allocations_update_editors ON public.allocations;
DROP POLICY IF EXISTS allocations_delete_editors ON public.allocations;
CREATE POLICY allocations_insert_editors ON public.allocations FOR INSERT TO authenticated WITH CHECK (private.can_edit_board(auth.uid()));
CREATE POLICY allocations_update_editors ON public.allocations FOR UPDATE TO authenticated USING (private.can_edit_board(auth.uid())) WITH CHECK (private.can_edit_board(auth.uid()));
CREATE POLICY allocations_delete_editors ON public.allocations FOR DELETE TO authenticated USING (private.can_edit_board(auth.uid()));

DROP FUNCTION IF EXISTS public.can_edit_board(uuid);
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);