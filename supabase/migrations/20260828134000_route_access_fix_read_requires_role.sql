-- Correção crítica (revisão final da issue #23): a migration
-- 20260828131000_route_access_rls.sql trocou a checagem de leitura das 4
-- tabelas do board de "tem papel" (private.can_view_board) por "tem a rota
-- alocacoes" (private.has_route), em vez de exigir as DUAS coisas — que é
-- exatamente o que as policies de escrita já faziam corretamente
-- (private.can_edit_board(...) AND private.has_route(...)).
--
-- Como o backfill da Task 1 (20260828130000) deu as 4 rotas para todo
-- usuário que tinha QUALQUER papel na época, e nada removia linhas de
-- user_route_access quando o papel era revogado via public.set_user_role,
-- um usuário desativado (papel definido como NULL em /admin) mantinha
-- leitura total de Alocações via RLS — a UI mostrava "Acesso negado", mas
-- isso é só client-side; uma chamada direta à API continuava funcionando.
-- A escrita já estava corretamente bloqueada (sempre exigiu as duas coisas).
--
-- Esta migration fecha três frentes:
--   1. As 4 policies de SELECT passam a exigir papel E rota, como as de
--      escrita sempre exigiram.
--   2. public.set_user_role, ao revogar o papel (_role IS NULL), agora
--      também apaga as linhas de user_route_access do usuário — a trigger
--      private.audit_user_route_access (Task 3, AFTER DELETE, já ativa)
--      gera sozinha as linhas 'route_revoke' na auditoria, atribuídas ao
--      ator correto porque app.actor_id já foi setado antes deste DELETE.
--   3. Limpeza pontual das linhas de user_route_access que já ficaram
--      órfãs (usuário sem papel) para quem foi desativado ANTES deste fix.

-- ============================================================
-- 1. Leitura — volta a exigir papel (can_view_board) E a rota alocacoes,
-- mantendo os MESMOS NOMES de policy criados em 20260828131000 (não
-- renomeia de novo).
-- ============================================================
DROP POLICY devs_select_route ON public.devs;
CREATE POLICY devs_select_route ON public.devs
  FOR SELECT TO authenticated
  USING (
    private.can_view_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY teams_select_route ON public.teams;
CREATE POLICY teams_select_route ON public.teams
  FOR SELECT TO authenticated
  USING (
    private.can_view_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY sprints_select_route ON public.sprints;
CREATE POLICY sprints_select_route ON public.sprints
  FOR SELECT TO authenticated
  USING (
    private.can_view_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

DROP POLICY allocations_select_route ON public.allocations;
CREATE POLICY allocations_select_route ON public.allocations
  FOR SELECT TO authenticated
  USING (
    private.can_view_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );

-- ============================================================
-- 2. set_user_role — revogar o papel (_role IS NULL) agora cascateia para
-- user_route_access. Corpo idêntico ao de
-- 20260809100000_rbac_user_roles_fk.sql — a versão realmente em produção
-- hoje, que por sua vez já havia acrescentado a guarda W2004 (uuid
-- inexistente em auth.users) sobre o corpo original de
-- 20260808121000_rbac_rpc_policies.sql. Uma revisão anterior desta
-- migration usou por engano o corpo de 20260808121000 como base e teria
-- revertido silenciosamente a guarda W2004; a base correta agora é
-- 20260809100000, com TODAS as suas guardas preservadas na mesma ordem
-- (W2001 admin-only, W2004 uuid órfão, W2002 auto-remoção de admin), e uma
-- única adição: o novo DELETE FROM public.user_route_access logo após o
-- DELETE de user_roles, dentro do mesmo branch _role IS NULL. (W2003, o
-- último-admin, mora no trigger guard_last_admin e não é tocado aqui.)
-- ============================================================
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
    -- Fecha o gap desta migration: sem isto, o usuário ficava sem papel mas
    -- mantinha as linhas de user_route_access, e a leitura sob RLS
    -- continuava liberada. O DELETE dispara private.audit_user_route_access
    -- (AFTER DELETE), que grava 'route_revoke' para cada rota removida,
    -- atribuído a v_actor via app.actor_id (setado acima).
    DELETE FROM public.user_route_access WHERE user_id = _target;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target, _role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
    WHERE user_roles.role IS DISTINCT FROM EXCLUDED.role;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_user_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) TO authenticated;

-- ============================================================
-- 3. Limpeza única de linhas órfãs — usuários que já haviam sido
-- desativados (papel = NULL) ANTES deste fix existir continuam com linhas
-- de user_route_access do backfill original, porque o set_user_role antigo
-- (corrigido acima, item 2) nunca as apagava. Com a policy de SELECT já
-- corrigida (item 1), essas linhas órfãs são inofensivas para leitura hoje
-- — mas se o usuário for reativado (um admin conceder papel de novo), ele
-- reganharia até 4 rotas silenciosamente, sem passar por set_user_routes e
-- sem o admin ter escolhido especificamente essas rotas, e sem qualquer
-- 'route_grant' na auditoria para esse regresso.
--
-- Nota sobre ordem: esta limpeza está posicionada depois da correção das
-- policies de SELECT só por clareza narrativa (mostrar a leitura já
-- corrigida antes de arrumar os dados). Não há dependência funcional real
-- entre as duas — este DELETE roda com privilégio de superusuário da
-- migration, fora de RLS, então a ordem em relação ao item 1 não afeta o
-- resultado.
--
-- Nota sobre auditoria: este é um DELETE solto, fora de set_user_role, logo
-- app.actor_id NUNCA foi setado nesta sessão. private.audit_user_route_access
-- lê app.actor_id com current_setting(..., true) (missing_ok), então cada
-- linha de auditoria 'route_revoke' gerada por este DELETE terá
-- actor_user_id = NULL. Essa é a convenção já estabelecida neste código
-- para alterações fora de banda (o mesmo current_setting(..., true) em
-- private.audit_user_roles resulta em actor_user_id = NULL sempre que uma
-- mudança em user_roles/user_route_access não passa pelas RPCs
-- set_user_role/set_user_routes — por exemplo, uma correção manual rodada
-- direto no SQL Editor, como esta).
DELETE FROM public.user_route_access
 WHERE user_id NOT IN (SELECT user_id FROM public.user_roles);
