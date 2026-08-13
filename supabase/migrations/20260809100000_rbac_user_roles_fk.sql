-- Fecha um furo real: sem FK, uma linha "admin" órfã em user_roles (por
-- exemplo, após excluir a conta pelo painel do Supabase) engana a contagem
-- de private.guard_last_admin e permite remover o único admin de verdade,
-- travando a plataforma sem caminho de recuperação.
DELETE FROM public.user_roles r
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id);

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- set_user_role passa a recusar conceder papel a um uuid que não existe em
-- auth.users, para não recriar uma linha órfã pelo mesmo caminho.
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

  IF _role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _target) THEN
    RAISE EXCEPTION 'Usuário não encontrado' USING ERRCODE = 'W2004';
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
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target, _role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
    WHERE user_roles.role IS DISTINCT FROM EXCLUDED.role;
  END IF;
END $$;
