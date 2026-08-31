-- Helpers de autorizacao para o quadro de alocacao (teams/devs/sprints/
-- allocations), achado de altitude do code review do PR #33.
--
-- O predicado real de acesso a estas quatro tabelas sempre foi "tem o papel
-- certo E tem a rota alocacoes" -- papel sozinho nunca bastou desde que
-- 20260828131000_route_access_rls.sql exigiu as duas coisas. Mas nao havia
-- uma funcao para esse predicado: ele era reescrito a mao em 20+ lugares (16
-- policies de escrita + 4 de leitura + a RPC delete_team), cada um repetindo
-- as mesmas duas linhas.
--
-- A prova de que isso e perigoso, nao so repetitivo: a primeira versao de
-- delete_team (20260830120000_team_delete_rpc.sql) escreveu so a metade —
-- can_edit_board, sem has_route — e produziu uma escalada de privilegio real
-- em producao, corrigida em 20260830130000_team_delete_route_guard.sql.
-- delete_team e SECURITY DEFINER: contorna a RLS por completo, entao nada no
-- Postgres obriga uma checagem escrita a mao ali a bater com o que a RLS ja
-- exige em todo o resto do sistema. Um esquecimento e invisivel ate alguem
-- explorar.
--
-- Estes dois helpers existem para que a proxima RPC SECURITY DEFINER sobre
-- estas quatro tabelas tenha UMA funcao para chamar, em vez de reconstruir o
-- AND de memoria. 'alocacoes' fica fixo no corpo, nao como parametro: e a
-- unica rota que ja combina papel e rota neste sistema hoje, e generalizar
-- agora seria construir para um caso que nao existe.
--
-- As 20 policies de RLS existentes NAO chamam estes helpers e continuam com
-- a checagem inline, de proposito: RLS e declarativa e o Postgres a aplica
-- sempre, sem depender de alguem lembrar de chama-la -- o risco real e
-- exclusivo de codigo SECURITY DEFINER escrito a mao, que e exatamente o que
-- isto endereca. Reescrever as 20 policies por DRY trocaria uma duplicacao
-- inerte por uma migration de 20 DROP+CREATE POLICY, para um ganho so
-- estetico.
CREATE OR REPLACE FUNCTION private.can_view_alocacoes(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.can_view_board(_user_id)
     AND private.has_route(_user_id, 'alocacoes'::public.app_route)
$$;

CREATE OR REPLACE FUNCTION private.can_edit_alocacoes(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.can_edit_board(_user_id)
     AND private.has_route(_user_id, 'alocacoes'::public.app_route)
$$;

REVOKE ALL ON FUNCTION private.can_view_alocacoes(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION private.can_edit_alocacoes(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.can_view_alocacoes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_edit_alocacoes(uuid) TO authenticated, service_role;
