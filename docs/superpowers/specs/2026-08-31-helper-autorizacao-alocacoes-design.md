# Helpers de Autorização para o Quadro de Alocação — Design

**Origem:** achado de altitude do code review interno do [PR #33](https://github.com/dbizfreitas/agile-assignment/pull/33) (issue #14, CRUD de times).
**Data:** 2026-08-31

## Problema

`private.can_edit_board(...) AND private.has_route(..., 'alocacoes')` é o predicado real de autorização de escrita no quadro de alocação, e `private.can_view_board(...) AND private.has_route(..., 'alocacoes')` é o de leitura. Nenhum dos dois é uma função — são duas linhas repetidas à mão, hoje em **21 lugares**: as 4 policies de `SELECT` (leitura) e as 16 de `INSERT`/`UPDATE`/`DELETE` (escrita) em `teams`/`devs`/`sprints`/`allocations`, mais a RPC `delete_team`.

A prova de que isso é perigoso, não só feio, é a própria história desta base de código: a primeira versão de `delete_team` (`20260830120000_team_delete_rpc.sql`) escreveu só a metade do predicado — `can_edit_board`, sem `has_route` — e produziu uma escalada de privilégio real em produção, corrigida em `20260830130000_team_delete_route_guard.sql`. `delete_team` é `SECURITY DEFINER`: contorna a RLS por completo, então nada no Postgres obriga a checagem escrita à mão a bater com o que a RLS já exige. Um esquecimento ali é invisível até alguém explorar.

`'alocacoes'` é a única rota já combinada dessa forma em todo o código — nenhuma das outras três rotas (`compromisso`, `cycle-time`, `retrospectivas`) tem esse padrão no RLS hoje.

## Escopo

Dois helpers novos, com a rota fixa em `'alocacoes'` (não parametrizados — é o único caso de uso real, e generalizar agora seria construir para uma rota que não existe). Usados **só** em `delete_team` e, por convenção documentada, em toda RPC `SECURITY DEFINER` futura sobre estas quatro tabelas.

**Fora de escopo, de propósito:** as 20 policies de RLS existentes. Ver "Por que as policies ficam como estão".

## Os dois helpers

Mesmo padrão de `can_edit_board`/`can_view_board`/`has_route`: `STABLE SECURITY DEFINER SET search_path = public`, `REVOKE ALL ... FROM public, anon` seguido de `GRANT EXECUTE ... TO authenticated, service_role`.

```sql
CREATE OR REPLACE FUNCTION private.can_view_alocacoes(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.can_view_board(_user_id)
     AND private.has_route(_user_id, 'alocacoes'::public.app_route)
$$;

CREATE OR REPLACE FUNCTION private.can_edit_alocacoes(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.can_edit_board(_user_id)
     AND private.has_route(_user_id, 'alocacoes'::public.app_route)
$$;
```

O comentário da migration registra a classe do bug, não só a mecânica: uma função `SECURITY DEFINER` precisa reproduzir o predicado **inteiro** das policies que ela contorna, e checar só o papel (como a primeira versão de `delete_team` fez) deixa passar um `editor` sem a rota `alocacoes` — que a RLS já bloqueia em todo o resto do sistema.

## Retrofit de `delete_team`

Nova migration (a já aplicada, `20260830130000`, não é tocada — ela registra o que está rodando em produção). `CREATE OR REPLACE FUNCTION public.delete_team(...)` com o corpo idêntico ao atual, trocando só a checagem:

```sql
IF NOT private.can_edit_alocacoes(v_actor) THEN
  RAISE EXCEPTION 'Sem permissao' USING ERRCODE = 'W4002';
END IF;
```

`W4002` mantém o mesmo SQLSTATE e mensagem; `src/lib/board-errors.ts` não muda. A assinatura `(_team uuid, _target uuid DEFAULT NULL) RETURNS void` não muda, então `src/integrations/supabase/types.ts` também não.

## Por que as policies ficam como estão

As 16 policies de escrita e as 4 de leitura continuam escritas com a checagem inline, sem chamar os novos helpers. Isso é uma decisão consciente, não uma pendência:

- RLS é declarativa e determinística — o Postgres a aplica sempre, sem depender de alguém lembrar de chamá-la. O risco que motivou este trabalho é específico de código `SECURITY DEFINER` escrito à mão, que contorna exatamente essa garantia.
- As 20 policies já existem, já foram aplicadas, e já foram exercitadas em produção sem incidente. Reescrevê-las por DRY puro troca uma duplicação inerte por uma migration de 20 `DROP POLICY` + `CREATE POLICY`, onde qualquer transcrição errada é um bug novo em código que já funcionava.
- O ganho de unificar as policies seria só estético — nenhuma delas pode "esquecer a metade do predicado" do jeito que uma função nova pode, porque ninguém as escreve à mão a cada chamada.

Se uma RLS existente precisar mudar por outro motivo no futuro, trocar sua checagem inline pelos helpers nesse momento é natural — mas não há motivo para tocar nelas só por causa deste trabalho.

## Verificação

Suíte nova, `supabase/tests/alocacoes_auth_helpers_smoke.sql`, mesmo padrão de `BEGIN…ROLLBACK` com `SET LOCAL plpgsql.check_asserts = on`:

- Um ator com papel `editor` e a rota `alocacoes`: `can_edit_alocacoes` e `can_view_alocacoes` retornam `true`.
- O mesmo ator, sem a rota: os dois retornam `false`.
- Um ator sem papel algum, com a rota: `can_edit_alocacoes` retorna `false`; `can_view_alocacoes` também (`can_view_board` exige algum papel).
- Um ator com papel `viewer` (não editor) e a rota: `can_view_alocacoes` `true`, `can_edit_alocacoes` `false` — prova que os dois helpers checam papéis diferentes, não o mesmo.

Depois: reaplicar `supabase/tests/team_delete_smoke.sql` (já existente, 7 seções) sem nenhuma modificação, como checagem de regressão — `delete_team` precisa continuar se comportando exatamente igual, só trocando a implementação interna da guarda.

## Arquivos

| Arquivo | O quê |
|---|---|
| `supabase/migrations/20260901120000_alocacoes_auth_helpers.sql` | **Criar.** Os dois helpers + `REVOKE`/`GRANT`. |
| `supabase/migrations/20260901130000_team_delete_use_auth_helper.sql` | **Criar.** `CREATE OR REPLACE` de `delete_team`, só a guarda muda. |
| `supabase/tests/alocacoes_auth_helpers_smoke.sql` | **Criar.** 4 casos acima. |

Nenhuma tabela nova, nenhuma coluna nova, nenhuma policy tocada. Nenhum arquivo TypeScript muda.

## Restrições de processo

Mesmas desta base de código: migrations aplicadas manualmente pelo usuário no SQL Editor do projeto Supabase `nuvrdppxecbowxopbqcr` (nunca pela ferramenta MCP do Lovable, que aponta para outro banco); SQL em ASCII, sem acentos; `src/routeTree.gen.ts` e `src/components/compromisso/StatsCards.tsx` não são tocados nem commitados; commits em ASCII; sem `git push` automático — decisão do usuário ao final.
