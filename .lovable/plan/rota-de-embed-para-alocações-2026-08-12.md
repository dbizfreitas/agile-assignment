# Rota de embed para Alocações

Objetivo: manter `/alocacoes` exatamente como está (dentro da casca, com cabeçalho, guias e seletor de projeto) e criar uma rota nova que renderiza **apenas** o quadro de alocações, sem cabeçalho e sem barra de guias — igual à segunda imagem enviada. As duas rotas usam o mesmo componente `BoardGrid`, sem duplicar código.

## O que muda

- Nova rota `/embed/alocacoes`, fora da casca `_shell`.
  - Renderiza só `BoardGrid`, ocupando a viewport inteira.
  - Continua exigindo login e papel: sem sessão mostra o cartão de login; sem papel mostra o aviso de acesso não liberado (mesma regra da casca).
  - Projeto vem da URL (`/embed/alocacoes?project=PIM`), com o mesmo fallback de hoje: chave inválida ou ausente cai em `localStorage["lastProject"]` e depois no primeiro projeto da lista.
  - `head()` própria com título/descrição de embed e `robots: noindex` — é uma tela para iframe/TV, não para busca.
- `/alocacoes` e a aba Alocações: nenhuma alteração de comportamento ou visual.
- `BoardGrid` continua recebendo `canEdit` e `project` por props; nada de novo acoplamento. A rota de embed passa essas props diretamente em vez de usar `useShell()`.

## Detalhes técnicos

- Arquivo novo: `src/routes/embed.alocacoes.tsx` → `createFileRoute("/embed/alocacoes")`, `ssr: false` (lê sessão e `localStorage` no boot, como a casca).
- Sessão/papel via `useAuthorizedSession()`; estados de `loading`, `!session` (`AuthCard`) e `!canView` (`AccessDenied`) replicam a casca.
- Projeto validado com `isJiraProjectKey`; `validateSearch` na própria rota (seguro aqui, pois não é rota de layout — o problema documentado em `_shell.tsx` era o esquema vazar para irmãs).
- Sem chamada a `getJiraProjects()`: o embed não tem seletor, então não precisa dos rótulos do Jira.
- Layout: wrapper `h-screen w-screen overflow-hidden` para o `BoardGrid` preencher a tela sem barra de rolagem dupla.
