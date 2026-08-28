-- ============================================================
-- 1. Coluna de rota na auditoria — NULL para eventos do eixo de papel
-- ============================================================
ALTER TABLE public.role_audit_log ADD COLUMN route public.app_route;

-- ============================================================
-- 2. Trigger — mesma forma de private.audit_user_roles
-- ============================================================
CREATE OR REPLACE FUNCTION private.audit_user_route_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_target uuid;
  v_route public.app_route;
  v_action public.role_audit_action;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_target := NEW.user_id; v_route := NEW.route; v_action := 'route_grant';
  ELSE
    v_target := OLD.user_id; v_route := OLD.route; v_action := 'route_revoke';
  END IF;

  INSERT INTO public.role_audit_log (
    action, target_user_id, target_email,
    actor_user_id, actor_email, route
  ) VALUES (
    v_action,
    v_target,
    (SELECT email FROM auth.users WHERE id = v_target),
    v_actor,
    (SELECT email FROM auth.users WHERE id = v_actor),
    v_route
  );

  RETURN NULL;
END $$;

CREATE TRIGGER audit_user_route_access
AFTER INSERT OR DELETE ON public.user_route_access
FOR EACH ROW EXECUTE FUNCTION private.audit_user_route_access();
