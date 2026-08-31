-- Corrige uma corrida na criacao de time, achada no code review do PR #33.
--
-- Tanto TeamsDialog.tsx quanto o "+ Criar novo time" do DevDialog.tsx
-- calculam `position: teams.length` a partir do cache local do cliente, que
-- pode estar desatualizado entre abas ou sessoes (o TanStack Query nao
-- sincroniza cache entre abas). Duas criacoes quase simultaneas podem ler o
-- mesmo `teams.length` e inserir dois times na mesma position do mesmo
-- projeto -- nao ha `UNIQUE (jira_project, position)` que rejeite isso, e
-- nada corrigia depois (ao contrario de exclusao, que renumera).
--
-- Mesma familia de solucao que private.set_dev_project/set_allocation_project
-- (20260810121000_board_project_constraints.sql): um trigger BEFORE INSERT
-- recalcula o valor no servidor, tornando o payload do cliente inforjavel
-- tambem para este campo. Os dois call sites ja so querem "no fim da lista",
-- entao sobrescrever sempre e seguro e nao muda nenhum comportamento
-- documentado -- so reduz a janela de corrida de "um round-trip de rede +
-- refetch de cache" (ordem de segundos) para "a duracao de uma unica
-- instrucao SQL" (ordem de microssegundos). Nao elimina toda concorrencia
-- teorica sem um lock explicito, mas o proprio delete_team ja documenta que
-- teams.position tolera esse nivel de corrida por decisao (sem UNIQUE,
-- "nao existe colisao a evitar com um passo intermediario") -- esta e a
-- profundidade de correcao consistente com o resto do sistema.
--
-- So BEFORE INSERT, nunca BEFORE UPDATE: o reorder de TeamsDialog.tsx e a
-- renumeracao de delete_team escrevem `position` via UPDATE direto, com
-- valores calculados de proposito. Um trigger de UPDATE aqui sobrescreveria
-- os dois e quebraria tanto reordenar quanto a exclusao com realocacao.
CREATE OR REPLACE FUNCTION private.set_team_position()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.position := COALESCE(
    (SELECT max(position) + 1 FROM public.teams WHERE jira_project = NEW.jira_project),
    0
  );
  RETURN NEW;
END $$;

-- Trigger functions nao tem o EXECUTE checado em tempo de execucao (a
-- verificacao acontece no CREATE TRIGGER), entao revogar e seguro e mantem a
-- disciplina das outras funcoes de trigger do projeto.
REVOKE ALL ON FUNCTION private.set_team_position() FROM public, anon;

CREATE TRIGGER teams_set_position
BEFORE INSERT ON public.teams
FOR EACH ROW EXECUTE FUNCTION private.set_team_position();
