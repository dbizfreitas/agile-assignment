# Administração de usuários e papéis (RBAC) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir configurar administradores da plataforma e gerenciar quem entra e o que cada pessoa pode fazer, com todo o enforcement no banco de dados.

**Architecture:** Três migrations SQL adicionam convites, auditoria imutável, travas anti-lockout e RPCs `SECURITY DEFINER` que derivam o ator de `auth.uid()` — impossibilitando agir em nome de outro. O front consome essas RPCs diretamente; `service_role` é usada apenas nas duas operações que a exigem (listar e-mails e gerar link de convite), sempre atrás de reverificação do papel sob RLS.

**Tech Stack:** PostgreSQL 15 (Supabase), TanStack Start + React 19, TanStack Query v5, shadcn/ui, Tailwind v4, TypeScript.

**Spec:** [`docs/superpowers/specs/2026-08-08-admin-rbac-design.md`](../specs/2026-08-08-admin-rbac-design.md)

## Global Constraints

- **Idioma da UI:** pt-BR em todo texto visível, com acentuação correta.
- **Papéis:** exatamente três — `admin`, `editor`, `viewer` (enum `public.app_role` já existente). Um papel por usuário.
- **E-mail do primeiro admin:** `diego.freitas@way2.com.br`.
- **Expiração de convite:** 7 dias.
- **Códigos de erro:** `W2001` (sem permissão), `W2002` (auto-rebaixamento), `W2003` (último admin), `W2004` (convite inválido).
- **Toda função SQL nova:** `SECURITY DEFINER` + `SET search_path = public`, com `EXECUTE` revogado de `public` e `anon`.
- **Helpers internos** vão no schema `private`; **RPCs chamadas pelo cliente** vão no schema `public` (o `private` não é exposto pelo PostgREST).
- **Não introduzir test runner.** A verificação é o script `supabase/tests/rbac_smoke.sql` mais o roteiro manual da Task 9.
- **Não fazer `git push`.** O repositório sincroniza com o Lovable; o push é decisão do usuário ao final.
- **Nunca reescrever histórico** (sem `rebase`, `amend` ou `squash` de commits publicados) — restrição do `AGENTS.md`.

### Como aplicar as migrations

Os arquivos ficam versionados em `supabase/migrations/`, mas **não são aplicados automaticamente** neste ambiente local. Para cada migration:

1. Abrir o SQL Editor do projeto Supabase `lpgkridgduuquteopnaj`.
2. Colar o conteúdo integral do arquivo `.sql`.
3. Executar e confirmar "Success. No rows returned".

Alternativa, se o executor tiver a senha do banco: `npx supabase link --project-ref lpgkridgduuquteopnaj` seguido de `npx supabase db push`.

### Como rodar o script de verificação

`supabase/tests/rbac_smoke.sql` roda dentro de `BEGIN ... ROLLBACK`, cria usuários de teste temporários e **não deixa resíduo**. Colar no SQL Editor e executar. Sucesso = "Success. No rows returned". Falha = `ERROR:` com a mensagem da asserção.

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `supabase/migrations/20260808120000_rbac_foundation.sql` | Tabelas `invitations` e `role_audit_log`, helper `can_view_board`, `UNIQUE (user_id)`, triggers de auditoria e de último admin |
| `supabase/migrations/20260808121000_rbac_rpc_policies.sql` | RPCs `set_user_role` e `create_invitation`, trigger `handle_new_user`, fechamento das policies de `SELECT` |
| `supabase/migrations/20260808122000_rbac_bootstrap_admin.sql` | Promove o primeiro admin |
| `supabase/tests/rbac_smoke.sql` | Suíte assertiva de 10 invariantes |
| `src/lib/admin.ts` | Tipos client-safe compartilhados (`AppRole`, `PlatformUser`, `AuditEntry`) |
| `src/lib/admin-errors.ts` | SQLSTATE → mensagem pt-BR |
| `src/hooks/use-role.ts` | Papel do usuário logado |
| `src/integrations/supabase/admin.server.ts` | Lógica que exige `service_role` |
| `src/integrations/supabase/admin-fns.ts` | Server functions expostas ao cliente |
| `src/components/admin/UserTable.tsx` | Tabela de usuários + troca de papel |
| `src/components/admin/InviteDialog.tsx` | Convite + link copiável |
| `src/components/admin/AuditLog.tsx` | Histórico de mudanças |
| `src/components/admin/AdminView.tsx` | Shell da tela, compõe os três acima |
| `src/routes/admin.tsx` | Rota `/admin` com guarda de papel |
| `src/routes/aceitar-convite.tsx` | Define a senha a partir do link |

**Modificar:**

| Arquivo | Mudança |
| --- | --- |
| `src/integrations/supabase/types.ts` | Tipos das novas tabelas e funções |
| `src/routes/index.tsx` | Passa `canEdit`/`isAdmin` ao board; trata quem não tem papel |
| `src/components/BoardGrid.tsx` | Gating visual de escrita; link "Usuários" |
| `src/components/AuthCard.tsx` | Remove o modo "Criar acesso" |

---

## Task 1: Fundação do banco — convites, auditoria e travas

**Files:**
- Create: `supabase/migrations/20260808120000_rbac_foundation.sql`
- Create: `supabase/tests/rbac_smoke.sql`

**Interfaces:**
- Consumes: `public.app_role`, `public.user_roles`, `private.has_role(uuid, app_role)` — já existentes.
- Produces: tabelas `public.invitations`, `public.role_audit_log`; enum `public.role_audit_action`; função `private.can_view_board(uuid) RETURNS boolean`; triggers `audit_user_roles` e `guard_last_admin` em `public.user_roles`; constraint `user_roles_user_id_key`.

- [ ] **Step 1: Escrever a asserção estrutural que falha**

Criar `supabase/tests/rbac_smoke.sql` com o cabeçalho e a seção 1:

```sql
-- Suíte de verificação do RBAC.
-- Roda inteiramente dentro de uma transação com ROLLBACK: não deixa resíduo.
-- Colar no SQL Editor do Supabase e executar por completo.
BEGIN;

-- ============================================================
-- Seção 1 — Estrutura (Task 1)
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.invitations') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.1: tabela public.invitations não existe';
  END IF;
  IF to_regclass('public.role_audit_log') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.2: tabela public.role_audit_log não existe';
  END IF;
  IF to_regproc('private.can_view_board') IS NULL THEN
    RAISE EXCEPTION 'FALHA 1.3: função private.can_view_board não existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_key' AND conrelid = 'public.user_roles'::regclass
  ) THEN
    RAISE EXCEPTION 'FALHA 1.4: constraint UNIQUE (user_id) ausente em user_roles';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.user_roles'::regclass AND tgname = 'audit_user_roles'
  ) THEN
    RAISE EXCEPTION 'FALHA 1.5: trigger audit_user_roles ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.user_roles'::regclass AND tgname = 'guard_last_admin'
  ) THEN
    RAISE EXCEPTION 'FALHA 1.6: trigger guard_last_admin ausente';
  END IF;
  RAISE NOTICE 'Seção 1 OK';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Colar `supabase/tests/rbac_smoke.sql` no SQL Editor e executar.
Esperado: `ERROR: FALHA 1.1: tabela public.invitations não existe`

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260808120000_rbac_foundation.sql`:

```sql
-- ============================================================
-- 1. Um papel por usuário
-- ============================================================
-- O schema atual permite acumular papéis (UNIQUE (user_id, role)).
-- O modelo passa a ser um papel por pessoa. Remove duplicatas mantendo
-- o mais privilegiado, para a constraint aplicar sem conflito.
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.user_id = b.user_id
  AND a.id <> b.id
  AND array_position(ARRAY['admin','editor','viewer']::public.app_role[], a.role)
    > array_position(ARRAY['admin','editor','viewer']::public.app_role[], b.role);

ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);

-- ============================================================
-- 2. Convites
-- ============================================================
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role public.app_role NOT NULL,
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_email_lowercase CHECK (email = lower(email))
);

-- Um convite pendente por e-mail; reconvidar após consumo continua possível.
CREATE UNIQUE INDEX invitations_pending_email_idx
  ON public.invitations (email) WHERE consumed_at IS NULL;

GRANT SELECT ON public.invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.invitations TO service_role;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY invitations_select_admin ON public.invitations
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 3. Auditoria imutável
-- ============================================================
CREATE TYPE public.role_audit_action AS ENUM ('invite','grant','revoke','bootstrap');

CREATE TABLE public.role_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action public.role_audit_action NOT NULL,
  target_user_id uuid,
  target_email text,
  actor_user_id uuid,
  actor_email text,
  previous_role public.app_role,
  new_role public.app_role,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX role_audit_log_created_at_idx ON public.role_audit_log (created_at DESC);

GRANT SELECT ON public.role_audit_log TO authenticated;
GRANT SELECT ON public.role_audit_log TO service_role;
-- Append-only: nem a aplicação com service_role reescreve o histórico.
-- Os triggers inserem como owner da função, sem depender destes grants.
REVOKE INSERT, UPDATE, DELETE ON public.role_audit_log FROM authenticated, service_role;

ALTER TABLE public.role_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_audit_log_select_admin ON public.role_audit_log
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 4. Helper de leitura do board
-- ============================================================
CREATE OR REPLACE FUNCTION private.can_view_board(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;

REVOKE ALL ON FUNCTION private.can_view_board(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.can_view_board(uuid) TO authenticated, service_role;

-- ============================================================
-- 5. Trigger de auditoria
-- ============================================================
-- Escrever a auditoria aqui, e não na aplicação, garante que nenhum caminho
-- de código consiga alterar papel sem deixar registro.
CREATE OR REPLACE FUNCTION private.audit_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_override text := nullif(current_setting('app.audit_action', true), '');
  v_action public.role_audit_action;
  v_target uuid;
  v_prev public.app_role;
  v_new public.app_role;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_target := NEW.user_id; v_new := NEW.role;
  ELSIF TG_OP = 'UPDATE' THEN
    v_target := NEW.user_id; v_prev := OLD.role; v_new := NEW.role;
  ELSE
    v_target := OLD.user_id; v_prev := OLD.role;
  END IF;

  IF v_override IS NOT NULL THEN
    v_action := v_override::public.role_audit_action;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'revoke';
  ELSE
    v_action := 'grant';
  END IF;

  INSERT INTO public.role_audit_log (
    action, target_user_id, target_email,
    actor_user_id, actor_email, previous_role, new_role
  ) VALUES (
    v_action,
    v_target,
    (SELECT email FROM auth.users WHERE id = v_target),
    v_actor,
    (SELECT email FROM auth.users WHERE id = v_actor),
    v_prev,
    v_new
  );

  RETURN NULL;
END $$;

CREATE TRIGGER audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION private.audit_user_roles();

-- ============================================================
-- 6. Trava do último administrador
-- ============================================================
-- Rede de segurança independente da RPC: protege inclusive contra
-- um DELETE manual no SQL Editor.
CREATE OR REPLACE FUNCTION private.guard_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role <> 'admin'::public.app_role THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role = 'admin'::public.app_role THEN
    RETURN NEW;
  END IF;

  IF (SELECT count(*) FROM public.user_roles
      WHERE role = 'admin'::public.app_role AND user_id <> OLD.user_id) = 0 THEN
    RAISE EXCEPTION 'É necessário ao menos um administrador na plataforma'
      USING ERRCODE = 'W2003';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE TRIGGER guard_last_admin
BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION private.guard_last_admin();
```

- [ ] **Step 4: Aplicar a migration**

Colar o conteúdo de `supabase/migrations/20260808120000_rbac_foundation.sql` no SQL Editor e executar.
Esperado: `Success. No rows returned`

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Executar `supabase/tests/rbac_smoke.sql`.
Esperado: `Success. No rows returned`, com `NOTICE: Seção 1 OK` no painel de mensagens.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260808120000_rbac_foundation.sql supabase/tests/rbac_smoke.sql
git commit -m "feat(db): add invitations, immutable role audit log and admin guards"
```

---

## Task 2: RPCs de mutação e fechamento das policies de leitura

**Files:**
- Create: `supabase/migrations/20260808121000_rbac_rpc_policies.sql`
- Modify: `supabase/tests/rbac_smoke.sql` (acrescentar Seção 2, antes do `ROLLBACK`)

**Interfaces:**
- Consumes: tudo produzido pela Task 1.
- Produces:
  - `public.set_user_role(_target uuid, _role public.app_role) RETURNS void`
  - `public.create_invitation(_email text, _role public.app_role) RETURNS uuid`
  - `public.handle_new_user()` + trigger `on_auth_user_created` em `auth.users`
  - Policies `devs_select_viewers`, `teams_select_viewers`, `sprints_select_viewers`, `allocations_select_viewers`

- [ ] **Step 1: Escrever as asserções comportamentais que falham**

Em `supabase/tests/rbac_smoke.sql`, inserir **antes** da linha `ROLLBACK;`:

```sql
-- ============================================================
-- Seção 2 — Comportamento (Task 2)
-- ============================================================
DO $$
DECLARE
  v_admin uuid := '11111111-1111-1111-1111-111111111111';
  v_editor uuid := '22222222-2222-2222-2222-222222222222';
  v_nobody uuid := '33333333-3333-3333-3333-333333333333';
  v_invited uuid := '44444444-4444-4444-4444-444444444444';
  v_expired uuid := '55555555-5555-5555-5555-555555555555';
  v_count int;
  v_role public.app_role;
BEGIN
  -- Fixtures: usuários temporários (a transação faz ROLLBACK ao final)
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'smoke-admin@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_editor, 'authenticated', 'authenticated',
     'smoke-editor@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false),
    ('00000000-0000-0000-0000-000000000000', v_nobody, 'authenticated', 'authenticated',
     'smoke-nobody@test.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false);

  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_admin, 'admin'), (v_editor, 'editor');

  -- 2.1 — RPC exige admin
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_editor, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.set_user_role(v_nobody, 'editor'::public.app_role);
    RAISE EXCEPTION 'FALHA 2.1: editor conseguiu alterar papel';
  EXCEPTION WHEN sqlstate 'W2001' THEN NULL;
  END;

  -- 2.2 — admin concede papel e gera auditoria
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.set_user_role(v_nobody, 'viewer'::public.app_role);
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_nobody;
  IF v_role IS DISTINCT FROM 'viewer'::public.app_role THEN
    RAISE EXCEPTION 'FALHA 2.2: papel viewer não aplicado';
  END IF;
  SELECT count(*) INTO v_count FROM public.role_audit_log
   WHERE target_user_id = v_nobody AND actor_user_id = v_admin AND action = 'grant';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALHA 2.3: auditoria de concessão ausente (achou %)', v_count;
  END IF;

  -- 2.4 — auto-rebaixamento bloqueado
  BEGIN
    PERFORM public.set_user_role(v_admin, 'editor'::public.app_role);
    RAISE EXCEPTION 'FALHA 2.4: admin rebaixou a si mesmo';
  EXCEPTION WHEN sqlstate 'W2002' THEN NULL;
  END;

  -- 2.5 — último admin protegido contra DELETE direto.
  -- Remove os demais admins primeiro (a transação faz ROLLBACK), para que
  -- v_admin seja de fato o último e a trava tenha o que proteger.
  DELETE FROM public.user_roles
   WHERE role = 'admin'::public.app_role AND user_id <> v_admin;
  BEGIN
    DELETE FROM public.user_roles WHERE user_id = v_admin;
    RAISE EXCEPTION 'FALHA 2.5: último admin foi removido';
  EXCEPTION WHEN sqlstate 'W2003' THEN NULL;
  END;

  -- 2.6 — auditoria é imutável para a aplicação
  BEGIN
    SET LOCAL ROLE authenticated;
    DELETE FROM public.role_audit_log WHERE target_user_id = v_nobody;
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 2.6: authenticated apagou linha da auditoria';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE;
  END;

  -- 2.7 — convite válido concede papel na criação do usuário
  PERFORM public.create_invitation('smoke-invited@test.local', 'editor'::public.app_role);
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_invited, 'authenticated', 'authenticated',
     'smoke-invited@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false);
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = v_invited;
  IF v_role IS DISTINCT FROM 'editor'::public.app_role THEN
    RAISE EXCEPTION 'FALHA 2.7: convite não concedeu o papel editor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invitations
                  WHERE email = 'smoke-invited@test.local' AND consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FALHA 2.8: convite não foi marcado como consumido';
  END IF;

  -- 2.9 — convite expirado não concede papel
  INSERT INTO public.invitations (email, role, invited_by, expires_at)
  VALUES ('smoke-expired@test.local', 'admin', v_admin, now() - interval '1 day');
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_expired, 'authenticated', 'authenticated',
     'smoke-expired@test.local', '', now(), now(), '{}'::jsonb, '{}'::jsonb, false);
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_expired) THEN
    RAISE EXCEPTION 'FALHA 2.9: convite expirado concedeu papel';
  END IF;

  -- 2.10 — usuário sem papel não lê o board
  IF private.can_view_board(v_expired) THEN
    RAISE EXCEPTION 'FALHA 2.10: usuário sem papel enxerga o board';
  END IF;
  IF NOT private.can_view_board(v_editor) THEN
    RAISE EXCEPTION 'FALHA 2.11: editor não enxerga o board';
  END IF;

  -- 2.12 — policies de SELECT do board exigem papel
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'devs' AND policyname = 'devs_select_authenticated'
  ) THEN
    RAISE EXCEPTION 'FALHA 2.12: policy permissiva devs_select_authenticated ainda existe';
  END IF;

  RAISE NOTICE 'Seção 2 OK';
END $$;
```

- [ ] **Step 2: Rodar e confirmar que falha**

Executar `supabase/tests/rbac_smoke.sql`.
Esperado: `ERROR: function public.set_user_role(uuid, app_role) does not exist`

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260808121000_rbac_rpc_policies.sql`:

```sql
-- ============================================================
-- 1. Mutação de papel
-- ============================================================
-- O ator vem de auth.uid(), nunca de parâmetro: é impossível agir
-- em nome de outra pessoa, mesmo com a service_role key.
CREATE OR REPLACE FUNCTION public.set_user_role(_target uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current public.app_role;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  SELECT role INTO v_current FROM public.user_roles WHERE user_id = _target;

  IF v_actor = _target
     AND v_current = 'admin'::public.app_role
     AND _role IS DISTINCT FROM 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Você não pode remover seu próprio acesso de administrador'
      USING ERRCODE = 'W2002';
  END IF;

  PERFORM set_config('app.actor_id', v_actor::text, true);

  IF _role IS NULL THEN
    DELETE FROM public.user_roles WHERE user_id = _target;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target, _role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
    WHERE user_roles.role IS DISTINCT FROM EXCLUDED.role;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_user_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) TO authenticated;

-- ============================================================
-- 2. Criação de convite
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_invitation(_email text, _role public.app_role)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := lower(trim(_email));
  v_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT private.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = 'W2001';
  END IF;

  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'E-mail inválido' USING ERRCODE = 'W2004';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'Já existe um usuário com este e-mail' USING ERRCODE = 'W2004';
  END IF;

  IF EXISTS (SELECT 1 FROM public.invitations
              WHERE email = v_email AND consumed_at IS NULL AND expires_at > now()) THEN
    RAISE EXCEPTION 'Já existe um convite pendente para este e-mail' USING ERRCODE = 'W2004';
  END IF;

  -- Limpa convites pendentes já expirados para liberar o índice único
  DELETE FROM public.invitations WHERE email = v_email AND consumed_at IS NULL;

  INSERT INTO public.invitations (email, role, invited_by)
  VALUES (v_email, _role, v_actor)
  RETURNING id INTO v_id;

  -- Nenhuma linha de user_roles muda aqui, então o trigger de auditoria
  -- não dispara: a própria função registra o evento.
  INSERT INTO public.role_audit_log (action, target_email, actor_user_id, actor_email, new_role)
  VALUES ('invite', v_email, v_actor, (SELECT email FROM auth.users WHERE id = v_actor), _role);

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.create_invitation(text, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_invitation(text, public.app_role) TO authenticated;

-- ============================================================
-- 3. Concessão de papel na criação do usuário
-- ============================================================
-- Sem convite válido, nenhum papel é concedido — e sem papel o usuário
-- não enxerga uma única linha do board. Deny by default.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.invitations%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM public.invitations
   WHERE email = lower(NEW.email)
     AND consumed_at IS NULL
     AND expires_at > now()
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    PERFORM set_config('app.actor_id', inv.invited_by::text, true);
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, inv.role)
    ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.invitations SET consumed_at = now() WHERE id = inv.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Falhar aqui não pode impedir a criação do usuário. Falhar sem
  -- conceder papel é falhar de forma segura.
  RAISE WARNING 'handle_new_user falhou para %: %', NEW.email, SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 4. Fechamento das policies de leitura
-- ============================================================
-- Antes: USING (true) — qualquer autenticado lia o board inteiro.
DROP POLICY IF EXISTS devs_select_authenticated ON public.devs;
CREATE POLICY devs_select_viewers ON public.devs
  FOR SELECT TO authenticated USING (private.can_view_board(auth.uid()));

DROP POLICY IF EXISTS teams_select_authenticated ON public.teams;
CREATE POLICY teams_select_viewers ON public.teams
  FOR SELECT TO authenticated USING (private.can_view_board(auth.uid()));

DROP POLICY IF EXISTS sprints_select_authenticated ON public.sprints;
CREATE POLICY sprints_select_viewers ON public.sprints
  FOR SELECT TO authenticated USING (private.can_view_board(auth.uid()));

DROP POLICY IF EXISTS allocations_select_authenticated ON public.allocations;
CREATE POLICY allocations_select_viewers ON public.allocations
  FOR SELECT TO authenticated USING (private.can_view_board(auth.uid()));
```

- [ ] **Step 4: Aplicar a migration**

Colar o conteúdo de `supabase/migrations/20260808121000_rbac_rpc_policies.sql` no SQL Editor e executar.
Esperado: `Success. No rows returned`

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Executar `supabase/tests/rbac_smoke.sql`.
Esperado: `Success. No rows returned`, com `NOTICE: Seção 1 OK` e `NOTICE: Seção 2 OK`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260808121000_rbac_rpc_policies.sql supabase/tests/rbac_smoke.sql
git commit -m "feat(db): add role mutation RPCs, invite flow and deny-by-default read policies"
```

---

## Task 3: Bootstrap do primeiro administrador

**Files:**
- Create: `supabase/migrations/20260808122000_rbac_bootstrap_admin.sql`

**Interfaces:**
- Consumes: `public.user_roles`, GUC `app.audit_action` lido por `private.audit_user_roles()`.
- Produces: uma linha `admin` em `public.user_roles` e uma linha `bootstrap` em `public.role_audit_log`.

- [ ] **Step 1: Confirmar que ainda não existe admin**

Rodar no SQL Editor:

```sql
SELECT u.email, r.role
FROM public.user_roles r
JOIN auth.users u ON u.id = r.user_id
ORDER BY r.role;
```

Esperado: nenhuma linha com `role = 'admin'`. Se já houver, pular para o Step 4.

- [ ] **Step 2: Escrever a migration**

Criar `supabase/migrations/20260808122000_rbac_bootstrap_admin.sql`:

```sql
-- Bootstrap do primeiro administrador.
-- Feito por migration, nunca por endpoint da aplicação: um endpoint
-- "tornar-se admin" é superfície de ataque desnecessária.
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM auth.users
   WHERE lower(email) = 'diego.freitas@way2.com.br';

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Bootstrap abortado: diego.freitas@way2.com.br não existe em auth.users. Faça login uma vez na aplicação antes de aplicar esta migration.';
  END IF;

  PERFORM set_config('app.audit_action', 'bootstrap', true);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_id, 'admin'::public.app_role)
  ON CONFLICT (user_id) DO UPDATE SET role = 'admin'::public.app_role
  WHERE user_roles.role IS DISTINCT FROM 'admin'::public.app_role;
END $$;
```

- [ ] **Step 3: Aplicar a migration**

Colar no SQL Editor e executar.
Esperado: `Success. No rows returned`. Se aparecer `ERROR: Bootstrap abortado`, fazer login uma vez em https://agile-assignment.lovable.app com esse e-mail e executar de novo.

- [ ] **Step 4: Verificar o resultado**

```sql
SELECT u.email, r.role FROM public.user_roles r
JOIN auth.users u ON u.id = r.user_id WHERE r.role = 'admin';

SELECT action, target_email, actor_user_id, previous_role, new_role
FROM public.role_audit_log WHERE action = 'bootstrap';
```

Esperado: primeira query retorna `diego.freitas@way2.com.br | admin`; segunda retorna uma linha com `actor_user_id` nulo e `new_role = admin`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260808122000_rbac_bootstrap_admin.sql
git commit -m "feat(db): bootstrap first platform administrator"
```

---

## Task 4: Tipos, mapeamento de erros e hook de papel

**Files:**
- Create: `src/lib/admin.ts`
- Create: `src/lib/admin-errors.ts`
- Create: `src/hooks/use-role.ts`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes: RPCs da Task 2.
- Produces:
  - `AppRole = "admin" | "editor" | "viewer"`
  - `PlatformUser`, `AuditEntry`, `ROLE_LABELS`
  - `adminErrorMessage(error: unknown): string`
  - `useRole(userId: string | undefined)` → `{ role, isAdmin, canEdit, canView, loading }`

- [ ] **Step 1: Criar os tipos compartilhados**

Criar `src/lib/admin.ts`:

```ts
export type AppRole = "admin" | "editor" | "viewer";

export type PlatformUser = {
  id: string;
  email: string;
  role: AppRole | null;
  createdAt: string;
  lastSignInAt: string | null;
  pendingInvite: boolean;
};

export type AuditEntry = {
  id: string;
  action: "invite" | "grant" | "revoke" | "bootstrap";
  target_email: string | null;
  actor_email: string | null;
  previous_role: AppRole | null;
  new_role: AppRole | null;
  created_at: string;
};

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  editor: "Editor",
  viewer: "Leitor",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "Gerencia usuários e edita o quadro",
  editor: "Edita o quadro",
  viewer: "Apenas visualiza o quadro",
};

export const ACTION_LABELS: Record<AuditEntry["action"], string> = {
  invite: "Convite",
  grant: "Concessão",
  revoke: "Revogação",
  bootstrap: "Bootstrap",
};
```

- [ ] **Step 2: Criar o mapeamento de erros**

Criar `src/lib/admin-errors.ts`:

```ts
// SQLSTATE customizados definidos nas migrations de RBAC.
const MESSAGES: Record<string, string> = {
  W2001: "Você não tem permissão para esta ação.",
  W2002: "Você não pode remover seu próprio acesso de administrador.",
  W2003: "É necessário ao menos um administrador na plataforma.",
};

export function adminErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;

  if (code && MESSAGES[code]) return MESSAGES[code];

  // W2004 carrega a mensagem específica do caso (e-mail inválido,
  // convite duplicado, usuário já existente).
  if (code === "W2004") {
    return (error as { message?: string }).message ?? "Convite inválido.";
  }

  console.error("[admin]", error);
  return error instanceof Error && !code
    ? error.message
    : "Não foi possível concluir a operação.";
}
```

- [ ] **Step 3: Criar o hook de papel**

Criar `src/hooks/use-role.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/admin";

// Lê o papel do próprio usuário — permitido pela policy user_roles_select_own.
// O resultado é conveniência de UI; a autorização real está na RLS.
export function useRole(userId: string | undefined) {
  const q = useQuery({
    queryKey: ["user-role", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AppRole | null> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as AppRole | undefined) ?? null;
    },
  });

  const role = q.data ?? null;

  return {
    role,
    isAdmin: role === "admin",
    canEdit: role === "admin" || role === "editor",
    canView: role !== null,
    loading: q.isLoading,
  };
}
```

- [ ] **Step 4: Regenerar os tipos do Supabase**

```bash
npx supabase gen types typescript --project-id lpgkridgduuquteopnaj > src/integrations/supabase/types.ts
```

Se o comando pedir autenticação, gerar pelo painel (Project Settings → API → TypeScript) e colar o conteúdo em `src/integrations/supabase/types.ts`.

Esperado: o arquivo passa a conter `invitations`, `role_audit_log`, `set_user_role`, `create_invitation` e o enum `role_audit_action`.

- [ ] **Step 5: Verificar tipos e lint**

```bash
npx tsc --noEmit
```

Esperado: sem erros.

```bash
npm run lint
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin.ts src/lib/admin-errors.ts src/hooks/use-role.ts src/integrations/supabase/types.ts
git commit -m "feat(admin): add role hook, shared types and SQLSTATE error mapping"
```

---

## Task 5: Server functions com service_role

**Files:**
- Create: `src/integrations/supabase/admin.server.ts`
- Create: `src/integrations/supabase/admin-fns.ts`

**Interfaces:**
- Consumes: `requireSupabaseAuth` (`src/integrations/supabase/auth-middleware.ts`), `supabaseAdmin` (`src/integrations/supabase/client.server.ts`), tipos de `src/lib/admin.ts`.
- Produces:
  - `listPlatformUsers()` → `Promise<PlatformUser[]>`
  - `generateInviteLink({ data: { email: string; kind: "invite" | "magiclink" } })` → `Promise<{ link: string }>`

**Convenção obrigatória:** `admin-fns.ts` é importado por componentes React e vai para o bundle do cliente. A lógica que usa `service_role` fica em `admin.server.ts` e só é carregada por `await import()` **dentro** do handler — mesmo padrão de `src/integrations/jira/server-fns.ts`.

- [ ] **Step 1: Criar a camada server-only**

Criar `src/integrations/supabase/admin.server.ts`:

```ts
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./client.server";
import type { Database } from "./types";
import type { AppRole, PlatformUser } from "@/lib/admin";

// Reconfirma o papel usando o client do PRÓPRIO usuário (sob RLS), antes de
// qualquer uso da service_role. Não é spoofável pelo cliente.
export async function assertAdmin(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Não foi possível validar suas permissões");
  if (data?.role !== "admin") throw new Error("Sem permissão");
}

const PER_PAGE = 200;

export async function fetchPlatformUsers(): Promise<PlatformUser[]> {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: PER_PAGE,
  });
  if (error) throw error;

  if (data.users.length === PER_PAGE) {
    console.warn(
      `[admin] listUsers retornou ${PER_PAGE} usuários — pode existir mais de uma página. Implementar paginação.`,
    );
  }

  const { data: roles, error: rolesError } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role");
  if (rolesError) throw rolesError;

  const roleByUser = new Map<string, AppRole>(
    roles.map((r) => [r.user_id, r.role as AppRole]),
  );

  return data.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      role: roleByUser.get(u.id) ?? null,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      // generateLink já cria a linha em auth.users, então "nunca entrou"
      // é o sinal de convite ainda não aceito.
      pendingInvite: !u.last_sign_in_at,
    }))
    .sort((a, b) => a.email.localeCompare(b.email, "pt-BR"));
}

export async function createInviteLink(input: {
  email: string;
  kind: "invite" | "magiclink";
}): Promise<{ link: string }> {
  // A origem vem do próprio request, nunca do cliente: evita open redirect.
  const origin = getRequest()?.headers.get("origin");
  if (!origin) throw new Error("Origem da requisição não identificada");

  const email = input.email.toLowerCase().trim();
  const options = { redirectTo: `${origin}/aceitar-convite` };

  const { data, error } =
    input.kind === "invite"
      ? await supabaseAdmin.auth.admin.generateLink({ type: "invite", email, options })
      : await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email, options });

  if (error) throw error;

  const link = data.properties?.action_link;
  if (!link) throw new Error("O Supabase não retornou o link de convite");

  return { link };
}
```

- [ ] **Step 2: Criar as server functions**

Criar `src/integrations/supabase/admin-fns.ts`:

```ts
// Stubs de RPC client-safe. A lógica que usa service_role vive em
// admin.server.ts e só é importada dinamicamente dentro dos handlers.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlatformUser } from "@/lib/admin";

export const listPlatformUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformUser[]> => {
    const { assertAdmin, fetchPlatformUsers } = await import("./admin.server");
    await assertAdmin(context.supabase, context.userId);
    return fetchPlatformUsers();
  });

export const generateInviteLink = createServerFn({ method: "POST" })
  .validator((data: { email: string; kind: "invite" | "magiclink" }) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<{ link: string }> => {
    const { assertAdmin, createInviteLink } = await import("./admin.server");
    await assertAdmin(context.supabase, context.userId);
    return createInviteLink(data);
  });
```

- [ ] **Step 3: Verificar tipos**

```bash
npx tsc --noEmit
```

Esperado: sem erros. Se `generateLink` reclamar do tipo do parâmetro `options`, confirmar que `@supabase/supabase-js` está em `^2.111.0` no `package.json`.

- [ ] **Step 4: Confirmar que a service_role não vazou para o bundle**

```bash
npm run build && grep -rl "SUPABASE_SERVICE_ROLE_KEY" .output/public 2>/dev/null || echo "OK: service_role ausente do bundle do cliente"
```

Esperado: `OK: service_role ausente do bundle do cliente`

- [ ] **Step 5: Commit**

```bash
git add src/integrations/supabase/admin.server.ts src/integrations/supabase/admin-fns.ts
git commit -m "feat(admin): add server functions for user listing and invite links"
```

---

## Task 6: Tabela de usuários

**Files:**
- Create: `src/components/admin/UserTable.tsx`

**Interfaces:**
- Consumes: `listPlatformUsers`, `generateInviteLink`, `PlatformUser`, `ROLE_LABELS`, `adminErrorMessage`, RPC `set_user_role`.
- Produces: `<UserTable currentUserId={string} />`

- [ ] **Step 1: Criar o componente**

Criar `src/components/admin/UserTable.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateInviteLink, listPlatformUsers } from "@/integrations/supabase/admin-fns";
import { adminErrorMessage } from "@/lib/admin-errors";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type AppRole } from "@/lib/admin";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NO_ROLE = "__sem_papel__";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function UserTable({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();

  const usersQ = useQuery({
    queryKey: ["platform-users"],
    queryFn: () => listPlatformUsers(),
  });

  const setRole = useMutation({
    mutationFn: async (vars: { userId: string; role: AppRole | null }) => {
      const { error } = await supabase.rpc("set_user_role", {
        _target: vars.userId,
        _role: vars.role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Papel atualizado");
      void qc.invalidateQueries({ queryKey: ["platform-users"] });
      void qc.invalidateQueries({ queryKey: ["role-audit"] });
      void qc.invalidateQueries({ queryKey: ["user-role"] });
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  // O link de convite do Supabase pode expirar antes do convite em si
  // (Email OTP Expiration, padrão 24 h). "magiclink" funciona para um
  // usuário que já existe — "invite" falharia.
  const newLink = useMutation({
    mutationFn: async (email: string): Promise<string> => {
      const result = await generateInviteLink({ data: { email, kind: "magiclink" } });
      return result.link;
    },
    onSuccess: async (link) => {
      await navigator.clipboard.writeText(link);
      toast.success("Novo link copiado");
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  if (usersQ.isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Carregando usuários...</p>;
  }

  if (usersQ.isError) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {adminErrorMessage(usersQ.error)}
      </p>
    );
  }

  const users = usersQ.data ?? [];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>E-mail</TableHead>
            <TableHead className="w-40">Papel</TableHead>
            <TableHead className="w-32">Último acesso</TableHead>
            <TableHead className="w-32">Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">
                {u.email}
                {u.id === currentUserId ? (
                  <span className="ml-2 text-[10px] text-muted-foreground">(você)</span>
                ) : null}
              </TableCell>
              <TableCell>
                <Select
                  value={u.role ?? NO_ROLE}
                  disabled={setRole.isPending}
                  onValueChange={(value) =>
                    setRole.mutate({
                      userId: u.id,
                      role: value === NO_ROLE ? null : (value as AppRole),
                    })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        <span className="flex flex-col">
                          <span>{ROLE_LABELS[r]}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {ROLE_DESCRIPTIONS[r]}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={NO_ROLE}>
                      <span className="flex flex-col">
                        <span>Sem acesso</span>
                        <span className="text-[10px] text-muted-foreground">
                          Não enxerga o quadro
                        </span>
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(u.lastSignInAt)}
              </TableCell>
              <TableCell>
                {u.pendingInvite ? (
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                      Pendente
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Gerar e copiar um novo link de acesso"
                      disabled={newLink.isPending}
                      onClick={() => newLink.mutate(u.email)}
                    >
                      <Link2 className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Ativo</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos e lint**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/UserTable.tsx
git commit -m "feat(admin): add user table with role assignment"
```

---

## Task 7: Convite e trilha de auditoria

**Files:**
- Create: `src/components/admin/InviteDialog.tsx`
- Create: `src/components/admin/AuditLog.tsx`

**Interfaces:**
- Consumes: RPC `create_invitation`, `generateInviteLink`, tabela `role_audit_log`, `ACTION_LABELS`, `ROLE_LABELS`.
- Produces: `<InviteDialog />`, `<AuditLog />`

- [ ] **Step 1: Criar o diálogo de convite**

Criar `src/components/admin/InviteDialog.tsx`:

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateInviteLink } from "@/integrations/supabase/admin-fns";
import { adminErrorMessage } from "@/lib/admin-errors";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type AppRole } from "@/lib/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function InviteDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("editor");
  const [link, setLink] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: async (): Promise<string> => {
      // 1. Registra o convite (o ator vem de auth.uid() dentro da RPC).
      const { error } = await supabase.rpc("create_invitation", {
        _email: email,
        _role: role,
      });
      if (error) throw error;

      // 2. Cria o usuário e devolve o link. Não depende de SMTP.
      const result = await generateInviteLink({
        data: { email, kind: "invite" },
      });
      return result.link;
    },
    onSuccess: (value) => {
      setLink(value);
      toast.success("Convite criado. Copie o link e envie para a pessoa.");
      void qc.invalidateQueries({ queryKey: ["platform-users"] });
      void qc.invalidateQueries({ queryKey: ["role-audit"] });
    },
    onError: (error) => toast.error(adminErrorMessage(error)),
  });

  function reset() {
    setEmail("");
    setRole("editor");
    setLink(null);
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success("Link copiado");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="size-4" /> Convidar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar pessoa</DialogTitle>
          <DialogDescription>
            O convite gera um link válido por 7 dias. Copie e envie pelo Teams.
          </DialogDescription>
        </DialogHeader>

        {link ? (
          <div className="space-y-3">
            <Label htmlFor="invite-link">Link de convite</Label>
            <div className="flex gap-2">
              <Input id="invite-link" readOnly value={link} className="font-mono text-xs" />
              <Button type="button" variant="secondary" onClick={copy}>
                <Copy className="size-4" />
              </Button>
            </div>
            <Button type="button" variant="ghost" className="w-full" onClick={reset}>
              Convidar outra pessoa
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pessoa@way2.com.br"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Papel</Label>
              <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      <span className="flex flex-col">
                        <span>{ROLE_LABELS[r]}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {ROLE_DESCRIPTIONS[r]}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full" disabled={invite.isPending}>
              {invite.isPending ? "Gerando convite..." : "Gerar link de convite"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Criar a trilha de auditoria**

Criar `src/components/admin/AuditLog.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminErrorMessage } from "@/lib/admin-errors";
import { ACTION_LABELS, ROLE_LABELS, type AppRole, type AuditEntry } from "@/lib/admin";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function roleLabel(role: AppRole | null): string {
  return role ? ROLE_LABELS[role] : "—";
}

export function AuditLog() {
  const q = useQuery({
    queryKey: ["role-audit"],
    queryFn: async (): Promise<AuditEntry[]> => {
      const { data, error } = await supabase
        .from("role_audit_log")
        .select("id, action, target_email, actor_email, previous_role, new_role, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as AuditEntry[];
    },
  });

  if (q.isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Carregando histórico...</p>;
  }

  if (q.isError) {
    return <p className="py-10 text-center text-sm text-destructive">{adminErrorMessage(q.error)}</p>;
  }

  const entries = q.data ?? [];

  if (entries.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nenhuma alteração de papel registrada.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Quando</TableHead>
            <TableHead className="w-28">Ação</TableHead>
            <TableHead>Alvo</TableHead>
            <TableHead>Responsável</TableHead>
            <TableHead className="w-44">Mudança</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(e.created_at).toLocaleString("pt-BR")}
              </TableCell>
              <TableCell className="text-sm">{ACTION_LABELS[e.action]}</TableCell>
              <TableCell className="text-sm">{e.target_email ?? "—"}</TableCell>
              <TableCell className="text-sm">
                {e.actor_email ?? (
                  <span className="text-muted-foreground">fora da aplicação</span>
                )}
              </TableCell>
              <TableCell className="text-sm">
                {roleLabel(e.previous_role)} → {roleLabel(e.new_role)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Verificar tipos e lint**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/InviteDialog.tsx src/components/admin/AuditLog.tsx
git commit -m "feat(admin): add invite dialog with copyable link and audit trail"
```

---

## Task 8: Rota /admin com guarda de papel

**Files:**
- Create: `src/components/admin/AdminView.tsx`
- Create: `src/routes/admin.tsx`

**Interfaces:**
- Consumes: `UserTable`, `InviteDialog`, `AuditLog`, `useSession`, `useRole`, `AuthCard`.
- Produces: rota `/admin`.

- [ ] **Step 1: Criar o shell da tela**

Criar `src/components/admin/AdminView.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserTable } from "./UserTable";
import { InviteDialog } from "./InviteDialog";
import { AuditLog } from "./AuditLog";

export function AdminView({ currentUserId }: { currentUserId: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-header text-header-foreground">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Users className="size-4" />
          </span>
          <div className="mr-auto">
            <h1 className="text-base font-semibold leading-tight">Usuários</h1>
            <p className="text-[11px] text-muted-foreground">
              Quem acessa a plataforma e o que cada um pode fazer
            </p>
          </div>
          <InviteDialog />
          <Button size="sm" variant="ghost" asChild>
            <Link to="/">
              <ArrowLeft className="size-4" /> Quadro
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 p-4">
        <Tabs defaultValue="usuarios" className="space-y-4">
          <TabsList>
            <TabsTrigger value="usuarios">Usuários</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="usuarios">
            <UserTable currentUserId={currentUserId} />
          </TabsContent>
          <TabsContent value="historico">
            <AuditLog />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Criar a rota**

Criar `src/routes/admin.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { useRole } from "@/hooks/use-role";
import { AuthCard } from "@/components/AuthCard";
import { AdminView } from "@/components/admin/AdminView";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Usuários — Sprint Board" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { session, loading } = useSession();
  const { isAdmin, loading: roleLoading } = useRole(session?.user.id);

  if (loading || (session && roleLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!session) return <AuthCard />;

  // Gating puramente visual: quem forjar a requisição bate na RLS.
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-pop">
          <ShieldAlert className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-4 text-lg font-semibold">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta área é exclusiva para administradores da plataforma.
          </p>
          <Button className="mt-6 w-full" asChild>
            <Link to="/">Voltar ao quadro</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <AdminView currentUserId={session.user.id} />;
}
```

- [ ] **Step 3: Verificar tipos, lint e build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Esperado: sem erros. `src/routeTree.gen.ts` é regenerado com a rota `/admin`.

- [ ] **Step 4: Verificar no navegador**

Iniciar o servidor de desenvolvimento pela ferramenta de preview (nunca por `Bash`), navegar até `/admin` logado como `diego.freitas@way2.com.br` e confirmar: a tabela lista os usuários e as duas abas renderizam.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.tsx src/components/admin/AdminView.tsx src/routeTree.gen.ts
git commit -m "feat(admin): add /admin route guarded by role"
```

---

## Task 9: Aceite de convite, fechamento do cadastro e gating do quadro

**Files:**
- Create: `src/routes/aceitar-convite.tsx`
- Modify: `src/components/AuthCard.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `src/components/BoardGrid.tsx`

**Interfaces:**
- Consumes: `useRole`, `useSession`.
- Produces: rota `/aceitar-convite`; `BoardGrid` passa a receber `canEdit: boolean` e `isAdmin: boolean`.

- [ ] **Step 1: Criar a rota de aceite**

Criar `src/routes/aceitar-convite.tsx`:

```tsx
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { LayoutGrid } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/aceitar-convite")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Aceitar convite — Sprint Board" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AcceptInvite,
});

function AcceptInvite() {
  const navigate = useNavigate();
  // O link do convite traz o token no fragmento da URL; o supabase-js
  // troca por sessão automaticamente (detectSessionInUrl).
  const { session, loading } = useSession();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Senha definida. Bem-vindo!");
      await navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível definir a senha");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Validando convite...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-pop">
          <h1 className="text-lg font-semibold">Convite inválido ou expirado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Peça um novo link ao administrador da plataforma.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-pop">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <LayoutGrid className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Defina sua senha</h1>
            <p className="text-xs text-muted-foreground">{session.user.email}</p>
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Nova senha</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo de 8 caracteres"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Salvando..." : "Entrar na plataforma"}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Fechar o cadastro público**

Em `src/components/AuthCard.tsx`, substituir o corpo do componente pelo abaixo. Remove `mode`, o ramo `signUp` e o botão de alternância; o restante do layout é preservado.

```tsx
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LayoutGrid } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AuthCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível entrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-pop">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <LayoutGrid className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Sprint Board</h1>
            <p className="text-xs text-muted-foreground">Alocação de demandas do time</p>
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            Entrar
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          O acesso é concedido por convite. Fale com um administrador da plataforma.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Tratar quem não tem papel, em `src/routes/index.tsx`**

Substituir a função `Index` (mantendo os imports existentes e acrescentando os novos):

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { useRole } from "@/hooks/use-role";
import { AuthCard } from "@/components/AuthCard";
import { BoardGrid } from "@/components/BoardGrid";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
```

```tsx
function Index() {
  const { session, loading } = useSession();
  const { canEdit, isAdmin, canView, loading: roleLoading } = useRole(session?.user.id);

  if (loading || (session && roleLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!session) return <AuthCard />;

  if (!canView) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 text-center shadow-pop">
          <ShieldAlert className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-4 text-lg font-semibold">Acesso ainda não liberado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sua conta existe, mas nenhum papel foi atribuído. Peça acesso a um administrador da
            plataforma.
          </p>
          <Button
            variant="outline"
            className="mt-6 w-full"
            onClick={() => supabase.auth.signOut()}
          >
            Sair
          </Button>
        </div>
      </div>
    );
  }

  return (
    <BoardGrid email={session.user.email ?? ""} canEdit={canEdit} isAdmin={isAdmin} />
  );
}
```

Manter o bloco `head:` e `createFileRoute` exatamente como estão.

- [ ] **Step 4: Aplicar o gating no `BoardGrid`**

Em `src/components/BoardGrid.tsx`, aplicar as sete edições abaixo.

**4a.** Nos imports de `lucide-react`, acrescentar `Users` à lista (ordem alfabética, após `UserPlus`).

**4b.** Assinatura do componente:

```tsx
export function BoardGrid({
  email,
  canEdit,
  isAdmin,
}: {
  email: string;
  canEdit: boolean;
  isAdmin: boolean;
}) {
```

**4c.** No header, envolver os botões "Sprint" e "Pessoa" em `{canEdit && (...)}` e acrescentar o link de administração antes do botão "Compromisso":

```tsx
            {canEdit ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSprintDialog({ open: true, sprint: null })}
                >
                  <CalendarPlus className="size-4" /> Sprint
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDevDialog({ open: true, dev: null })}
                >
                  <UserPlus className="size-4" /> Pessoa
                </Button>
              </>
            ) : null}
            {isAdmin ? (
              <Button size="sm" variant="ghost" asChild>
                <Link to="/admin">
                  <Users className="size-4" /> Usuários
                </Link>
              </Button>
            ) : null}
```

**4d.** No botão de cabeçalho de cada dev, trocar `onClick`:

```tsx
                          onClick={() => {
                            if (!canEdit) return;
                            setDevDialog({ open: true, dev: d });
                          }}
```

**4e.** Na renderização de `<SprintRow ... />`, acrescentar a prop `canEdit={canEdit}` e proteger os handlers:

```tsx
                  <SprintRow
                    key={s.id}
                    sprint={s}
                    devs={devs}
                    byCell={byCell}
                    matches={matches}
                    dragOver={dragOver}
                    setDragOver={setDragOver}
                    canEdit={canEdit}
                    onEditSprint={() => {
                      if (!canEdit) return;
                      setSprintDialog({ open: true, sprint: s });
                    }}
                    onAdd={(devId) => {
                      if (!canEdit) return;
                      setDraft({ sprint_id: s.id, dev_id: devId });
                    }}
                    onEdit={(a) => {
                      if (!canEdit) return;
                      setDraft(toDraft(a));
                    }}
                    onDrop={(id, devId) => {
                      if (!canEdit) return;
                      move.mutate({ id, sprint_id: s.id, dev_id: devId });
                    }}
                  />
```

**4f.** Em `SprintRow`, acrescentar `canEdit: boolean` na desestruturação e no tipo das props; passar `canEdit` ao `AllocationChip`; ocultar o botão `+ demanda` quando não puder editar:

```tsx
              {items.map((a) => (
                <AllocationChip
                  key={a.id}
                  allocation={a}
                  dimmed={!matches(a)}
                  allowWrap={items.length === 1}
                  canEdit={canEdit}
                  onEdit={() => onEdit(a)}
                />
              ))}
```

```tsx
            {canEdit ? (
              <button
                onClick={() => onAdd(d.id)}
                className="pointer-events-none absolute inset-x-1.5 top-full z-10 mt-0 flex items-center justify-center gap-1 rounded-md border border-dashed border-grid-line bg-surface/90 py-1 text-[11px] text-muted-foreground opacity-0 shadow-card backdrop-blur-sm transition-opacity hover:border-primary hover:text-primary group-hover/cell:pointer-events-auto group-hover/cell:opacity-100"
              >
                <Plus className="size-3" /> demanda
              </button>
            ) : null}
```

**4g.** Em `AllocationChip`, acrescentar `canEdit: boolean` na desestruturação e no tipo, e trocar o `<div>` interno:

```tsx
        <div
          draggable={canEdit}
          onDragStart={(e) => e.dataTransfer.setData("text/allocation", allocation.id)}
          onClick={onEdit}
          className={`shrink-0 overflow-hidden rounded-md border-l-[3px] px-2 py-1.5 text-left text-foreground shadow-card transition-opacity ${
            canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default"
          } ${washClass} ${accentClass} ${dimmed ? "opacity-25" : ""}`}
        >
```

Também substituir o `EmptyState` por uma mensagem de leitura quando não puder editar:

```tsx
          ) : sprints.length === 0 || devs.length === 0 ? (
            canEdit ? (
              <EmptyState
                hasDevs={devs.length > 0}
                onAddSprint={() => setSprintDialog({ open: true, sprint: null })}
                onAddDev={() => setDevDialog({ open: true, dev: null })}
              />
            ) : (
              <p className="py-20 text-center text-sm text-muted-foreground">
                O quadro ainda não foi montado.
              </p>
            )
          ) : (
```

- [ ] **Step 5: Verificar tipos, lint e build**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Esperado: sem erros.

- [ ] **Step 6: Rodar o roteiro manual**

Com o servidor de desenvolvimento aberto pela ferramenta de preview:

1. Login como `diego.freitas@way2.com.br` → o link "Usuários" aparece no header.
2. Abrir `/admin` → a tabela lista os usuários com seus papéis.
3. Convidar `teste-rbac@way2.com.br` como `viewer` → o link é gerado e copiável.
4. Abrir o link numa janela anônima → tela "Defina sua senha" → definir → cai no quadro.
5. Nessa janela: sem botões "Sprint"/"Pessoa", sem `+ demanda`, cards não arrastáveis, sem link "Usuários".
6. Nessa janela, acessar `/admin` diretamente → tela "Acesso restrito".
7. Na janela do admin, mudar `teste-rbac` para `editor` → recarregar a janela anônima → botões de escrita aparecem.
8. Na janela do admin, tentar mudar o próprio papel para `editor` → toast "Você não pode remover seu próprio acesso de administrador".
9. Aba "Histórico" → convite, concessão e alteração aparecem com responsável e horário.
10. Mudar `teste-rbac` para "Sem acesso" → recarregar a janela anônima → tela "Acesso ainda não liberado".

Ao final, remover o usuário de teste pelo painel Supabase (*Authentication → Users*).

- [ ] **Step 7: Commit**

```bash
git add src/routes/aceitar-convite.tsx src/routes/index.tsx src/components/AuthCard.tsx src/components/BoardGrid.tsx src/routeTree.gen.ts
git commit -m "feat(admin): close public signup, add invite acceptance and board write gating"
```

---

## Task 10: Passos manuais no painel Supabase

**Files:** nenhum. Esta task é de configuração e depende do usuário.

- [ ] **Step 1: Desligar o cadastro público**

No painel Supabase do projeto `lpgkridgduuquteopnaj`: *Authentication → Sign In / Providers → Email* → desmarcar **Allow new users to sign up** → salvar.

Sem isso, um desconhecido ainda consegue criar uma conta órfã. Ela não enxerga nada (o banco protege), mas ocupa a base.

- [ ] **Step 2: Alinhar a expiração do link**

*Authentication → Emails → Email OTP Expiration* → definir `604800` segundos (7 dias), casando com a expiração dos convites.

Opcional: se preferir manter 24 h, o botão de gerar novo link cobre a diferença.

- [ ] **Step 3: Verificar que o cadastro público está mesmo fechado**

Substituir `<SUPABASE_PUBLISHABLE_KEY>` pelo valor de `VITE_SUPABASE_PUBLISHABLE_KEY` do arquivo `.env` e rodar:

```bash
curl -s -X POST "https://lpgkridgduuquteopnaj.supabase.co/auth/v1/signup" -H "apikey: <SUPABASE_PUBLISHABLE_KEY>" -H "Content-Type: application/json" -d '{"email":"nao-convidado@exemplo.com","password":"SenhaDeTeste123"}'
```

Esperado: `{"code":422,"error_code":"signup_disabled","msg":"Signups not allowed for this instance"}`

Se a resposta trouxer um usuário criado, o toggle do Step 1 não foi salvo. Nesse caso, apagar o usuário criado em *Authentication → Users* e repetir o Step 1.

- [ ] **Step 4: Registrar a conclusão**

Marcar os passos como feitos neste plano e commitar:

```bash
git add docs/superpowers/plans/2026-08-08-admin-rbac.md
git commit -m "docs: mark Supabase console steps as completed"
```

---

## Encerramento

Após a Task 10, o repositório tem 9 commits locais e nenhum push foi feito. Publicar para o Lovable é decisão do usuário:

```bash
git push origin main
```
