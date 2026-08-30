# Exclusão de usuário pela tela /admin (issue #11)

**Data:** 2026-08-29
**Status:** aprovado para planejamento
**Issue:** [dbizfreitas/agile-assignment#11](https://github.com/dbizfreitas/agile-assignment/issues/11)

## Problema

A tela `/admin` concede papel e rotas, mas não tem caminho de saída: um usuário
que entrou uma vez fica na lista para sempre. Contas de teste, pessoas que
saíram do time e acessos indevidos se acumulam sem forma de limpeza.

**Achado que muda o ponto de partida da issue:** metade do "soft delete" que a
issue recomendava **já existe**. O `Select` de papel tem a opção "Sem acesso", e
desde `20260828134000_route_access_fix_read_requires_role.sql` o
`set_user_role(_target, NULL)` apaga o papel **e** as rotas, com auditoria
(`revoke` + `route_revoke`). Quem está nesse estado não lê nada sob RLS nem
passa nas server functions do Jira.

Ou seja: o problema real não é "revogar acesso" — isso está resolvido. É
**sumir da lista**. Um soft delete novo seria uma terceira grafia do mesmo
estado ("sem papel", "inativo", "excluído"), com o custo de ensinar a diferença
entre elas a quem usa a tela. A exclusão física é o que falta.

## Objetivo

Dar ao administrador uma ação de exclusão em `/admin` que remove o usuário da
plataforma de verdade — some da lista, perde todo acesso — sem quebrar o
histórico de auditoria e sem deixar caminho de retorno silencioso.

## Escopo

**Dentro:** RPC de exclusão com as invariantes no banco, server function com
`service_role` para apagar de `auth.users`, ação e diálogo de confirmação na
tabela de `/admin`, evento `delete` na auditoria, suíte smoke SQL.

**Fora (decidido explicitamente):**

- **Lista de bloqueio / banimento permanente.** A exclusão é um **reset**, não
  um banimento — ver "Decisão 3" abaixo.
- **Soft delete / coluna de "inativo" / filtro "ver inativos".** O estado
  "sem papel" já cumpre esse papel e continua disponível no mesmo `Select`.
  Duas semânticas de desativação na mesma tela é confusão, não recurso.
- **Exclusão em massa / seleção múltipla.** Os critérios de aceite falam de um
  usuário por vez, e cada exclusão pede confirmação nominal.
- **Retenção/expurgo do `role_audit_log`.** O histórico do usuário excluído
  permanece — é o que torna a exclusão auditável. Retenção é a
  [#28](https://github.com/dbizfreitas/agile-assignment/issues/28).
- **Provisionamento automático via SSO.** Continua sendo a
  [#3](https://github.com/dbizfreitas/agile-assignment/issues/3). Esta demanda
  só registra qual comportamento a #3 deve ter para um usuário já excluído.

## Princípios

Os mesmos do RBAC existente
(`docs/superpowers/specs/2026-08-08-admin-rbac-design.md`): autorização no
servidor, invariantes no Postgres, deny by default, ator não forjável
(`auth.uid()`), auditoria inescapável via trigger.

---

## As três decisões pendentes da issue

### Decisão 1 — Exclusão física, não soft delete

**Física.** A justificativa da issue para o soft delete era o risco de quebrar
relatórios passados por alocações órfãs. Esse risco **não existe neste
schema**: `public.devs` é um cadastro próprio (`name`, `initials`, `color`,
`position`, `active`) sem nenhuma referência a `auth.users`, e
`allocations.dev_id` aponta para `devs`, não para o usuário da plataforma.
Nenhuma alocação, sprint, time ou relatório referencia a conta excluída.

O único dado que referencia `auth.users` é o `role_audit_log`, por
`target_user_id`/`target_email` — e esse par não tem FK justamente para
sobreviver à exclusão da conta. O `target_email` continua gravado, então o
histórico segue legível depois de a conta sumir.

### Decisão 2 — Alocações do usuário excluído: não se aplica

Consequência direta da Decisão 1: não há vínculo entre conta de plataforma e
pessoa alocada. Nada a bloquear, nada a preservar. As issues
[#5](https://github.com/dbizfreitas/agile-assignment/issues/5) e
[#9](https://github.com/dbizfreitas/agile-assignment/issues/9) não são afetadas.

### Decisão 3 — Retorno via SSO: reset, não banimento

A exclusão remove o acesso atual; não impede o recadastro futuro.

- **Hoje:** `handle_new_user()` só concede papel se achar um convite pendente
  para o e-mail. Um excluído que logar via SSO reaparece na lista **sem papel
  nenhum** — não lê nada. Para voltar a ter acesso, precisa de um convite novo.
- **Depois da #3:** o login devolve o papel padrão `leitor` e a rota
  `alocacoes`, e o administrador reconcede o resto manualmente.

Nenhuma lista de bloqueio é criada. A alternativa (guardar o e-mail do excluído
para recusá-lo no `handle_new_user`) foi descartada: reter indefinidamente o
e-mail de quem foi excluído para negar-lhe acesso é o oposto do que "excluir"
comunica, e a reconcessão manual já dá ao administrador o controle que ele
precisa.

---

## Fluxo da exclusão

A operação tem duas metades em sistemas diferentes — Postgres (papel, rotas,
convites, auditoria) e GoTrue (`auth.users`) — e **a ordem entre elas não pode
ser invertida**.

```
UserTable  →  server fn deleteUser
                 ├─ 1. assertAdmin(client do usuário, sob RLS)
                 ├─ 2. rpc delete_platform_user  ← client do PRÓPRIO usuário
                 │       (invariantes + revogação + auditoria, atômico)
                 └─ 3. supabaseAdmin.auth.admin.deleteUser  ← service_role
```

### Por que a RPC vem antes

`private.audit_user_roles` e `private.audit_user_route_access` resolvem o
e-mail do alvo com `(SELECT email FROM auth.users WHERE id = v_target)` **no
momento do INSERT na auditoria**. Se `auth.users` fosse apagado primeiro, o
`ON DELETE CASCADE` de `user_roles` e `user_route_access` dispararia esses
triggers com a linha de `auth.users` já removida: as linhas de auditoria
sairiam com `target_email` nulo — e como `target_user_id` passaria a apontar
para um uuid inexistente, o evento ficaria sem **nenhuma** forma de identificar
quem foi excluído. Exatamente o oposto do critério de aceite.

Revogar pela RPC primeiro resolve os dois lados: o e-mail ainda existe para o
trigger resolver, e o ator vem de `auth.uid()` via `app.actor_id`.

### Por que a RPC não apaga `auth.users` ela mesma

Seria possível (`SECURITY DEFINER` com owner `postgres` alcança o schema
`auth`), mas acopla a migration ao schema interno do GoTrue — `identities`,
`sessions`, `refresh_tokens`, `mfa_factors` — que muda entre versões do
Supabase sem aviso. `auth.admin.deleteUser` é a API mantida para isso, e o
projeto já tem o lugar certo para chamá-la: `admin.server.ts`, com
`service_role`, seguindo a mesma convenção de `createInviteLink`.

### Falha parcial

Se o passo 3 falhar depois de o passo 2 ter comitado, o usuário fica **sem
papel, sem rotas e sem convite pendente, porém ainda listado**. É o estado
seguro: acesso já revogado, operação reexecutável (a RPC roda de novo sem
efeito colateral — os `DELETE` são idempotentes e o segundo `INSERT` de
auditoria registra a nova tentativa). A UI mostra o erro e mantém a linha.

Não há transação distribuída entre Postgres e GoTrue, e inverter a ordem para
evitar essa janela custaria a auditoria — o preço errado.

---

## Modelo de dados

Nenhuma tabela nova. Nenhuma coluna nova. Só um valor de enum:

```sql
ALTER TYPE public.role_audit_action ADD VALUE 'delete';
```

**Migration própria, isolada.** Um valor de enum recém-criado não pode ser
comparado ou castado na mesma transação em que foi adicionado — a mesma
restrição já documentada em `20260828132000_route_access_audit_enum.sql`. A RPC
da migration seguinte referencia `'delete'`.

## RPC `public.delete_platform_user`

```sql
CREATE OR REPLACE FUNCTION public.delete_platform_user(_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_role public.app_role;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF v_actor = _target THEN
    RAISE EXCEPTION 'Você não pode excluir a própria conta' USING ERRCODE = 'W2005';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = _target;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado' USING ERRCODE = 'W2004';
  END IF;

  SELECT role INTO v_role FROM public.user_roles WHERE user_id = _target;

  -- Um convite pendente que ainda não expirou recadastraria o usuário com o
  -- papel e as rotas ORIGINAIS no próximo clique no magic link — o link já
  -- está na caixa de entrada dele e não é revogável pela exclusão da conta.
  DELETE FROM public.invitations
   WHERE email = lower(v_email) AND consumed_at IS NULL;

  PERFORM set_config('app.actor_id', v_actor::text, true);

  IF v_role IS NOT NULL THEN
    -- O override faz o trigger gravar 'delete' em vez do 'revoke' padrão,
    -- preservando previous_role. Mesmo mecanismo que 'bootstrap' já usa.
    PERFORM set_config('app.audit_action', 'delete', true);
    DELETE FROM public.user_roles WHERE user_id = _target;
    PERFORM set_config('app.audit_action', '', true);
  ELSE
    -- Sem papel não há DELETE, logo o trigger não dispara e a exclusão
    -- passaria sem registro. previous_role/new_role ficam nulos: a coluna
    -- "Mudança" da UI já trata esse par como "—".
    INSERT INTO public.role_audit_log (
      action, target_user_id, target_email, actor_user_id, actor_email
    ) VALUES (
      'delete', _target, v_email, v_actor,
      (SELECT email FROM auth.users WHERE id = v_actor)
    );
  END IF;

  DELETE FROM public.user_route_access WHERE user_id = _target;
END $$;

REVOKE ALL ON FUNCTION public.delete_platform_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_platform_user(uuid) TO authenticated;
```

### Invariantes e onde cada uma mora

| Regra | Onde | Código |
| --- | --- | --- |
| Só administrador exclui | RPC (`private.has_role`) + `assertAdmin` na server fn + rota `/admin` já gateada | `W2001` |
| Não exclui a própria conta | RPC | `W2005` (novo) |
| Não exclui o último administrador | consequência do `W2005` (ver abaixo); `guard_last_admin` continua como rede | `W2003` |
| Usuário inexistente | RPC | `W2004` |

**A trava do último administrador não precisa de código novo — e `W2003` é
inalcançável por esta RPC.** `guard_last_admin` conta os admins **excluindo o
alvo**: `count(*) ... WHERE role = 'admin' AND user_id <> OLD.user_id`. Para
chegar ao `DELETE`, o ator já passou pelo `W2001` (é admin) e pelo `W2005`
(não é o alvo) — logo ele próprio é um admin diferente do alvo, e a contagem
nunca chega a zero.

Dito de outro modo: o último administrador só poderia ser excluído **por ele
mesmo**, e é exatamente isso que o `W2005` bloqueia. O critério de aceite é
cumprido transitivamente, não por uma checagem própria.

`guard_last_admin` permanece como rede para os caminhos **fora** desta RPC —
um `DELETE` manual no SQL Editor, ou o `ON DELETE CASCADE` disparado por
alguém apagando a conta direto pelo painel do Supabase. Se um dia a trava de
autoexclusão for afrouxada, ela volta a ser o que segura a plataforma; por
isso a suíte confirma que o trigger continua no lugar em vez de ignorá-lo.

### Por que `set_config(..., '')` no fim do branch

`private.audit_user_roles` lê o override com
`nullif(current_setting('app.audit_action', true), '')`, então a string vazia o
desliga. O `DELETE` de `user_route_access` logo abaixo dispara
`private.audit_user_route_access`, que hoje **não** lê esse setting — mas
deixar o override ligado além do statement que ele qualifica é uma armadilha
para a próxima pessoa que mexer no trigger. `is_local = true` já limitaria o
vazamento à transação; zerar explicitamente limita ao statement.

---

## Server function

`src/integrations/supabase/admin.server.ts` ganha:

```ts
export async function deleteAuthUser(targetId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(targetId);
  if (error) {
    console.error("[admin] deleteUser falhou:", error);
    throw new Error(
      "O acesso foi revogado, mas a conta não pôde ser removida. Tente novamente.",
    );
  }
}
```

A mensagem descreve o estado real após a falha parcial — dizer só "não foi
possível excluir" faria o administrador achar que nada aconteceu.

`src/integrations/supabase/admin-fns.ts` ganha:

```ts
export const deletePlatformUser = createServerFn({ method: "POST" })
  .validator((data: { userId: string }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<void> => {
    const { assertAdmin, deleteAuthUser } = await import("./admin.server");
    await assertAdmin(context.supabase, context.userId);

    const { error } = await context.supabase.rpc("delete_platform_user", {
      _target: data.userId,
    });
    if (error) throw error;

    await deleteAuthUser(data.userId);
  });
```

A RPC roda com `context.supabase` — o client do **próprio usuário** — e não com
`supabaseAdmin`: é o que faz `auth.uid()` resolver o ator de verdade dentro da
função. `service_role` entra só no passo 3.

**Propagação do erro do Postgres:** `error` do `supabase-js` carrega `code`
com o SQLSTATE, e `adminErrorMessage` no cliente já traduz por esse campo. O
`throw error` cru preserva `code` na serialização da server function — mesmo
comportamento que as chamadas diretas de `supabase.rpc` na `UserTable` já
dependem hoje. Se na verificação manual o `code` não sobreviver ao transporte,
o fallback é relançar `new Error(mensagemTraduzida)` no servidor.

---

## Cliente

### `src/lib/admin.ts`

```ts
export type PlatformUser = {
  // ...campos existentes
  name: string | null;
};

export type AuditEntry = {
  action: /* ...existentes */ | "delete";
  // ...
};

export const ACTION_LABELS = {
  // ...existentes
  delete: "Exclusão",
};
```

`name` sai de `user_metadata.full_name ?? user_metadata.name ?? null` em
`fetchPlatformUsers`. O critério de aceite pede nome e e-mail na confirmação;
`auth.users` só tem nome para quem entrou por um provedor que o envia, então é
anulável e o diálogo cai para o e-mail sozinho quando falta. **Não vira coluna
na tabela** — o e-mail continua sendo a identidade visível na listagem.

### `src/lib/admin-errors.ts`

```ts
W2005: "Você não pode excluir a própria conta.",
```

### `src/components/admin/UserTable.tsx`

Coluna nova, última, sem cabeçalho visível (`<TableHead className="w-12">
<span className="sr-only">Ações</span></TableHead>`), com um botão-ícone
`Trash2` `variant="ghost"`, `title="Excluir usuário"`.

O botão fica **desabilitado** na própria linha do administrador logado
(`u.id === currentUserId`), com `title` explicando o motivo. É a mesma
informação que a linha já mostra com o sufixo "(você)". A trava real continua
sendo o `W2005` da RPC — o `disabled` é cortesia, não segurança.

A confirmação usa `@/components/ui/alert-dialog` — o componente já está no
projeto (e `@radix-ui/react-alert-dialog` já é dependência), mas **ainda não
tem nenhum consumidor**: esta é a primeira tela a usá-lo, então vale conferir
o estilo renderizado no tema claro e no escuro. `AlertDialog` e não `Dialog`
(o que o `InviteDialog` usa) porque a ação é destrutiva: o Radix não fecha o
`AlertDialog` por clique fora, o foco nasce no botão de cancelar, e o papel
ARIA é `alertdialog`.

> **Excluir usuário?**
> Fulano de Tal (fulano@way2.com.br) perde o acesso imediatamente e sai desta
> lista. O histórico de alterações dele é mantido. Para voltar, precisará de
> um acesso concedido de novo.
>
> [Cancelar] [Excluir]

Sem nome, a primeira linha é só o e-mail. O botão de confirmação usa
`variant="destructive"`.

A última frase é deliberadamente genérica em vez de "só volta com um convite
novo": hoje o convite é o único caminho, mas a #3 vai acrescentar o login SSO
como segundo caminho (Decisão 3), e o texto do diálogo não deve virar mentira
quando ela entrar.

A mutation invalida `["platform-users"]` e `["role-audit"]` no sucesso, e usa
`adminErrorMessage` no erro — mesmo formato de `setRole`/`setRoutes`.

### `src/components/admin/AuditLog.tsx`

**Sem mudança.** `changeLabel` decide pelo dado (`!previous_role &&
!new_role`), não pelo tipo de ação: o evento `delete` de um usuário com papel
renderiza "Leitor → —", e o de um usuário sem papel renderiza "—". Os dois
estão certos. `ACTION_LABELS[e.action]` já cobre o rótulo novo por ser um
`Record` sobre a união.

### `src/integrations/supabase/types.ts`

Editado à mão, como manda a convenção do projeto: `delete_platform_user` em
`Functions` e `'delete'` no enum `role_audit_action`.

---

## Acesso imediato: o que "imediatamente" significa

`auth.admin.deleteUser` remove sessões e refresh tokens, então o usuário não
renova a sessão. O **access token JWT já emitido** continua criptograficamente
válido até expirar (1 h por padrão), e nesse intervalo `auth.uid()` ainda
resolve para o uuid antigo.

Isso não vaza dado: toda policy de leitura das 4 tabelas do board exige
`private.can_view_board(...) AND private.has_route(...)`, e as duas passam a
retornar `false` no instante do commit da RPC — as linhas de `user_roles` e
`user_route_access` sumiram. As server functions do Jira fazem a mesma
checagem sob RLS. O que o usuário vê na aba aberta é a casca renderizada em
memória até o `staleTime` de 5 min do `useRole`/`useRoutes` vencer, sem
conseguir ler nem escrever nada. É o mesmo comportamento que a revogação de
papel já tem hoje.

## Rastros deixados para trás

`invitations.invited_by`, `user_route_access.granted_by` e
`role_audit_log.actor_user_id` guardam uuids **sem FK**. Se o excluído tiver
convidado alguém ou concedido rotas, esses uuids ficam pendurados — de
propósito: é o que preserva o histórico. `actor_email` e `target_email` estão
gravados junto, então a UI continua legível; `AuditLog.tsx` já renderiza
"fora da aplicação" quando `actor_email` é nulo.

---

## Verificação

Sem test runner no projeto (`package.json` tem só `dev`, `build`, `build:dev`,
`preview`, `lint`, `format`) — esta demanda não introduz um.

**Banco:** `supabase/tests/user_delete_smoke.sql`, no padrão das suítes
existentes (tudo em `BEGIN … ROLLBACK`, `RAISE NOTICE 'Seção N OK'`, falha =
`RAISE EXCEPTION 'FALHA N.M: ...'`). Seções:

1. **Estrutura** — `'delete'` presente em `role_audit_action`;
   `delete_platform_user` existe, é `SECURITY DEFINER`, e o ACL não tem
   `EXECUTE` para `PUBLIC`/`anon`.
2. **Invariantes** — não-admin recebe `W2001`; autoexclusão recebe `W2005`
   mesmo quando o ator é o único admin da plataforma (é o caso que cumpre o
   critério do último administrador); uuid inexistente recebe `W2004`; o
   trigger `guard_last_admin` continua wired em `public.user_roles`.

   Os três erros são levantados **antes** de qualquer escrita, então não há
   estado parcial a verificar — e não há como exercitar um erro posterior à
   primeira escrita, justamente porque `W2003` ficou inalcançável. A
   atomicidade do resto vem de graça: a RPC é PL/pgSQL, roda na transação de
   quem chamou, e nenhuma das escritas está em bloco de exceção próprio.
3. **Caminho feliz com papel** — papel e rotas somem; exatamente uma linha
   `delete` na auditoria, com `target_email`, `actor_user_id` e
   `previous_role` corretos; uma linha `route_revoke` por rota que existia;
   **nenhuma** linha `revoke` (prova de que o override pegou).
4. **Caminho feliz sem papel** — usuário com `role = NULL` também gera uma
   linha `delete`, com os dois papéis nulos.
5. **Convite pendente** — convite não consumido para o e-mail é apagado; um
   convite já consumido não é tocado.
6. **Não-alvos** — `devs`, `sprints`, `allocations` e `teams` inalterados;
   linhas antigas do `role_audit_log` do usuário preservadas.

A suíte exercita a RPC; a remoção de `auth.users` é do GoTrue e fica para o
roteiro manual.

**Código:** nos arquivos tocados, nesta ordem —
`npx prettier --write`, `npx eslint`, `npx tsc --noEmit`. Nunca
`npm run lint` sem escopo (CRLF pré-existente reprova arquivos não tocados).

**Manual:** excluir um leitor comum e confirmar que some da lista e aparece no
Histórico como "Exclusão"; excluir um usuário "Sem acesso" e confirmar que
também aparece no Histórico; confirmar que o botão da própria linha está
desabilitado; excluir um usuário com convite pendente e confirmar que o magic
link antigo não recadastra com o papel original.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Passo 3 falha após o passo 2 comitar | Estado seguro (acesso revogado, linha permanece), mensagem de erro descreve o estado real, operação é reexecutável |
| Exclusão acidental é irreversível | Confirmação nominal com nome e e-mail, botão destrutivo, ação um-a-um; readmissão por convite é barata |
| `code` do SQLSTATE não sobreviver ao transporte da server function | Verificação manual dos 4 casos de erro; fallback documentado (traduzir no servidor) |
| Alguém futuramente inverter a ordem dos passos 2 e 3 | Comentário na server function e seção 3 do smoke amarrando `target_email` não nulo |
