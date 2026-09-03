# Participantes e sorteio de Retrospectivas no banco (issue #24)

**Data:** 2026-09-02
**Status:** aprovado para planejamento
**Issue:** [dbizfreitas/agile-assignment#24](https://github.com/dbizfreitas/agile-assignment/issues/24)

## Problema

`RouletteView` (guia Retrospectivas) não tem back-end. `PARTICIPANTS`
(`src/lib/retrospectivas/participants.ts`) é um array estático de ~20 pessoas
(nome + e-mail corporativo) que vai no bundle JS de qualquer autenticado, e o
estado do sorteio (quem já foi sorteado, quem está ausente, último vencedor)
vive em `localStorage` — por dispositivo, não compartilhado.

Isso foi documentado como limitação aceita na #23: ocultar a guia por rota
esconde a navegação, mas não protege o dado. Quem tiver o bundle em cache
continua vendo nomes/e-mails independente de `has_route(uid, 'retrospectivas')`.

A issue também pede duas coisas adicionais, levantadas durante o
planejamento: replicar o estado dos participantes do projeto irmão
`jira-live`, e dar a cada participante uma foto — que no `jira-live` vem do
Microsoft Graph (foto corporativa do Entra ID), não existe hoje no
`agile-assignment`.

## Objetivo

Mover participantes e estado do sorteio para tabelas Supabase protegidas por
RLS na mesma linha da #23 (`private.has_route(uid, 'retrospectivas')`), para
que o bloqueio de rota valha para o dado, não só para a navegação. Trazer
fotos corporativas via Microsoft Graph, replicando o mecanismo do `jira-live`
adaptado ao runtime serverless deste projeto (Cloudflare Workers via Nitro).

## Escopo

**Dentro:**
- Tabela `retro_participants` (substitui o array estático) com RLS por rota.
- Tabela `retro_roulette_state` (substitui `localStorage`), compartilhada
  entre todos que acessam a guia — sem tempo real, só refetch após ações.
- RPCs `SECURITY DEFINER` para as mutações do sorteio, mesmo padrão de
  `can_view_alocacoes`/`can_edit_alocacoes` da #23.
- Fotos via Microsoft Graph: `createServerFn` que busca, cacheia (coluna na
  tabela) e devolve a foto como data-URI; script local para a autorização
  OAuth inicial (device-code flow); refresh automático do token em runtime.
- Seed migration com os 20 participantes atuais (nome, e-mail, cor, ordem).

**Fora (decidido explicitamente):**
- **UI de administração de participantes.** Adicionar/remover/editar pessoa
  continua manual, via SQL/editor do Supabase. Não há fricção nova em relação
  a hoje (hoje já exige editar código + deploy); a issue é sobre segurança do
  dado, não sobre UX de gestão. Fica para o dia em que alguém pedir.
- **UI administrativa para (re)autorizar o Microsoft Graph.** A autorização
  inicial (e uma eventual reautorização, se o refresh token expirar por ~90
  dias de inatividade) é feita por um script local rodado uma vez, não por
  uma tela do app. Introduzir polling client-side + estado intermediário no
  banco só para uma ação rara, feita por quem já tem acesso ao repo e à
  service role key, não paga o custo.
- **Sincronização em tempo real do sorteio.** Ações (`spin`/`skip`/`reset`)
  invalidam a query local e refazem fetch; outra aba/dispositivo só vê a
  mudança ao recarregar ou no próximo refetch do react-query. Supabase
  Realtime resolveria isso, mas não é um padrão usado em nenhum outro lugar
  do projeto e normalmente uma retro tem uma pessoa operando a roleta por
  vez, compartilhando tela.
- **Qualquer alteração em `devs`.** Não é fonte dos participantes — não tem
  e-mail, inclui gente sem alocação (Shippit), um JOIN por nome seria frágil
  (homônimos, acentuação). Ver comentário já existente em `participants.ts`.
- **Migração de fotos já existentes em `photos-cache.ts`** (gitignored, gerado
  fora do fluxo normal). A tabela nova nasce sem foto; a primeira leitura de
  cada participante popula via Graph.

## Princípios

Os mesmos da #23: autorização no servidor é a fonte da verdade (RLS/RPC,
nunca só esconder botão), deny by default, ator não forjável (`auth.uid()`).
Estende-se ao Microsoft Graph: nenhuma credencial ou token chega ao client —
tudo fica em módulos `*.server.ts` e numa tabela (`public.ms_graph_token`)
sem nenhuma policy de RLS para `authenticated`.

---

## Modelo de dados

### Tabela `public.retro_participants`

| coluna             | tipo          | nota                                              |
| ------------------ | ------------- | -------------------------------------------------- |
| `id`                | uuid          | PK, `default gen_random_uuid()`                    |
| `name`              | text          | not null                                           |
| `email`             | text          | not null, `UNIQUE`                                 |
| `color`             | text          | nullable — cor fixa (hoje só o pessoal da Shippit) |
| `sort_order`        | int           | not null — preserva a ordem de que a paleta depende |
| `photo_data_url`    | text          | nullable — cache do Graph, ver seção Fotos          |
| `photo_fetched_at`  | timestamptz   | nullable                                           |
| `created_at`        | timestamptz   | `default now()`                                    |

```sql
ALTER TABLE public.retro_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_participants_select_route ON public.retro_participants
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'retrospectivas'::public.app_route));
-- Sem policy de INSERT/UPDATE/DELETE para authenticated: gestão é manual
-- (SQL/editor Supabase, ver Escopo/Fora); a única escrita automática é o
-- cache de foto, feita por supabaseAdmin dentro da server function.
```

`sort_order` existe porque `paletteColor`/`avatarColor` em
`participants.ts` derivam a cor da posição no array (`AVATAR_COLORS[index %
21]`) — sem uma coluna de ordem explícita, a cor de cada pessoa mudaria
conforme o Postgres decidisse devolver as linhas.

### Tabela `public.retro_roulette_state`

Linha única (singleton) — hoje existe um sorteio só, sem conceito de retros
paralelas.

| coluna               | tipo          | nota                                  |
| -------------------- | ------------- | -------------------------------------- |
| `id`                  | boolean       | PK, `default true`, `CHECK (id)`       |
| `drawn_emails`        | text[]        | not null, `default '{}'`               |
| `skipped_emails`      | text[]        | not null, `default '{}'`               |
| `last_winner_email`   | text          | nullable                               |
| `updated_at`          | timestamptz   | `default now()`                        |

```sql
INSERT INTO public.retro_roulette_state (id) VALUES (true);

ALTER TABLE public.retro_roulette_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY retro_roulette_state_select_route ON public.retro_roulette_state
  FOR SELECT TO authenticated
  USING (private.has_route(auth.uid(), 'retrospectivas'::public.app_route));
-- Sem policy de escrita: só as RPCs abaixo gravam.
```

### Tabela `public.ms_graph_token`

Fica em `public` (não em `private`) por uma razão prática: `supabaseAdmin`
(`src/integrations/supabase/client.server.ts`) é um client `supabase-js`
comum, que só consegue tipar/consultar tabelas expostas via PostgREST no
schema `public` sem configuração adicional de API (expor outro schema na API
do Supabase é mudança de infraestrutura fora do escopo desta issue, e nenhum
código do projeto hoje acessa um schema fora de `public` a partir do
service-role client). A proteção não vem do schema, vem de **zero policies**:

| coluna           | tipo        | nota                    |
| ---------------- | ----------- | ----------------------- |
| `id`              | boolean     | PK, `default true`, `CHECK (id)` |
| `access_token`    | text        | nullable                |
| `refresh_token`   | text        | nullable                |
| `expires_at`      | timestamptz | nullable                |
| `updated_at`      | timestamptz | `default now()`         |

```sql
INSERT INTO public.ms_graph_token (id) VALUES (true);
ALTER TABLE public.ms_graph_token ENABLE ROW LEVEL SECURITY;
-- Sem nenhuma policy: RLS habilitado + zero policies = ninguém em
-- `authenticated`/`anon` lê ou escreve (mesmo padrão de proteção "RLS
-- ligado, zero policies" já usado para blindar tabelas sensíveis no
-- projeto). Só service_role (supabaseAdmin, que bypassa RLS) acessa.
```

### Helpers `private.can_view_retrospectivas` / `can_edit_retrospectivas`

Mesma forma de `can_view_alocacoes`/`can_edit_alocacoes`
(`20260831140000_alocacoes_auth_helpers.sql`) — existe para não repetir o
`AND` em cada RPC (a lição documentada naquela migration: uma RPC que
esqueceu o `has_route` virou escalada de privilégio real).

```sql
CREATE OR REPLACE FUNCTION private.can_view_retrospectivas(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.can_view_board(_user_id)
     AND private.has_route(_user_id, 'retrospectivas'::public.app_route)
$$;

CREATE OR REPLACE FUNCTION private.can_edit_retrospectivas(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.can_edit_board(_user_id)
     AND private.has_route(_user_id, 'retrospectivas'::public.app_route)
$$;

REVOKE ALL ON FUNCTION private.can_view_retrospectivas(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION private.can_edit_retrospectivas(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.can_view_retrospectivas(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_edit_retrospectivas(uuid) TO authenticated, service_role;
```

### RPCs do sorteio

O sorteio do vencedor precisa acontecer **no servidor**: se o client
escolhesse o vencedor e só enviasse o resultado para persistir, qualquer
usuário poderia forjar quem "ganhou" chamando a RPC direto. A animação visual
de 18 flashes (`use-roulette.ts`, puramente estética, já hoje independente de
qual participante realmente ganha até o commit final) continua rodando no
client depois que o servidor já decidiu o vencedor.

```sql
CREATE OR REPLACE FUNCTION public.spin_roulette()
RETURNS text -- e-mail do vencedor
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_winner text;
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  SELECT p.email INTO v_winner
    FROM public.retro_participants p, public.retro_roulette_state s
   WHERE NOT (p.email = ANY(s.drawn_emails))
     AND NOT (p.email = ANY(s.skipped_emails))
   ORDER BY random()
   LIMIT 1;

  IF v_winner IS NULL THEN
    RAISE EXCEPTION 'Nenhum participante elegível' USING ERRCODE = 'W2402';
  END IF;

  UPDATE public.retro_roulette_state
     SET drawn_emails = array_append(drawn_emails, v_winner),
         last_winner_email = v_winner,
         updated_at = now();

  RETURN v_winner;
END $$;

CREATE OR REPLACE FUNCTION public.skip_participant(_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;
  UPDATE public.retro_roulette_state
     SET skipped_emails = array_append(skipped_emails, _email), updated_at = now()
   WHERE NOT (_email = ANY(skipped_emails)) AND NOT (_email = ANY(drawn_emails));
END $$;

CREATE OR REPLACE FUNCTION public.unskip_participant(_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;
  UPDATE public.retro_roulette_state
     SET skipped_emails = array_remove(skipped_emails, _email), updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.unmark_participant(_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;
  UPDATE public.retro_roulette_state
     SET drawn_emails = array_remove(drawn_emails, _email),
         last_winner_email = CASE WHEN last_winner_email = _email THEN NULL ELSE last_winner_email END,
         updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.reset_roulette()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.can_edit_retrospectivas(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;
  UPDATE public.retro_roulette_state
     SET drawn_emails = '{}', skipped_emails = '{}', last_winner_email = NULL, updated_at = now();
END $$;

-- Mesmo REVOKE/GRANT para as 5 funções acima:
REVOKE ALL ON FUNCTION public.spin_roulette() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.spin_roulette() TO authenticated;
-- idem skip_participant(text), unskip_participant(text),
-- unmark_participant(text), reset_roulette()
```

`W2402` é um código novo (`ENTITY.SPECIFIC_ERROR`, convenção do projeto) para
"sorteio sem participantes elegíveis" — distinto de `W2001` (sem permissão),
para a UI poder diferenciar as duas mensagens.

### Seed

Migration separada, populando `retro_participants` a partir dos 20
registros hoje em `participants.ts` (mesma ordem → mesmo `sort_order` →
mesma cor de cada pessoa não muda para quem já está acostumado):

```sql
INSERT INTO public.retro_participants (name, email, color, sort_order) VALUES
  ('André Secco', 'andre.secco@way2.com.br', NULL, 0),
  ('Bruno Shippit', 'bruno@shippit.app', '#0ea5e9', 1),
  -- ... demais 18, na ordem atual do array
  ('Warley Thales da Silva Lopes', 'warley.lopes@way2.com.br', NULL, 19);
```

---

## Fotos via Microsoft Graph

### Mecanismo (adaptado do `jira-live`)

O `jira-live` roda um processo Node de vida longa: guarda o token OAuth em
disco (`.ms-token-cache.json`) e o cache de fotos em memória (TTL 24h). O
`agile-assignment` roda em Cloudflare Workers via Nitro — sem disco
persistente, sem garantia de memória compartilhada entre invocações. Isso
exige duas adaptações:

1. **Token persistido no Supabase**, não em arquivo: `public.ms_graph_token`.
2. **Cache de foto persistido no Supabase**, não em memória do processo:
   colunas `photo_data_url`/`photo_fetched_at` em `retro_participants`.

O allowlist de domínio (`way2.com.br`, `shippit.app`) e o formato de resposta
do Graph (`GET /v1.0/users/{email}/photo/$value`) são idênticos ao
`jira-live`. As credenciais (`MS_TENANT_ID`/`MS_CLIENT_ID`) são as mesmas do
app registration já aprovado no Entra ID — evita novo processo de admin
consent.

### Autorização inicial: script local, não UI

O device-code flow pede um código, mostra um link, e faz polling até a
pessoa autorizar no navegador — isso normalmente leva de segundos a minutos.
Uma invocação serverless (Cloudflare Worker) não sustenta esse polling numa
única chamada, e replicar isso como fluxo de UI exigiria duas server
functions (iniciar/verificar) mais um `setInterval` no client mais colunas
temporárias no banco — complexidade real para uma ação que:

- Roda uma vez.
- É repetida raramente (só se o refresh token expirar por inatividade
  prolongada — tipicamente ~90 dias sem uso no Entra ID).
- É executada por alguém que já tem acesso ao repo e à
  `SUPABASE_SERVICE_ROLE_KEY` local — não por um usuário final do app.

**Decisão:** um script Node (`scripts/ms-graph-auth.ts`, rodado localmente
via `npm run ms-graph:auth`) faz o device-code flow completo em processo
próprio (com polling real, sem limitação de timeout de invocação), imprime
o link + código no terminal, e ao concluir grava o token resultante direto em
`public.ms_graph_token` usando um client Supabase com a service role key do
`.env.local` (nunca `.env`, que é versionado no git). Depois de rodado uma vez, o app em produção só faz refresh
automático (`token.server.ts`) — nunca mais precisa do device-code, a menos
que o script seja rodado de novo manualmente.

### Módulo `src/integrations/ms-graph/`

Segue a mesma estrutura de `src/integrations/jira/` (client-safe `*-fns.ts`
+ lógica em `*.server.ts`, import dinâmico dentro do handler):

- **`config.server.ts`** — lê `MS_TENANT_ID`/`MS_CLIENT_ID` de `process.env`.
- **`token.server.ts`** — `getAccessToken()`: lê `public.ms_graph_token` via
  `supabaseAdmin`; se `expires_at` ainda válido, devolve `access_token`; senão
  tenta `refresh_token` contra `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
  e regrava a linha; se não houver `refresh_token` ou o refresh falhar, lança
  erro explicando que é necessário rodar `npm run ms-graph:auth`.
- **`photos.server.ts`** — `fetchParticipantPhoto(email)`: valida
  `isAllowedEmail` (mesma allowlist do `jira-live`), chama
  `getAccessToken()`, busca `/v1.0/users/{email}/photo/$value`, converte o
  `ArrayBuffer` para data-URI (`data:{content-type};base64,{...}`).
- **`server-fns.ts`** — expõe `getParticipantPhoto`, único ponto client-safe.

### `getParticipantPhoto` (createServerFn)

```ts
// ILUSTRATIVO
export const getParticipantPhoto = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((email: string) => email)
  .handler(async ({ context, data: email }) => {
    const { assertRouteAccess } = await import("../jira/access.server");
    await assertRouteAccess(context.supabase, context.userId, "retrospectivas");

    const { getCachedOrFetchPhoto } = await import("./photos.server");
    return getCachedOrFetchPhoto(email); // string | null (data-URI)
  });
```

`getCachedOrFetchPhoto(email)`:
1. Lê `photo_data_url`/`photo_fetched_at` de `retro_participants` (via
   `supabaseAdmin`, já que o cache é escrita de sistema, não do usuário).
2. Se existe e `photo_fetched_at` tem menos de 7 dias, devolve o cache.
3. Senão chama `fetchParticipantPhoto(email)`; em caso de sucesso, grava
   `photo_data_url`/`photo_fetched_at = now()` e devolve; em caso de erro
   (pessoa sem foto no Graph, token não configurado, domínio fora da
   allowlist), devolve `null` sem lançar — quem chama cai no fallback de
   iniciais, igual ao comportamento atual quando `photos-cache.ts` não existe.

TTL de 7 dias: fotos corporativas mudam raramente: value razoável entre
"não fica desatualizado por muito tempo" e "não bate no Graph toda vez que
alguém abre a guia".

### Client (`photos.ts`)

`getPhoto(email)` deixa de ler o glob `photos-cache*.ts` e passa a chamar
`getParticipantPhoto` através de um hook react-query
(`staleTime` de 12h — cache do lado do client, complementar ao cache no
banco) por participante, ou uma única chamada em lote ao abrir a tela
(decisão de implementação, ver plano). O comentário existente no arquivo já
antecipava esta troca ("único módulo que sabe de onde vem a foto").

---

## Frontend

| Arquivo | Mudança |
| --- | --- |
| `src/lib/retrospectivas/participants.ts` | Remove `PARTICIPANTS` e `type Participant` fica alinhado ao shape vindo do banco (`{ id, name, email, color, sort_order }`); mantém `AVATAR_COLORS`, `paletteColor`, `avatarColor`, `getInitials`, `firstName`, `shortName` como funções puras |
| `src/hooks/use-retro-participants.ts` **(novo)** | `useQuery` lendo `retro_participants` ordenado por `sort_order` |
| `src/hooks/use-roulette.ts` | Reescrito: estado vem de `retro_roulette_state` via `useQuery`; `spin`/`skip`/`unskip`/`unmark`/`reset` chamam as RPCs via `supabase.rpc(...)` + `invalidateQueries`; mantém a mesma `RouletteApi` pública e a animação local de flashes (o pool de flashes usa a lista de participantes elegíveis já carregada, o vencedor final vem do retorno de `spin_roulette`) |
| `src/lib/retrospectivas/storage.ts` | Removido — sem mais leitura/escrita de `localStorage` |
| `src/components/retrospectivas/RouletteView.tsx` | Consome `useRetroParticipants()` no lugar do import estático de `PARTICIPANTS` |
| `src/components/retrospectivas/ParticipantCard.tsx` | Sem mudança de contrato (já recebe `participant`/`index` via props) |
| `src/lib/retrospectivas/photos.ts` | `getPhoto` passa a chamar `getParticipantPhoto` (server function) em vez do glob local |
| `scripts/ms-graph-auth.ts` **(novo)** | Script local de autorização OAuth, ver seção Fotos |
| `package.json` | novo script `"ms-graph:auth": "tsx scripts/ms-graph-auth.ts"` (ou runner equivalente já usado no projeto) |
| `src/integrations/ms-graph/*` **(novo)** | `config.server.ts`, `token.server.ts`, `photos.server.ts`, `server-fns.ts` |

### Tratamento de perda de conexão com participantes desconhecidos

`use-roulette.ts` hoje descarta e-mails salvos que saíram da lista
(`keepKnown`). Com o estado no banco, isso não é mais necessário do lado do
client: `drawn_emails`/`skipped_emails` só contêm e-mails que estavam em
`retro_participants` no momento da mutação. Se uma pessoa for removida da
tabela depois, a RPC de spin já não a considera elegível (`JOIN` implícito
pela subquery); um e-mail órfão em `drawn_emails` apenas não corresponde a
nenhum card renderizado — comportamento aceitável, mesmo espírito do
`keepKnown` original mas resolvido na leitura, não escrevendo de volta.

---

## Tratamento de erros

- `W2001` ("Sem permissão") — já existe, cobre chamada das RPCs por quem não
  tem `can_edit_retrospectivas`.
- `W2402` ("Nenhum participante elegível") — novo, `spin_roulette()` quando
  todos já foram sorteados ou marcados ausentes. UI mostra mensagem amigável
  em vez de erro genérico (mesmo padrão de mapeamento de erro usado em
  outras mutações do projeto).
- `getParticipantPhoto` nunca lança para o client em caso de foto ausente —
  `null` é um resultado válido, tratado como "sem foto, mostrar iniciais".

---

## Verificação

Sem test runner no projeto — script assertivo em SQL, seguindo o padrão de
`supabase/tests/*_smoke.sql` (fixtures com `auth.users` de UUID fixo, `SET
LOCAL ROLE authenticated` + `request.jwt.claims`, `ROLLBACK` no final):

### `supabase/tests/retro_participants_smoke.sql`

1. Usuário sem rota `retrospectivas` não lê `retro_participants` nem
   `retro_roulette_state`.
2. Usuário com rota `retrospectivas` e papel `viewer` lê ambas, mas
   `spin_roulette`/`skip_participant`/`reset_roulette` falham com `W2001`.
3. Usuário com rota `retrospectivas` e papel `editor` consegue sortear,
   pular e resetar.
4. `spin_roulette()` nunca sorteia um e-mail já em `drawn_emails` ou
   `skipped_emails`.
5. `spin_roulette()` com todos sorteados/ausentes lança `W2402`.
6. `reset_roulette()` zera os três campos de estado.
7. `public.ms_graph_token` não é lida por nenhuma policy de `authenticated`
   (tentativa de `SELECT` sob RLS simulada falha/retorna vazio).

### Roteiro manual

Com o app rodando: revogar `retrospectivas` de um usuário → guia some e
`/retrospectivas` direto na URL mostra `<AccessDenied>` (já coberto pelo
guard central da #23, não deveria precisar de mudança); girar a roleta,
recarregar a página, confirmar que o estado (sorteados/ausente/vencedor)
persiste; abrir em duas abas, sortear numa, confirmar que a outra só atualiza
depois de um refetch (comportamento esperado, sem tempo real); rodar
`npm run ms-graph:auth` uma vez e confirmar que fotos aparecem na guia;
remover a foto de um participante propositalmente inacessível (fora da
allowlist) e confirmar fallback de iniciais sem erro na tela.

---

## Ordem de implementação

1. Migration A — tabelas `retro_participants` e `retro_roulette_state` + RLS
   de leitura + seed dos 20 participantes atuais.
2. Migration B — `public.ms_graph_token` (sem policies) + helpers
   `can_view_retrospectivas`/`can_edit_retrospectivas`.
3. Migration C — RPCs `spin_roulette`, `skip_participant`,
   `unskip_participant`, `unmark_participant`, `reset_roulette`.
4. `retro_participants_smoke.sql` e execução.
5. `src/integrations/ms-graph/` (config/token/photos/server-fns) +
   `scripts/ms-graph-auth.ts`.
6. Rodar o script localmente uma vez, confirmar token gravado.
7. `use-retro-participants.ts` + reescrita de `use-roulette.ts` (RPCs no
   lugar de `localStorage`).
8. `RouletteView.tsx` consumindo o hook novo; remoção de
   `src/lib/retrospectivas/storage.ts` e do `PARTICIPANTS` estático.
9. `photos.ts` chamando `getParticipantPhoto`.
10. Roteiro manual.

Migrations A/B são aditivas e independentes entre si; C depende de A e B
(usa as tabelas e os helpers). Se C precisar de ajuste, A/B já deixam o
schema estável sem quebrar nada em produção — mesmo raciocínio de
fatiamento da #23.
