-- Restaura os REVOKE de EXECUTE nas RPCs SECURITY DEFINER do schema public.
--
-- Contexto: os REVOKE originais foram aplicados junto de cada função
-- (20260808121000 e 20260809090000), mas não sobreviveram ao remix do
-- projeto — o banco novo provisionou as quatro funções com a ACL padrão do
-- Postgres, que concede EXECUTE a PUBLIC. Constatado em 13/08/2026 via
-- pg_proc.proacl: `=X/postgres` e `anon=X/postgres` nas quatro.
--
-- Não havia brecha explorável: as três RPCs abortam em `v_actor IS NULL`
-- antes de qualquer escrita, e auth.uid() é NULL para anônimo;
-- handle_new_user é função de trigger e o Postgres recusa chamá-la fora do
-- contexto de trigger. Mas RLS e ACL não devem depender de a guarda interna
-- nunca ser refatorada por engano — mesmo raciocínio do guard_last_admin
-- (20260808120000) e do invitations_rls_hardening (20260810130000): uma
-- trava independente da lógica da função.
--
-- Efeito no linter do Supabase: silencia o lint 0028 (anon pode executar
-- SECURITY DEFINER). O lint 0029 (autenticado pode executar) CONTINUA
-- aparecendo e deve ser dispensado — é o desenho pretendido: as RPCs são
-- SECURITY DEFINER justamente para que um autenticado comum possa chamá-las
-- e a própria função decida se ele é admin. Revogar de `authenticated`
-- quebraria a tela de administração.

REVOKE ALL ON FUNCTION public.set_user_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_invitation(text, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_invitation(text) FROM PUBLIC, anon;

-- handle_new_user roda como trigger em auth.users: ninguém a chama por RPC,
-- então não recebe GRANT de volta — nem para `authenticated`, que só ganhou
-- EXECUTE no provisionamento do remix e não existia no desenho original.
-- Disparar um trigger não exige EXECUTE do chamador (a checagem acontece no
-- CREATE TRIGGER), e quem insere em auth.users é o serviço de auth, não o
-- papel `authenticated` — então revogar aqui não afeta o cadastro.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Reafirma o acesso que a aplicação realmente usa. REVOKE ... FROM PUBLIC
-- não remove o grant explícito de `authenticated`, mas deixar isto escrito
-- mantém a intenção legível e torna a migration idempotente.
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invitation(text, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invitation(text) TO authenticated;
