# Light/dark theme toggle (parity with Visão Agile)

## Contexto

O Dev Demand Flow acabou de migrar para um tema escuro fixo, alinhado ao
Visão Agile (spec anterior:
[2026-08-06-visao-agile-theme-design.md](2026-08-06-visao-agile-theme-design.md)).
Feedback do usuário após ver o resultado: "não ficou legal, quero que
tenha modo claro também assim como tem na Visão Agile".

Pesquisa ao vivo no Visão Agile (Playwright, sessão autenticada) revelou
que a suposição da spec anterior estava incorreta: o Visão Agile **tem**
alternância clara/escura (ícone sol/lua no header, abre escuro por padrão,
prefere ncia persistida em `localStorage["way2-theme"]`). Esta spec
corrige isso, restaurando um tema duplo (claro + escuro) no Dev Demand
Flow, com os valores do modo claro medidos diretamente do Visão Agile.

**Decisão confirmada com o usuário**: ao contrário do Visão Agile (que
abre escuro por padrão), o Dev Demand Flow deve abrir **claro** por
padrão na primeira visita (sem preferência salva). A alternância e a
persistência funcionam do mesmo jeito depois disso.

## Tokens do modo claro (medidos ao vivo no Visão Agile, 06/08/2026)

| Variável shadcn | Valor HSL |
|---|---|
| `--background` | `0 0% 98%` |
| `--foreground` | `217 33% 17%` |
| `--card` / `--popover` | `0 0% 100%` |
| `--primary` | `212 100% 40%` (mesmo matiz do escuro, mais escuro para contraste em fundo claro) |
| `--primary-foreground` | `0 0% 100%` |
| `--secondary` / `--muted` | `210 40% 96%` |
| `--accent` | `212 100% 95%` |
| `--accent-foreground` | `212 100% 40%` (= primary) |
| `--muted-foreground` | `215 16% 47%` |
| `--border` / `--input` | `214 32% 91%` |
| `--destructive` | `0 84% 60%` |

Padrão de badge no claro (medido nos badges "Saudável"/"Risco"/"Atenção"):
mesma faixa de opacidade do wash (~10%) usada no escuro, mas o texto vira
a variante "600" da cor em vez da "400" — ex.: Saudável usa texto
`rgb(22,163,74)` = verde-600 (idêntico ao que já usamos para "Férias" no
escuro, só a tonalidade muda).

## Paleta semântica dos chips no modo claro

Mesma lógica de precedência e mesmos matizes do modo escuro; só a
tonalidade do texto/borda muda de "400" (escuro) para "600" (claro),
seguindo o padrão observado no Visão Agile:

| Chip | Escuro (já existe) | Claro (novo) |
|---|---|---|
| Especificada | azul-400 `#60a5fa` | azul-600 `#2563eb` |
| Não especificada | âmbar-400 `#facc15` | amarelo-600 `#ca8a04` (idêntico ao "Atenção" do Visão Agile) |
| Bug | vermelho-400 `#f87171` | vermelho-600 `#dc2626` |
| Férias | verde-400 `#4ade80` | verde-600 `#16a34a` (idêntico ao "Saudável" do Visão Agile) |

Wash (fundo translúcido do card): mesmas cores-base, opacidade um pouco
menor no claro (~10% em vez de ~12%) para não ficar pastel demais sobre
branco.

## Tokens auxiliares do board (surface/grid-line) no modo claro

Mesma relação proporcional já usada no escuro (surface-2 entre
background e secondary; grid-line mais escuro que border para ficar
visível):

- `--surface`: `var(--card)` (branco)
- `--surface-2`: `hsl(210 40% 98%)`
- `--grid-line`: `hsl(214 32% 85%)` (mais escuro que `--border` de propósito, para as linhas da grade ficarem visíveis — mesma correção que já fizemos no escuro)
- `--header` / `--header-foreground`: iguais a `--card`/`--foreground`

## Arquitetura da alternância

- Estrutura de tokens shadcn restaurada: `:root` volta a conter os
  valores **claros**; um bloco `.dark { ... }` novo recebe todos os
  valores **escuros** que já existem hoje (incluindo os tokens
  customizados `--surface-2`, `--grid-line`, `--st-*`).
- Novo hook `useTheme()` (`src/hooks/use-theme.ts`): lê
  `localStorage["theme"]` (`"light" | "dark"`); sem valor salvo, assume
  `"light"`. Alterna adicionando/removendo a classe `.dark` em
  `document.documentElement` e persiste a escolha.
- Novo componente `ThemeToggle` (`src/components/ThemeToggle.tsx`):
  botão com ícone sol/lua (`lucide-react`, já é dependência), mesmo
  padrão visual do Visão Agile. Usa `useTheme()`.
- Colocação: no header do quadro (`BoardGrid.tsx`), ao lado do botão de
  logout; e na tela de login (`AuthCard.tsx`), ao lado do logo — é uma
  preferência do app inteiro, não só do quadro autenticado.
- Script inline no `<head>` (`src/routes/__root.tsx`, dentro de
  `RootShell`) que lê `localStorage["theme"]` e aplica `.dark` **antes**
  do React hidratar, evitando um flash de tela clara para quem já
  escolheu o modo escuro anteriormente. Não é necessário um script
  equivalente para o padrão claro, porque claro já é o estado natural do
  HTML sem nenhuma classe — só precisa de proteção contra flash quem
  optou pelo escuro.

## O que não muda

- `TEAM_COLORS` (cores dos avatares de time): já funcionam nos dois
  fundos (foram escolhidas originalmente para fundo claro, e a revisão
  anterior confirmou contraste adequado também no escuro) — nenhuma
  alteração.
- `chipClassFor`/`washClassFor`/`accentClassFor` em `board.ts`: nenhuma
  mudança de código — como já referenciam classes Tailwind ligadas às
  variáveis CSS (`bg-st-*`, `text-st-*-fg`, `border-st-*-fg`), passam a
  responder ao tema automaticamente assim que os tokens virarem
  condicionais por `.dark`.
- Diálogos, dropdowns, demais componentes shadcn: idem — consomem só
  variáveis semânticas, migram sozinhos.
- Modelo de dados, autenticação, roteamento: inalterados.

## Verificação

- Abrir o app sem nenhuma preferência salva (localStorage limpo) →
  deve abrir **claro**.
- Clicar no botão sol/lua → alterna para escuro, recarregar a página →
  deve continuar escuro (persistência).
- Conferir visualmente nos dois temas: header, grade completa com os 4
  tipos de chip, diálogos, tela de login, tooltip/hover card, toast.
- Conferir que as linhas de grade e o hover dos cabeçalhos de
  dev/sprint continuam visíveis no modo claro (mesma classe de bug que
  corrigimos no escuro, agora prevenida de propósito nos valores novos).
- `npm run build` como gate de correção (sem suíte de testes
  automatizada; `npm run lint` continua quebrado por ruído de
  CRLF/prettier pré-existente, não é usado como gate).
