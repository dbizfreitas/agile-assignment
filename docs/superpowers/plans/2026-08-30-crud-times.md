# CRUD de Times no Quadro de Alocação — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quem edita o quadro passa a criar, renomear, recolorir, reordenar e excluir times por um diálogo próprio. Excluir um time com pessoas exige escolher para onde elas vão, e a movimentação + exclusão acontecem numa transação só.

**Architecture:** Uma RPC nova (`public.delete_team`) e um componente novo (`TeamsDialog`). A RPC existe porque `supabase-js` não abre transação: mover pessoas e apagar o time em duas chamadas pode deixar as pessoas movidas e o time vivo. Ela é `SECURITY DEFINER`, chamada com o client do **próprio usuário** (para `auth.uid()` resolver o ator), verifica `private.can_edit_board` explicitamente e recusa destino de outro projeto. Nenhuma tabela, coluna ou policy nova.

**Tech Stack:** PostgreSQL 15 (Supabase), TanStack Start 1.168 + React 19, TanStack Query v5, shadcn/ui (Radix Dialog/AlertDialog/Select), Tailwind 4, TypeScript 5.8 (`strict`), Node 24.

**Spec:** [`docs/superpowers/specs/2026-08-30-crud-times-design.md`](../specs/2026-08-30-crud-times-design.md)

**Issue:** [dbizfreitas/agile-assignment#14](https://github.com/dbizfreitas/agile-assignment/issues/14)

## Global Constraints

- **Idioma da UI:** pt-BR em todo texto visível, com acentuação correta.
- **`jira_project` NUNCA entra em payload de `UPDATE` de `teams`.** A restrição da issue ("não é possível mover um time para outro projeto") é cumprida por **ausência de campo**, não por validação. Se alguma task parecer precisar de um campo de projeto no formulário, parar e revisar a spec.
- **A RPC é chamada com `supabase` (client do usuário autenticado)**, nunca com um client `service_role` — é isso que faz `auth.uid()` resolver dentro da função. Chamar de outro jeito faz a RPC levantar `W4001`.
- **Nenhuma tabela nova, nenhuma coluna nova, nenhuma policy nova.** As policies `teams_*_editors` e `devs_update_editors` já existem e cobrem o caminho direto.
- **A chave de cache é `["board", "teams", project]`** — a MESMA já usada por `BoardGrid` e `DevDialog`. Não criar chave nova.
- **Migrations são aplicadas MANUALMENTE pelo usuário, no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr`** (`https://supabase.com/dashboard/project/nuvrdppxecbowxopbqcr/sql/new`) — é o projeto real, o mesmo do `.env`/`supabase/config.toml`. **A ferramenta MCP `query_database` do Lovable NÃO deve ser usada** para aplicar ou verificar: ela aponta para outro banco Postgres (confirmado na issue #23). O agente cria o `.sql`, pede ao usuário para colar no SQL Editor e **aguarda confirmação explícita** ("apliquei, deu sucesso" ou a mensagem de erro) antes de qualquer step dependente do schema.
- **`src/integrations/supabase/types.ts` é editado à mão** — mesma convenção de `invitations`, `role_audit_log`, `delete_platform_user`.
- **Sem test runner.** Verificação: smoke SQL (em `BEGIN…ROLLBACK`, sem resíduo) para o banco; `prettier`/`eslint`/`tsc` para o TypeScript; roteiro manual para a UI.
- **Não fazer `git push`.** O repositório sincroniza com o Lovable; o push é decisão do usuário ao final.
- **Nunca reescrever histórico** (sem `rebase`, `amend` ou `squash` de commits publicados) — restrição do `AGENTS.md`.
- **Não commitar `src/routeTree.gen.ts` nem `src/components/compromisso/StatsCards.tsx`.** Já chegam modificados no working tree e não são desta frente. Todo `git add` é por caminho explícito, **nunca** `git add -A`.
- **Mensagens de commit em ASCII** (sem acentos), seguindo o padrão dos commits recentes.

### Verificação de código: sempre nesta ordem, só nos arquivos tocados

```bash
npx prettier --write <arquivos tocados>
```

```bash
npx eslint <arquivos tocados>
```

```bash
npx tsc --noEmit
```

**Nunca rodar `npm run lint` sem escopo** — o checkout usa `core.autocrlf=true`, então arquivos não tocados por esta demanda reprovam a regra `prettier/prettier` por causa de CRLF pré-existente.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `supabase/migrations/20260830120000_team_delete_rpc.sql` | **Criar.** `public.delete_team(uuid, uuid)` + `REVOKE`/`GRANT`. | 1 |
| `supabase/tests/team_delete_smoke.sql` | **Criar.** Suíte em `BEGIN…ROLLBACK`, 6 seções. | 1 |
| `src/integrations/supabase/types.ts` | **Modificar.** `Functions.delete_team`. | 1 |
| `src/lib/board-errors.ts` | **Modificar.** `W4001`–`W4006` e `devs_team_id_fkey`. | 2 |
| `src/components/TeamsDialog.tsx` | **Criar.** Lista, criação, edição, reordenação (Task 3); exclusão (Task 4). | 3, 4 |
| `src/components/BoardGrid.tsx` | **Modificar.** Botão `Times` + estado do diálogo. | 5 |

`src/components/DevDialog.tsx` **não muda** — o `+ Criar novo time` de lá permanece como está (ver spec, "Superfície de UI").

---

## Task 1: Banco — RPC `delete_team` e suíte de verificação

**Files:**
- Create: `supabase/migrations/20260830120000_team_delete_rpc.sql`
- Create: `supabase/tests/team_delete_smoke.sql`
- Modify: `src/integrations/supabase/types.ts` (1 ponto)

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: RPC `public.delete_team(_team uuid, _target uuid DEFAULT NULL) RETURNS void`, chamável de `supabase.rpc("delete_team", { _team: string, _target: string | null })`. Levanta `W4001`…`W4006`.

- [ ] **Step 1: Criar a migration da RPC**

Arquivo `supabase/migrations/20260830120000_team_delete_rpc.sql`:

```sql
-- Exclusão de time com realocação explícita das pessoas (issue #14).
--
-- Por que uma RPC e não duas chamadas do supabase-js: mover as pessoas e
-- apagar o time PRECISAM estar na mesma transação. Em duas chamadas, uma
-- falha na segunda deixa as pessoas já movidas e o time vivo — e como teams é
-- a raiz do eixo de colunas do quadro, isso é estado silenciosamente errado,
-- sem nada na tela para denunciá-lo.
--
-- SECURITY DEFINER com verificação explícita de permissão (mesmo padrão de
-- public.delete_platform_user): a função é chamada com o client do PRÓPRIO
-- usuário, para auth.uid() resolver o ator. As policies teams_delete_editors
-- e devs_update_editors permanecem, cobrindo o caminho direto.
CREATE OR REPLACE FUNCTION public.delete_team(_team uuid, _target uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_project text;
  v_target_project text;
  v_people int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida' USING ERRCODE = 'W4001';
  END IF;

  IF NOT private.can_edit_board(v_actor) THEN
    RAISE EXCEPTION 'Sem permissao' USING ERRCODE = 'W4002';
  END IF;

  -- Trava as duas linhas de uma vez e SEMPRE na mesma ordem (por id). Sem o
  -- ORDER BY, duas exclusoes cruzadas simultaneas (A->B e B->A) travariam em
  -- ordem oposta e produziriam deadlock.
  PERFORM 1 FROM public.teams
   WHERE id IN (_team, _target)
   ORDER BY id
     FOR UPDATE;

  SELECT jira_project INTO v_project FROM public.teams WHERE id = _team;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'Time nao encontrado' USING ERRCODE = 'W4003';
  END IF;

  SELECT count(*) INTO v_people FROM public.devs WHERE team_id = _team;

  IF v_people > 0 THEN
    IF _target IS NULL THEN
      RAISE EXCEPTION 'Time com pessoas exige destino' USING ERRCODE = 'W4004';
    END IF;

    IF _target = _team THEN
      RAISE EXCEPTION 'Destino igual a origem' USING ERRCODE = 'W4005';
    END IF;

    SELECT jira_project INTO v_target_project FROM public.teams WHERE id = _target;
    IF v_target_project IS NULL THEN
      RAISE EXCEPTION 'Time de destino nao encontrado' USING ERRCODE = 'W4003';
    END IF;

    -- A ultima palavra continua sendo devs_team_project_fkey; esta checagem
    -- existe para a violacao virar um codigo com mensagem propria em vez de
    -- um 23503 cru, e para fechar a invariante no servidor — a tela ja a
    -- fecha por cima oferecendo so times do mesmo projeto.
    IF v_target_project IS DISTINCT FROM v_project THEN
      RAISE EXCEPTION 'Destino em outro projeto' USING ERRCODE = 'W4006';
    END IF;

    -- Redispara devs_set_project, que recalcula jira_project a partir do novo
    -- time. Origem e destino sao do mesmo projeto, entao o valor nao muda.
    -- allocations nao e tocada: os cartoes seguem a PESSOA, nao o time.
    UPDATE public.devs SET team_id = _target WHERE team_id = _team;
  END IF;

  DELETE FROM public.teams WHERE id = _team;

  -- Renumeracao (a): pessoas realocadas chegam ao destino com as position que
  -- tinham na origem e colidem com as de la; duas pessoas com position = 0
  -- ficam em ordem indefinida e a coluna dança entre recargas.
  IF v_people > 0 AND _target IS NOT NULL THEN
    WITH ord AS (
      SELECT id, (row_number() OVER (ORDER BY position, name)) - 1 AS pos
        FROM public.devs WHERE team_id = _target
    )
    UPDATE public.devs d SET position = ord.pos
      FROM ord
     WHERE d.id = ord.id AND d.position IS DISTINCT FROM ord.pos;
  END IF;

  -- Renumeracao (b): a exclusao abre um buraco na sequencia de position dos
  -- times do projeto, e a proxima insercao usa `position: teams.length`.
  WITH ord AS (
    SELECT id, (row_number() OVER (ORDER BY position, name)) - 1 AS pos
      FROM public.teams WHERE jira_project = v_project
  )
  UPDATE public.teams t SET position = ord.pos
    FROM ord
   WHERE t.id = ord.id AND t.position IS DISTINCT FROM ord.pos;
END $$;

REVOKE ALL ON FUNCTION public.delete_team(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_team(uuid, uuid) TO authenticated, service_role;
```

- [ ] **Step 2: Criar a suíte de smoke**

Arquivo `supabase/tests/team_delete_smoke.sql`. Envolver tudo em `BEGIN; … ROLLBACK;` para não deixar resíduo. Seções, cada uma com `RAISE NOTICE` do resultado e `ASSERT` do esperado:

1. **Setup:** dois times `_SMOKE_A_` e `_SMOKE_B_` em `jira_project = 'PIM'`, mais um time `_SMOKE_C_` em `'PH'`; duas pessoas em A (`position` 0 e 1) e uma em B (`position` 0).
2. **Time vazio:** criar `_SMOKE_D_` sem gente, `delete_team(D, NULL)`, conferir que sumiu.
3. **Realocação:** `delete_team(A, B)` → A não existe mais, as duas pessoas de A estão em B, B tem 3 pessoas com `position` 0/1/2 sem repetição, e `jira_project` das três é `'PIM'`.
4. **`W4004`:** `delete_team(B, NULL)` com B povoado → capturar a exceção e conferir `SQLSTATE = 'W4004'`; conferir que B continua existindo.
5. **`W4006`:** `delete_team(B, C)` (C é do PH) → `SQLSTATE = 'W4006'`.
6. **`W4002`:** rodar como um usuário sem papel de edição → `SQLSTATE = 'W4002'`. Se simular o ator no SQL Editor for inviável, substituir por uma verificação direta de que `private.can_edit_board` retorna `false` para um uuid sem papel, **e deixar isso anotado no cabeçalho do arquivo**.

Usar `set_config('request.jwt.claims', …)` para o ator quando necessário; se não funcionar no SQL Editor, seguir a nota da seção 6.

- [ ] **Step 3: Pedir ao usuário para aplicar a migration**

Mostrar o caminho do arquivo e o link do SQL Editor. **Parar e aguardar confirmação explícita.** Não seguir para o Step 4 antes disso. Se o usuário reportar erro, corrigir o `.sql` e pedir nova aplicação.

- [ ] **Step 4: Pedir ao usuário para rodar a suíte de smoke**

Mesma coisa: colar `supabase/tests/team_delete_smoke.sql` no SQL Editor e reportar a saída. Aguardar confirmação de que as 6 seções passaram.

- [ ] **Step 5: Declarar a RPC em `types.ts`**

Em `Functions`, mantendo a ordem alfabética (entre `create_invitation` e `delete_platform_user`):

```ts
      delete_team: {
        Args: { _team: string; _target?: string | null };
        Returns: undefined;
      };
```

- [ ] **Step 6: Verificar**

```bash
npx prettier --write src/integrations/supabase/types.ts
```

```bash
npx eslint src/integrations/supabase/types.ts
```

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

`git add` explícito nos três arquivos. Mensagem: `feat(board): rpc delete_team com realocacao de pessoas`

---

## Task 2: Mensagens de erro em pt-BR

**Files:**
- Modify: `src/lib/board-errors.ts`

**Interfaces:**
- Consumes: os `ERRCODE` da Task 1.
- Produces: `boardErrorMessage` traduzindo `W4001`–`W4006` e o `23503` de `devs_team_id_fkey`.

- [ ] **Step 1: Acrescentar os códigos `W4xxx`**

Logo depois do bloco de `W3001`, seguindo o mesmo estilo de comentário do arquivo (explicar *por que* o código existe, não repetir o que ele faz):

```ts
// W4xxx: public.delete_team. Os três primeiros são alcançáveis pela tela
// (sessão que expirou, papel revogado no meio do caminho, dado velho); os
// três últimos não são — o Select só oferece times do mesmo projeto e o botão
// fica desabilitado sem destino. Existem porque a RPC é SECURITY DEFINER e
// precisa se defender de um cliente desatualizado ou de uma chamada direta.
const TEAM_CODES: Record<string, string> = {
  W4001: "Sessão expirada. Entre novamente.",
  W4002: "Você não tem permissão para excluir times.",
  W4003: "Time não encontrado. Recarregue a página.",
  W4004: "Escolha para qual time as pessoas devem ir.",
  W4005: "O time de destino precisa ser diferente do time excluído.",
  W4006: "O time de destino precisa ser do mesmo projeto.",
};
```

E dentro de `boardErrorMessage`, antes do bloco de `23503`:

```ts
  if (code && TEAM_CODES[code]) return TEAM_CODES[code];
```

- [ ] **Step 2: Acrescentar `devs_team_id_fkey` a `FK_MESSAGES`**

```ts
  {
    constraint: "devs_team_id_fkey",
    message: "Este time tem pessoas; escolha para qual time elas devem ir antes de excluí-lo.",
  },
```

Comentário de uma linha explicando que esse caminho é o `.delete()` direto em `teams` (a RPC nunca chega aqui, porque valida antes).

- [ ] **Step 3: Verificar**

```bash
npx prettier --write src/lib/board-errors.ts
```

```bash
npx eslint src/lib/board-errors.ts
```

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

Mensagem: `feat(board): mensagens pt-BR para os erros de exclusao de time`

---

## Task 3: `TeamsDialog` — listar, criar, editar, reordenar

**Files:**
- Create: `src/components/TeamsDialog.tsx`

**Interfaces:**
- Consumes: `Team` e `TEAM_COLORS` de `@/lib/board`; `boardErrorMessage` da Task 2; `JiraProjectKey` de `@/lib/projects`.
- Produces:
  ```ts
  export function TeamsDialog({
    open,
    project,
    onOpenChange,
  }: {
    open: boolean;
    project: JiraProjectKey;
    onOpenChange: (open: boolean) => void;
  }): JSX.Element
  ```

**Referência de estilo:** `src/components/SprintDialog.tsx` e `src/components/DevDialog.tsx` — mesmas importações de `@/components/ui/*`, mesmo uso de `useMutation`/`useQueryClient`, mesmo `onError: (e: Error) => toast.error(boardErrorMessage(e))`.

- [ ] **Step 1: Queries**

Duas queries, ambas com a chave já existente:

```ts
const teamsQ = useQuery({
  queryKey: ["board", "teams", project],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("teams").select("*").eq("jira_project", project).order("position");
    if (error) throw error;
    return data as Team[];
  },
});
```

E a contagem de pessoas por time — reusar `["board", "devs", project]` (mesma chave do `BoardGrid`) selecionando `id, name, team_id`, e derivar a contagem com `useMemo`. **Não** criar uma query de agregação nova: a chave já está no cache quando o diálogo abre.

Comentar no código *por que* as chaves são as mesmas (o comentário de [DevDialog.tsx:57](../../../src/components/DevDialog.tsx#L57) é o precedente).

- [ ] **Step 2: Estado local**

```ts
const [editing, setEditing] = useState<string | null>(null); // team.id, ou "__new__"
const [draftName, setDraftName] = useState("");
const [draftColor, setDraftColor] = useState(TEAM_COLORS[0]!);
```

`useEffect` limpando tudo quando `open` vira `false` — mesmo padrão dos outros diálogos.

- [ ] **Step 3: Lista**

`Dialog` com `DialogContent className="sm:max-w-md"`, título `Times · {project}` (o projeto como texto, não como campo — mesmo racional do `SprintDialog`).

Cada linha: bolinha de cor (`size-2.5 rounded-full`, `style={{ backgroundColor: t.color }}`), nome, `{n} pessoa(s)` em `text-xs text-muted-foreground`, e à direita quatro botões `variant="ghost" size="icon"`: `ChevronUp`, `ChevronDown`, `Pencil`, `Trash2` (todos de `lucide-react`, já dependência). `aria-label` em pt-BR em cada um. `ChevronUp` desabilitado no primeiro, `ChevronDown` no último.

Estado vazio: `Nenhum time cadastrado no {project} ainda.`

- [ ] **Step 4: Formulário de criação/edição**

Quando `editing !== null`, a linha correspondente é **substituída** pelo formulário (ou ele aparece no fim da lista, quando `editing === "__new__"`): `Input` de nome + a paleta `TEAM_COLORS` (copiar o bloco de botões de cor do `DevDialog`, incluindo o `ring-2 ring-ring ring-offset-2` do selecionado) + `Salvar`/`Cancelar`. Sem `Dialog` aninhado.

Mutation:

```ts
const save = useMutation({
  mutationFn: async () => {
    const payload = { name: draftName.trim(), color: draftColor };
    // jira_project NÃO entra no payload de update: é o que impede mover um
    // time entre projetos. No insert ele é obrigatório (teams é raiz do eixo
    // e a coluna não tem DEFAULT).
    const res = editing === NEW_TEAM
      ? await supabase.from("teams").insert({ ...payload, position: teams.length, jira_project: project })
      : await supabase.from("teams").update(payload).eq("id", editing!);
    if (res.error) throw res.error;
  },
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ["board", "teams"] });
    setEditing(null);
  },
  onError: (e: Error) => toast.error(boardErrorMessage(e)),
});
```

`Salvar` desabilitado com nome vazio ou `save.isPending`.

- [ ] **Step 5: Reordenação**

Mutation `reorder` recebendo `{ id, dir }`, trocando `position` com o vizinho — duas chamadas `update`, sequenciais, cada uma com seu `error` checado. Não há `UNIQUE` em `(jira_project, position)`, então a troca direta não colide.

Invalida `["board", "teams"]`. Comentar no código por que são setas e não drag-and-drop (spec, "Superfície de UI").

- [ ] **Step 6: Verificar**

```bash
npx prettier --write src/components/TeamsDialog.tsx
```

```bash
npx eslint src/components/TeamsDialog.tsx
```

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

Mensagem: `feat(board): dialogo de times com criacao, edicao e reordenacao`

---

## Task 4: Exclusão com realocação

**Files:**
- Modify: `src/components/TeamsDialog.tsx`

**Interfaces:**
- Consumes: a RPC `delete_team` da Task 1; a lista de pessoas já carregada na Task 3.
- Produces: nada de novo para fora.

- [ ] **Step 1: Estado da confirmação**

```ts
const [removing, setRemoving] = useState<Team | null>(null);
const [moveTo, setMoveTo] = useState<string>("");
```

Ao abrir a confirmação, pré-selecionar o destino: o time do projeto chamado `Sem time`, se existir; senão o primeiro time da lista que não seja o que está sendo excluído. Se não houver nenhum outro time, `moveTo` fica `""`.

- [ ] **Step 2: `AlertDialog`**

Mesmo padrão de [UserTable.tsx:285](../../../src/components/admin/UserTable.tsx#L285). Três casos, decididos pela contagem de pessoas do time e pela existência de outro time no projeto:

| Caso | Corpo | Botão `Excluir` |
|---|---|---|
| Sem pessoas | `O time "X" será excluído.` | habilitado |
| Com pessoas, há outro time | `Select` obrigatório: `Mover as N pessoas para:` listando os outros times do projeto por `position`, com bolinha de cor (copiar o `SelectItem` do `DevDialog`) | habilitado só com `moveTo` preenchido |
| Com pessoas, é o único time | `Este é o único time do {project} e tem N pessoas. Crie outro time para movê-las antes de excluir.` | **desabilitado** |

Confirmação simples, **não nominal**: nenhum dado é destruído além do time — as pessoas mudam de time e os cartões nem são tocados. Registrar isso num comentário, para o próximo leitor não "consertar" a divergência com o `UserTable`.

- [ ] **Step 3: Mutation**

```ts
const remove = useMutation({
  mutationFn: async () => {
    if (!removing) return;
    // RPC e não .delete(): mover as pessoas e apagar o time precisam estar na
    // mesma transação. Ver a spec, "Decisão central".
    const { error } = await supabase.rpc("delete_team", {
      _team: removing.id,
      _target: moveTo || null,
    });
    if (error) throw error;
  },
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ["board", "teams"] });
    qc.invalidateQueries({ queryKey: ["board", "devs"] });
    setRemoving(null);
  },
  onError: (e: Error) => toast.error(boardErrorMessage(e)),
});
```

As duas invalidações são obrigatórias: a RPC mexe em `devs.team_id` **e** em `devs.position`.

- [ ] **Step 4: Verificar**

```bash
npx prettier --write src/components/TeamsDialog.tsx
```

```bash
npx eslint src/components/TeamsDialog.tsx
```

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

Mensagem: `feat(board): exclusao de time com realocacao das pessoas`

---

## Task 5: Fiação no `BoardGrid` e roteiro manual

**Files:**
- Modify: `src/components/BoardGrid.tsx`

**Interfaces:**
- Consumes: `TeamsDialog` da Task 3/4.
- Produces: o botão `Times` na toolbar.

- [ ] **Step 1: Estado e botão**

`const [teamsDialog, setTeamsDialog] = useState(false);`

Na toolbar, dentro do bloco `canEdit ? (…) : null` que já existe (por volta de [BoardGrid.tsx:215](../../../src/components/BoardGrid.tsx#L215)), um terceiro botão com o mesmo `size="sm" variant="secondary"`, ícone `Users` do `lucide-react`, texto `Times`. Colocá-lo **antes** de `Sprint` e `Pessoa` — é a raiz do eixo de colunas, e a ordem na toolbar espelha a hierarquia dos dados.

- [ ] **Step 2: Renderizar o diálogo**

Junto dos outros três (`AllocationDialog`, `DevDialog`, `SprintDialog`), por volta de [BoardGrid.tsx:387](../../../src/components/BoardGrid.tsx#L387):

```tsx
<TeamsDialog open={teamsDialog} project={project} onOpenChange={setTeamsDialog} />
```

- [ ] **Step 3: Verificar**

```bash
npx prettier --write src/components/BoardGrid.tsx
```

```bash
npx eslint src/components/BoardGrid.tsx
```

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Roteiro manual**

Pedir ao usuário para rodar `npm run dev`, abrir `/alocacoes` e conferir, na ordem — reportando qualquer divergência:

1. `Times` aparece na toolbar (e **não** aparece para um usuário `viewer`).
2. Criar um time; ele aparece no seletor do `DevDialog`.
3. Renomear um time que tenha pessoas → o nome muda no cabeçalho das colunas **sem recarregar a página**.
4. Trocar a cor → o avatar e a borda inferior do cabeçalho mudam.
5. `↑`/`↓` reordenam, e a ordem das colunas de pessoas acompanha.
6. Excluir um time vazio → some da lista e do seletor do `DevDialog`.
7. Excluir um time com pessoas escolhendo destino → o time some e as pessoas aparecem sob o time de destino, com os cartões delas intactos.
8. Trocar de projeto no seletor → o diálogo lista só os times do novo projeto.

- [ ] **Step 5: Commit**

Mensagem: `feat(board): botao Times na toolbar do quadro`

---

## Task 6: Fechamento

- [ ] **Step 1: Conferir o diff completo**

```bash
git status --short
```

`src/routeTree.gen.ts` e `src/components/compromisso/StatsCards.tsx` devem continuar como `M` **não commitados**. Se tiverem entrado em algum commit, parar e avisar o usuário.

- [ ] **Step 2: Conferir os critérios de aceite da issue #14**

Marcar um a um contra o que foi verificado no roteiro manual da Task 5. Reportar ao usuário, sem alegar nada que não tenha sido observado.

- [ ] **Step 3: Não fazer push**

Informar o usuário de que os commits estão locais e o push é decisão dele.
