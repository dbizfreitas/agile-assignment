-- Dimensão de projeto no quadro de alocação — parte A (aditiva e reversível).
--
-- Só acrescenta coluna e dado; nenhuma escrita passa a ser recusada aqui. As
-- travas ficam na parte B, pelo mesmo motivo das migrations de RBAC: se algo
-- der errado em B, A já está estável. Reverter A é
-- `ALTER TABLE … DROP COLUMN jira_project` nas quatro tabelas.

-- ============================================================
-- 1. Colunas anuláveis
-- ============================================================
ALTER TABLE public.teams       ADD COLUMN jira_project text;
ALTER TABLE public.sprints     ADD COLUMN jira_project text;
ALTER TABLE public.devs        ADD COLUMN jira_project text;
ALTER TABLE public.allocations ADD COLUMN jira_project text;

-- ============================================================
-- 2. Eixo das colunas: time -> pessoas -> cartões
-- ============================================================
-- Nenhuma migration semeou devs ou sprints: todo time e toda pessoa que
-- existem hoje foram criados à mão pela tela, e a única evidência de projeto
-- disponível é o prefixo de allocations.ticket_key. O voto é por TIME, não por
-- cartão, porque time é a raiz do eixo: um cartão de INTFLOW-… na linha de
-- alguém do time do PIM é trabalho pontual, não muda o projeto do time.
-- Empate resolvido por ordem alfabética, para o resultado ser determinístico.
WITH voto AS (
  SELECT d.team_id,
         upper(split_part(a.ticket_key, '-', 1)) AS chave,
         count(*) AS n
    FROM public.allocations a
    JOIN public.devs d ON d.id = a.dev_id
   WHERE a.ticket_key ~ '^[A-Za-z]+-[0-9]+$'
   GROUP BY 1, 2
), vencedor AS (
  SELECT DISTINCT ON (team_id) team_id, chave
    FROM voto
   WHERE chave IN ('PIM','PH','INTFLOW','PDC')
   ORDER BY team_id, n DESC, chave
)
UPDATE public.teams t
   SET jira_project = COALESCE(
         (SELECT v.chave FROM vencedor v WHERE v.team_id = t.id),
         'PIM');   -- sem nenhum sinal (inclusive o time 'Sem time'): PIM

UPDATE public.devs d
   SET jira_project = t.jira_project
  FROM public.teams t
 WHERE t.id = d.team_id;

UPDATE public.allocations a
   SET jira_project = d.jira_project
  FROM public.devs d
 WHERE d.id = a.dev_id;

-- ============================================================
-- 3. Eixo das linhas: a sprint herda o projeto dos seus cartões
-- ============================================================
-- (a) cada sprint fica com o primeiro projeto dos seus cartões (ordem
--     alfabética, determinística); sem cartões, PIM.
UPDATE public.sprints s
   SET jira_project = COALESCE(
     (SELECT a.jira_project FROM public.allocations a
       WHERE a.sprint_id = s.id ORDER BY a.jira_project LIMIT 1),
     'PIM');

-- (b) Sprint com cartões de mais de um projeto é DIVIDIDA, não recusada: não
--     existe atribuição única possível, e abortar a migration travaria o
--     deploy por um dado que ninguém consegue inspecionar antes. Os projetos
--     restantes ganham uma cópia da sprint e os cartões daquele projeto passam
--     a apontar para ela — que é exatamente o modelo final (cada projeto tem
--     seu próprio calendário). Nada é perdido.
--     Num quadro de projeto único — o cenário quase certo — este bloco não faz
--     nada e não emite NOTICE nenhum.
DO $$
DECLARE r record; v_new uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT a.sprint_id, a.jira_project
      FROM public.allocations a
      JOIN public.sprints s ON s.id = a.sprint_id
     WHERE a.jira_project <> s.jira_project
  LOOP
    INSERT INTO public.sprints (code, quarter, start_date, end_date, days, position, jira_project)
    SELECT code, quarter, start_date, end_date, days, position, r.jira_project
      FROM public.sprints WHERE id = r.sprint_id
    RETURNING id INTO v_new;

    UPDATE public.allocations
       SET sprint_id = v_new
     WHERE sprint_id = r.sprint_id AND jira_project = r.jira_project;

    RAISE NOTICE 'sprint % duplicada para o projeto %', r.sprint_id, r.jira_project;
  END LOOP;
END $$;
