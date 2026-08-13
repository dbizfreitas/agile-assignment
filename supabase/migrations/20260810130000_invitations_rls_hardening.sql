-- Reforço de defesa em profundidade em public.invitations.
--
-- Hoje a única escrita possível já é via create_invitation/cancel_invitation/
-- handle_new_user (20260808121000), todas SECURITY DEFINER e checando admin
-- dentro do plpgsql; authenticated não tem GRANT de INSERT/UPDATE na tabela,
-- só SELECT (20260808120000). Mas RLS não deveria depender só da ausência de
-- um GRANT: se algum dia uma feature não relacionada conceder
-- `GRANT INSERT ON invitations TO authenticated`, sem esta política qualquer
-- autenticado poderia se autoconvidar como admin, sem nenhuma trava pegando
-- o erro. Mesmo raciocínio do guard_last_admin (20260808120000) — uma trava
-- independente da RPC.
CREATE POLICY invitations_insert_admin ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY invitations_update_admin ON public.invitations
  FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
