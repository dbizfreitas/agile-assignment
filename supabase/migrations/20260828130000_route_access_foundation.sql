-- ============================================================
-- 1. Enum de rotas — os 4 valores são os mesmos `id` de src/components/shell/tabs.ts
-- ============================================================
CREATE TYPE public.app_route AS ENUM
  ('compromisso', 'cycle-time', 'retrospectivas', 'alocacoes');

-- ============================================================
-- 2. Tabela de rotas por usuário — aditiva a user_roles, eixo independente
-- ============================================================
CREATE TABLE public.user_route_access (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route public.app_route NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route)
);

GRANT SELECT ON public.user_route_access TO authenticated;
ALTER TABLE public.user_route_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY route_access_select_own ON public.user_route_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY route_access_select_admin ON public.user_route_access
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));
-- Sem policy de INSERT/UPDATE/DELETE: só a RPC SECURITY DEFINER abaixo escreve.

-- ============================================================
-- 3. Backfill — ninguém perde acesso no deploy: todo usuário com papel hoje
-- recebe as 4 rotas.
-- ============================================================
INSERT INTO public.user_route_access (user_id, route)
SELECT ur.user_id, r.route
  FROM public.user_roles ur
 CROSS JOIN unnest(enum_range(NULL::public.app_route)) AS r(route)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. Helper de leitura — mesmo padrão de private.can_view_board
-- ============================================================
CREATE OR REPLACE FUNCTION private.has_route(_user_id uuid, _route public.app_route)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_route_access
     WHERE user_id = _user_id AND route = _route
  )
$$;

REVOKE ALL ON FUNCTION private.has_route(uuid, public.app_route) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.has_route(uuid, public.app_route)
  TO authenticated, service_role;

-- ============================================================
-- 5. RPC de mutação — só admin, substituição pela lista completa
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_user_routes(_target uuid, _routes public.app_route[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  PERFORM set_config('app.actor_id', v_actor::text, true);

  DELETE FROM public.user_route_access
   WHERE user_id = _target AND route <> ALL(_routes);

  INSERT INTO public.user_route_access (user_id, route, granted_by)
  SELECT _target, r, v_actor FROM unnest(_routes) AS r
  ON CONFLICT (user_id, route) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.set_user_routes(uuid, public.app_route[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_routes(uuid, public.app_route[]) TO authenticated;
