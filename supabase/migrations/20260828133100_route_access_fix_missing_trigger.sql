-- Achado durante o smoke test da Task 4 (issue #23, permissões por rota):
-- o trigger `on_auth_user_created`, que a migration original de RBAC
-- (20260808121000_rbac_rpc_policies.sql) cria para disparar
-- `public.handle_new_user()` a cada INSERT em `auth.users`, não existe de
-- fato neste banco (`SELECT ... FROM pg_trigger WHERE tgfoid =
-- 'public.handle_new_user'::regproc` não retorna nenhuma linha).
--
-- Isso é um bug pré-existente à issue #23, não introduzido por ela: sem
-- este trigger, NENHUM convite aceito — nem antes desta feature — concede
-- papel automaticamente. A pessoa aceita o convite, o `auth.users` ganha a
-- linha, mas `user_roles` nunca recebe a inserção, e ela cai em "Acesso
-- ainda não liberado". A função `handle_new_user()` em si está correta
-- (testado manualmente com sucesso) — só faltava o trigger que a conecta.
--
-- Idempotente: seguro rodar de novo se este arquivo for reaplicado.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
