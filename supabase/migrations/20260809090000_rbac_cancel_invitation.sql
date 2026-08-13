-- Rollback automático de convite: se a geração do link falhar depois que
-- create_invitation já criou a linha pendente, esta função a desfaz — sem
-- isso, o e-mail ficaria bloqueado até a expiração (7 dias) sem retry.
ALTER TYPE public.role_audit_action ADD VALUE 'cancel';

CREATE OR REPLACE FUNCTION public.cancel_invitation(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := lower(trim(_email));
  v_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  DELETE FROM public.invitations
   WHERE email = v_email AND consumed_at IS NULL
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum convite pendente encontrado para este e-mail' USING ERRCODE = 'W2004';
  END IF;

  INSERT INTO public.role_audit_log (action, target_email, actor_user_id, actor_email)
  VALUES ('cancel', v_email, v_actor, (SELECT email FROM auth.users WHERE id = v_actor));
END $$;

REVOKE ALL ON FUNCTION public.cancel_invitation(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_invitation(text) TO authenticated;
