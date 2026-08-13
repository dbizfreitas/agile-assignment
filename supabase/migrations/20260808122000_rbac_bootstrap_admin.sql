-- Bootstrap do primeiro administrador.
-- Feito por migration, nunca por endpoint da aplicação: um endpoint
-- "tornar-se admin" é superfície de ataque desnecessária.
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM auth.users
   WHERE lower(email) = 'diego.freitas@way2.com.br';

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Bootstrap abortado: diego.freitas@way2.com.br não existe em auth.users. Faça login uma vez na aplicação antes de aplicar esta migration.';
  END IF;

  PERFORM set_config('app.audit_action', 'bootstrap', true);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_id, 'admin'::public.app_role)
  ON CONFLICT (user_id) DO UPDATE SET role = 'admin'::public.app_role
  WHERE user_roles.role IS DISTINCT FROM 'admin'::public.app_role;
END $$;
