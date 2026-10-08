# Saneamento do código (issue #19): plano da análise

**Objetivo:** Inventário de código morto ou possivelmente morto, com evidências e nível de confiança, mais uma análise detalhada de `devs.active`. **Esta etapa não altera código** (regra da issue). As remoções viram issues ou PRs separados, depois de aprovadas.

**Arquitetura:** A análise junta três fontes de evidência: ferramentas estáticas (`tsc`, `eslint`, um detector de exports e arquivos órfãos), buscas dirigidas (`grep` em `src/`, `supabase/migrations/`, `supabase/tests/` e `scripts/`) e consultas read-only no banco de produção pelo SQL Editor. O resultado é um único relatório em `docs/saneamento/2026-10-08-inventario.md`.

## Decisões

1. **Entregável:** `docs/saneamento/2026-10-08-inventario.md`, com a tabela pedida na issue (Item | Localização | Tipo | Evidência | Dependências/Impactos | Confiança | Recomendação), uma seção separada para `devs.active` (os 9 pontos da issue) e, por último, as propostas de saneamento só para os itens de **alta confiança**, com arquivo, linha e migration exatos.
2. **Nada é removido neste PR.** O PR leva só o relatório e este plano. Cada remoção aprovada vira uma issue própria, porque cada uma tem risco e verificação diferentes (front, migration, dependência).
3. **Fonte da verdade do banco é produção, só leitura.** As migrations são aplicadas à mão pelo SQL Editor, e o localhost grava em produção. Por isso as consultas ao banco são só `SELECT`, e eu as entrego para o Diego rodar. Nenhum `ALTER` ou `DROP` sai desta etapa.
4. **Ferramenta para exports e arquivos órfãos:** `knip` via `npx`, sem instalar no `package.json`. É download de pacote, então peço autorização antes de rodar. Se não houver autorização, o fallback é `tsc --noUnusedLocals --noUnusedParameters` mais `grep` por export, que é mais lento e acha menos.
5. **Escopo excluído:** `src/components/ui/*` (componentes shadcn gerados) e `src/routeTree.gen.ts` / `src/integrations/supabase/types.ts` (arquivos gerados). Os componentes shadcn não usados entram como **um** item agregado de baixa prioridade, com as dependências `@radix-ui/*` que só eles puxam, e não como dezenas de linhas.
6. **Confiança:** alta = sem referência no código, nos testes SQL, nas migrations (funções, views, policies, triggers) e sem consumidor externo plausível. Média = sem referência interna, mas acessível de fora (REST do Supabase via PostgREST, RPC exposta, rota pública como `/embed/alocacoes`). Baixa = indício ambíguo (acesso dinâmico, `select("*")`, string montada).
7. **`select("*")` conta como leitura indireta.** `BoardGrid.tsx:196` e `TeamsDialog.tsx:73` leem todas as colunas de `devs`. Por isso, uma coluna sem uso nominal ainda chega ao cliente, e a remoção precisa conferir que nenhum spread ou serialização depende dela.

## Achados preliminares sobre `devs.active` (a confirmar no Passo 2)

- Criada em `supabase/migrations/20260801002005_…sql:9` como `active boolean NOT NULL DEFAULT true`, no primeiro schema (remix inicial do Lovable).
- Nenhum `UPDATE` ou `INSERT` grava o campo: `DevDialog.tsx:150-168` monta o payload sem `active`, e `use-reorder-devs.ts` só grava `position`.
- Nenhum filtro lê o campo: as consultas de `devs` filtram por `jira_project` e ordenam por `position, name`. O tipo `Dev` em `src/lib/board.ts:25` declara `active: boolean`, mas nenhum componente lê `dev.active`.
- O mecanismo que faz esse papel hoje é a janela de disponibilidade (`available_from` / `available_to`, migration `20260815120000_devs_availability_window.sql`, issue #2).
- Os `active` em `security_invariants_*` e `provision_sso_user` são de `cron.job.active`, não de `devs`.
- **Em aberto:** se existem linhas com `active = false` em produção (dado legado com significado), e se algo fora do app (Power BI, planilha, script) lê `devs` pela API REST.

## Passos

1. **Linha de base.** `git switch -c chore/saneamento-inventario-19`. Rodar `npm run build` e `npm run lint` para registrar o estado atual (erros que já existem não entram como achado).

2. **`devs.active`, código.** Confirmar os achados preliminares com:

   ```bash
   grep -rnw "active" src supabase scripts --include=*.ts --include=*.tsx --include=*.sql
   grep -rn "\.active\b\|\[\"active\"\]\|'active'" src
   grep -rn "devs" supabase/migrations supabase/tests | grep -iE "function|view|trigger|policy|select"
   ```

   Para cada função, view ou trigger que toca `devs`, ler o corpo e confirmar que não usa `active`. Registrar `git log -S"active" -- supabase src` para datar a origem e verificar se alguma vez houve UI de "inativar pessoa".

3. **`devs.active`, banco.** Entregar ao Diego, para rodar no SQL Editor (read-only):

   ```sql
   -- distribuição do valor
   SELECT active, count(*) FROM public.devs GROUP BY active;
   -- quem está inativo, se houver
   SELECT id, name, jira_project, available_from, available_to FROM public.devs WHERE NOT active;
   -- objetos do banco que citam a coluna
   SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosrc ~* '\mactive\M' AND n.nspname IN ('public','private');
   SELECT schemaname, viewname FROM pg_views WHERE definition ~* 'devs' AND definition ~* '\mactive\M';
   SELECT tablename, policyname FROM pg_policies WHERE tablename = 'devs' AND (qual ~* 'active' OR with_check ~* 'active');
   ```

   Se existir alguma pessoa com `active = false`, o campo **tem** significado legado: a recomendação passa a ser migrar esse estado para `available_to` antes de qualquer remoção.

4. **`devs.active`, relatório.** Escrever a seção com os 9 pontos da issue. O plano de remoção, se aprovado, tem quatro partes: (a) tirar `active` do tipo `Dev` em `src/lib/board.ts`; (b) criar a migration `ALTER TABLE public.devs DROP COLUMN active;`, aplicada pelo SQL Editor **depois** do deploy do front; (c) regenerar `src/integrations/supabase/types.ts`; (d) avisar quem consome a REST. Risco esperado: baixo, condicionado ao Passo 3.

5. **Varredura TypeScript.**

   ```bash
   npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p tsconfig.json
   npx eslint . --rule "@typescript-eslint/no-unused-vars: error"
   npx knip --reporter compact   # após autorização (Decisão 4)
   ```

   Triar cada achado: exports sem import, arquivos órfãos, hooks e utilitários sem chamador (por exemplo, conferir `src/hooks/use-mobile.tsx`, `src/lib/lovable-error-reporting.ts` e `src/lib/error-page.ts`), e imports sem uso. Exports usados só em `routeTree.gen.ts` ou pelo roteador por convenção de arquivo (`Route`) **não** são mortos.

6. **Dependências.** Usar a saída de dependências do `knip` ou, no fallback, `grep -rn "from \"<pacote>\"" src` para cada item de `dependencies`. Candidatos prováveis: `embla-carousel-react`, `input-otp`, `react-resizable-panels`, `cmdk` e `@radix-ui/*` usados só em `components/ui/*` não importados. Conferir também `devDependencies` e `vite.config.ts` (plugins).

7. **Rotas e endpoints.** Para cada arquivo em `src/routes/`, conferir se há `<Link to>` ou `navigate` apontando para ele, ou se ele é ponto de entrada externo (`aceitar-convite`, `auth.callback`, `embed.alocacoes`: links de e-mail, OAuth e iframe, então nunca alta confiança). Para server functions em `*.server.ts` e `createServerFn`, conferir os chamadores.

8. **Banco.** Listar RPCs e funções de `public` e `private` e cruzar com `supabase.rpc("…")` em `src/` e com os testes em `supabase/tests/`. Listar colunas de todas as tabelas (`information_schema.columns`, query read-only para o Diego) e cruzar com o código. Marcar migrations de "fix" e "restore" sobrepostas (por exemplo, `route_access_fix_*`, `restore_*_revokes`) apenas como **histórico**: migrations aplicadas não são removidas.

9. **Comentários e flags.** Usar `grep -rnE "^\s*//.*(\(|;|=>)" src` para achar código comentado, e `grep -rn "TODO\|FIXME\|deprecated\|legacy\|obsolet" src supabase`. Também `grep -rn "import.meta.env\|process.env" src` cruzado com `.env` (o `.env` é versionado, e removê-lo quebra o preview do Lovable, então só se reporta a variável não usada e o arquivo continua no repo).

10. **Relatório e PR.** Consolidar tudo em `docs/saneamento/2026-10-08-inventario.md`, ordenado por confiança (alta primeiro). Rodar `prettier --write` no `.md`, commitar com `docs(saneamento): inventário de código morto (#19)` e abrir o PR. Se o relatório trouxer dados de produção (nomes de pessoas no Passo 3), tirar os nomes e deixar só as contagens antes de commitar.

## Verificação

- Não há framework de testes. Como o PR só adiciona `.md`, `npm run build` e `npm run lint` precisam dar o mesmo resultado da linha de base do Passo 1.
- Cada linha da tabela tem uma evidência reproduzível: comando, `arquivo:linha` ou query.
- Nenhum item está marcado como alta confiança se for acessível pela REST, por RPC ou por rota pública sem consumidor confirmado.
