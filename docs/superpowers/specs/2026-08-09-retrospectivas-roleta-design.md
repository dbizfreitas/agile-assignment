# Roleta de Retrospectiva

**Data:** 2026-08-09
**Status:** aprovado para planejamento

## Problema

O `jira-live` (Node + Hono + JS vanilla, sem banco) está sendo descontinuado. Suas
features já foram reimplementadas aqui — board de alocação (`BoardGrid.tsx`,
`AllocationDialog.tsx`), relatório de compromisso (`/compromisso`), administração
e RBAC (`/admin`). Sobrou uma: a aba **Retrospectivas**, que hospeda a roleta de
sorteio de quem conduz/participa da próxima retro.

A roleta é a única feature que ainda obriga o time a manter o serviço antigo no ar
(Windows Service, porta 8000, restart exige Admin). Enquanto ela não migrar, o
desligamento do legado fica bloqueado por uma tela de ~400 linhas.

Além disso, a implementação de origem tem duas características que **não** se
transportam mecanicamente:

1. **Manipulação direta de DOM.** `renderRoulette(container)` escreve `innerHTML`,
   guarda estado em variáveis de módulo (`drawn`, `skipped`, `spinning`) e usa
   `getElementById` durante a animação. Não há nada disso a preservar em React —
   só o *comportamento*.
2. **Fotos vêm de um arquivo estático não versionado.** O legado tem um proxy MS
   Graph com OAuth device-code (`server/routes/photos.ts`), mas o componente
   **nunca o chama em runtime**: `photoUrl(email)` lê exclusivamente do mapa
   `PHOTOS` importado de `static/photos-cache.js` — 1,3 MB de `data:image/jpeg`,
   gitignorado, gerado à mão, sem script de geração versionado. O proxy é código
   morto do ponto de vista desta tela.

## Objetivo

Reproduzir fielmente a roleta em `/retrospectivas`, com os mesmos gestos que o time
já tem no dedo (sortear, marcar ausente, desfazer, reiniciar, estado que sobrevive
ao refresh), usando os padrões desta base — rota TanStack, `useAuthorizedSession`,
shadcn/ui, Tailwind — e sem carregar junto o proxy OAuth.

## Escopo

**Dentro:** rota `/retrospectivas` autenticada, lista de participantes como dado
estático versionado, cache de fotos como arquivo local ignorado pelo git, hook de
sorteio com persistência em `localStorage`, cards com avatar (foto ou iniciais),
animação de sorteio, entrada na navegação do board.

**Fora (decidido explicitamente):**

- **Proxy MS Graph / OAuth device-code (`server/routes/photos.ts`).** Não vira Edge
  Function, não vira server function. A tela nunca dependeu dele; portar traria um
  fluxo de consentimento, um cache de token e uma superfície de credencial para
  resolver um problema que um arquivo estático já resolve.
- **Tela de administração de participantes.** A lista muda uma ou duas vezes por
  ano; editá-la é um commit de uma linha. CRUD + RLS + auditoria para isso é custo
  sem retorno.
- **Regeneração automática das fotos.** Continua sendo passo manual, como hoje.
- **Sincronização entre navegadores/dispositivos.** Ver "Persistência".
- **Histórico de sorteios, sorteio ponderado, integração com a tabela `devs`.**

## Princípios

1. **Fidelidade comportamental.** A ferramenta funciona; a migração não é
   oportunidade de redesenho. Toda divergência em relação ao legado está listada e
   justificada na seção "Desvios deliberados".
2. **Estado em React, não no DOM.** O DOM é resultado do estado, nunca a sua fonte.
3. **A origem das fotos fica atrás de uma função.** `getPhoto(email)` é o único
   ponto do código que sabe de onde a foto vem. Trocar arquivo local por Supabase
   Storage depois é mudança de um arquivo.
4. **PII não entra no histórico do git.** Vale a mesma regra do legado: foto +
   e-mail de ~20 colegas não são código. Git não esquece.
5. **Falha graciosa.** Sem cache de fotos, a tela funciona com avatares de iniciais.
   Ausência do arquivo nunca quebra o build.

---

## Dados

### `src/lib/retrospectivas/participants.ts`

Fonte da verdade da lista, versionada. Nome + e-mail corporativo + cor opcional —
não é PII sensível e é exatamente o que já aparece no board.

```ts
export type Participant = { name: string; email: string; color?: string };

export const PARTICIPANTS: readonly Participant[] = [
  { name: "André Secco",                    email: "andre.secco@way2.com.br" },
  { name: "Bruno Shippit",                  email: "bruno@shippit.app",  color: "#0ea5e9" },
  { name: "Christian Leonardo Chiavelli",   email: "christian.chiavelli@way2.com.br" },
  { name: "Daniel Alves",                   email: "daniel.alves@way2.com.br" },
  { name: "Daniel Heler Pohlmann",          email: "daniel.heler@way2.com.br" },
  { name: "Diego Freitas",                  email: "diego.freitas@way2.com.br" },
  { name: "Diego Martini Longhi",           email: "diego.longhi@way2.com.br" },
  { name: "Fábio Meira de Almeida",         email: "fabio.almeida@way2.com.br" },
  { name: "Fernando Gaio",                  email: "fernando.gaio@way2.com.br" },
  { name: "Francisco das Chagas",           email: "francisco.chagas@way2.com.br" },
  { name: "Gilcelaine Portela da Luz",      email: "gilcelaine.luz@way2.com.br" },
  { name: "Guilherme de Oliveira França",   email: "guilherme.franca@way2.com.br" },
  { name: "Jaicon Algir Marmitt",           email: "jaicon.marmitt@way2.com.br" },
  { name: "José Shippit",                   email: "jose@shippit.app",   color: "#0ea5e9" },
  { name: "Lais Caroline Ortiz",            email: "lais.ortiz@way2.com.br" },
  { name: "Luiz Berti",                     email: "luizberti@shippit.app", color: "#0ea5e9" },
  { name: "Rafaello Valladares Bertolini",  email: "rafaello.bertolini@way2.com.br" },
  { name: "Rinaldo Ferreira Junior",        email: "rinaldo.junior@way2.com.br" },
  { name: "Vitor Junior de Oliveira Souza", email: "vitor.souza@way2.com.br" },
  { name: "Warley Thales da Silva Lopes",   email: "warley.lopes@way2.com.br" },
];
```

O módulo exporta também `AVATAR_COLORS` (as mesmas 21 cores do legado, na mesma
ordem — a cor de cada pessoa é `AVATAR_COLORS[i % 21]`, então mudar a ordem muda as
cores de todo mundo), `getInitials(name)` (primeira + última inicial; nome de uma
palavra só usa os 2 primeiros caracteres) e `firstName(name)`.

O `color` explícito (`#0ea5e9` para os três da Shippit) tem precedência sobre a
paleta — é o marcador visual de "pessoal externo".

**Por que não derivar da tabela `devs`:** `devs` não tem coluna de e-mail, e e-mail
é a chave do cache de fotos. E a lista da retro não é o board: inclui gente da
Shippit e papéis que não recebem alocação. Um `JOIN` por nome seria frágil por
homônimo e por acentuação.

### Cache de fotos

**Formato:** `Record<string, string>`, e-mail em minúsculas → `data:image/jpeg;base64,…`
— o mesmo shape do `PHOTOS` do legado, para que a migração do conteúdo seja
mecânica.

**Localização:** `src/lib/retrospectivas/photos-cache.ts`, **não versionado**.

**Carregamento:** `src/lib/retrospectivas/photos.ts` é o único módulo que importa o
cache, e importa de forma tolerante à ausência:

```ts
// glob com curinga de propósito: se o arquivo não existir, `modules` é {} e o
// build passa. Um import estático quebraria o build em qualquer clone limpo.
const modules = import.meta.glob<{ PHOTOS: Record<string, string> }>(
  "./photos-cache*.ts",
  { eager: true },
);

const PHOTOS: Record<string, string> = Object.values(modules)[0]?.PHOTOS ?? {};

export function getPhoto(email: string): string | undefined {
  return PHOTOS[email.toLowerCase()];
}
```

Consequências de desenho:

- Nenhum outro arquivo pode casar com `./photos-cache*.ts` — sem `.example`, sem
  `.sample`. Se precisar documentar o formato, use um `.md`.
- `tsconfig.json` tem `noUncheckedIndexedAccess: true`, então `PHOTOS[email]` já é
  `string | undefined` — o retorno opcional é o tipo natural, não um `as`.
- `eager: true` coloca o cache no chunk da rota `/retrospectivas`, que só é baixado
  quando alguém abre a tela. Se 1,3 MB nesse chunk incomodar, trocar para
  `eager: false` + `useQuery` é mudança contida neste arquivo — por isso o resto do
  código só conhece `getPhoto`.

**Ignorar nas ferramentas** — três arquivos, porque cada uma ignora por conta
própria:

```gitignore
# .gitignore — bloco novo, no estilo dos comentários já existentes

# Cache de fotos da roleta de retrospectiva: ~1,3 MB de foto + e-mail de ~20
# colegas embutidos como código. Dado pessoal, não código — e git não esquece,
# mesmo se o arquivo for apagado depois. Gerado manualmente, fora do repositório.
src/lib/retrospectivas/photos-cache.ts
```

- `.prettierignore`: mesma linha. `prettier --write .` não respeita `.gitignore` e
  tentaria reformatar 1,3 MB a cada execução.
- `eslint.config.js`: acrescentar o caminho ao array `ignores` do primeiro bloco de
  configuração — `eslint .` também não lê `.gitignore` no flat config.

**Como popular (passo de implementação, fora deste spec):** o conteúdo real já
existe em `jira-live/static/photos-cache.js`. É o mesmo objeto; a conversão é
trocar o cabeçalho `export const PHOTOS = {` por
`export const PHOTOS: Record<string, string> = {`, garantir que as chaves estejam em
minúsculas e salvar como `.ts`. Nenhum download, nenhuma chamada ao Graph. Esta
etapa é manual e deliberadamente não automatizada — automatizá-la é reintroduzir o
proxy OAuth pela porta dos fundos.

---

## Autorização

A rota exige **`canView`** — o mesmo nível do board e do `/compromisso`, via
`useAuthorizedSession()`, com `<AuthCard />` para não autenticado e
`<AccessDenied />` para autenticado sem papel.

Justificativas:

- **Não é `canEdit`.** Sortear não escreve no banco; o estado é local ao navegador
  de quem está com a tela aberta. Exigir `editor` criaria fricção sem ganhar
  segurança: um `viewer` decidido resolve com um dado de seis faces.
- **Não é `isAdmin`.** É ferramenta de cerimônia do time, não superfície
  administrativa.
- **Não é público.** Os dados exibidos (nome, e-mail, foto de ~20 colaboradores)
  são exatamente o tipo de coisa que a migration de RBAC fechou ao trocar
  `USING (true)` por `private.can_view_board(auth.uid())` nas tabelas do board.
  Deixar a roleta aberta reabriria pela lateral o vazamento que aquele spec fechou.

Ressalva honesta, do mesmo tipo que o spec de RBAC já registra: este gate é de
**UI**. O bundle do cliente é público, e o cache de fotos embarcado nele também.
O gate impede navegação casual, não exfiltração determinada. Nenhuma decisão de
segurança do produto depende dele.

---

## Frontend

### Rota e navegação

`src/routes/retrospectivas.tsx`, `ssr: false` (igual a `/` e `/compromisso` — a tela
depende de `localStorage`, que não existe no servidor), com `head()` definindo
título e descrição.

O corpo repete o preâmbulo padrão das rotas autenticadas — `loading` → `!session`
→ `!canView` → conteúdo — e renderiza `<RouletteView email={session.user.email ?? ""} />`.

Entrada na navegação: botão no header do `BoardGrid`, ao lado de "Compromisso",
com ícone `Dices` do `lucide-react`:

```tsx
<Button size="sm" variant="ghost" asChild>
  <Link to="/retrospectivas">
    <Dices className="size-4" /> Retrospectivas
  </Link>
</Button>
```

Visível para qualquer usuário com papel — sem gate condicional, ao contrário do
link "Usuários" (`isAdmin`). O header da própria tela traz o link "Quadro" de volta,
`<ThemeToggle />` e o botão de logout, exatamente como o `CompromissoView`.

### Componentes

| Arquivo | Papel |
| --- | --- |
| `src/routes/retrospectivas.tsx` **(novo)** | rota + gate de autorização |
| `src/components/retrospectivas/RouletteView.tsx` **(novo)** | header, palco (vencedor + botões), grid |
| `src/components/retrospectivas/ParticipantCard.tsx` **(novo)** | card individual: avatar, nome, badges, ações |
| `src/hooks/use-roulette.ts` **(novo)** | todo o estado, sorteio e persistência |
| `src/lib/retrospectivas/participants.ts` **(novo)** | lista, paleta, helpers de nome |
| `src/lib/retrospectivas/photos.ts` **(novo)** | `getPhoto(email)` |
| `src/lib/retrospectivas/photos-cache.ts` **(novo, ignorado)** | mapa e-mail → data URI |
| `src/lib/retrospectivas/storage.ts` **(novo)** | leitura/escrita das chaves de `localStorage` |
| `src/components/BoardGrid.tsx` | acrescenta o link "Retrospectivas" |

O "card de vencedor" fica **dentro** de `RouletteView`: são ~15 linhas de JSX que
não são reutilizadas em lugar nenhum. Extrair componente para isso só espalharia
props.

### `useRoulette()`

Concentra o que no legado eram variáveis de módulo (`drawn`, `skipped`, `spinning`,
`flashInterval`) mais as funções `_spin`, `_reset` e os handlers de card.

```ts
type RouletteApi = {
  drawn: ReadonlySet<string>;      // e-mails
  skipped: ReadonlySet<string>;    // e-mails
  lastWinner: string | null;       // e-mail
  highlight: string | null;        // e-mail piscando durante a animação
  spinning: boolean;
  availableCount: number;
  spin(): void;
  reset(): void;
  unmark(email: string): void;     // desfaz "sorteado"
  skip(email: string): void;       // marca "ausente"
  unskip(email: string): void;     // reinclui
};
```

**Chaveado por e-mail, não por índice.** O legado guarda `Set<number>` em memória e
converte para e-mail só na fronteira do `localStorage`, porque os `id`s do DOM
(`rcard-3`) são índices. Em React não há essa amarra, e o índice é uma chave ruim:
inserir alguém no meio da lista alfabética reatribuiria o estado de todo mundo
abaixo. O e-mail é estável.

Comportamentos preservados literalmente:

- `spin()` é no-op se já estiver girando ou se `availableCount === 0`.
- Elegíveis = nem sorteados, nem ausentes. Vencedor sorteado **antes** da animação,
  com distribuição uniforme (`Math.random()`), e a animação apenas o revela.
- Ao terminar: adiciona aos sorteados, persiste, grava como último vencedor, exibe
  o card de vencedor.
- `unmark(email)` remove dos sorteados; se era o último vencedor, limpa também a
  chave do vencedor e esconde o card.
- `skip` / `unskip` alternam a marcação de ausente. Um sorteado não pode ser
  marcado ausente — a ação nem aparece no card.
- `reset()` limpa sorteados, ausentes e último vencedor.
- Qualquer interação é ignorada enquanto `spinning === true`.
- O intervalo é limpo no `useEffect` de cleanup — equivalente ao `_cleanup()` que o
  legado chama a cada `renderRoulette`.

### Persistência

`src/lib/retrospectivas/storage.ts`, mesmas três chaves do legado:

| Chave | Conteúdo |
| --- | --- |
| `retro-roulette-drawn` | JSON array de e-mails |
| `retro-roulette-skipped` | JSON array de e-mails |
| `retro-roulette-last-winner` | e-mail (string crua, sem JSON) |

Toda leitura e escrita fica dentro de `try/catch` que degrada para vazio, como no
legado — modo privativo e quota estourada não podem derrubar a tela. A leitura
inicial acontece no *initializer* do `useState` (função, não valor), para não
executar no servidor nem a cada render; a rota é `ssr: false`, mas o initializer
lazy é o padrão correto de qualquer forma.

**`localStorage` é suficiente — não vai para o Supabase.** A roleta é operada por
uma pessoa, numa tela compartilhada, durante a retro. Não existe cenário real de
duas pessoas sorteando em paralelo e precisando convergir. Sincronizar via Supabase
custaria tabela, RLS, realtime e resolução de conflito para um problema que não
acontece — e trocaria uma feature que funciona há meses por uma que precisa de
banco no ar para funcionar.

Consequência aceita: o estado **não migra** do legado (`localhost:8000`) para cá
(`agile-assignment.lovable.app`) — origens diferentes, `localStorage` diferentes. A
primeira retro no destino começa zerada, que é exatamente o que se faz no início de
cada ciclo.

### Animação do sorteio

`setInterval` de **80 ms**, **18 iterações** (~1,44 s), guardado em `useRef`, com o
e-mail destacado em `highlight`:

- iterações 1–14: destaque em qualquer elegível;
- iterações 15–18: o pool encolhe para `[vencedor, ...elegíveis com ~40% de chance
  de entrar]` — é o que produz a sensação de desaceleração;
- ao final: limpa o destaque, comita o vencedor e revela o card.

O card do vencedor entra com `animate-in zoom-in-95 duration-300` (tw-animate-css já
importado em `src/styles.css`), substituindo o keyframe `winnerPop` e o hack de
`void box.offsetWidth` para forçar reflow — em React basta a `key` mudar para a
animação reiniciar.

`prefers-reduced-motion` pula o loop e revela o vencedor imediatamente. São três
linhas (`window.matchMedia("(prefers-reduced-motion: reduce)").matches`) e evitam
1,4 s de piscada em quem configurou o sistema para não receber isso.

### Estilo

Reimplementado com utilitários Tailwind e tokens do tema — o CSS de `roulette-*` do
legado **não é copiado**. Ele usa variáveis próprias (`--slate-900`, `--blue`,
`--bg-elevated`) que não existem aqui, e o destino tem tema claro/escuro que o
legado não tinha.

| Elemento | Intenção original | Equivalente aqui |
| --- | --- | --- |
| `.roulette-grid` | grid fluido, colunas de ~100 px | `grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3` |
| `.roulette-stage` | palco elevado com sombra | `<Card>` do shadcn |
| `.roulette-card` | card com borda e hover | `relative flex flex-col items-center gap-2 rounded-lg border bg-card p-3` |
| `.roulette-card--drawn` | apagado + foto em cinza | `opacity-40 [&_img]:grayscale` |
| `.roulette-card--skipped` | âmbar + foto em sépia | `border-amber-500/60 bg-amber-500/10` + `text-amber-600 dark:text-amber-400` |
| `.roulette-card--flash` | pisca em azul | `ring-2 ring-primary bg-primary/15` |
| `.roulette-btn` | CTA azul arredondado | `<Button size="lg">` com `<Shuffle />` |
| `.roulette-reset-btn` | ação secundária discreta | `<Button variant="ghost" size="sm">` com `<RotateCcw />` |

O par `amber-500/600/400` com variante `dark:` é o mesmo padrão já usado em
`IssuesTable.tsx` e `StatsCards.tsx` — não é cor nova no projeto.

### Avatar

`src/components/ui/avatar.tsx` (Radix) já resolve o caso: `AvatarFallback` renderiza
quando não há `src` ou quando a imagem falha. Isso **elimina `makeAvatarSvg`** — não
há mais SVG montado em string, `btoa`, nem `unescape(encodeURIComponent(...))`.

```tsx
<Avatar className="size-12">
  <AvatarImage src={getPhoto(p.email)} alt="" />
  <AvatarFallback
    style={{ backgroundColor: color }}
    className="text-sm font-semibold text-white"
  >
    {getInitials(p.name)}
  </AvatarFallback>
</Avatar>
```

`color` segue a mesma regra do legado, incluindo os estados: cinza (`#9ca3af`) para
sorteado, âmbar (`#d97706`) para ausente, senão `p.color ?? AVATAR_COLORS[i % 21]`.
A cor é *inline style* porque vem de dado, não de classe — Tailwind não gera classe
para valor dinâmico.

O nome no card é o primeiro nome; o nome no card de vencedor são as duas primeiras
palavras. Idêntico ao legado.

### Acessibilidade

Ganhos que vêm de graça ao trocar `div` por componente:

- O botão "marcar ausente" vira `<button>` de verdade, com
  `aria-label="Marcar {nome} como ausente"` — no legado é uma `<div>` com `title`,
  inalcançável por teclado.
- O card de vencedor recebe `aria-live="polite"`, para o leitor de tela anunciar o
  resultado.
- O contador (`N / 20 sorteados · M ausentes`) é texto real, já legível.

---

## Desvios deliberados em relação ao legado

| # | Legado | Aqui | Por quê |
| --- | --- | --- | --- |
| 1 | Estado em `Set<number>` (índices) | `Set<string>` (e-mails) | índice muda quando a lista muda; e-mail é estável |
| 2 | Migra formato antigo por índice no `localStorage` | migração removida | o formato antigo só existe na origem `localhost:8000`; aqui ele é inalcançável — seria código morto no dia 1 |
| 3 | Botão "Sortear" desabilita por `drawn.size >= PARTICIPANTS.length` | desabilita por `availableCount === 0` | com todo mundo restante marcado ausente, o botão do legado fica clicável e não faz nada |
| 4 | `showWinner` usa sempre a paleta, ignorando `p.color` | usa a mesma regra do grid | o legado mostra o externo com cor da paleta no palco e com `#0ea5e9` no card — inconsistência visível |
| 5 | `makeAvatarSvg` gera SVG base64 | `AvatarFallback` do shadcn | menos código, e o fallback já cobre "imagem falhou ao carregar", que o legado não cobre |
| 6 | Animação sempre roda | respeita `prefers-reduced-motion` | três linhas |
| 7 | Botão de ausente é `<div>` com `onclick` delegado | `<button>` com `aria-label` | acessível por teclado |
| 8 | `photoUrl` casa e-mail exato | `getPhoto` normaliza para minúsculas | evita "por que a foto do Fulano sumiu" por causa de maiúscula na chave |

Nada nessa lista muda o fluxo que o time executa. Os itens 3 e 4 corrigem
comportamentos que o legado erra em silêncio.

---

## Risco conhecido: fotos em produção

O arquivo de cache é ignorado pelo git; o app em produção
(https://agile-assignment.lovable.app) é construído **a partir do git**. Logo:
**em produção a roleta cai no fallback de iniciais**, e as fotos só aparecem em
`npm run dev` na máquina que tem o arquivo.

Isso é consequência direta — e conhecida — de manter a estratégia de cache estático
num app que agora é publicado, e não mais um serviço em `localhost`. Está
registrado aqui para ser decisão consciente, não descoberta na primeira retro.

As saídas, se e quando isso incomodar:

| Opção | Custo | Efeito colateral |
| --- | --- | --- |
| Aceitar iniciais em produção e rodar a retro pelo `dev` local | zero | depende da máquina do facilitador estar com o repo rodando |
| Versionar o arquivo | zero | PII de ~20 pessoas no histórico do git, permanentemente. Contraria o princípio 4 |
| Bucket privado no Supabase Storage, objeto único, policy de `SELECT` reusando `private.can_view_board` | 1 migration + upload manual + trocar o corpo de `getPhoto` | continua sendo cache estático gerado à mão, sem OAuth; e passa a ser o *único* lugar do produto onde a foto exige sessão autenticada |

A terceira é a única que resolve de fato, e o desenho já está preparado para ela:
como só `photos.ts` conhece a origem, a troca não toca em componente nenhum. **Não
faz parte desta rodada** — entra se o time reclamar da ausência das fotos.

---

## Verificação

O projeto não possui *test runner* (não há vitest/jest em `package.json`) e esta
demanda **não introduz um**, seguindo a mesma decisão do spec de RBAC.

Portões automáticos:

- `npm run lint` — precisa passar **com o arquivo de cache presente** (é o cenário
  em que o `ignores` do ESLint e o `.prettierignore` são exercitados).
- `npm run build` — precisa passar **com o arquivo de cache ausente**. É o teste do
  `import.meta.glob`: se alguém trocar por import estático, este comando quebra.

### Roteiro manual

1. Sem sessão, abrir `/retrospectivas` → `AuthCard`.
2. Logado sem papel → `AccessDenied`, sem vazar a lista de participantes.
3. Como `viewer` → a tela funciona por inteiro (sortear, ausente, desfazer).
4. Link "Retrospectivas" aparece no header do quadro; "Quadro" volta da roleta.
5. Sortear → ~1,4 s de piscada, um vencedor, card com foto/iniciais e nome.
6. Recarregar a página → sorteados continuam apagados, vencedor continua exibido.
7. Clicar num sorteado → volta a elegível; se era o vencedor, o card some.
8. Marcar 2 ausentes → contador exibe "· 2 ausentes"; nenhum deles sai no sorteio.
9. Sortear até esgotar → botão desabilita; marcar todos os restantes como ausentes
   também desabilita (desvio 3).
10. "Reiniciar" → tudo volta ao estado inicial, inclusive após recarregar.
11. Renomear temporariamente `photos-cache.ts` → todos os cards caem em iniciais,
    com as cores certas, sem erro no console.
12. Alternar tema claro/escuro → sorteado, ausente e destaque continuam legíveis.
13. `prefers-reduced-motion: reduce` no SO → vencedor aparece sem a piscada.

---

## Passos manuais fora do código

1. **Gerar `src/lib/retrospectivas/photos-cache.ts`** a partir de
   `jira-live/static/photos-cache.js`, conforme a seção "Como popular". Sem esse
   passo, a tela funciona — só com iniciais.
2. **Confirmar que o arquivo não aparece em `git status`** depois de criado. Se
   aparecer, o `.gitignore` foi para o lugar errado; parar e corrigir antes de
   qualquer commit.

---

## Ordem de implementação

1. `.gitignore` + `.prettierignore` + `ignores` do ESLint — **antes** de qualquer
   arquivo de fotos existir no disco
2. `participants.ts` (lista, paleta, helpers)
3. `photos.ts` com o glob tolerante; verificar que `npm run build` passa sem o cache
4. `storage.ts` + `use-roulette.ts`
5. `ParticipantCard.tsx`
6. `RouletteView.tsx` (header, palco, grid, contador)
7. `routes/retrospectivas.tsx` + link no `BoardGrid`
8. Passo manual 1 (popular o cache) e verificação visual
9. Roteiro manual completo

O passo 1 vem primeiro de propósito: o custo de descobrir que o cache foi commitado
é reescrever histórico de um repositório sincronizado com o Lovable — operação que
o `AGENTS.md` deste projeto pede explicitamente para evitar.
