# Ano, busca e filtros do board na URL (issue #55): plano de implementação

**Objetivo:** `?ano=`, `?q=`, `?tipo=` e `?status=` refletem e restauram o estado do board de Alocações. F5 não perde mais o ano/filtros e dá para compartilhar um link filtrado. Valor inválido na URL cai no padrão, sem erro.

**Arquitetura:** os quatro filtros saem do `useState` do `BoardGrid` e passam a ser controlados pela rota. Um parser puro em `src/lib/board-search.ts` valida os search params; as duas rotas que renderizam o board (`/_shell/alocacoes` e `/embed/alocacoes`) usam esse parser no `validateSearch` e repassam `filters` + `onFiltersChange` ao `BoardGrid`.

## Faz sentido?

Sim, e é barato. O plano do filtro de ano (`2026-09-01-filtro-ano-alocacoes.md`) descartou a URL só por falta de necessidade e registrou que "a migração de `useState` para `validateSearch` é direta". A necessidade apareceu (F5 em 2030 volta para 2026; não dá para mandar um link "só Bugs"). De quebra o embed ganha links fixos por ano/tipo, útil em painel.

O risco conhecido de `validateSearch` (registrado em `_shell.tsx`) era específico de rota de LAYOUT, cujo esquema vazou para rotas irmãs. Aqui o esquema fica em rotas folha e todas as chaves são opcionais, então `<Link to="/alocacoes">` (guias) e o `redirect` de `_shell/index.tsx` seguem sem `search`.

## Decisões

1. **Sem `?project=` em `/alocacoes`.** O projeto é da casca (`localStorage["lastProject"]`, seletor no cabeçalho). Um `?project=` na rota folha criaria duas fontes de verdade e exigiria a folha escrever no contexto da casca. Fica fora; o embed já aceita `?project=`. Registrar na issue/PR como degradação consciente do "idealmente".
2. **Esquema** (`BoardSearch`, todas opcionais):
   - `ano?: number` — inteiro entre 2000 e 2100 (aceita string numérica `"2030"` e number); fora disso → `undefined`.
   - `q?: string` — string; vazia ou só espaços → `undefined`. Guarda o texto como digitado (sem trim no meio da digitação: o parser só descarta se `trim()` for vazio).
   - `tipo?: AllocationTipo` — só valores de `TIPO_LIST`; senão `undefined`.
   - `status?: AllocationStatus` — só valores de `STATUS_LIST`; senão `undefined`.
   - Qualquer outro tipo (array, objeto, boolean) → `undefined`. O parser nunca lança.
3. **Padrões ficam fora da URL.** "Todos" = chave ausente; busca vazia = ausente. `ano` ausente = ano corrente do relógio (resolvido no `BoardGrid`, como hoje). Ao escolher um ano no select, grava sempre `ano=<valor>` (inclusive o corrente), para o link compartilhado não "andar" na virada do ano.
4. **Escrita na URL:** `navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })`. `replace` para não poluir o histórico a cada tecla/clique. Patch com valor padrão grava `undefined` (remove a chave).
5. **Embed:** o `validateSearch` existente passa a ser `{ project, ...parseBoardSearch(search) }`. Os filtros funcionam igual.
6. **Troca de projeto continua zerando os filtros.** Hoje `key={project}` remonta o `BoardGrid` e reseta tudo (comentário em `alocacoes.tsx`). Com estado na URL a remontagem não basta: em `AlocacoesPage`, quando `project` mudar em relação ao valor anterior (ref; ignorar a montagem inicial), navegar com `search: {}` e `replace: true`. Manter `key={project}` (ainda reseta diálogos/drag).
7. **`BoardGrid` vira controlado** nos quatro filtros: novas props `filters: BoardSearch` e `onFiltersChange: (patch: Partial<BoardSearch>) => void`. Valores efetivos derivados: `search = filters.q ?? ""`, `statusFilter = filters.status ?? "todos"`, `tipoFilter = filters.tipo ?? "todos"`, `yearFilter = filters.ano ?? new Date().getFullYear()`. Os demais `useState` (diálogos, drag) ficam. Atualizar o comentário "Filtro local, sem persistência" do ano.

## Passos

1. `src/lib/board-search.ts`: tipo `BoardSearch` e `parseBoardSearch(search: Record<string, unknown>): BoardSearch`, conforme decisão 2. Comentário curto apontando a issue #55.
2. `src/components/BoardGrid.tsx`: props `filters`/`onFiltersChange`; remover os quatro `useState` de filtro; trocar os `setX(...)` por `onFiltersChange({...})` mapeando padrão → `undefined` (decisões 3 e 7).
3. `src/routes/_shell/alocacoes.tsx`: `validateSearch: parseBoardSearch`; `Route.useSearch()` + `Route.useNavigate()` (ou `useNavigate({ from: Route.fullPath })`); repassar ao `BoardGrid`; efeito de reset na troca de projeto (decisão 6); atualizar o comentário do `key`.
4. `src/routes/embed.alocacoes.tsx`: incorporar `parseBoardSearch` ao `validateSearch` e repassar filtros/navegação ao `BoardGrid`. Atualizar o docblock do arquivo.
5. `src/routes/_shell.tsx`: nada a mudar no código; só conferir que o comentário sobre `?project=` continua verdadeiro.

## Verificação

Não há framework de testes. `parseBoardSearch` é verificado com script descartável (`npx tsx`, não commitado) cobrindo: `{}` → `{}`; `ano: "2030"` → 2030; `ano: "abc" | 1999 | 2101 | 2030.5 | ["2030"]` → undefined; `q: "   "` → undefined; `q: "PIM-1"` mantém; `tipo: "bug"` ok, `tipo: "xyz"` undefined; `status: "especificada"` ok, `status: 1` undefined.

Antes do commit: `npx prettier --write` e `npx eslint` nos arquivos tocados e `npm run build` (inclui checagem de tipos das rotas; `routeTree.gen.ts` é regenerado pelo plugin, não editar à mão).

O preview local grava em produção (Supabase), então a verificação no navegador é só de leitura: abrir `/alocacoes?ano=2030&tipo=bug&status=especificada&q=pim`, conferir filtros aplicados, F5 mantém, `?ano=abc&tipo=xyz` cai no padrão sem erro no console, trocar de projeto limpa a URL.
