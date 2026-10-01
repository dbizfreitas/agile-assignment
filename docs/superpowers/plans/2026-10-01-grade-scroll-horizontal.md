# Grade de alocações com scroll horizontal (issue #48): plano de implementação

> **Para execução agêntica:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam sintaxe de checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** A grade de alocações deve parar de espremer as colunas até caberem na tela. Cada coluna ganha largura mínima e o container ganha scroll horizontal. A coluna "Sprint" e o cabeçalho de pessoas ficam fixos durante o scroll, e o título dos cards aparece em pelo menos 2 linhas.

**Arquitetura:** A mudança fica no layout de `BoardGrid.tsx`. O container passa de `overflow-x-hidden` para `overflow-auto`. O grid recebe `min-width` calculado em px (coluna Sprint + N × coluna de pessoa), e as colunas usam `minmax(<mín>px, 1fr)`: em telas largas elas continuam esticando para preencher, e em telas estreitas o grid fica mais largo que o container e rola. A coluna Sprint vira `sticky left-0`. O fundo atual dela é translúcido (`bg-muted-foreground/15`), então ganha uma utility nova em `styles.css` que pinta o mesmo tom por cima de uma base opaca. Assim, os cards que passam por baixo não aparecem através dela.

**Tech Stack:** React 19, Tailwind v4 (utilities via `@utility` em `src/styles.css`), CSS Grid.

## Restrições globais

- Todo texto de UI e comentário em pt-BR com acentuação correta.
- Larguras mínimas: coluna de pessoa **152px**, coluna Sprint **128px**. A issue pede de 140 a 160px para as pessoas.
- Camadas de `z-index` dentro da grade, do topo para baixo: canto "Sprint" `z-40`, cabeçalho de pessoas `z-30`, coluna Sprint `z-20`. Os elementos internos das células (botão de replicar e "+ demanda") já usam `z-10` e precisam ficar **abaixo** da coluna fixa.
- Não altere comportamento: drag & drop, cliques, tooltips e hover cards continuam iguais.
- Não há framework de testes no projeto (nem `vitest`/`jest`, nem script `test`). A verificação usa `npm run build`, e a parte visual fica com o coordenador no navegador.
- Baseline conhecida: `npm run lint` já falha no checkout local com `prettier/prettier: Delete '␍'` por causa de `core.autocrlf=true`. Isso não é responsabilidade deste plano. Nos arquivos tocados, rode `npx prettier --write <arquivo>` antes de commitar.
- O repositório sincroniza com o Lovable. Trabalhe na branch `fix/grade-scroll-48`, nunca reescreva histórico publicado e **não faça push**: o push e o PR ficam com o coordenador.
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Mapa de arquivos

- **Modificar `src/styles.css` (perto da linha 239, ao lado de `board-scroll`):** nova utility `board-sticky-col`.
- **Modificar `src/components/BoardGrid.tsx`:**
  - ~linha 446: container e grid (overflow, `gridTemplateColumns`, `minWidth`);
  - ~linha 458: célula de canto "Sprint" (sticky nos dois eixos);
  - ~linha 472: cabeçalho de pessoa (`z-10` → `z-30`);
  - ~linha 632: botão da sprint dentro de `SprintRow` (sticky à esquerda);
  - ~linha 802: título do `AllocationChip` (`truncate` → `line-clamp-2`).

---

### Tarefa 1: scroll horizontal com coluna Sprint e cabeçalho fixos

**Arquivos:**
- Modificar: `src/styles.css`
- Modificar: `src/components/BoardGrid.tsx`

**Interfaces:**
- Produz: as constantes de módulo `SPRINT_COL_MIN_PX = 128` e `DEV_COL_MIN_PX = 152`, definidas no topo de `BoardGrid.tsx`, e a utility CSS `board-sticky-col`.

- [ ] **Passo 1: criar a branch**

```bash
git checkout -b fix/grade-scroll-48
```

- [ ] **Passo 2: adicionar a utility em `src/styles.css`**

Logo depois do bloco `@utility board-scroll { … }`, acrescentar:

```css
/* Fundo da coluna fixa (sticky) da grade: o mesmo tom de
   `bg-muted-foreground/15`, só que pintado sobre a superfície opaca.
   Sozinho, o tom translúcido deixaria os cards aparecerem através da coluna
   durante o scroll horizontal. `hover:bg-*` continua funcionando, porque troca
   só a `background-color` por baixo da camada. */
@utility board-sticky-col {
  background-color: var(--color-surface);
  background-image: linear-gradient(
    color-mix(in oklab, var(--color-muted-foreground) 15%, transparent),
    color-mix(in oklab, var(--color-muted-foreground) 15%, transparent)
  );
}
```

- [ ] **Passo 3: constantes de largura em `BoardGrid.tsx`**

Logo antes de `export function BoardGrid(`, acrescentar:

```tsx
// Larguras mínimas das colunas (issue #48). Abaixo disso a grade rola na
// horizontal, em vez de espremer os cards até ficarem ilegíveis.
const SPRINT_COL_MIN_PX = 128;
const DEV_COL_MIN_PX = 152;
```

- [ ] **Passo 4: container e grid**

Substituir o trecho atual:

```tsx
            <div className="h-full w-full overflow-x-hidden overflow-y-auto rounded-xl border border-grid-line bg-surface shadow-card board-scroll">
              <div
                className="grid w-full"
                style={{
                  gridTemplateColumns: `minmax(0, 1fr) repeat(${devs.length}, minmax(0, 1fr))`,
```

por:

```tsx
            <div className="h-full w-full overflow-auto rounded-xl border border-grid-line bg-surface shadow-card board-scroll">
              <div
                className="grid w-full"
                style={{
                  // `minWidth` força o grid a ficar mais largo que o container
                  // quando a soma dos mínimos não cabe, e é isso que liga o
                  // scroll horizontal. Em telas largas as colunas continuam
                  // esticando (`1fr`) e preenchem o espaço.
                  minWidth: SPRINT_COL_MIN_PX + devs.length * DEV_COL_MIN_PX,
                  gridTemplateColumns: `minmax(${SPRINT_COL_MIN_PX}px, 1fr) repeat(${devs.length}, minmax(${DEV_COL_MIN_PX}px, 1fr))`,
```

Mantenha `gridTemplateRows` e o restante do objeto `style` como estão.

- [ ] **Passo 5: célula de canto "Sprint"**

Substituir:

```tsx
                <div className="sticky top-0 z-20 border-b border-r border-grid-line bg-muted-foreground/15 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
```

por:

```tsx
                <div className="board-sticky-col sticky left-0 top-0 z-40 border-b border-r border-grid-line px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
```

- [ ] **Passo 6: cabeçalho de pessoa**

No `className` do `<button>` do cabeçalho de cada pessoa (o que tem `group sticky top-0 z-10 flex items-center gap-2 …`), troque `z-10` por `z-30`. Não mude mais nada nessa string.

- [ ] **Passo 7: coluna Sprint dentro de `SprintRow`**

Substituir:

```tsx
        className="group overflow-hidden border-b border-r border-grid-line bg-muted-foreground/15 px-3 py-1.5 text-left hover:bg-secondary"
```

por:

```tsx
        className="board-sticky-col group sticky left-0 z-20 overflow-hidden border-b border-r border-grid-line px-3 py-1.5 text-left hover:bg-secondary"
```

- [ ] **Passo 8: formatar e compilar**

```bash
npx prettier --write src/components/BoardGrid.tsx src/styles.css
npm run build
```

Esperado: o build termina sem erro de TypeScript ou CSS. Se o Tailwind reclamar de `@utility board-sticky-col`, confira se o bloco ficou fora de qualquer `@layer`, igual ao `board-scroll`.

- [ ] **Passo 9: commit**

```bash
git add src/components/BoardGrid.tsx src/styles.css
git commit -m "fix(grade): scroll horizontal com coluna Sprint e cabeçalho fixos (#48)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 2: títulos dos cards em até 2 linhas quando a célula tem vários cards

**Arquivos:**
- Modificar: `src/components/BoardGrid.tsx` (função `AllocationChip`, ~linha 802)

**Interfaces:**
- Consome: nada da Tarefa 1, além do arquivo já modificado.

Hoje, um card sozinho na célula (`allowWrap`) mostra até 4 linhas, mas quando a célula tem 2 ou mais cards cada título fica em **1 linha** (`truncate`), o que gera os "t…" e "B…" da issue. O critério de aceite pede pelo menos 2 linhas.

- [ ] **Passo 1: trocar `truncate` por `line-clamp-2`**

Substituir:

```tsx
            className={`text-xs font-medium leading-snug ${allowWrap ? "line-clamp-4" : "truncate"} ${canEdit ? "pr-4" : ""}`}
```

por:

```tsx
            className={`text-xs font-medium leading-snug ${allowWrap ? "line-clamp-4" : "line-clamp-2"} ${canEdit ? "pr-4" : ""}`}
```

Não mexa no bloco de tickets/notas logo abaixo, que continua só para `allowWrap`.

- [ ] **Passo 2: formatar e compilar**

```bash
npx prettier --write src/components/BoardGrid.tsx
npm run build
```

Esperado: o build termina sem erro.

- [ ] **Passo 3: commit**

```bash
git add src/components/BoardGrid.tsx
git commit -m "fix(grade): títulos dos cards em até 2 linhas em células com vários cards (#48)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Verificação no navegador (coordenador, depois das duas tarefas)

Com o servidor `lovable-dev` (porta 8081) aberto na aba Alocações, ou em `/embed/alocacoes`:

1. **Viewport 375×812:** `document.querySelector('.board-scroll').scrollWidth` deve ser maior que o `clientWidth` do mesmo elemento. Além disso, o `getBoundingClientRect().width` de qualquer célula de pessoa deve ser ≥ 152.
2. Role a grade na horizontal e confira que a coluna Sprint fica parada à esquerda e que nenhum card aparece através dela.
3. Role na vertical e confira que o cabeçalho de pessoas fica no topo e que o canto "Sprint" fica acima de tudo.
4. **Desktop ~1280px com 12+ pessoas:** os títulos de células com vários cards aparecem em 2 linhas.
5. Arraste um card para outra célula e confirme que ele se move. Passe o mouse sobre um card e confirme que o botão de replicar aparece e fica abaixo da coluna fixa.
6. Repita os passos 2 e 3 no tema escuro.
