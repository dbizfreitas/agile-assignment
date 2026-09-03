-- supabase/migrations/20260902181000_retro_ms_graph_token.sql
-- Token OAuth do Microsoft Graph (issue #24, fotos de participantes),
-- persistido no Supabase porque o runtime é Cloudflare Workers via
-- Nitro (serverless) — sem disco persistente, diferente do processo Node
-- de vida longa do jira-live original (.ms-token-cache.json em arquivo).
--
-- Fica no schema public (não em private) porque supabaseAdmin
-- (src/integrations/supabase/client.server.ts) é um client supabase-js
-- comum: só consulta tabelas expostas via PostgREST no schema public sem
-- configuração adicional de API, e nenhum código do projeto hoje acessa
-- outro schema a partir do service-role client. A proteção não vem do
-- isolamento de schema, vem de RLS habilitado SEM NENHUMA policy — só
-- service_role (que bypassa RLS) consegue ler ou escrever.
CREATE TABLE public.ms_graph_token (
  id boolean PRIMARY KEY DEFAULT true,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ms_graph_token_singleton CHECK (id)
);

INSERT INTO public.ms_graph_token (id) VALUES (true);

ALTER TABLE public.ms_graph_token ENABLE ROW LEVEL SECURITY;
-- De propósito: zero CREATE POLICY aqui.

-- Helpers de autorização para as RPCs do sorteio (Task 3), mesmo padrão de
-- private.can_view_alocacoes/can_edit_alocacoes
-- (20260831140000_alocacoes_auth_helpers.sql) — existe para que a próxima
-- RPC SECURITY DEFINER tenha UMA função para chamar, em vez de reconstruir
-- o AND papel+rota de memória (a lição documentada naquela migration: um
-- esquecimento assim já virou escalada de privilégio real em produção).
CREATE OR REPLACE FUNCTION private.can_view_retrospectivas(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.can_view_board(_user_id)
     AND private.has_route(_user_id, 'retrospectivas'::public.app_route)
$$;

CREATE OR REPLACE FUNCTION private.can_edit_retrospectivas(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.can_edit_board(_user_id)
     AND private.has_route(_user_id, 'retrospectivas'::public.app_route)
$$;

REVOKE ALL ON FUNCTION private.can_view_retrospectivas(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION private.can_edit_retrospectivas(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.can_view_retrospectivas(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_edit_retrospectivas(uuid) TO authenticated, service_role;
