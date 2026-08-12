# Identidade visual do Dev Demand Flow alinhada ao Visão Agile

## Contexto

O Dev Demand Flow ("Sprint Board") é hoje um app claro, com paleta teal/âmbar
própria e fontes IBM Plex Sans/Outfit. O Visão Agile
(https://apontamentos.way2.com.br/visao-agile) — outra ferramenta interna
Way2 — usa um dashboard escuro fixo com uma linguagem visual consistente
(fundo azul-marinho escuro, azul vívido como cor primária, cards com faixa
de acento colorida e badges semânticos verde/âmbar/vermelho/azul).

O objetivo desta mudança é fazer o Dev Demand Flow "parecer parte da mesma
família de ferramentas" do Visão Agile — só no design system (cores, tema,
tipografia, cards, badges, header). **Fora de escopo**: autenticação (SSO
Microsoft), integração à barra de navegação do hub, modelo de dados, lógica
de drag-and-drop.

## Tokens de referência (medidos no Visão Agile ao vivo, 06/08/2026)

Capturados via `getComputedStyle` no DOM autenticado (Playwright MCP,
projeto `xxohcoplmdaeqmeomhwr.supabase.co`, tema `.dark` fixo no `<html>`):

| Variável shadcn | Valor HSL | RGB medido | Uso |
|---|---|---|---|
| `--background` | `217 33% 10%` | `rgb(17,24,34)` | fundo da página |
| `--card` | `217 33% 13%` | `rgb(22,31,44)` | cards, header, painéis |
| `--foreground` | `210 40% 98%` | `rgb(248,250,252)` | texto principal |
| `--muted-foreground` | `215 20% 65%` | `rgb(148,163,184)` | texto secundário |
| `--border` | `217 33% 17%` | `rgb(29,40,58)` | bordas |
| `--primary` | `212 100% 50%` | `rgb(0,119,255)` | ações primárias, foco, acento |
| `--destructive` | `0 63% 31%` | — | botões destrutivos |
| `--success` (badge) | `142 71% 45%` (green-500) | bg 10% / texto green-400 `#4ade80` | positivo |
| `--warning` (badge) | `38 92% 50%` (yellow-500) | bg 10% / texto yellow-400 `#facc15` | atenção |
| risco (badge) | orange-500 `#f97316` | bg 10% / texto orange-400 `#fb923c` | risco |

Padrão de badge: pílula (`border-radius: 9999px`), `padding: 0 6px`,
`font-size: 10px`, `font-weight: 500`, fundo = cor a 10% de opacidade, texto
= tonalidade "400" da mesma cor. Fonte: **Inter**. Cards: `border-radius: 8px`,
fundo `--card`, faixa de acento de 4px na borda esquerda na cor do status.

Decisão de implementação: os novos tokens serão escritos em `hsl(...)`
diretamente (em vez de convertidos para oklch), para manter rastreabilidade
1:1 com os valores medidos na fonte. Isso é uma mudança de convenção
documentada no comentário de topo de `styles.css` — Tailwind v4 aceita
qualquer função de cor CSS válida, então não há impacto funcional.

## Paleta semântica do board (decisão final, validada via companion visual)

| Chip (status/tipo) | Cor | Significado |
|---|---|---|
| Especificada | Azul (`--primary`/blue-400 `#60a5fa`) | pronta para desenvolvimento |
| Não especificada | Âmbar (yellow-500/400) | precisa de refinamento |
| Bug | Vermelho (red-500/400 `#f87171`) | correção de defeito |
| Férias | Verde (green-500/400 `#4ade80`) | ausência planejada |

Cada chip usa o padrão "Opção C" validado no companion visual: fundo do
card com leve lavagem da cor (10-12% opacidade) + faixa sólida de 3px na
borda esquerda + badge em pílula com o rótulo, dentro do card escuro
(`--card`), não mais blocos sólidos cobrindo o chip inteiro.

Tipo `planejado`/`evolutiva` continuam sem cor fixa própria — herdam a cor
do `status` da alocação (comportamento atual de `chipClassFor`, preservado).

Cores de time (`TEAM_COLORS`, avatares de dev) são uma dimensão de
identidade, não de status — permanecem com paleta própria, só recalibradas
para contraste sobre o fundo escuro.

## Mudanças por arquivo

### `src/styles.css`
- Remove o bloco `:root` claro (teal/âmbar) e o bloco `.dark` duplicado do
  boilerplate shadcn — o app passa a ter um único tema (escuro fixo).
- Novo `:root` único com os tokens shadcn padrão (`--background`, `--card`,
  `--foreground`, `--primary`, `--border`, etc.) nos valores HSL medidos
  acima.
- Novo bloco de tokens de chip: `--st-especificada`, `--st-nao-especificada`,
  `--st-bug`, `--st-ferias` — cada um como par `wash` (10-12% opacidade) e
  `accent`/`fg` (tonalidade "400" sólida), seguindo a paleta semântica da
  seção anterior.
- `--font-sans`/`--font-display` trocam de `IBM Plex Sans`/`Outfit` para
  `Inter` (mesma família para body e headings — remove a distinção de fonte
  de display, que não existe no Visão Agile).
- `--header`/`--header-foreground` passam a apontar para os mesmos valores
  de `--card`/`--foreground` (o header vira "mais um painel escuro", como no
  Visão Agile, em vez de uma faixa de cor própria).

### `src/lib/board.ts`
- `STATUS_LIST` e `TIPO_LIST`: `chip` passa a ser a classe de "wash" (fundo
  10-12%) e `dot`/nova propriedade `accent` aponta para a cor sólida da
  borda/badge.
- `chipClassFor`: passa a retornar as classes de wash+accent em vez de
  bg/fg sólidos, mantendo a mesma lógica de precedência (bug/ferias fixos,
  senão segue o status).

### `src/components/BoardGrid.tsx`
- `AllocationChip`: estrutura visual muda de "bloco sólido" para "card
  escuro + faixa de 3px à esquerda + badge em pílula", conforme validado no
  mockup (Opção C). Mantém truncamento/wrap condicional e hover card
  existentes.
- Chips de filtro (Tipo/Status) no header: recebem o tratamento de
  "segmented control" (ativo = fundo levemente elevado + sombra sutil,
  inativo = transparente + `text-muted-foreground`), no lugar do estilo
  atual `bg-white/10`/`bg-white/20` (que dependia do header ser uma cor
  sólida própria).
- Logo do header: badge arredondado com o ícone, no mesmo estilo do ícone
  do Visão Agile (fundo `--primary`/10%, ícone `--primary`).

### Componentes shadcn (`src/components/ui/*`), `AllocationDialog.tsx`,
### `DevDialog.tsx`, `SprintDialog.tsx`
Sem edição direta — todos consomem as variáveis semânticas (`bg-card`,
`bg-popover`, `border`, `bg-primary`, etc.), então migram automaticamente
ao trocar os tokens em `styles.css`.

## Fora de escopo (confirmado com o usuário)
- Autenticação (permanece Supabase email/senha; não migra para SSO
  Microsoft).
- Navegação/hub (o board não ganha a barra de links do Visão Agile —
  continua um app independente).
- Toggle claro/escuro (tema escuro é fixo, sem alternância).
- Modelo de dados, lógica de drag-and-drop, roteamento.

## Verificação
- Rodar `npm run dev` (ou `bun dev`) e abrir o board no browser preview.
- Conferir visualmente: header, grade sprint×dev, os 4 tipos de chip juntos
  numa mesma célula, hover card, os 3 diálogos (Aloc./Dev/Sprint), estado
  vazio (`EmptyState`).
- Conferir contraste de texto sobre os novos fundos (WCAG AA básico a olho,
  já que os valores vêm de uma ferramenta em produção).
- `npm run lint` para garantir que nenhuma classe Tailwind referenciada
  ficou órfã (ex.: `bg-header` antigo, se removido de algum lugar).
