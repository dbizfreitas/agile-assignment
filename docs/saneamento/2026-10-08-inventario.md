# Inventário de código morto (issue #19)

Este documento é só análise e inventário. Nenhum código foi alterado. O plano está em `docs/superpowers/plans/2026-10-08-saneamento-codigo.md`.

**Data:** 08/10/2026. **Branch:** `chore/saneamento-inventario-19`.

**Banco de produção:** a verificação de `devs.active` foi rodada em 08/10/2026 (resultado na seção de `devs.active`). Os demais itens que dependem do banco continuam marcados com 🔎, e as consultas estão na seção [Consultas pendentes no SQL Editor](#consultas-pendentes-no-sql-editor).

## Resumo

| Grupo                                  | Achados                                                                  | Ação sugerida                                              |
| -------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `devs.active`                          | Coluna nunca lida nem escrita desde o commit inicial                     | Remover (front primeiro, depois a migration)               |
| Componentes shadcn sem uso             | 28 arquivos em `src/components/ui/` + ~24 dependências que só eles puxam | Decisão do dono: remover em lote ou manter como biblioteca |
| Integração MS Graph                    | Cadeia inteira inoperante (token nunca obtido)                           | Decisão do dono: abandonar ou manter 🔎                    |
| Código TS sem uso real                 | 1 parâmetro (`sprintEnd`), 1 hook órfão transitivo, exports supérfluos   | Ajustes pontuais, prioridade baixa                         |
| Duplicações                            | Consultas de `teams`/`devs`, helpers de `localStorage`, `demandasPhrase` | Refator em issue própria                                   |
| Rotas, server functions, RPCs, enums   | Nenhum morto                                                             | Nada a fazer                                               |
| Código comentado, TODOs, feature flags | Nenhum                                                                   | Nada a fazer                                               |

## Linha de base

- `npm run build`: passa.
- `npm run lint`: falha com ~17 mil erros `prettier/prettier "Delete ␍"`. A causa é a cópia de trabalho em CRLF no Windows (`core.autocrlf=true`), enquanto o índice está em LF. O código não tem esse problema. Fora isso, há 15 avisos que já existiam (`react-hooks/exhaustive-deps` em `BoardGrid.tsx:252,253,271`, `react-refresh/only-export-components` em `AllocationDialog.tsx:790`).
- `tsc --noEmit --noUnusedLocals --noUnusedParameters`: 1 erro, `src/lib/compromisso/calc.ts:56` (`sprintEnd`).
- `knip` (sem config): 29 arquivos, 25 dependências, 19 exports e 7 tipos sem uso. A triagem está abaixo.

## `devs.active`: análise detalhada

**1. O que é.** É a coluna `public.devs.active boolean NOT NULL DEFAULT true`. O nome sugere "pessoa ativa ou inativa", mas não há nenhum comportamento associado a ela.

**2. Onde foi criado.** `supabase/migrations/20260801002005_d13e7c4e-d6ff-4619-b94e-41c17a6e1682.sql:9`, no `CREATE TABLE` do schema inicial (commit `551caaa`, "Initial commit from remix"). O tipo `active: boolean` em `src/lib/board.ts:25` vem do mesmo commit.

**3. Onde é utilizado.**

- **Leitura: em nenhum lugar.** Aparece só como declaração em `src/lib/board.ts:25` e em `src/integrations/supabase/types.ts:99,111,123` (Row, Insert e Update).
- **Escrita: em nenhum lugar.** O payload do `DevDialog.tsx:150-169` não inclui `active`, e `use-reorder-devs.ts:23` grava só `position`. Nenhum UPDATE em migration cita a coluna (`team_delete*`, `board_project_column`), nem o trigger `devs_set_project`. Os testes em `supabase/tests/` listam colunas explícitas, sem `active`. A coluna só recebe o default.
- **Leitura indireta:** `select("*")` em `BoardGrid.tsx:196` e `TeamsDialog.tsx:73` traz a coluna para o cliente, mas ninguém a lê pelo nome. Spreads como `{...d, position}` apenas repassam o objeto. Não há `Object.keys`, `JSON.stringify` ou exportação CSV sobre `Dev`. O embed (`embed.alocacoes.tsx`) reaproveita o `BoardGrid`.
- **Falsos positivos:** os `active` em `security_invariants_*` e `provision_sso_user` são de `cron.job.active`.

**4. Quem depende dele.** Ninguém no repositório: nem código, nem migrations, policies, triggers, funções ou testes. No banco de produção, também ninguém (ver "Resultado em produção" abaixo). Fora do app, falta confirmar se existe consumidor da REST do Supabase 🔎.

**5. Fluxo funcional associado.** Nenhum, e nunca houve UI de "inativar pessoa". Nem `git log -S"active"` nem `git log --all -S"inativ"` acham isso. O plano `docs/superpowers/plans/2026-08-15-disponibilidade-pessoa.md:23,883` já registrava a coluna como morta ("merece issue própria: usar ou dropar"). A spec de disponibilidade (`:230`) rejeitou reaproveitá-la como interruptor manual.

**6. Substituto.** A janela de disponibilidade `available_from`/`available_to` (migration `20260815120000_devs_availability_window.sql`, issue #2, regra em `isDevAvailableInSprint`) é parcial. Ela cobre o caso real, que é desabilitar a pessoa fora do período, mas não oculta a pessoa. Hoje não existe requisito de ocultar.

**Resultado em produção (08/10/2026):**

| Verificação                                  | Resultado                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `devs` por valor de `active`                 | 14 linhas, todas `true`                                                                                                                       |
| Funções que citam `active`                   | só `private.assert_security_invariants`, falso positivo: ela lê `cron.job.active` (migrations `security_invariants_*` e `provision_sso_user`) |
| Views com `devs` + `active`                  | nenhuma                                                                                                                                       |
| Policies de `devs` com `active`              | nenhuma                                                                                                                                       |
| Triggers de `devs`                           | só `devs_set_project`, que chama `private.set_dev_project()` e lê apenas `teams.jira_project`                                                 |
| Objetos que dependem da coluna (`pg_depend`) | 0                                                                                                                                             |

**7. Pode ser removido?** Sim. Nenhuma pessoa está com `active = false`, e nada no banco depende da coluna. A única condição que resta é não haver consumidor externo da REST lendo `active`.

**8. O que alterar para remover.** A ordem é front primeiro, banco depois.

1. PR do front:
   - Apagar `active: boolean;` em `src/lib/board.ts:25`.
   - Apagar `active` em `src/integrations/supabase/types.ts:99` (Row), `:111` (Insert) e `:123` (Update).
   - Conferir com `npx tsc --noEmit` e `npm run build`.
2. Depois do front publicado, criar a migration `supabase/migrations/<data>_drop_devs_active.sql` e aplicá-la pelo SQL Editor:
   ```sql
   -- devs.active: coluna sem leitores nem escritores (issue #19).
   ALTER TABLE public.devs DROP COLUMN active;
   ```
3. Se houver consumidor externo da REST, avisá-lo antes.
4. Rollback: `ALTER TABLE public.devs ADD COLUMN active boolean NOT NULL DEFAULT true;`. Os valores originais se perdem, mas hoje todos devem ser `true`.

**9. Risco.** Baixo, se as consultas confirmarem. Os riscos reais são três:

- Existir pessoa com `active = false` e significado legado. Nesse caso, primeiro migrar para `available_to` com a data de saída informada pelo dono.
- Um consumidor externo fazer `select=active`.
- Aplicar o DROP antes do front publicado. Não quebra o app (o front nunca escreve a coluna e `select("*")` continua funcionando), mas o tipo fica desatualizado.

## Inventário

Ordenado por confiança. "Alta (interno)" quer dizer que não há referência no repositório e que o item não é acessível de fora.

| Item                                                            | Localização                                                                                                                                                                                                                                                                                                                                                           | Tipo                          | Evidência de código morto                                                                                                                                                                                                                              | Dependências/Impactos                                                                                                                   | Confiança                               | Recomendação                                                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `devs.active`                                                   | `20260801002005_…sql:9`; `src/lib/board.ts:25`; `types.ts:99,111,123`                                                                                                                                                                                                                                                                                                 | Coluna + campo de tipo        | Nunca lida nem escrita (ver seção acima)                                                                                                                                                                                                               | Exposta pela REST do Supabase; possível dado legado                                                                                     | Alta (código e banco)                   | Remover: front, depois migration                                                                       |
| Parâmetro `sprintEnd`                                           | `src/lib/compromisso/calc.ts:56` (chamada em `:136`)                                                                                                                                                                                                                                                                                                                  | Parâmetro sem uso             | `tsc --noUnusedParameters` (TS6133) e `eslint no-unused-vars`                                                                                                                                                                                          | Função interna não exportada. Confirmar se a regra "conclusões de hoje contam" (`calc.ts:50`) pretendia usar o fim da sprint            | Alta                                    | Remover o parâmetro e o argumento, ou implementar a intenção                                           |
| 28 componentes shadcn sem uso (agregado)                        | `src/components/ui/`: accordion, alert, aspect-ratio, breadcrumb, calendar, carousel, checkbox, collapsible, command, context-menu, drawer, dropdown-menu, form, input-otp, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, separator, sheet, sidebar, skeleton, slider, switch                                         | Arquivos órfãos (gerados)     | `knip` ("Unused files") e fecho de imports a partir de `src` fora de `ui/`. Seguem vivos: alert-dialog, avatar, badge, button, card, chart, dialog, hover-card, input, label, select, table, tabs, textarea, toggle, toggle-group, tooltip e sonner    | Puxam as dependências da linha seguinte. O Lovable pode recriar componentes ao gerar telas                                              | Alta (interno)                          | Decisão do dono, baixa prioridade. Remover em lote com as dependências, em issue própria               |
| Dependências usadas só pelos `ui/*` órfãos (~24)                | `package.json`. Radix: accordion, aspect-ratio, checkbox, collapsible, context-menu, dropdown-menu, menubar, navigation-menu, popover, progress, radio-group, scroll-area, separator, slider, switch. Outras: `cmdk`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-hook-form`, `@hookform/resolvers`, `react-resizable-panels`, `vaul`, `date-fns` | Dependências                  | `knip` ("Unused dependencies") e busca por `from "<pacote>"` fora de `ui/`. `date-fns` tem zero imports e é peer de `react-day-picker`                                                                                                                 | Mexe em `package.json`, `package-lock.json` e `bun.lock`                                                                                | Alta (sem import); Média (para remover) | Remover junto com os `ui/*` correspondentes; `npm run build` depois                                    |
| `useIsMobile`                                                   | `src/hooks/use-mobile.tsx:5`                                                                                                                                                                                                                                                                                                                                          | Hook órfão transitivo         | Único consumidor: `ui/sidebar.tsx:6,69`, que também é órfão                                                                                                                                                                                            | Some junto com o `sidebar.tsx`                                                                                                          | Alta (condicionada)                     | Remover com o `ui/sidebar.tsx`                                                                         |
| Cadeia do MS Graph para fotos da retro                          | `src/integrations/ms-graph/photos.server.ts:34-53` (`fetchParticipantPhoto`), `token.server.ts:18-76`, `config.server.ts:9-11` (`MS_*`)                                                                                                                                                                                                                               | Código ligado, mas inoperante | `getAccessToken` sempre lança `MsGraphAuthError` porque o refresh token nunca existiu (login por device code bloqueado entre tenants). O `catch` só grava `photo_fetched_at`. As fotos reais vêm de `retro_participants.photo_data_url`, gravado à mão | Se for removida, `getCachedOrFetchPhoto` passa a só ler o cache. Pessoa nova continua sem foto até alguém gravar, como já acontece hoje | Média 🔎                                | Decisão do dono: se o Graph está abandonado, remover a cadeia; se não, documentar a limitação          |
| `scripts/ms-graph-auth.ts` + npm script `ms-graph:auth`         | `scripts/ms-graph-auth.ts`, `package.json:13`, `README.md` (~linhas 88-101)                                                                                                                                                                                                                                                                                           | Script e documentação         | O fluxo não consegue obter token. O README manda rodar algo que não funciona                                                                                                                                                                           | `tsx` existe só para esse script                                                                                                        | Média                                   | Junto com a decisão do Graph. Se abandonar: remover o script, o npm script, `tsx` e o trecho do README |
| Tabela `public.ms_graph_token`                                  | `20260902181000_retro_ms_graph_token.sql:14-27`; lida em `token.server.ts:30`; teste `retro_participants_smoke.sql:78-86`                                                                                                                                                                                                                                             | Tabela                        | Linha singleton criada pela migration e nunca preenchida                                                                                                                                                                                               | `DROP TABLE` por migration manual. Ajustar o smoke test                                                                                 | Média 🔎                                | Só se a consulta confirmar que está vazia e o Graph for abandonado                                     |
| `photos-cache.ts`                                               | `src/lib/retrospectivas/photos-cache.ts` (arquivo local), ignorado em `.gitignore:60`, `.prettierignore:12`, `eslint.config.js:11`                                                                                                                                                                                                                                    | Arquivo local não versionado  | Não está no git e não é importado (`grep -rn "photos-cache" src`). Resíduo da 1ª versão da roleta; hoje o cache está no banco                                                                                                                          | Não afeta o Lovable                                                                                                                     | Alta (fora do repo)                     | Apagar o arquivo local. Opcional: tirar as 3 entradas de ignore                                        |
| `retro-types.ts` (`withRetroTypes`, `RetroDatabase`)            | `src/integrations/supabase/retro-types.ts:3-56`; usado em `use-retro-participants.ts`, `use-roulette.ts`, `photos.server.ts`, `token.server.ts`                                                                                                                                                                                                                       | Abstração redundante          | O `types.ts` já tipa `ms_graph_token`, `retro_participants`, `retro_roulette_state` e as 5 RPCs com `_project`. O overlay virou um cast sem efeito                                                                                                     | Trocar 4 arquivos para o cliente direto e conferir com `tsc`                                                                            | Média                                   | Refator em issue própria                                                                               |
| Exports usados só no próprio arquivo (19)                       | `cycle-time.server.ts:176`; `issues.server.ts:86,142`; `photos.server.ts:34`; `token.server.ts:18`; `board.ts:166`; `compromisso/calc.ts:72,108,114`; `cycle-time/calc.ts:107,117,185`; `error-capture.ts:18`; `participants.ts:10,40`; `tickets.ts:18,95`                                                                                                            | Export supérfluo              | `knip` ("Unused exports"); `grep -rnw` só acha uso local                                                                                                                                                                                               | A função está viva; só o `export` sobra                                                                                                 | Alta (não é código morto)               | Opcional, sem ganho real                                                                               |
| Tipos exportados sem import externo (5)                         | `issues.server.ts:15` `JiraIssueRaw`; `sprints.server.ts:7` `JiraSprintRaw`; `burndown.ts:15,21`; `compromisso/calc.ts:198` `SPSummaryRow`                                                                                                                                                                                                                            | Export supérfluo              | `knip` ("Unused exported types")                                                                                                                                                                                                                       | Nenhum                                                                                                                                  | Alta (não é código morto)               | Opcional                                                                                               |
| Consulta de `teams` triplicada                                  | `BoardGrid.tsx:207-217`, `DevDialog.tsx:92-102`, `TeamsDialog.tsx:48-57`                                                                                                                                                                                                                                                                                              | Duplicação                    | Mesma `queryKey` e a mesma query; comentários dizem que precisam ser idênticas para o cache                                                                                                                                                            | Qualquer mudança precisa ser replicada nos três                                                                                         | Média                                   | Extrair `useTeamsQuery(project)` em `src/hooks/`                                                       |
| Consulta de `devs` duplicada                                    | `BoardGrid.tsx:193-205`, `TeamsDialog.tsx:70-82`                                                                                                                                                                                                                                                                                                                      | Duplicação                    | Idênticas (`select("*")`, filtro e ordenação)                                                                                                                                                                                                          | Idem                                                                                                                                    | Média                                   | Extrair `useDevsQuery(project)`                                                                        |
| Helpers `ls`/`save` de `localStorage`                           | `src/routes/_shell.tsx:26-40`, `src/components/cycle-time/CycleTimeView.tsx:17-30`                                                                                                                                                                                                                                                                                    | Duplicação                    | Corpo idêntico                                                                                                                                                                                                                                         | Nenhum                                                                                                                                  | Média                                   | Mover para `src/lib/`                                                                                  |
| `demandasPhrase`                                                | `DevDialog.tsx:49-51`, `SprintDialog.tsx:38-40`                                                                                                                                                                                                                                                                                                                       | Duplicação                    | Mesma função                                                                                                                                                                                                                                           | Nenhum                                                                                                                                  | Média                                   | Mover para `src/lib/board.ts`                                                                          |
| `private.can_view_alocacoes`, `private.can_view_retrospectivas` | `20260831140000_…sql:33`; `20260902181000_…sql:34-41`                                                                                                                                                                                                                                                                                                                 | Funções de banco              | Nenhuma policy ou função as chama; só os smoke tests. As policies usam `has_route` direto                                                                                                                                                              | Helpers simétricos aos `can_edit_*`, que são usados                                                                                     | Baixa                                   | Manter                                                                                                 |
| `@tanstack/router-plugin`                                       | `package.json:48`                                                                                                                                                                                                                                                                                                                                                     | Dependência                   | Sem import; `vite.config.ts` usa `@lovable.dev/vite-tanstack-config`                                                                                                                                                                                   | Pode ser exigida transitivamente pela config do Lovable                                                                                 | Baixa                                   | Não remover sem testar `build` e `dev`                                                                 |
| `user_route_access.granted_by`                                  | `20260828130000_route_access_foundation.sql:13`                                                                                                                                                                                                                                                                                                                       | Coluna só de escrita          | Gravada, mas nenhum `SELECT` do app a lê                                                                                                                                                                                                               | Auditoria                                                                                                                               | Baixa 🔎                                | Manter, como auditoria sem leitor                                                                      |
| `SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PROJECT_ID`               | `.env`                                                                                                                                                                                                                                                                                                                                                                | Variáveis de ambiente         | Zero leituras em `src`, `scripts` e `vite.config.ts`                                                                                                                                                                                                   | O `.env` é versionado de propósito, e o Lovable pode usá-las                                                                            | Baixa                                   | Manter                                                                                                 |
| `createSupabaseFetch`/`isNewSupabaseApiKey` triplicados         | `supabase/auth-middleware.ts:9,13`, `client.server.ts:8,12`, `client.ts:7,11`                                                                                                                                                                                                                                                                                         | Duplicação gerada             | Arquivos gerados pelo Lovable ("Do not edit")                                                                                                                                                                                                          | Edição seria desfeita                                                                                                                   | Baixa                                   | Não mexer                                                                                              |
| `prefer-const` em `timer`                                       | `src/integrations/supabase/previewAuthStorage.ts:38`                                                                                                                                                                                                                                                                                                                  | Estilo                        | `eslint`                                                                                                                                                                                                                                               | Nenhum                                                                                                                                  | n/a                                     | Fora do escopo; tratar num saneamento de lint                                                          |

## Verificado e sem código morto

- **Rotas** (`src/routes/`): todas têm link, redirect ou são ponto de entrada externo (`/aceitar-convite` vem de e-mail, `/auth/callback` do OAuth, `/embed/alocacoes` de iframe).
- **Server functions** (`createServerFn`): todas têm chamador.
- **Funções e RPCs do banco** (estado final das migrations): todas são usadas por `.rpc()`, trigger, policy, CHECK, cron ou testes. As exceções são as duas `can_view_*` da tabela. As assinaturas antigas da roleta foram removidas em `20261008120000_retro_por_projeto.sql:51-55`.
- **Enums**: todos os valores de `role_audit_action`, `allocation_status`, `allocation_tipo`, `app_route` e `app_role` são usados.
- **`types.ts` × migrations**: consistentes. Não há tabela ou função tipada que não exista, nem o contrário.
- **Referências quebradas**: nenhuma.
- **Código comentado, TODO/FIXME e feature flags**: nenhum.
- **Migrations "fix"/"restore"** (`restore_rpc_execute_revokes`, `route_access_fix_*`, `repair_null_ticket_keys`, `*_row_lock`, `*_explicit_where` etc.): são só histórico. Migration aplicada não se remove.

### Falsos positivos descartados

`lovable-error-reporting.ts`, `error-page.ts`, `error-capture.ts`, `ui/sonner.tsx` (importado por caminho relativo), `router.tsx`, `start.ts` (convenção do TanStack Start), `previewAuthStorage.ts` (import relativo com aspas simples), `toDraft`, `photo_data_url`/`photo_fetched_at`, `retro_participants.sort_order`/`color`, `ticket_url_is_valid` (usado em CHECK), funções de trigger, e dependências de toolchain ou peer (`tsx`, `@tailwindcss/vite`, `vite-tsconfig-paths`, `@vitejs/plugin-react`, `nitro`, `eslint-config-prettier`, `react-dom`, `@types/*`). Também `@radix-ui/react-slot`/`react-label` e `class-variance-authority`, que são usados por componentes `ui/*` vivos.

## Consultas pendentes no SQL Editor

Todas são somente leitura. O SQL Editor mostra apenas o resultado da última instrução, por isso cada bloco devolve uma única tabela.

**A. `devs.active`, MS Graph e colunas só de escrita**

```sql
SELECT 'devs com active = ' || active::text AS verificacao, count(*)::text AS resultado
FROM public.devs GROUP BY active
UNION ALL
SELECT 'funções que citam active',
       coalesce(string_agg(n.nspname || '.' || p.proname, ', '), '(nenhuma)')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosrc ~* '\mactive\M' AND n.nspname IN ('public', 'private')
UNION ALL
SELECT 'views com devs + active',
       coalesce(string_agg(schemaname || '.' || viewname, ', '), '(nenhuma)')
FROM pg_views WHERE definition ~* '\mdevs\M' AND definition ~* '\mactive\M'
UNION ALL
SELECT 'policies de devs com active', coalesce(string_agg(policyname, ', '), '(nenhuma)')
FROM pg_policies
WHERE tablename = 'devs' AND (coalesce(qual, '') ~* 'active' OR coalesce(with_check, '') ~* 'active')
UNION ALL
SELECT 'objetos que dependem de devs.active', count(*)::text
FROM pg_depend d
JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
WHERE d.refobjid = 'public.devs'::regclass AND a.attname = 'active'
  AND d.classid <> 'pg_attrdef'::regclass
UNION ALL
SELECT 'ms_graph_token: linhas com refresh_token', count(*) FILTER (WHERE refresh_token IS NOT NULL)::text
FROM public.ms_graph_token
UNION ALL
SELECT 'ms_graph_token: última atualização', coalesce(max(updated_at)::text, '(vazio)')
FROM public.ms_graph_token
UNION ALL
SELECT 'user_route_access: total / com granted_by', count(*)::text || ' / ' || count(granted_by)::text
FROM public.user_route_access;
```

**B. Funções que existem no banco (para comparar com as migrations e achar drift)**

```sql
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private')
ORDER BY 1, 2;
```

**C. Colunas que existem no banco (para comparar com `types.ts`)**

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

**Como ler:**

- Em A, se aparecer `devs com active = false`, a coluna tem significado legado. Antes de remover, é preciso registrar a data de saída em `available_to`. Se alguma função, view, policy ou dependência aparecer, é preciso tratar o objeto antes do DROP.
- Em A, se `ms_graph_token` tiver 0 linhas com refresh token, fica confirmado que o Graph nunca funcionou.
- B e C: qualquer função ou coluna que não esteja nas migrations ou em `types.ts` indica drift (algo criado fora das migrations) e entra no inventário.
- Fora do banco: algum cliente fora do app (Power BI, planilha, script) lê a REST do Supabase? Se sim, nenhuma coluna ou tabela é "alta confiança" antes de falar com esse consumidor.

## Próximos passos sugeridos (cada um em issue própria)

1. Remover `devs.active`, depois das consultas.
2. Decidir sobre o MS Graph: abandonar (remover a cadeia, o script, `tsx`, o README e a tabela) ou manter e documentar.
3. Remover os 28 componentes shadcn sem uso e as dependências que só eles puxam.
4. Tratar o parâmetro `sprintEnd` em `compromisso/calc.ts`: remover ou implementar a intenção.
5. Refatorar as duplicações: hooks `useTeamsQuery`/`useDevsQuery`, helpers de `localStorage` e `demandasPhrase`.
6. Opcional: remover `retro-types.ts` e rebaixar os exports supérfluos.
