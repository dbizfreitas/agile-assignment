# Administração de usuários e papéis (RBAC)

**Data:** 2026-08-08
**Status:** aprovado para planejamento

## Problema

O banco já tem uma fundação de RBAC correta (tabela `user_roles`, enum `app_role`,
helpers `SECURITY DEFINER` no schema `private`, RLS em todas as tabelas), mas a
plataforma é inoperável do ponto de vista administrativo:

1. **Não existe nenhum admin.** A migration `20260803004421` semeou todos os
   usuários existentes como `editor`. Como a policy `user_roles_admin_manage`
   exige `has_role(admin)` para gerenciar papéis, ninguém consegue conceder o
   primeiro `admin` — deadlock de bootstrap.
2. **Não existe UI de gestão.** Nenhum arquivo em `src/` referencia `user_roles`;
   o front sequer lê o papel do usuário logado.
3. **Cadastro é público.** `AuthCard.tsx` oferece "Criar acesso" a qualquer um, e
   as policies de `SELECT` são `USING (true)` para qualquer autenticado — logo,
   quem tiver a URL cria conta e lê o board inteiro do time.
4. **Novo usuário não recebe papel.** Não há trigger em `auth.users`. O papel
   `viewer` está declarado mas nunca é usado; "sem papel" equivale a "viewer" por
   acidente, não por desenho.
5. **Sem trava de último admin.** Nada impede o único admin remover o próprio
   papel e travar a plataforma permanentemente.
6. **Sem trilha de auditoria** de concessão/revogação de privilégio.

## Objetivo

Permitir que um administrador da plataforma seja configurado e que ele gerencie
quem entra e o que cada pessoa pode fazer, com o enforcement no banco de dados —
não na interface.

## Escopo

**Dentro:** bootstrap do primeiro admin, tela de administração de usuários,
convite como único caminho de entrada, deny-by-default para quem não tem papel,
trilha de auditoria imutável, travas anti-lockout.

**Fora (decidido explicitamente):** MFA obrigatório para admin, papel no JWT via
Custom Access Token Hook, step-up re-auth. Ficam para uma rodada futura, se
volume de usuários ou exigência de compliance justificar.

## Princípios

1. **Autorização no servidor.** A RLS é a fonte da verdade. Esconder botão é
   cosmética (OWASP A01:2021).
2. **Invariantes no Postgres, não no TypeScript.** As travas valem inclusive para
   quem detém a `service_role` key.
3. **Deny by default.** Sem papel, sem acesso — nem de leitura.
4. **Ator não forjável.** As funções de mutação derivam o ator de `auth.uid()`,
   nunca de um parâmetro vindo do cliente.
5. **Auditoria inescapável.** Toda alteração de `user_roles` é registrada por
   trigger — nenhum caminho de código pode esquecer de auditar. Eventos que não
   alteram `user_roles` (o convite) são gravados pela própria função no banco.

---

## Modelo de papéis

| Papel      | Vê o board | Edita board | Gerencia usuários |
| ---------- | ---------- | ----------- | ----------------- |
| *sem papel*| ❌         | ❌          | ❌                |
| `viewer`   | ✅         | ❌          | ❌                |
| `editor`   | ✅         | ✅          | ❌                |
| `admin`    | ✅         | ✅          | ✅                |

Um usuário tem **exatamente um papel**. Hoje o schema permite vários
(`UNIQUE (user_id, role)`); acrescentamos `UNIQUE (user_id)`. Os registros atuais
já têm um papel por usuário, então a constraint aplica sem conflito.

Os usuários existentes permanecem `editor` — **ninguém perde acesso** na migração.

---

## Banco de dados

### Tabela `public.invitations`

| coluna        | tipo          | nota                                     |
| ------------- | ------------- | ---------------------------------------- |
| `id`          | uuid PK       |                                          |
| `email`       | text NOT NULL | normalizado para minúsculas pela função  |
| `role`        | `app_role`    | papel que o convidado receberá           |
| `invited_by`  | uuid NOT NULL | quem convidou                            |
| `expires_at`  | timestamptz   | `now() + interval '7 days'`              |
| `consumed_at` | timestamptz   | preenchido quando o usuário é criado     |
| `created_at`  | timestamptz   | `now()`                                  |

```sql
CREATE UNIQUE INDEX invitations_pending_email_idx
  ON public.invitations (lower(email)) WHERE consumed_at IS NULL;
```

Permite reconvidar depois que um convite foi consumido, mas impede dois convites
pendentes para o mesmo e-mail.

**Por que uma tabela e não `raw_user_meta_data`:** o metadado do usuário é
gravável pelo próprio usuário via `supabase.auth.updateUser()`. Derivar o papel
de lá seria um vetor direto de auto-elevação de privilégio. Esta tabela só é
escrita por função `SECURITY DEFINER` que valida o ator.

RLS: `SELECT` apenas para admin. Nenhum `INSERT`/`UPDATE`/`DELETE` concedido a
`authenticated` — toda escrita passa pela RPC.

### Tabela `public.role_audit_log`

`id`, `action` (`invite` | `grant` | `revoke` | `bootstrap`), `target_user_id`,
`target_email`, `actor_user_id`, `actor_email`, `previous_role`, `new_role`,
`created_at`.

Os e-mails são gravados como **snapshot**: o registro sobrevive à exclusão do
usuário em `auth.users`.

Imutabilidade real:

```sql
GRANT SELECT ON public.role_audit_log TO authenticated;   -- RLS: só admin
REVOKE UPDATE, DELETE ON public.role_audit_log FROM authenticated, service_role;
```

Nem a aplicação com a chave de serviço reescreve o histórico. A inserção ocorre
pelo trigger, que roda como *owner* e portanto não depende desses grants.

### Helper `private.can_view_board(uuid)`

```sql
SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
```

`SECURITY DEFINER`, `SET search_path = public`, `EXECUTE` revogado de
`anon`/`public` — mesmo padrão dos helpers já existentes.

### Fechamento das policies de leitura

Em `devs`, `teams`, `sprints` e `allocations`, a policy de `SELECT` troca
`USING (true)` por `USING (private.can_view_board(auth.uid()))`.

Este é o ponto que efetivamente fecha o vazamento do item 3 do problema.

---

## Onde mora cada regra

```
navegador ──► RPC public.set_user_role (SECURITY DEFINER)
                 │  ator = auth.uid()  ← não forjável
                 ├─ valida ator é admin
                 ├─ valida guardas
                 └─ escreve user_roles ──► trigger ──► role_audit_log
```

A mutação de papel **não passa por server function**. O cliente autenticado chama
a RPC diretamente; a função deriva o ator de `auth.uid()`, tornando impossível
agir em nome de outro. `service_role` fica reservada para as duas operações que
genuinamente a exigem: listar e-mails de usuários e gerar link de convite.

### `public.set_user_role(_target uuid, _role public.app_role)`

`SECURITY DEFINER`, `SET search_path = public`. `_role NULL` significa revogar
todo acesso. Numa única transação:

1. `_actor := auth.uid()`; se não for admin → `W2001`
2. se `_actor = _target` e o ator perderia o papel `admin` → `W2002`
3. se a mudança zeraria a contagem de admins → `W2003`
4. `set_config('app.actor_id', _actor::text, true)` — GUC local à transação
5. `DELETE` dos papéis do alvo + `INSERT` do novo (quando `_role` não é nulo)
6. o trigger de auditoria dispara e grava o registro

`GRANT EXECUTE TO authenticated`, revogado de `anon` e `public`.

### `public.create_invitation(_email text, _role public.app_role) RETURNS uuid`

Ator de `auth.uid()`, valida admin (`W2001`), normaliza o e-mail, recusa se já
existir convite pendente ou usuário com aquele e-mail (`W2004`), insere em
`invitations` com `expires_at = now() + 7 days`.

Como nenhuma linha de `user_roles` muda neste momento, o trigger de auditoria não
dispara: a própria função insere o registro `action = 'invite'` em
`role_audit_log`. É a única escrita direta na tabela de auditoria, e acontece
dentro do banco — a aplicação segue sem acesso de escrita.

### Trigger de auditoria `audit_user_roles`

`AFTER INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW`.

Lê dois GUCs locais à transação, ambos opcionais:

- `app.actor_id` — quem agiu. Vazio quando a mudança vem de fora da RPC (console
  do Supabase, por exemplo); nesse caso grava `actor_user_id NULL`, sinalizando
  alteração fora de banda em vez de não registrar nada.
- `app.audit_action` — sobrescreve a ação derivada de `TG_OP`. Usado pela
  migration de bootstrap para gravar `action = 'bootstrap'` em vez de `grant`, e
  por `handle_new_user` para atribuir o `invited_by` como ator.

**Por que trigger e não escrita pela aplicação:** cobertura de 100% dos caminhos
que alteram papel, sem risco de escrita dupla e sem a possibilidade de um caminho
novo esquecer de auditar.

### Trigger de segurança `guard_last_admin`

`BEFORE UPDATE OR DELETE ON public.user_roles`. Rede de segurança independente da
RPC: se a operação deixaria zero admins, levanta `W2003`. Protege contra um
`DELETE` manual no SQL Editor.

### Trigger `handle_new_user`

`AFTER INSERT ON auth.users`, `SECURITY DEFINER`:

- procura convite pendente e não expirado para `lower(NEW.email)`;
- se achar: define `app.actor_id = invitations.invited_by` (para o trigger de
  auditoria creditar quem convidou), insere o papel e marca `consumed_at`;
- se não achar: **não faz nada** — o usuário fica sem papel e, por
  `can_view_board`, não enxerga uma única linha do board.

A função nunca levanta exceção (bloco `EXCEPTION WHEN OTHERS THEN RETURN NEW`
com `RAISE WARNING`): uma falha aqui não pode impedir a criação do usuário, e
falhar sem conceder papel é falhar de forma segura.

### Códigos de erro

| SQLSTATE | Significado                       | Mensagem ao usuário                    |
| -------- | --------------------------------- | -------------------------------------- |
| `W2001`  | ator não é admin                  | "Você não tem permissão para esta ação" |
| `W2002`  | tentativa de auto-rebaixamento    | "Você não pode remover seu próprio acesso de administrador" |
| `W2003`  | deixaria a plataforma sem admin   | "É necessário ao menos um administrador" |
| `W2004`  | convite inválido, duplicado ou expirado | mensagem específica do caso      |

`W2001` é deliberadamente genérico para o cliente: não revela se o usuário-alvo
existe nem qual o papel dele. O detalhe fica na auditoria.

---

## Bootstrap do primeiro admin

Migration idempotente que localiza `diego.freitas@way2.com.br` em `auth.users`,
define `app.audit_action = 'bootstrap'` e substitui seu papel por `admin`. O
trigger de auditoria grava a linha com `actor_user_id NULL`, deixando registrado
que a concessão veio de migration e não de uma ação de usuário.

Se o e-mail não existir, a migration **falha com mensagem explícita** em vez de
aplicar em silêncio e deixar a plataforma sem administrador.

O bootstrap acontece por migration — nunca por endpoint da aplicação. Um endpoint
"tornar-se admin", ainda que protegido, é superfície de ataque desnecessária.

---

## Fechamento do cadastro público

Três camadas, sendo a terceira a que realmente protege:

| Camada          | O quê                                                   | Se falhar sozinha       |
| --------------- | ------------------------------------------------------- | ----------------------- |
| UI              | remover o modo "Criar acesso" de `AuthCard.tsx`          | apenas cosmética        |
| Painel Supabase | desligar *Allow new users to sign up* — **passo manual** | próxima camada segura   |
| Banco           | `handle_new_user` + `can_view_board`                     | ✅ proteção efetiva     |

`supabase/config.toml` contém apenas `project_id` — a configuração de Auth é
gerenciada pelo Lovable Cloud e não é versionável neste repositório. Por isso o
desenho não depende do toggle do painel.

### Fluxo de convite

1. Admin preenche e-mail + papel na tela `/admin`.
2. Cliente chama `create_invitation` → registro em `invitations`.
3. Server function `generateInviteLink` (service_role) chama
   `supabaseAdmin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: <origin>/aceitar-convite } })`.
4. `generateLink` cria o registro em `auth.users` → `handle_new_user` dispara →
   papel concedido, convite marcado como consumido.
5. A UI exibe o `action_link` com botão **Copiar link** — o admin envia por Teams.
6. A pessoa abre o link, cai em `/aceitar-convite` já com sessão e define a senha
   via `supabase.auth.updateUser({ password })`.

**Por que `generateLink` e não `inviteUserByEmail`:** o SMTP padrão do Supabase
limita a cerca de 2 e-mails por hora, insuficiente para convidar o time.
`generateLink` devolve o link sem depender de SMTP, eliminando o bloqueio.
Configurar SMTP próprio e trocar para envio automático continua possível depois,
sem mudança no modelo de dados.

**Reenvio:** para um convidado que não usou o link a tempo, a tela oferece
"Gerar novo link", que usa `generateLink({ type: 'magiclink' })` — `type: 'invite'`
falha quando o usuário já existe.

**Expiração:** a tabela guarda 7 dias, mas o link do Supabase expira conforme o
*Email OTP Expiration* do projeto (padrão 24 h). Recomenda-se alinhar o painel
para 7 dias; enquanto não estiver alinhado, "Gerar novo link" cobre a diferença.

---

## Frontend

| Arquivo                                    | Mudança                                                |
| ------------------------------------------ | ------------------------------------------------------ |
| `src/hooks/use-role.ts` **(novo)**         | `{ role, isAdmin, canEdit, loading }`                   |
| `src/routes/admin.tsx` **(novo)**          | tela de administração; 403 limpo para não-admin         |
| `src/routes/aceitar-convite.tsx` **(novo)**| define a senha a partir do link de convite              |
| `src/components/admin/UserTable.tsx` **(novo)**   | usuários, papel, último acesso, ações           |
| `src/components/admin/InviteDialog.tsx` **(novo)**| e-mail + papel + link copiável                  |
| `src/components/admin/AuditLog.tsx` **(novo)**    | histórico de mudanças de papel                  |
| `src/integrations/supabase/admin-fns.ts` **(novo)**| server functions `listPlatformUsers`, `generateInviteLink` |
| `src/lib/admin-errors.ts` **(novo)**       | mapeia SQLSTATE → mensagem pt-BR                        |
| `src/components/AuthCard.tsx`              | remove o modo "criar conta"                             |
| `src/components/BoardGrid.tsx`             | recebe `canEdit`; link "Usuários" só para admin         |

### `useRole()`

Consulta `user_roles` do próprio usuário — permitido pela policy
`user_roles_select_own` já existente. Uma query por sessão, cacheada pelo
TanStack Query.

### Server functions

Ambas usam o middleware `requireSupabaseAuth` já existente e, **antes** de tocar
em `service_role`, reconfirmam o papel lendo `user_roles` com o token do próprio
usuário (portanto sob RLS, não spoofável):

- `listPlatformUsers` — `supabaseAdmin.auth.admin.listUsers()` paginado, cruzado
  com `user_roles`. Necessário porque `auth.users` não é exposto ao cliente.
  Registra aviso em log se houver mais de uma página, para não truncar a lista
  silenciosamente. Um usuário com `email_confirmed_at` nulo e `last_sign_in_at`
  nulo aparece como **convite pendente de aceite** — como `generateLink` já cria
  o registro em `auth.users`, é assim que se distingue quem ainda não entrou.
- `generateInviteLink` — descrito no fluxo de convite acima.

### Gating de UI

`viewer` não vê os botões de escrita do board; não-admin não vê o link
"Usuários". Isso é **exclusivamente conveniência visual** — um cliente forjado
bate na RLS. Nenhuma decisão de segurança depende do front.

---

## Tratamento de erros

Erros do Postgres são mapeados por SQLSTATE em `src/lib/admin-errors.ts` e
exibidos via `sonner`, em pt-BR, seguindo o padrão já usado no projeto. Erros
desconhecidos exibem mensagem genérica; a mensagem crua vai para o console.

---

## Verificação

O projeto não possui *test runner* (não há vitest/jest em `package.json`) e esta
demanda **não introduz um** — seria escopo alheio ao pedido.

### `supabase/tests/rbac_smoke.sql`

Script assertivo (`DO $$ ... RAISE EXCEPTION`) executável no SQL Editor, cobrindo:

1. usuário sem papel não lê `devs`/`sprints`/`allocations`/`teams`
2. `viewer` lê mas não escreve no board
3. `editor` escreve no board mas não altera `user_roles`
4. `admin` altera papéis
5. admin não consegue remover o próprio papel de admin (`W2002`)
6. remover o último admin falha, tanto pela RPC quanto por `DELETE` direto (`W2003`)
7. toda mudança de papel gerou linha em `role_audit_log`
8. `UPDATE`/`DELETE` em `role_audit_log` são negados
9. convite expirado não concede papel na criação do usuário
10. criação de usuário sem convite não concede papel

### Roteiro manual

Com o app rodando, verificar: login como admin → tela `/admin` acessível; login
como editor → link "Usuários" ausente e `/admin` retorna 403; convidar um e-mail
de teste → link copiável funciona → senha definida → papel correto aplicado;
rebaixar o editor para viewer → botões de escrita somem após recarregar.

---

## Passos manuais fora do código

1. **Desligar o cadastro público** no painel Supabase
   (*Authentication → Sign In / Providers → Allow new users to sign up*). Sem
   isso, um desconhecido ainda consegue criar uma conta órfã — que não enxerga
   nada, mas ocupa a base.
2. **Alinhar o *Email OTP Expiration*** para 7 dias, casando com a expiração dos
   convites. Opcional; "Gerar novo link" cobre enquanto não for feito.

---

## Ordem de implementação

1. Migration A — `invitations`, `role_audit_log`, `can_view_board`,
   `UNIQUE (user_id)`, triggers de auditoria e de último admin
2. Migration B — RPCs `set_user_role` e `create_invitation`, trigger
   `handle_new_user`, fechamento das policies de `SELECT`
3. Migration C — bootstrap do primeiro admin
4. `rbac_smoke.sql` e execução
5. `use-role.ts` + gating em `BoardGrid`
6. `admin-fns.ts` + `admin-errors.ts`
7. Tela `/admin` (tabela, convite, auditoria)
8. `/aceitar-convite` + remoção do cadastro público de `AuthCard`
9. Roteiro manual

As migrations A e B são separadas de propósito: A é aditiva e reversível; B muda
o comportamento de acesso. Se algo der errado em B, A já está estável.
