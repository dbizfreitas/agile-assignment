-- Janela de disponibilidade da pessoa (issue #2 do repo): a partir de quando,
-- e opcionalmente até quando, alguém faz parte do time e deve aparecer
-- habilitada na grade de alocações. Substitui o cinza que hoje é pintado à
-- mão na planilha que a ferramenta veio aposentar.
--
-- As duas colunas são ANULÁVEIS de propósito: NULL desliga o lado
-- correspondente da regra, então toda pessoa já cadastrada nasce sem
-- restrição e se comporta exatamente como antes desta migration. Não há
-- backfill — preencher com uma data que ninguém informou seria inventar dado.
--
-- Nenhuma policy de RLS muda: as policies de devs (devs_select_viewers,
-- devs_insert_editors, devs_update_editors, devs_delete_editors) são por
-- tabela e por papel, não por coluna, e os GRANTs de tabela cobrem coluna
-- nova automaticamente.
--
-- Sem índice: a regra é avaliada no cliente sobre a lista de pessoas que a
-- tela já carrega em memória, nunca num WHERE.
--
-- Sem trigger em allocations validando a janela — decisão registrada em
-- docs/superpowers/specs/2026-08-15-disponibilidade-pessoa-design.md.
-- Resumo: projeto é imutável na prática, janela de disponibilidade muda.
-- Com o trigger, encurtar a janela de alguém travaria o UPDATE de todo
-- cartão preexistente fora dela — inclusive o arrastar-para-fora, que é
-- justamente a correção. O banco impediria a única ação que resolve.
ALTER TABLE public.devs
  ADD COLUMN available_from date,
  ADD COLUMN available_to   date;

-- Este CHECK fica porque é invariante de LINHA, não de relação: não depende
-- de nenhuma outra tabela, então travá-lo no banco não pode encurralar o
-- usuário. Os dois IS NULL deixam passar janela aberta dos dois lados e
-- janela aberta de um lado só.
ALTER TABLE public.devs
  ADD CONSTRAINT devs_availability_order
  CHECK (available_to IS NULL OR available_from IS NULL OR available_to >= available_from);
