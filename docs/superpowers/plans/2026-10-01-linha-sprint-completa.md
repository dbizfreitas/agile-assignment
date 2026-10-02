# Código e período completos na linha da sprint (issue #56): plano de implementação

> **Para execução agêntica:** SUB-SKILL OBRIGATÓRIA: use superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam sintaxe de checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** A coluna "Sprint" da grade de alocações deve mostrar o código e o período da sprint sem cortar nenhum dos dois, e um tooltip deve repetir as duas informações.

**Contexto e escopo:** A issue #56 tem dois critérios de aceite. O primeiro (títulos legíveis em pelo menos 2 linhas com 12+ pessoas em ~1000px) **já foi entregue pelo PR #65** (issue #48): a coluna de pessoa tem mínimo de 152px, o container rola na horizontal e os títulos usam `line-clamp-2`. Este plano cobre só o segundo critério.

Hoje a coluna Sprint tem 128px, e o conteúdo útil fica com 104px depois do `px-3`. O período sai de `formatRange` como `06/07/26 – 19/07/26`, com cerca de 115px em `text-[11px]`. Como o `<p>` tem `truncate`, ele vira `06/07/…`. O código (`sprint.code`) também usa `truncate` e divide a linha com o badge do quarter e o ícone de lápis, então um código mais longo também seria cortado.

**Arquitetura:** A mudança fica toda no botão da linha da sprint em `src/components/BoardGrid.tsx` (~linhas 691–708). A largura da coluna **não muda**: aumentá-la tiraria espaço das pessoas e anularia parte do ganho do #65. O período passa a quebrar linha, e a quebra natural acontece no espaço depois do `–` (`06/07/26 –` / `19/07/26`). O código passa a quebrar palavra em vez de truncar. O botão ganha um `title` com quarter, código e período.

**Tech Stack:** React 19, Tailwind v4.

## Restrições globais

- Todo texto de UI e comentário em pt-BR com acentuação correta.
- Não altere `formatRange`/`formatDate` em `src/lib/board.ts`: outros pontos dependem do formato.
- Não altere a largura das colunas (`SPRINT_COL_MIN_PX`, `DEV_COL_MIN_PX`), o sticky, o `z-index` nem o fundo `board-sticky-col`.
- Não altere o comportamento: o clique no botão continua abrindo a edição da sprint.
- Não há framework de testes no projeto. A verificação usa `npm run build`, e a parte visual fica com o coordenador no navegador.
- Baseline conhecida: `npm run lint` falha no checkout local com `prettier/prettier: Delete '␍'` por causa de `core.autocrlf=true`. Rode `npx prettier --write src/components/BoardGrid.tsx` antes de commitar.
- O repositório sincroniza com o Lovable. Trabalhe na branch `fix/linha-sprint-56` (já criada), nunca reescreva histórico publicado e **não faça push**: o push e o PR ficam com o coordenador.
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Tarefa 1: linha da sprint sem truncar

**Arquivo:** `src/components/BoardGrid.tsx`, botão com `onClick={onEditSprint}` (~linha 691).

- [ ] **Passo 1:** no `<button>`, adicione um `title` com quarter (quando houver), código e período, separados por ` · `. Exemplo: `Q3 · S14 · 06/07/26 – 19/07/26`. Monte a string com `[sprint.quarter, sprint.code, formatRange(sprint.start_date, sprint.end_date)].filter(Boolean).join(" · ")`.
- [ ] **Passo 2:** no `<div className="flex items-center gap-2">`, troque `items-center` por `items-start`, para o badge e o lápis ficarem alinhados ao topo quando o código quebrar.
- [ ] **Passo 3:** no `<span>` do código, troque `truncate` por `min-w-0 break-words`. Mantenha `text-sm font-semibold`.
- [ ] **Passo 4:** no `<p>` do período, troque `truncate` por `leading-tight`. A classe `whitespace-normal` é o padrão, então não precisa ser adicionada. O texto quebra no espaço depois do `–`.
- [ ] **Passo 5:** acrescente um comentário curto acima do `<p>` do período, explicando que, em 128px, o período não cabe em uma linha e por isso quebra em vez de truncar (issue #56).
- [ ] **Passo 6:** rode `npx prettier --write src/components/BoardGrid.tsx` e `npm run build`. O build precisa passar.
- [ ] **Passo 7:** faça o commit `fix(grade): código e período completos na linha da sprint (#56)`.

## Critérios de verificação (coordenador, no navegador)

- [ ] Na grade do PIM em ~1000px, a coluna Sprint mostra `06/07/26 –` / `19/07/26` em duas linhas, sem reticências.
- [ ] O código da sprint aparece inteiro, ao lado do badge do quarter.
- [ ] O tooltip nativo, ao passar o mouse na célula da sprint, mostra quarter, código e período.
- [ ] As linhas de sprint vazias continuam baixas (altura `auto`) e não cresceram a ponto de atrapalhar.
- [ ] O tema escuro e o scroll horizontal (a coluna fixa) continuam funcionando.
- [ ] Clicar na célula ainda abre a edição da sprint.
