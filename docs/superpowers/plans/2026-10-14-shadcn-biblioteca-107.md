# Manter componentes shadcn como biblioteca (#107) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar a decisão B da #107: os 28 componentes shadcn sem uso e as dependências que eles puxam **ficam** no projeto como biblioteca para o Lovable. Para o `knip` parar de apontá-los como código morto, o projeto ganha um `knip.json`. O inventário da #19 passa a registrar a decisão.

**Architecture:** Nenhum código de `src/` muda. Entra um `knip.json` na raiz que trata `src/components/ui/**` como entrada. Assim os arquivos de `ui/`, seus exports, o `use-mobile.tsx` (importado pelo `sidebar.tsx`) e as dependências importadas por eles deixam de ser "sem uso". Duas dependências não são importadas por nenhum arquivo de `ui/`, mas fazem parte do kit: `@hookform/resolvers` (par do `react-hook-form` no `form.tsx`) e `date-fns` (peer do `react-day-picker`). Elas vão para o `ignoreDependencies`. A config já foi testada no planejamento com knip 6.41.0.

**Tech Stack:** knip 6, npm, TanStack Start/Vite.

## Global Constraints

- Repositório conectado ao Lovable: **não** fazer force push, rebase, amend ou squash. **Não** fazer push: quem executa só commita, e o push/PR fica com a sessão principal.
- **Não** tocar em `.env`, `src/`, `package.json`, `package-lock.json` nem `bun.lock`. Nada é instalado ou removido.
- Fora de escopo, continuam aparecendo no `knip` e **não** devem ser silenciados: `@tanstack/router-plugin` (a #107 pede teste à parte) e os exports de `src/integrations/supabase/types.ts` (arquivo gerado).
- Commits no padrão do repo, em português, com `(#107)` no fim do assunto e terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Não há suíte de testes, então TDD não se aplica. Os gates são a saída do `knip`, `npx tsc --noEmit` e `npm run build`.

---

### Task 0: Branch

- [ ] **Step 1:** A partir de `main` limpa:

```bash
git checkout main
git checkout -b chore/shadcn-biblioteca-107
```

- [ ] **Step 2:** Este plano já existe como arquivo não rastreado e vai junto para a branch. Commite-o:

```bash
git add docs/superpowers/plans/2026-10-14-shadcn-biblioteca-107.md
git commit -m "docs(plano): manter componentes shadcn como biblioteca (#107)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: `knip.json`

- [ ] **Step 1:** Crie `knip.json` na raiz com exatamente este conteúdo:

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "entry": ["src/components/ui/**/*.tsx!"],
  "ignoreDependencies": ["@hookform/resolvers", "date-fns"]
}
```

- [ ] **Step 2:** Rode `npx --yes knip --no-progress`. O exit code será 1, porque sobram achados fora de escopo. A saída esperada é **só** isto:

```
Unused dependencies (1)
@tanstack/router-plugin  package.json:48:6
Unused exports (1)
Constants  src/integrations/supabase/types.ts:607:14
Unused exported types (6)
Json            type  src/integrations/supabase/types.ts:1:13
Tables          type  src/integrations/supabase/types.ts:494:13
TablesInsert    type  src/integrations/supabase/types.ts:523:13
TablesUpdate    type  src/integrations/supabase/types.ts:548:13
Enums           type  src/integrations/supabase/types.ts:573:13
CompositeTypes  type  src/integrations/supabase/types.ts:590:13
```

Se aparecer qualquer arquivo de `src/components/ui/`, `src/hooks/use-mobile.tsx` ou uma das dependências da #107, pare e reporte. Não ajuste a config por conta própria.

- [ ] **Step 3:** Rode `npx prettier --check knip.json`. Se falhar, rode `npx prettier --write knip.json` e confira que só a formatação mudou.

- [ ] **Step 4:** Commit:

```bash
git add knip.json
git commit -m "chore(knip): tratar componentes shadcn como biblioteca (#107)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Registrar a decisão no inventário

Arquivo: `docs/saneamento/2026-10-08-inventario.md`. Edite **só** as linhas abaixo e mantenha o alinhamento das tabelas Markdown (o Prettier formata tabelas; rode `npx prettier --write` no arquivo ao final e confira no diff que só essas linhas mudaram, além do realinhamento das colunas das tabelas tocadas).

- [ ] **Step 1:** Na tabela **Resumo**, linha "Componentes shadcn sem uso", troque a ação sugerida por: `Mantidos como biblioteca (decisão de 14/10/2026, #107)`.

- [ ] **Step 2:** Na triagem, linha "28 componentes shadcn sem uso (agregado)", troque a última coluna (recomendação) por: `Mantidos como biblioteca para o Lovable (#107). O knip.json trata ui/ como entrada`.

- [ ] **Step 3:** Na linha seguinte, "Dependências usadas só pelos `ui/*` órfãos (~24)", troque a última coluna por: `Mantidas com os ui/* (#107). @hookform/resolvers e date-fns ficam em ignoreDependencies do knip.json`.

- [ ] **Step 4:** Em **Próximos passos sugeridos**, item 3, troque o texto por: `Componentes shadcn sem uso: decidido manter como biblioteca (#107). O knip.json deixa de apontá-los.`

- [ ] **Step 5:** Commit:

```bash
git add docs/saneamento/2026-10-08-inventario.md
git commit -m "docs(saneamento): registrar decisão de manter shadcn (#107)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Verificação final

- [ ] **Step 1:** `npx tsc --noEmit` → exit 0.
- [ ] **Step 2:** `npm run build` → exit 0.
- [ ] **Step 3:** `git status` limpo e `git diff main --stat` mostrando só `knip.json`, o inventário e este plano (se ele tiver sido commitado).
- [ ] **Step 4:** Reporte: hashes dos commits, saída do `knip` e resultado de `tsc` e `build`.
