# Permissões por rota (issue #23)

**Data:** 2026-08-28
**Status:** aprovado para planejamento
**Issue:** [dbizfreitas/agile-assignment#23](https://github.com/dbizfreitas/agile-assignment/issues/23)

## Problema

O modelo de permissões hoje é tudo-ou-nada: `user_roles` guarda um único papel
global (`admin | editor | viewer`) e `useRole()` deriva `canView`/`canEdit` a
partir dele. Quem tem qualquer papel vê as 4 guias do produto (Compromisso,
Cycle Time, Retrospectivas, Alocações) igualmente — não existe granularidade
por rota. A tela `/admin` já troca o papel de cada usuário, mas não o que ele
enxerga.

**Achado que muda o ponto de partida da issue:** as rotas alimentadas por Jira
(Compromisso, Cycle Time) já têm checagem no servidor — `assertCanViewBoard`
roda dentro das 5 server functions de `src/integrations/jira/server-fns.ts`.
O buraco não é falta de enforcement, é o enforcement ser **cego a rota**:
qualquer papel libera qualquer server function Jira. Tornar isso ciente de
rota é parametrizar uma função existente, não criar um chokepoint novo.

## Objetivo

Permitir que um admin conceda, por usuário, quais das 4 guias ele acessa —
com o bloqueio valendo de verdade (RLS/server, não só ocultar botão) onde o
dado tem um back-end capaz de aplicá-lo.

## Escopo

**Dentro:** tabela de rotas por usuário, RLS de Alocações ciente de rota,
server functions de Jira cientes de rota, UI na tela `/admin` existente,
default de convite (`viewer` + `alocacoes`), auditoria, `/embed/alocacoes`.

**Fora (decidido explicitamente):**
- **Proteção real do dado de Retrospectivas.** `RouletteView` consome
  `PARTICIPANTS`, array estático em `src/lib/retrospectivas/participants.ts`,
  sem back-end. Ocultar a guia esconde a navegação, não o dado — a lista já
  vai no bundle JS de qualquer autenticado. Rastreado separadamente em
  [#24](https://github.com/dbizfreitas/agile-assignment/issues/24).
- **Provisionamento automático via SSO sem convite prévio.** `handle_new_user()`
  só concede acesso se achar um `invitations` pendente para o e-mail; login
  Microsoft/SSO sem convite manual hoje resulta em usuário sem nenhum papel.
  É o assunto da issue [#3](https://github.com/dbizfreitas/agile-assignment/issues/3)
  (comentário já registrado lá com o detalhe técnico) — tratado quando a
  migração de login for feita, não aqui.
- **Rota como eixo de `/admin`.** A tela de administração continua derivada
  de `role = 'admin'`, como hoje. A trava de último-admin já implementada em
  `guard_last_admin` não é tocada.
- **Nível de acesso por rota** (ex.: "editor só de Alocações, leitor de Cycle
  Time"). O papel (`admin/editor/viewer`) continua global e ortogonal à rota;
  como Alocações é a única guia que escreve hoje, essa limitação não tem
  efeito prático. Vira dívida arquitetural só no dia em que uma segunda guia
  escrevível existir — não vale o custo de resolver agora (YAGNI).

## Princípios

Os mesmos do RBAC existente (`docs/superpowers/specs/2026-08-08-admin-rbac-design.md`):
autorização no servidor (RLS/server function é a fonte da verdade — esconder
guia na `AppShell` é cosmética), invariantes no Postgres, deny by default,
ator não forjável (`auth.uid()`), auditoria inescapável via trigger.

---

## Modelo de dados

### Enum `public.app_route`

```sql
CREATE TYPE public.app_route AS ENUM
  ('compromisso', 'cycle-time', 'retrospectivas', 'alocacoes');
```

Os 4 valores são os mesmos `id` de `src/components/shell/tabs.ts` — mantendo
essa string idêntica nos dois lados, o mapeamento rota↔ícone/label no
front não precisa de tabela de tradução.

### Tabela `public.user_route_access`

| coluna       | tipo        | nota                                  |
| ------------ | ----------- | -------------------------------------- |
| `user_id`    | uuid        | `REFERENCES auth.users(id) ON DELETE CASCADE` |
| `route`      | `app_route` |                                        |
| `granted_by` | uuid        | quem concedeu (auditoria)             |
| `created_at` | timestamptz | `now()`                                |

`PRIMARY KEY (user_id, route)`. `user_roles` não muda — papel e rota são eixos
independentes, cada um na sua tabela.

```sql
GRANT SELECT ON public.user_route_access TO authenticated;
ALTER TABLE public.user_route_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY route_access_select_own ON public.user_route_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY route_access_select_admin ON public.user_route_access
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));
-- Sem policy de escrita: só a RPC SECURITY DEFINER grava.
```

**Backfill obrigatório na mesma migration** — sem isso, todo usuário com papel
hoje perde as 4 guias no deploy:

```sql
INSERT INTO public.user_route_access (user_id, route)
SELECT ur.user_id, r.route
  FROM public.user_roles ur
 CROSS JOIN unnest(enum_range(NULL::public.app_route)) AS r(route)
ON CONFLICT DO NOTHING;
```

### Helper `private.has_route`

```sql
CREATE OR REPLACE FUNCTION private.has_route(_user_id uuid, _route public.app_route)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_route_access
     WHERE user_id = _user_id AND route = _route
  )
$$;

REVOKE ALL ON FUNCTION private.has_route(uuid, public.app_route) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.has_route(uuid, public.app_route)
  TO authenticated, service_role;
```

### RPC `public.set_user_routes`

Substituição por lista completa (não delta) — mesmo padrão de "o cliente manda
o estado final" já usado pelo `ToggleGroup` da UI.

```sql
CREATE OR REPLACE FUNCTION public.set_user_routes(
  _target uuid, _routes public.app_route[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  PERFORM set_config('app.actor_id', v_actor::text, true);

  DELETE FROM public.user_route_access
   WHERE user_id = _target AND route <> ALL(_routes);

  INSERT INTO public.user_route_access (user_id, route, granted_by)
  SELECT _target, r, v_actor FROM unnest(_routes) AS r
  ON CONFLICT (user_id, route) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.set_user_routes(uuid, public.app_route[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_routes(uuid, public.app_route[]) TO authenticated;
```

Sem trava de "não se autoexcluir" aqui: rota não controla acesso a `/admin`
(ver Escopo/Fora) — só um admin pode chamar esta RPC, e revogar a própria rota
de conteúdo não afeta seu acesso administrativo.

---

## Onde mora cada regra

### Alocações (RLS)

As 4 policies de leitura criadas em `20260808121000_rbac_rpc_policies.sql`
trocam `can_view_board` por `has_route`:

```sql
DROP POLICY devs_select_viewers ON public.devs;
CREATE POLICY devs_select_route ON public.devs
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'alocacoes'::public.app_route));
-- idem teams_select_viewers, sprints_select_viewers, allocations_select_viewers
```

As policies de escrita (`*_insert_editors`, `*_update_editors`,
`*_delete_editors`, hoje `USING (private.can_edit_board(auth.uid()))`) passam
a exigir as duas coisas:

```sql
CREATE POLICY allocations_insert_editors ON public.allocations
  FOR INSERT TO authenticated
  WITH CHECK (
    private.can_edit_board(auth.uid())
    AND private.has_route(auth.uid(), 'alocacoes'::public.app_route)
  );
-- idem update/delete, e idem devs/teams/sprints (12 policies no total)
```

`private.can_view_board` fica órfã — comentário `-- DEPRECATED` na migration,
sem dropar (é `SECURITY DEFINER`; confirmar antes que nada mais referencia).

### Compromisso / Cycle Time (server functions)

`assertCanViewBoard(client, userId)` em `src/integrations/jira/access.server.ts`
vira `assertRouteAccess(client, userId, route: AppRoute)`, mesma forma (query
sob RLS em `user_route_access`, `throw new Error("Sem permissão")`).

Nos 5 handlers de `server-fns.ts`:

| Server function | Rota exigida |
| --- | --- |
| `getJiraSprints`, `getJiraSprint`, `getJiraIssues` | `'compromisso'` |
| `getJiraCycleTime` | `'cycle-time'` |
| `getJiraProjects` | `'compromisso'` **ou** `'cycle-time'` (chamada pela casca para as duas guias) |

`getJiraProjects` precisa de uma variante `assertAnyRouteAccess(client, userId, routes)`
— senão quebra a casca inteira para quem só tem uma das duas.

### Retrospectivas

Só UI (ver Escopo/Fora — proteção real é a #24).

### Cliente

- `src/hooks/use-routes.ts` **(novo)**: `useQuery({ queryKey: ["user-routes", userId], ... })`
  lendo `user_route_access` do próprio usuário — mesmo `staleTime` de 5 min do
  `useRole`. Devolve `Set<AppRoute>`.
- `use-authorized-session.ts` agrega `routes` ao retorno.
- `ShellContextValue` (`shell-context.tsx`) ganha `routes: Set<AppRoute>`.
- `AppShell.tsx`: `TABS.filter((t) => routes.has(t.id))` no lugar de `TABS.map(...)` direto.
- **Bloqueio de URL direta, centralizado em `_shell.tsx`:** a `Shell()` já
  resolve `pathname` via `useLocation` (mesmo padrão de `AppShell.tsx`); antes
  de renderizar `<Outlet/>`, calcula a guia ativa a partir do `pathname` e,
  se `!routes.has(activeTab.id)`, renderiza `<AccessDenied>` no lugar do
  outlet. Um guard central em vez de 4 checks duplicados nas rotas-filha —
  mesmo raciocínio que já levou `tabs.ts` a centralizar a lista de guias.
- `src/routes/embed.alocacoes.tsx`: troca `canView` por `routes.has('alocacoes')`
  no gate existente (é uma quinta porta para Alocações, fora da `_shell`).
- `src/routes/_shell/index.tsx`: **sem mudança.** Continua redirecionando para
  `/alocacoes`; se o usuário não tiver essa rota, cai no `<AccessDenied>`
  central acima — a navegação em `AppShell` já mostra só as guias que ele tem,
  então o próximo clique funciona. Calcular "primeira rota acessível" para o
  redirect da raiz não foi pedido pelos critérios de aceite (YAGNI).

**Propagação sem novo login:** mesmo padrão atual — `invalidateQueries` no
navegador do admin, `staleTime` de 5 min na vítima. Não é instantâneo; é o
comportamento que já existe para mudança de papel, e a issue não pede mais
que isso.

---

## Frontend

| Arquivo | Mudança |
| --- | --- |
| `src/lib/admin.ts` | tipo `AppRoute` (ou importar de onde `tabs.ts` expõe os ids) |
| `src/hooks/use-routes.ts` **(novo)** | `{ routes: Set<AppRoute>, loading }` |
| `src/hooks/use-authorized-session.ts` | agrega `routes` |
| `src/components/shell/shell-context.tsx` | `ShellContextValue.routes` |
| `src/routes/_shell.tsx` | guard central por rota antes do `<Outlet/>` |
| `src/components/shell/AppShell.tsx` | filtra `TABS` por `routes` |
| `src/routes/embed.alocacoes.tsx` | gate troca `canView` por `routes.has('alocacoes')` |
| `src/integrations/jira/access.server.ts` | `assertRouteAccess` / `assertAnyRouteAccess` no lugar de `assertCanViewBoard` |
| `src/integrations/jira/server-fns.ts` | 5 call sites passam a rota exigida |
| `src/components/admin/UserTable.tsx` | coluna nova: `ToggleGroup` de 4 ícones por linha |
| `src/components/admin/InviteDialog.tsx` | mesmo `ToggleGroup`, pré-marcado só `alocacoes` |
| `src/integrations/supabase/admin-fns.ts` / `admin.server.ts` | `listPlatformUsers` inclui rotas de cada usuário (join, para não gerar N queries) |
| `src/lib/admin.ts` (`AuditEntry`, `ACTION_LABELS`) | 2 ações novas + campo `route` |
| `src/components/admin/AuditLog.tsx` | exibe rota quando presente |

### Coluna de rotas em `UserTable.tsx`

```tsx
// ILUSTRATIVO
<TableCell>
  <ToggleGroup
    type="multiple"
    size="sm"
    value={u.routes}
    disabled={setRoutes.isPending || u.role === null}
    onValueChange={(next) =>
      setRoutes.mutate({ userId: u.id, routes: next as AppRoute[] })
    }
  >
    {TABS.map((tab) => (
      <ToggleGroupItem key={tab.id} value={tab.id} title={tab.label} aria-label={tab.label}>
        <tab.icon className="size-4" />
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
</TableCell>
```

`disabled` quando `u.role === null`: sem papel já bloqueia tudo por
`_shell.tsx` (`!canView`); marcar rota ali seria um controle mentiroso.

### Default de convite

`InviteDialog` mantém `role` default `viewer` (rótulo "Leitor" — já existe,
não é papel novo) e passa a enviar `routes: ['alocacoes']` por padrão, com o
mesmo `ToggleGroup` pré-marcado só nessa rota. `create_invitation` ganha o
parâmetro `_routes public.app_route[]`, gravado em `invitations.routes`
(`app_route[] NOT NULL DEFAULT ARRAY['alocacoes']::public.app_route[]`).

`handle_new_user()` insere as duas coisas dentro do `IF FOUND`:

```sql
INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, inv.role)
  ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.user_route_access (user_id, route, granted_by)
SELECT NEW.id, r, inv.invited_by FROM unnest(inv.routes) AS r
  ON CONFLICT DO NOTHING;
```

---

## Auditoria

Reaproveita `role_audit_log`, sem tabela nova:

```sql
-- Migration separada da que usa os valores novos — ALTER TYPE ... ADD VALUE
-- não pode ser lido na mesma transação em que é criado.
ALTER TYPE public.role_audit_action ADD VALUE 'route_grant';
ALTER TYPE public.role_audit_action ADD VALUE 'route_revoke';
```

```sql
ALTER TABLE public.role_audit_log ADD COLUMN route public.app_route;
```

Trigger `private.audit_user_route_access`, mesma forma de `audit_user_roles`
(`app.actor_id` via `set_config`, `SECURITY DEFINER`, `AFTER INSERT OR DELETE
ON public.user_route_access`), gravando uma linha por rota concedida/revogada.
Mantém a garantia original: nenhum caminho de código — nem um `INSERT` manual
no SQL Editor — muda acesso sem deixar registro.

`AuditEntry` (`src/lib/admin.ts`) ganha `route: AppRoute | null` e
`ACTION_LABELS` os dois rótulos novos ("Rota concedida" / "Rota revogada").

---

## Tratamento de erros

Mesmo padrão de `src/lib/admin-errors.ts` — `W2001` ("Sem permissão") já
cobre o caso de não-admin chamando `set_user_routes`. Nenhum SQLSTATE novo é
necessário.

---

## Verificação

Sem test runner no projeto (mesma decisão do RBAC original) — script
assertivo em SQL, seguindo `supabase/tests/rbac_smoke.sql`:

### `supabase/tests/route_access_smoke.sql`

1. usuário com papel mas sem rota `alocacoes` não lê `devs`/`sprints`/`allocations`/`teams`
2. usuário com rota `alocacoes` e papel `editor` escreve; com papel `viewer` só lê
3. usuário sem rota `compromisso`/`cycle-time` recebe erro de `getJiraSprints`/`getJiraCycleTime` (teste de integração, não SQL puro — ver roteiro manual)
4. `set_user_routes` por não-admin falha com `W2001`
5. backfill da migration não deixa ninguém com zero rotas que tinha papel antes
6. toda concessão/revogação de rota gera linha em `role_audit_log` com a `route` preenchida

### Roteiro manual

Com o app rodando: revogar `compromisso` de um usuário → guia some da
navegação e `/compromisso` direto na URL mostra `<AccessDenied>`; revogar
`alocacoes` → mesma checagem em `/embed/alocacoes`; convidar pessoa nova →
nasce só com Alocações; conceder `cycle-time` sem `compromisso` → confirmar
que `getJiraProjects` ainda funciona (variante "qualquer uma das duas").

---

## Ordem de implementação

1. Migration A — enum `app_route`, tabela `user_route_access` + backfill,
   helper `has_route`, RPC `set_user_routes`
2. Migration B — RLS de `devs/teams/sprints/allocations` cientes de rota
   (leitura e escrita)
3. Migration C — enum `role_audit_log` (`route_grant`/`route_revoke`),
   coluna `route`, trigger `audit_user_route_access` (separada da B por causa
   do `ALTER TYPE ADD VALUE`)
4. Migration D — `invitations.routes`, `create_invitation` e `handle_new_user`
   atualizados
5. `route_access_smoke.sql` e execução
6. `access.server.ts` (`assertRouteAccess`/`assertAnyRouteAccess`) + 5 call
   sites em `server-fns.ts`
7. `use-routes.ts` + `use-authorized-session.ts` + `shell-context.tsx`
8. Guard central em `_shell.tsx` + filtro de `AppShell.tsx` + `embed.alocacoes.tsx`
9. Coluna de rotas em `UserTable.tsx` + `admin-fns.ts`/`admin.server.ts`
   (join de rotas em `listPlatformUsers`)
10. `InviteDialog.tsx` (default `alocacoes`) + `AuditLog.tsx` (rótulos/coluna nova)
11. Roteiro manual

Migrations A/B são aditivas e reversíveis isoladamente; C e D dependem de A
mas não uma da outra. Se algo falhar em B (RLS), A já deixou o schema estável
sem quebrar nada em produção — mesmo raciocínio de fatiamento do RBAC original.
