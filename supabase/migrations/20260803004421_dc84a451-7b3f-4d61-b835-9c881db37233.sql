CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'viewer');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
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

CREATE OR REPLACE FUNCTION public.can_edit_board(_user_id uuid)
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

CREATE POLICY "user_roles_select_own" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "user_roles_admin_manage" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed existing users as editors so the shared board keeps working
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'editor'::public.app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- Replace permissive board policies
DROP POLICY IF EXISTS "allocations_all_authenticated" ON public.allocations;
DROP POLICY IF EXISTS "devs_all_authenticated" ON public.devs;
DROP POLICY IF EXISTS "sprints_all_authenticated" ON public.sprints;

CREATE POLICY "devs_select_authenticated" ON public.devs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "devs_insert_editors" ON public.devs
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_board(auth.uid()));
CREATE POLICY "devs_update_editors" ON public.devs
  FOR UPDATE TO authenticated
  USING (public.can_edit_board(auth.uid()))
  WITH CHECK (public.can_edit_board(auth.uid()));
CREATE POLICY "devs_delete_editors" ON public.devs
  FOR DELETE TO authenticated USING (public.can_edit_board(auth.uid()));

CREATE POLICY "sprints_select_authenticated" ON public.sprints
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sprints_insert_editors" ON public.sprints
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_board(auth.uid()));
CREATE POLICY "sprints_update_editors" ON public.sprints
  FOR UPDATE TO authenticated
  USING (public.can_edit_board(auth.uid()))
  WITH CHECK (public.can_edit_board(auth.uid()));
CREATE POLICY "sprints_delete_editors" ON public.sprints
  FOR DELETE TO authenticated USING (public.can_edit_board(auth.uid()));

CREATE POLICY "allocations_select_authenticated" ON public.allocations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "allocations_insert_editors" ON public.allocations
  FOR INSERT TO authenticated WITH CHECK (public.can_edit_board(auth.uid()));
CREATE POLICY "allocations_update_editors" ON public.allocations
  FOR UPDATE TO authenticated
  USING (public.can_edit_board(auth.uid()))
  WITH CHECK (public.can_edit_board(auth.uid()));
CREATE POLICY "allocations_delete_editors" ON public.allocations
  FOR DELETE TO authenticated USING (public.can_edit_board(auth.uid()));