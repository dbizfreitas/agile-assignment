# Retrospectivas por projeto — plano

**Objetivo:** a roleta de Retrospectivas deixa de ser única e global. Cada projeto
Jira (o mesmo seletor de projeto da casca, `useShell().project`) tem o seu time de
participantes e o seu estado de sorteio. Tudo que existe hoje passa a ser do
projeto **PIM**. Os outros projetos começam vazios (gestão de participantes
continua manual, via SQL Editor — decisão da issue #24, não muda aqui).

**Convenção seguida:** a mesma dimensão `jira_project text` de `teams`/`sprints`/
`devs` (migration `20260810121000_board_project_constraints.sql`): o banco valida
só o formato `^[A-Z][A-Z0-9]{1,9}$`; a lista de projetos mora em
`src/lib/projects.ts`.

## Tarefa 1 — Migration `supabase/migrations/20261008120000_retro_por_projeto.sql`

Um arquivo só, envolto em `BEGIN; … COMMIT;`, com comentário de cabeçalho no
estilo das migrations vizinhas (português, explicando o porquê).

1. `retro_participants`:
   - `ADD COLUMN jira_project text`; `UPDATE … SET jira_project = 'PIM'`;
   - `SET NOT NULL`; `CHECK (jira_project ~ '^[A-Z][A-Z0-9]{1,9}$')`
     (nome `retro_participants_jira_project_format`);
   - `DROP CONSTRAINT retro_participants_email_key` e
     `ADD CONSTRAINT retro_participants_project_email_key UNIQUE (jira_project, email)`
     — a mesma pessoa pode estar na retro de dois projetos.
   - índice não precisa: o UNIQUE já começa por `jira_project`.
2. `retro_roulette_state` deixa de ser singleton:
   - `ADD COLUMN jira_project text`; `UPDATE … SET jira_project = 'PIM'`;
   - `DROP CONSTRAINT retro_roulette_state_pkey`, `DROP COLUMN id` (leva junto o
     `CHECK retro_roulette_state_singleton`), `SET NOT NULL`, `ADD PRIMARY KEY (jira_project)`,
     mesmo CHECK de formato (`retro_roulette_state_jira_project_format`).
   - policy de SELECT existente continua valendo (não depende de `id`).
3. RPCs: `DROP FUNCTION` das 5 assinaturas antigas
   (`spin_roulette()`, `skip_participant(text)`, `unskip_participant(text)`,
   `unmark_participant(text)`, `reset_roulette()`) e criar as novas com `_project text`
   como PRIMEIRO parâmetro: `spin_roulette(_project text)`,
   `skip_participant(_project text, _email text)`, `unskip_participant(_project text, _email text)`,
   `unmark_participant(_project text, _email text)`, `reset_roulette(_project text)`.
   Corpo = o da versão vigente (`20260903133600_retro_roulette_rpcs_explicit_where.sql`)
   com estas mudanças, nesta ordem, depois do check `can_edit_retrospectivas` (W2001):
   ```sql
   IF _project IS NULL OR _project !~ '^[A-Z][A-Z0-9]{1,9}$' THEN
     RAISE EXCEPTION 'Projeto inválido' USING ERRCODE = 'W2403';
   END IF;
   -- Estado nasce sob demanda: projeto novo não precisa de seed.
   INSERT INTO public.retro_roulette_state (jira_project) VALUES (_project)
   ON CONFLICT (jira_project) DO NOTHING;
   PERFORM 1 FROM public.retro_roulette_state WHERE jira_project = _project FOR UPDATE;
   ```
   - todo `UPDATE` usa `WHERE jira_project = _project` (WHERE explícito continua
     obrigatório — ver o achado do PostgREST/pg-safeupdate na migration 20260903133600);
   - `spin_roulette` sorteia só `p.jira_project = _project` e junta com o estado do
     mesmo projeto (`s.jira_project = _project`).
   - `SECURITY DEFINER`, `SET search_path = public`, mesmos `REVOKE ALL … FROM public, anon`
     e `GRANT EXECUTE … TO authenticated` das assinaturas novas.

## Tarefa 2 — Tipos

- `src/integrations/supabase/retro-types.ts`: `jira_project: string` em
  `RetroParticipantRow`; `RetroRouletteStateRow` troca `id: boolean` por
  `jira_project: string`; `Args` das 5 funções com `_project`.
- `src/integrations/supabase/types.ts` (linhas ~208 e ~241, gerado): ajustar as
  mesmas colunas de `retro_participants`/`retro_roulette_state` à mão para não
  divergir.

## Tarefa 3 — Hooks e tela

- `src/hooks/use-retro-participants.ts`: `useRetroParticipants(project: JiraProjectKey)`;
  `.eq("jira_project", project)`; `queryKey: ["retro-participants", project]`.
- `src/hooks/use-roulette.ts`: `useRoulette(participants, project)`;
  estado com `.eq("jira_project", project).maybeSingle()` — sem linha = estado
  vazio (`[]`, `[]`, `null`), não erro; `queryKey: ["retro-roulette-state", project]`
  (invalidateState usa a mesma chave); todas as RPCs passam `_project: project`;
  `W2403: "Projeto inválido."` em `ROULETTE_ERROR_MESSAGES`.
- `src/components/retrospectivas/RouletteView.tsx`: `const { project } = useShell();`
  e passar para os dois hooks. Estado vazio: quando `!loading && participants.length === 0`,
  mostrar no lugar do Card+grid um texto `text-sm text-muted-foreground` centrado:
  "Nenhum participante cadastrado na retrospectiva deste projeto." (sem botão Sortear).
- `src/routes/_shell/retrospectivas.tsx`: ler `project` do `useShell()` e renderizar
  `<RouletteView key={project} />` (remonta e zera animação/highlight ao trocar de projeto,
  mesmo padrão de `alocacoes.tsx`). Atualizar o comentário do arquivo e o `head`
  ("Sorteia quem conduz a próxima retro do time do projeto…").

## Tarefa 4 — Foto (cache por e-mail)

`src/integrations/ms-graph/photos.server.ts` linha ~85: com a mesma pessoa em dois
projetos, `.eq("email", email).maybeSingle()` passa a falhar (mais de uma linha).
Trocar por `.order("photo_fetched_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()`.
Os `UPDATE … .eq("email", email)` ficam: a foto é da pessoa, vale para todas as linhas dela.

## Tarefa 5 — Suíte SQL `supabase/tests/retro_participants_smoke.sql`

Ajustar ao esquema novo, mantendo `BEGIN … ROLLBACK` e um `RAISE NOTICE 'Seção N OK'` por seção:
- Seção 1: tabelas existem; todo participante tem `jira_project`; existe estado `PIM`;
  remover a contagem fixa de 20 e o check do `bruno@shippit.app` (já saiu na migration PIM).
- Seção 3/4: chamar as RPCs com `'PIM'` (ou um projeto de teste) nos novos parâmetros,
  `WHERE jira_project = …` nas conferências.
- Seção nova "Isolamento entre projetos": inserir 2 participantes no projeto `ZZTEST`,
  `spin_roulette('ZZTEST')` cria a linha de estado sob demanda, sorteia alguém de `ZZTEST`,
  e o estado de `PIM` não muda; `reset_roulette('ZZTEST')` não zera `PIM`;
  `spin_roulette('pim')` levanta `W2403`.

## Tarefa 6 — Verificação

- `npm run lint` e `npx tsc --noEmit` (ou `npm run build`) sem erros novos.
- Não rodar o dev server contra o banco: localhost lê PRODUÇÃO e a migration ainda
  não está aplicada.
- Commits pequenos em português, prefixo convencional (`feat(retro): …`), na branch
  `feat/retro-por-projeto`. Não fazer push.

## Depois do merge (para o PR)

O frontend novo e a migration dependem um do outro (as assinaturas antigas das RPCs
somem). Ordem: (1) colar o arquivo inteiro da migration no SQL Editor do Supabase e
rodar; (2) fazer o merge logo em seguida; (3) colar e rodar a suíte
`supabase/tests/retro_participants_smoke.sql`; (4) abrir Retrospectivas no site
publicado com PIM e conferir que o estado do sorteio continua o de antes; trocar para
PowerHub e ver o estado vazio.
