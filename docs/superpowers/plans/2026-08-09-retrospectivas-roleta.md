# Roleta de Retrospectiva — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar a última feature viva do `jira-live` — a roleta de sorteio da retrospectiva — para `/retrospectivas` neste app, com os mesmos gestos que o time já tem no dedo (sortear, marcar ausente, desfazer, reiniciar, estado que sobrevive ao refresh), desbloqueando o desligamento do serviço legado.

**Architecture:** Uma rota `ssr: false` protegida por `canView` renderiza `RouletteView`, que compõe um palco (vencedor + botões) e um grid de `ParticipantCard`. Todo o estado — sorteados, ausentes, último vencedor, destaque da animação — vive no hook `useRoulette`, chaveado por e-mail e persistido em três chaves de `localStorage` via `storage.ts`. A lista de participantes é dado estático versionado; as fotos vêm de um arquivo local **não versionado**, carregado por `import.meta.glob` tolerante à ausência e escondido atrás de `getPhoto(email)` — único ponto do código que sabe de onde a foto vem.

**Tech Stack:** TanStack Start + TanStack Router, React 19, TypeScript 5.8 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Tailwind v4, shadcn/ui (Radix Avatar, Button, Card), lucide-react, Vite 8, ESLint 9 flat config + Prettier.

**Spec:** [`docs/superpowers/specs/2026-08-09-retrospectivas-roleta-design.md`](../specs/2026-08-09-retrospectivas-roleta-design.md)

## Global Constraints

- **Idioma da UI:** pt-BR em todo texto visível, com acentuação correta.
- **PII nunca entra no git.** `src/lib/retrospectivas/photos-cache.ts` é gerado à mão e permanece fora do repositório. **Nunca** usar `git add .`, `git add -A` ou `git commit -a` — sempre caminhos explícitos, como nos blocos de commit deste plano.
- **A Task 1 vem primeiro, sem exceção.** Nenhum arquivo de fotos pode existir no disco antes dos três `ignores` estarem no lugar. O custo de descobrir o cache commitado é reescrever histórico de um repositório sincronizado com o Lovable — exatamente o que o `AGENTS.md` pede para evitar.
- **Nunca reescrever histórico** (sem `rebase`, `amend` ou `squash` de commits publicados) e **não fazer `git push`** — publicar é decisão do usuário no fim.
- **Não introduzir test runner.** O `package.json` não tem vitest/jest e o spec decidiu explicitamente não adicionar um. Os portões são `npx tsc --noEmit`, `npm run lint`, `npm run build` e o roteiro manual da Task 10.
- **Não rodar `npm install`.** As dependências usadas (`@radix-ui/react-avatar`, `lucide-react`, `tw-animate-css`) já estão instaladas.
- **Prettier é erro de lint** (`eslint-plugin-prettier/recommended`), com `printWidth: 100`, aspas duplas, `trailingComma: "all"`. Antes de cada `npm run lint`, rodar `npx prettier --write` nos arquivos tocados — assim qualquer divergência de formatação do código abaixo se resolve sozinha.
- **Estado chaveado por e-mail**, nunca por índice (desvio 1 do spec). Índice muda quando a lista muda.
- **Só `photos.ts` conhece a origem da foto.** Nenhum outro módulo importa o cache; nenhum arquivo novo pode casar com `src/lib/retrospectivas/photos-cache*.ts` (sem `.example`, sem `.sample` — se precisar documentar o formato, use `.md`).
- **Tipos rígidos ligados:** `noUncheckedIndexedAccess` faz todo acesso indexado retornar `| undefined`; `exactOptionalPropertyTypes` proíbe passar `undefined` explícito para propriedade opcional. O código deste plano já respeita ambos — não "consertar" com `as` ou `!`.
- **Fora de escopo, decidido no spec — não implementar mesmo que pareça fácil:** proxy MS Graph / OAuth device-code (`server/routes/photos.ts` do legado), tela de administração de participantes, regeneração automática das fotos, sincronização entre navegadores/dispositivos, histórico de sorteios, sorteio ponderado e integração com a tabela `devs`.

### Portões automáticos e quando rodar cada um

| Comando | Quando | Por quê |
| --- | --- | --- |
| `npx tsc --noEmit` | toda task que mexe em `.ts`/`.tsx` | única verificação estática de contrato entre as tasks |
| `npm run lint` | idem, e obrigatoriamente **com** o cache de fotos presente (Task 1 com arquivo falso, Task 9 com o real) | é o cenário que exercita o `ignores` do ESLint e o `.prettierignore` |
| `npm run build` | Tasks 3 e 8, obrigatoriamente **sem** o cache de fotos | é o teste do `import.meta.glob`: se alguém trocar por import estático, o build de um clone limpo quebra |

Onde não há checagem estática possível (animação, avatar, acessibilidade, tema), a verificação é abrir `/retrospectivas` no navegador e conferir o comportamento descrito — está explícito em cada step.

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/retrospectivas/participants.ts` | lista versionada, paleta de 21 cores, helpers de nome e cor |
| `src/lib/retrospectivas/photos.ts` | `getPhoto(email)` — único ponto que conhece a origem da foto |
| `src/lib/retrospectivas/photos-cache.ts` | mapa e-mail → data URI (**gerado à mão, ignorado pelo git**) |
| `src/lib/retrospectivas/storage.ts` | leitura/escrita das três chaves de `localStorage` |
| `src/hooks/use-roulette.ts` | estado, sorteio, animação e persistência |
| `src/components/retrospectivas/ParticipantCard.tsx` | card individual: avatar, nome, ações |
| `src/components/retrospectivas/RouletteView.tsx` | header, palco (vencedor + botões), contador, grid |
| `src/routes/retrospectivas.tsx` | rota `/retrospectivas` + gate de `canView` |

**Modificar:**

| Arquivo | Mudança |
| --- | --- |
| `.gitignore` | bloco novo ignorando o cache de fotos |
| `.prettierignore` | mesma linha |
| `eslint.config.js:9` | acrescenta o caminho ao array `ignores` |
| `src/components/BoardGrid.tsx:11,219` | ícone `Dices` no import e link "Retrospectivas" no header |
| `src/routeTree.gen.ts` | regenerado pelo router plugin ao aparecer a nova rota |

---

### Task 1: Ignorar o cache de fotos nas três ferramentas

**Files:**
- Modify: `.gitignore` (fim do arquivo)
- Modify: `.prettierignore` (fim do arquivo)
- Modify: `eslint.config.js:9`

**Interfaces:**
- Consumes: nada.
- Produces: a garantia de que `src/lib/retrospectivas/photos-cache.ts` é invisível para `git`, `prettier` e `eslint`. Todas as tasks seguintes dependem disso.

- [ ] **Step 1: Ignorar no git**

Acrescentar ao final de `.gitignore`, no estilo dos comentários já existentes:

```gitignore
# Cache de fotos da roleta de retrospectiva: ~1,3 MB de foto + e-mail de ~20
# colegas embutidos como código. Dado pessoal, não código — e git não esquece,
# mesmo se o arquivo for apagado depois. Gerado manualmente, fora do repositório.
src/lib/retrospectivas/photos-cache.ts
```

- [ ] **Step 2: Ignorar no Prettier**

Acrescentar ao final de `.prettierignore`:

```gitignore
# Cache de fotos da retro — 1,3 MB numa linha só. `prettier --write .` não lê o
# .gitignore e tentaria reformatar o arquivo inteiro a cada execução.
src/lib/retrospectivas/photos-cache.ts
```

- [ ] **Step 3: Ignorar no ESLint**

Em `eslint.config.js`, substituir a linha 9 pelo bloco abaixo — `eslint .` também não lê o `.gitignore` no flat config:

```js
  // O cache de fotos da retro é gerado à mão, fica fora do git e tem ~1,3 MB
  // numa linha só; lintar/formatar não faz sentido. `eslint .` não lê .gitignore.
  { ignores: ["dist", ".output", ".vinxi", "src/lib/retrospectivas/photos-cache.ts"] },
```

- [ ] **Step 4: Provar os três ignores com um cache falso**

Criar `src/lib/retrospectivas/photos-cache.ts` com **exatamente** este conteúdo — uma linha só, sem espaços, de propósito (é um PNG 1×1 transparente; nenhuma foto real entra aqui):

```ts
export const PHOTOS: Record<string, string> = {"diego.freitas@way2.com.br":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","andre.secco@way2.com.br":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}
```

Rodar os três testes:

```bash
git status --porcelain --ignored=matching -- src/lib/retrospectivas
npx prettier --list-different .
npm run lint
```

Esperado, nesta ordem:

1. exatamente `!! src/lib/retrospectivas/photos-cache.ts` — o `!!` é a prova de que o git vê e ignora. Se aparecer `??`, o `.gitignore` está errado: **parar e corrigir antes de qualquer commit.**
2. a saída **não** menciona `photos-cache.ts` (se mencionar outros arquivos com formatação divergente, isso é ruído pré-existente e não é problema desta task).
3. exit 0. Sem o `ignores` do Step 3, o arquivo de uma linha só quebraria a regra `prettier/prettier`.

- [ ] **Step 5: Apagar o cache falso**

```bash
rm src/lib/retrospectivas/photos-cache.ts
git status --porcelain
```

A saída do `git status` deve conter apenas os três arquivos de configuração modificados. O arquivo real entra só na Task 9.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .prettierignore eslint.config.js
git commit -m "chore(retro): ignore the retrospective photo cache in git, prettier and eslint"
```

---

### Task 2: Lista de participantes, paleta e helpers de nome

**Files:**
- Create: `src/lib/retrospectivas/participants.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type Participant = { name: string; email: string; color?: string }`
  - `PARTICIPANTS: readonly Participant[]` (20 pessoas)
  - `AVATAR_COLORS: readonly string[]` (21 cores)
  - `DRAWN_COLOR = "#9ca3af"`, `SKIPPED_COLOR = "#d97706"`
  - `paletteColor(index: number): string`
  - `avatarColor(p: Participant, index: number): string`
  - `getInitials(name: string): string`
  - `firstName(fullName: string): string`
  - `shortName(fullName: string): string`

- [ ] **Step 1: Criar o módulo**

Criar `src/lib/retrospectivas/participants.ts`. O spec mostra a lista com colunas alinhadas por legibilidade; o Prettier colapsa esse alinhamento, então o código abaixo já vem no formato final:

```ts
// Fonte da verdade da lista da retro, versionada. Nome + e-mail corporativo não
// são PII sensível — é exatamente o que já aparece no board. A foto, que é, mora
// em photos-cache.ts, fora do git.
//
// Não derivamos de `devs`: aquela tabela não tem coluna de e-mail (que é a chave
// do cache de fotos), e esta lista inclui gente da Shippit e papéis que não
// recebem alocação. Um JOIN por nome seria frágil por homônimo e acentuação.
export type Participant = { name: string; email: string; color?: string };

export const PARTICIPANTS: readonly Participant[] = [
  { name: "André Secco", email: "andre.secco@way2.com.br" },
  { name: "Bruno Shippit", email: "bruno@shippit.app", color: "#0ea5e9" },
  { name: "Christian Leonardo Chiavelli", email: "christian.chiavelli@way2.com.br" },
  { name: "Daniel Alves", email: "daniel.alves@way2.com.br" },
  { name: "Daniel Heler Pohlmann", email: "daniel.heler@way2.com.br" },
  { name: "Diego Freitas", email: "diego.freitas@way2.com.br" },
  { name: "Diego Martini Longhi", email: "diego.longhi@way2.com.br" },
  { name: "Fábio Meira de Almeida", email: "fabio.almeida@way2.com.br" },
  { name: "Fernando Gaio", email: "fernando.gaio@way2.com.br" },
  { name: "Francisco das Chagas", email: "francisco.chagas@way2.com.br" },
  { name: "Gilcelaine Portela da Luz", email: "gilcelaine.luz@way2.com.br" },
  { name: "Guilherme de Oliveira França", email: "guilherme.franca@way2.com.br" },
  { name: "Jaicon Algir Marmitt", email: "jaicon.marmitt@way2.com.br" },
  { name: "José Shippit", email: "jose@shippit.app", color: "#0ea5e9" },
  { name: "Lais Caroline Ortiz", email: "lais.ortiz@way2.com.br" },
  { name: "Luiz Berti", email: "luizberti@shippit.app", color: "#0ea5e9" },
  { name: "Rafaello Valladares Bertolini", email: "rafaello.bertolini@way2.com.br" },
  { name: "Rinaldo Ferreira Junior", email: "rinaldo.junior@way2.com.br" },
  { name: "Vitor Junior de Oliveira Souza", email: "vitor.souza@way2.com.br" },
  { name: "Warley Thales da Silva Lopes", email: "warley.lopes@way2.com.br" },
];

// As mesmas 21 cores do legado, na mesma ordem: a cor de cada pessoa é
// AVATAR_COLORS[i % 21]. Mudar a ordem da lista acima muda a cor de todo mundo
// abaixo da mudança — é feio, mas é o comportamento que o time já conhece.
export const AVATAR_COLORS: readonly string[] = [
  "#4f46e5",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#d97706",
  "#059669",
  "#0891b2",
  "#1d4ed8",
  "#be185d",
  "#9333ea",
  "#0d9488",
  "#b45309",
  "#16a34a",
  "#e11d48",
  "#6d28d9",
  "#0369a1",
  "#c2410c",
  "#15803d",
  "#7e22ce",
  "#0e7490",
  "#b91c1c",
];

// Cores de estado do avatar, iguais às do legado.
export const DRAWN_COLOR = "#9ca3af";
export const SKIPPED_COLOR = "#d97706";

// noUncheckedIndexedAccess torna o acesso indexado `string | undefined`; o `??`
// devolve um string de verdade sem precisar de `!`.
export function paletteColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length] ?? "#4f46e5";
}

// Cor base do avatar: o `color` explícito (marcador de pessoal externo) tem
// precedência sobre a paleta. Vale no grid E no card de vencedor — o legado
// ignorava `color` no palco, o que deixava o externo com duas cores diferentes
// na mesma tela (desvio 4).
export function avatarColor(p: Participant, index: number): string {
  return p.color ?? paletteColor(index);
}

// Primeira + última inicial; nome de uma palavra só usa os 2 primeiros caracteres.
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0] ?? "";
    const last = parts[parts.length - 1] ?? "";
    return (first.slice(0, 1) + last.slice(0, 1)).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Nome exibido no card do grid.
export function firstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
}

// Nome exibido no card de vencedor: as duas primeiras palavras, como no legado.
export function shortName(fullName: string): string {
  return fullName.split(" ").slice(0, 2).join(" ");
}
```

- [ ] **Step 2: Verificar contagens e tipos**

```bash
npx prettier --write src/lib/retrospectivas/participants.ts
npx tsc --noEmit
npm run lint
grep -c "email:" src/lib/retrospectivas/participants.ts
grep -c '^  "#' src/lib/retrospectivas/participants.ts
```

Esperado: `tsc` e `lint` em exit 0; `20` participantes; `21` cores na paleta. As duas contagens importam — 19 participantes significa alguém perdido na cópia, e 20 cores mudariam a cor de todo mundo em relação ao legado.

- [ ] **Step 3: Commit**

```bash
git add src/lib/retrospectivas/participants.ts
git commit -m "feat(retro): add versioned participant list, avatar palette and name helpers"
```

---

### Task 3: Origem das fotos atrás de `getPhoto`

**Files:**
- Create: `src/lib/retrospectivas/photos.ts`

**Interfaces:**
- Consumes: nada (o cache é opcional e pode não existir).
- Produces: `getPhoto(email: string): string | undefined` — data URI da foto, ou `undefined` quando não há cache ou o e-mail não está nele.

- [ ] **Step 1: Criar o módulo com o glob tolerante**

Criar `src/lib/retrospectivas/photos.ts`:

```ts
// Único módulo que sabe de onde vem a foto. Trocar o arquivo local por um bucket
// do Supabase Storage depois é mudança daqui, e de mais nenhum arquivo.

// O curinga é de propósito: se photos-cache.ts não existir, `modules` é {} e o
// build passa. Um import estático quebraria o build em qualquer clone limpo —
// e o cache é gitignorado, então todo clone é um clone limpo.
//
// Consequência: nenhum outro arquivo pode casar com "./photos-cache*.ts". Sem
// .example, sem .sample. Para documentar o formato, use um .md.
//
// eager: true coloca o cache no chunk da rota /retrospectivas, baixado só quando
// alguém abre a tela. Se 1,3 MB nesse chunk incomodar, trocar para eager: false
// + useQuery é mudança contida neste arquivo — por isso o resto do código só
// conhece getPhoto.
const modules = import.meta.glob<{ PHOTOS: Record<string, string> }>("./photos-cache*.ts", {
  eager: true,
});

const PHOTOS: Record<string, string> = Object.values(modules)[0]?.PHOTOS ?? {};

// Normaliza para minúsculas: evita "por que a foto do Fulano sumiu" por causa de
// uma maiúscula na chave do cache (desvio 8). noUncheckedIndexedAccess já torna o
// retorno `string | undefined` — o opcional é o tipo natural, não um `as`.
export function getPhoto(email: string): string | undefined {
  return PHOTOS[email.toLowerCase()];
}
```

- [ ] **Step 2: Portão crítico — build sem o cache**

Confirmar que o cache **não** está no disco e buildar:

```bash
ls src/lib/retrospectivas
npm run build
```

Esperado: `ls` lista apenas `participants.ts` e `photos.ts`; `npm run build` termina em exit 0. Este é o portão que o spec chama de crítico — ele prova que um clone limpo (produção inclusive) builda sem o arquivo de fotos. Se o build quebrar com "Failed to resolve import", alguém trocou o glob por import estático.

- [ ] **Step 3: Verificar tipos e lint**

```bash
npx prettier --write src/lib/retrospectivas/photos.ts
npx tsc --noEmit
npm run lint
```

Esperado: exit 0 nos dois. Em particular, `tsc` precisa aceitar o parâmetro de tipo do `import.meta.glob` — a sobrecarga com generic único + `eager: true` devolve `Record<string, M>`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/retrospectivas/photos.ts
git commit -m "feat(retro): load the photo cache through a tolerant glob behind getPhoto"
```

---

### Task 4: Persistência em `localStorage`

**Files:**
- Create: `src/lib/retrospectivas/storage.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `loadDrawn(): string[]` / `saveDrawn(emails: ReadonlySet<string>): void`
  - `loadSkipped(): string[]` / `saveSkipped(emails: ReadonlySet<string>): void`
  - `loadLastWinner(): string | null` / `saveLastWinner(email: string): void` / `clearLastWinner(): void`
  - Chaves: `retro-roulette-drawn`, `retro-roulette-skipped` (JSON array de e-mails) e `retro-roulette-last-winner` (e-mail em string crua, sem JSON) — as mesmas três do legado.

- [ ] **Step 1: Criar o módulo**

Criar `src/lib/retrospectivas/storage.ts`:

```ts
// As mesmas três chaves do legado. O estado não migra de localhost:8000 para cá
// (origens diferentes = localStorage diferentes); a primeira retro no destino
// começa zerada, que é o que se faz no início de cada ciclo de qualquer forma.
const DRAWN_KEY = "retro-roulette-drawn";
const SKIPPED_KEY = "retro-roulette-skipped";
const WINNER_KEY = "retro-roulette-last-winner";

// Toda leitura e escrita degrada para vazio em caso de erro: modo privativo e
// quota estourada não podem derrubar a tela.
function readEmailArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // O filtro por typeof também descarta o formato antigo por índice do legado,
    // que aqui é inalcançável (outra origem) — desvio 2: sem código de migração.
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function writeEmailArray(key: string, emails: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...emails]));
  } catch {
    // Sem persistência a roleta continua funcionando dentro da sessão.
  }
}

export function loadDrawn(): string[] {
  return readEmailArray(DRAWN_KEY);
}

export function saveDrawn(emails: ReadonlySet<string>): void {
  writeEmailArray(DRAWN_KEY, emails);
}

export function loadSkipped(): string[] {
  return readEmailArray(SKIPPED_KEY);
}

export function saveSkipped(emails: ReadonlySet<string>): void {
  writeEmailArray(SKIPPED_KEY, emails);
}

export function loadLastWinner(): string | null {
  try {
    return localStorage.getItem(WINNER_KEY);
  } catch {
    return null;
  }
}

export function saveLastWinner(email: string): void {
  try {
    localStorage.setItem(WINNER_KEY, email);
  } catch {
    // idem writeEmailArray
  }
}

export function clearLastWinner(): void {
  try {
    localStorage.removeItem(WINNER_KEY);
  } catch {
    // idem writeEmailArray
  }
}
```

Os comentários dentro dos `catch` não são decoração: a regra `no-empty` do `js.configs.recommended` reprova bloco vazio, e ignora bloco que contém comentário.

- [ ] **Step 2: Verificar tipos e lint**

```bash
npx prettier --write src/lib/retrospectivas/storage.ts
npx tsc --noEmit
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/retrospectivas/storage.ts
git commit -m "feat(retro): persist roulette state in the three legacy localStorage keys"
```

---

### Task 5: Hook `useRoulette`

**Files:**
- Create: `src/hooks/use-roulette.ts`

**Interfaces:**
- Consumes: `PARTICIPANTS` de `@/lib/retrospectivas/participants`; `loadDrawn`, `saveDrawn`, `loadSkipped`, `saveSkipped`, `loadLastWinner`, `saveLastWinner`, `clearLastWinner` de `@/lib/retrospectivas/storage`.
- Produces:

```ts
export type RouletteApi = {
  drawn: ReadonlySet<string>;
  skipped: ReadonlySet<string>;
  lastWinner: string | null;
  highlight: string | null;
  spinning: boolean;
  availableCount: number;
  spin(): void;
  reset(): void;
  unmark(email: string): void;
  skip(email: string): void;
  unskip(email: string): void;
};

export function useRoulette(): RouletteApi;
```

- [ ] **Step 1: Criar o topo do arquivo — constantes, tipo e helpers**

Criar `src/hooks/use-roulette.ts` com o cabeçalho, as constantes de animação, o tipo público e os helpers de módulo:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PARTICIPANTS } from "@/lib/retrospectivas/participants";
import {
  clearLastWinner,
  loadDrawn,
  loadLastWinner,
  loadSkipped,
  saveDrawn,
  saveLastWinner,
  saveSkipped,
} from "@/lib/retrospectivas/storage";

// 18 flashes de 80 ms ≈ 1,44 s — os mesmos números do legado.
const FLASH_MS = 80;
const TOTAL_FLASHES = 18;
// Nos 4 últimos flashes o pool encolhe para [vencedor, ...~40% dos elegíveis]:
// é isso que produz a sensação de desaceleração.
const SLOWDOWN_FROM = TOTAL_FLASHES - 4;
const KEEP_CHANCE = 0.6;

export type RouletteApi = {
  drawn: ReadonlySet<string>; // e-mails
  skipped: ReadonlySet<string>; // e-mails
  lastWinner: string | null; // e-mail
  highlight: string | null; // e-mail piscando durante a animação
  spinning: boolean;
  availableCount: number;
  spin(): void;
  reset(): void;
  unmark(email: string): void; // desfaz "sorteado"
  skip(email: string): void; // marca "ausente"
  unskip(email: string): void; // reinclui
};

const KNOWN_EMAILS: ReadonlySet<string> = new Set(PARTICIPANTS.map((p) => p.email));

// Descarta e-mails que saíram da lista: quem não está mais no time não pode
// continuar contando no "N / 20 sorteados". O legado ganhava isso de graça ao
// converter e-mail para índice na fronteira do localStorage.
function keepKnown(emails: readonly string[]): Set<string> {
  return new Set(emails.filter((email) => KNOWN_EMAILS.has(email)));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function pickRandom(pool: readonly string[]): string | undefined {
  return pool[Math.floor(Math.random() * pool.length)];
}
```

- [ ] **Step 2: Acrescentar o hook com estado, derivados e as quatro ações síncronas**

Acrescentar ao final do arquivo. `spin` entra aqui na versão que revela o vencedor na hora — não é rascunho: esse é exatamente o caminho que a Step 3 preserva como branch de `prefers-reduced-motion`. Ao final desta step a roleta já é funcional, só não pisca.

```ts
export function useRoulette(): RouletteApi {
  // Initializer lazy (função, não valor): não roda no servidor nem a cada render.
  const [drawn, setDrawn] = useState<ReadonlySet<string>>(() => keepKnown(loadDrawn()));
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => keepKnown(loadSkipped()));
  // Só restaura o vencedor se ele ainda estiver entre os sorteados — mesmo guard
  // que o legado aplicava ao reabrir a aba.
  const [lastWinner, setLastWinner] = useState<string | null>(() => {
    const stored = loadLastWinner();
    return stored !== null && drawn.has(stored) ? stored : null;
  });
  const [highlight, setHighlight] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Equivalente ao _cleanup() que o legado chamava a cada renderRoulette.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Elegíveis = nem sorteados, nem ausentes.
  const available = useMemo(
    () =>
      PARTICIPANTS.filter((p) => !drawn.has(p.email) && !skipped.has(p.email)).map((p) => p.email),
    [drawn, skipped],
  );

  const commitWinner = useCallback(
    (email: string) => {
      const next = new Set(drawn);
      next.add(email);
      setDrawn(next);
      saveDrawn(next);
      saveLastWinner(email);
      setLastWinner(email);
      setHighlight(null);
      setSpinning(false);
    },
    [drawn],
  );

  const spin = useCallback(() => {
    if (spinning) return;
    // Vencedor sorteado ANTES da animação, com distribuição uniforme; a animação
    // só revela. pickRandom devolve undefined quando não há elegível — o no-op de
    // availableCount === 0.
    const winner = pickRandom(available);
    if (winner === undefined) return;

    setSpinning(true);
    setLastWinner(null); // esconde o card do vencedor anterior durante o sorteio
    commitWinner(winner);
  }, [available, commitWinner, spinning]);

  const reset = useCallback(() => {
    if (spinning) return;
    const noDrawn = new Set<string>();
    const noSkipped = new Set<string>();
    setDrawn(noDrawn);
    saveDrawn(noDrawn);
    setSkipped(noSkipped);
    saveSkipped(noSkipped);
    clearLastWinner();
    setLastWinner(null);
  }, [spinning]);

  const unmark = useCallback(
    (email: string) => {
      if (spinning) return;
      const next = new Set(drawn);
      next.delete(email);
      setDrawn(next);
      saveDrawn(next);
      // Se era o último vencedor, some também com o card do palco.
      if (lastWinner === email) {
        clearLastWinner();
        setLastWinner(null);
      }
    },
    [drawn, lastWinner, spinning],
  );

  const skip = useCallback(
    (email: string) => {
      // Um sorteado não pode ser marcado ausente — no card a ação nem aparece,
      // mas o hook não depende disso para estar correto.
      if (spinning || drawn.has(email)) return;
      const next = new Set(skipped);
      next.add(email);
      setSkipped(next);
      saveSkipped(next);
    },
    [drawn, skipped, spinning],
  );

  const unskip = useCallback(
    (email: string) => {
      if (spinning) return;
      const next = new Set(skipped);
      next.delete(email);
      setSkipped(next);
      saveSkipped(next);
    },
    [skipped, spinning],
  );

  return {
    drawn,
    skipped,
    lastWinner,
    highlight,
    spinning,
    availableCount: available.length,
    spin,
    reset,
    unmark,
    skip,
    unskip,
  };
}
```

- [ ] **Step 3: Trocar `spin` pela versão animada**

Substituir o corpo de `spin` (do Step 2) por este, que mantém a revelação imediata como caminho de `prefers-reduced-motion`:

```ts
  const spin = useCallback(() => {
    if (spinning) return;
    const pool = available;
    const winner = pickRandom(pool);
    if (winner === undefined) return;

    setSpinning(true);
    setLastWinner(null);

    // Quem configurou o sistema para não receber animação não leva 1,4 s de
    // piscada: o vencedor aparece direto.
    if (prefersReducedMotion()) {
      commitWinner(winner);
      return;
    }

    let flashes = 0;
    timerRef.current = setInterval(() => {
      flashes += 1;
      const roundPool =
        flashes > SLOWDOWN_FROM
          ? pool.filter((email) => email === winner || Math.random() > KEEP_CHANCE)
          : pool;
      // O vencedor está sempre no roundPool, então o ?? nunca dispara na prática
      // — existe só para satisfazer noUncheckedIndexedAccess.
      setHighlight(pickRandom(roundPool) ?? winner);

      if (flashes >= TOTAL_FLASHES) {
        if (timerRef.current !== null) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        commitWinner(winner);
      }
    }, FLASH_MS);
  }, [available, commitWinner, spinning]);
```

- [ ] **Step 4: Verificar tipos e lint**

```bash
npx prettier --write src/hooks/use-roulette.ts
npx tsc --noEmit
npm run lint
```

Esperado: exit 0. Em especial, `react-hooks/exhaustive-deps` não pode reclamar de nenhum `useCallback` — todos os valores lidos estão nas listas de dependência.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-roulette.ts
git commit -m "feat(retro): add useRoulette with email-keyed state, draw animation and persistence"
```

---

### Task 6: `ParticipantCard`

**Files:**
- Create: `src/components/retrospectivas/ParticipantCard.tsx`

**Interfaces:**
- Consumes: `Participant`, `avatarColor`, `firstName`, `getInitials`, `DRAWN_COLOR`, `SKIPPED_COLOR` de `@/lib/retrospectivas/participants`; `getPhoto` de `@/lib/retrospectivas/photos`; `Avatar`, `AvatarImage`, `AvatarFallback` de `@/components/ui/avatar`; `cn` de `@/lib/utils`.
- Produces:

```ts
export type ParticipantCardProps = {
  participant: Participant;
  index: number;
  drawn: boolean;
  skipped: boolean;
  highlighted: boolean;
  disabled: boolean;
  onUnmark: () => void;
  onSkip: () => void;
  onUnskip: () => void;
};

export function ParticipantCard(props: ParticipantCardProps);
```

(sem anotação de retorno — em React 19 o namespace global `JSX` não existe mais; deixar o TypeScript inferir.)

- [ ] **Step 1: Criar o componente**

Criar `src/components/retrospectivas/ParticipantCard.tsx`:

```tsx
import { Ban, CirclePause, Undo2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getPhoto } from "@/lib/retrospectivas/photos";
import {
  avatarColor,
  firstName,
  getInitials,
  DRAWN_COLOR,
  SKIPPED_COLOR,
  type Participant,
} from "@/lib/retrospectivas/participants";
import { cn } from "@/lib/utils";

export type ParticipantCardProps = {
  participant: Participant;
  index: number;
  drawn: boolean;
  skipped: boolean;
  highlighted: boolean;
  disabled: boolean; // true enquanto a roleta gira
  onUnmark: () => void;
  onSkip: () => void;
  onUnskip: () => void;
};

// Botão que cobre o card inteiro. Só existe quando o card tem ação (sorteado ou
// ausente) — e nesses estados o botão de "marcar ausente" não é renderizado,
// então nunca há <button> dentro de <button>.
const OVERLAY_BUTTON =
  "absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring disabled:pointer-events-none";

export function ParticipantCard({
  participant,
  index,
  drawn,
  skipped,
  highlighted,
  disabled,
  onUnmark,
  onSkip,
  onUnskip,
}: ParticipantCardProps) {
  // Mesma regra do legado, incluindo os estados: cinza para sorteado, âmbar para
  // ausente, senão a cor da pessoa. Vai em style porque vem de dado — Tailwind
  // não gera classe para valor dinâmico.
  const color = drawn ? DRAWN_COLOR : skipped ? SKIPPED_COLOR : avatarColor(participant, index);

  return (
    <div
      className={cn(
        "group relative flex flex-col items-center gap-2 rounded-lg border bg-card p-3 transition",
        drawn && "opacity-40 [&_img]:grayscale",
        skipped && "border-amber-500/60 bg-amber-500/10",
        highlighted && "bg-primary/15 ring-2 ring-primary",
      )}
    >
      <Avatar className="size-12">
        {/* Sem cache de fotos, src é undefined e o Radix cai direto no fallback —
            que também cobre "a imagem falhou ao carregar", caso que o legado não
            cobria. É o que elimina o makeAvatarSvg com btoa. */}
        <AvatarImage src={getPhoto(participant.email)} alt="" />
        <AvatarFallback
          style={{ backgroundColor: color }}
          className="text-sm font-semibold text-white"
        >
          {getInitials(participant.name)}
        </AvatarFallback>
      </Avatar>

      <span
        className={cn(
          "max-w-full truncate text-xs font-medium",
          skipped && "text-amber-600 dark:text-amber-400",
        )}
      >
        {firstName(participant.name)}
      </span>

      {drawn ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onUnmark}
          aria-label={`Desmarcar ${participant.name} como sorteado`}
          className={OVERLAY_BUTTON}
        >
          <Undo2 aria-hidden className="absolute right-1 top-1 size-3.5 text-muted-foreground" />
        </button>
      ) : null}

      {skipped ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onUnskip}
          aria-label={`Reincluir ${participant.name} no sorteio`}
          className={OVERLAY_BUTTON}
        >
          <CirclePause
            aria-hidden
            className="absolute right-1 top-1 size-3.5 text-amber-600 dark:text-amber-400"
          />
        </button>
      ) : null}

      {!drawn && !skipped ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onSkip}
          aria-label={`Marcar ${participant.name} como ausente`}
          className={cn(
            "absolute right-1 top-1 rounded-full p-0.5 text-muted-foreground opacity-0",
            "transition hover:text-amber-600 focus-visible:opacity-100 group-hover:opacity-100",
            "disabled:pointer-events-none dark:hover:text-amber-400",
          )}
        >
          <Ban aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos e lint**

```bash
npx prettier --write src/components/retrospectivas/ParticipantCard.tsx
npx tsc --noEmit
npm run lint
```

Esperado: exit 0. Os três ícones (`Ban`, `CirclePause`, `Undo2`) existem no `lucide-react` instalado — se `tsc` reclamar de export inexistente, a versão do pacote mudou e o nome precisa ser reconferido, não removido.

- [ ] **Step 3: Commit**

```bash
git add src/components/retrospectivas/ParticipantCard.tsx
git commit -m "feat(retro): add participant card with photo/initials avatar and keyboard actions"
```

---

### Task 7: `RouletteView`

**Files:**
- Create: `src/components/retrospectivas/RouletteView.tsx`

**Interfaces:**
- Consumes: `useRoulette` / `RouletteApi` de `@/hooks/use-roulette`; `ParticipantCard` de `./ParticipantCard`; `PARTICIPANTS`, `avatarColor`, `getInitials`, `shortName` de `@/lib/retrospectivas/participants`; `getPhoto`; `Button`, `Card`, `Avatar*`, `ThemeToggle`, `supabase`.
- Produces: `export function RouletteView({ email }: { email: string })` — a tela inteira, header incluído.

- [ ] **Step 1: Criar a view com header, contador e grid**

Criar `src/components/retrospectivas/RouletteView.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { Dices, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useRoulette } from "@/hooks/use-roulette";
import { PARTICIPANTS } from "@/lib/retrospectivas/participants";
import { ParticipantCard } from "./ParticipantCard";

export function RouletteView({ email }: { email: string }) {
  const roulette = useRoulette();

  const drawnCount = roulette.drawn.size;
  const skippedCount = roulette.skipped.size;
  const plural = skippedCount > 1 ? "s" : "";
  const counter =
    skippedCount > 0
      ? `${drawnCount} / ${PARTICIPANTS.length} sorteados · ${skippedCount} ausente${plural}`
      : `${drawnCount} / ${PARTICIPANTS.length} sorteados`;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Dices className="size-4" />
        </span>
        <div className="mr-auto">
          <h1 className="text-base font-semibold leading-tight">Roleta de Retrospectiva</h1>
          {/* Contador é texto real, já legível por leitor de tela. */}
          <p className="text-[11px] text-muted-foreground">{counter}</p>
        </div>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/">Quadro</Link>
        </Button>
        <ThemeToggle />
        <Button size="sm" variant="ghost" onClick={() => supabase.auth.signOut()} title={email}>
          <LogOut className="size-4" />
        </Button>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3">
          {PARTICIPANTS.map((p, i) => (
            <ParticipantCard
              key={p.email}
              participant={p}
              index={i}
              drawn={roulette.drawn.has(p.email)}
              skipped={roulette.skipped.has(p.email)}
              highlighted={roulette.highlight === p.email}
              disabled={roulette.spinning}
              onUnmark={() => roulette.unmark(p.email)}
              onSkip={() => roulette.skip(p.email)}
              onUnskip={() => roulette.unskip(p.email)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Acrescentar o palco (vencedor + botões)**

Acrescentar os imports que faltam, no topo:

```tsx
import { Dices, LogOut, RotateCcw, Shuffle } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { getPhoto } from "@/lib/retrospectivas/photos";
import {
  avatarColor,
  getInitials,
  shortName,
  PARTICIPANTS,
} from "@/lib/retrospectivas/participants";
```

(o import de `lucide-react` substitui o da Step 1; o de `participants` também.)

Dentro do componente, antes do `return`, resolver o vencedor:

```tsx
  // O card do vencedor vive aqui: são ~15 linhas de JSX que não se repetem em
  // lugar nenhum — extrair componente só espalharia props.
  const winnerIndex = PARTICIPANTS.findIndex((p) => p.email === roulette.lastWinner);
  const winner = winnerIndex === -1 ? undefined : PARTICIPANTS[winnerIndex];
```

E inserir o palco dentro do `<main>`, **antes** do grid:

```tsx
        <Card className="flex flex-col items-center gap-4 p-6">
          {/* A região aria-live existe desde o primeiro render, mesmo vazia: é o
              que faz o leitor de tela anunciar o vencedor quando ele aparece. */}
          <div aria-live="polite" className="flex min-h-[7rem] items-center justify-center">
            {winner ? (
              <div
                key={winner.email}
                className="flex animate-in flex-col items-center gap-1 duration-300 zoom-in-95"
              >
                <Avatar className="size-16 ring-2 ring-primary">
                  <AvatarImage src={getPhoto(winner.email)} alt="" />
                  <AvatarFallback
                    style={{ backgroundColor: avatarColor(winner, winnerIndex) }}
                    className="text-lg font-semibold text-white"
                  >
                    {getInitials(winner.name)}
                  </AvatarFallback>
                </Avatar>
                <p className="text-base font-semibold">{shortName(winner.name)}</p>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  sorteado!
                </p>
              </div>
            ) : null}
          </div>

          {/* Desabilita por availableCount, não por drawn.size: com todo mundo
              restante marcado ausente, o botão do legado ficava clicável e não
              fazia nada (desvio 3). */}
          <Button
            size="lg"
            onClick={roulette.spin}
            disabled={roulette.spinning || roulette.availableCount === 0}
          >
            <Shuffle className="size-5" /> Sortear
          </Button>

          {drawnCount > 0 || skippedCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={roulette.reset} disabled={roulette.spinning}>
              <RotateCcw className="size-4" /> Reiniciar
            </Button>
          ) : null}
        </Card>
```

A `key={winner.email}` é o que reinicia a animação `zoom-in-95` a cada novo vencedor — substitui o `void box.offsetWidth` do legado.

- [ ] **Step 3: Verificar tipos e lint**

```bash
npx prettier --write src/components/retrospectivas/RouletteView.tsx
npx tsc --noEmit
npm run lint
```

Esperado: exit 0. `PARTICIPANTS[winnerIndex]` é `Participant | undefined` por causa do `noUncheckedIndexedAccess` — o `winner` opcional já trata isso, não acrescentar `!`.

- [ ] **Step 4: Commit**

```bash
git add src/components/retrospectivas/RouletteView.tsx
git commit -m "feat(retro): add roulette view with stage, winner card and participant grid"
```

---

### Task 8: Rota `/retrospectivas` e link no board

**Files:**
- Create: `src/routes/retrospectivas.tsx`
- Modify: `src/components/BoardGrid.tsx:11` e `src/components/BoardGrid.tsx:219`
- Modify: `src/routeTree.gen.ts` (gerado automaticamente — não editar à mão)

**Interfaces:**
- Consumes: `RouletteView` de `@/components/retrospectivas/RouletteView`; `useAuthorizedSession`, `AuthCard`, `AccessDenied`, `Button`, `supabase`.
- Produces: rota `/retrospectivas` registrada no `routeTree.gen.ts` — é ela que faz `<Link to="/retrospectivas">` compilar no `BoardGrid`.

- [ ] **Step 1: Criar a rota**

Criar `src/routes/retrospectivas.tsx` — mesmo preâmbulo de `/compromisso`, com `ssr: false` porque a tela depende de `localStorage`, que não existe no servidor:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useAuthorizedSession } from "@/hooks/use-authorized-session";
import { AuthCard } from "@/components/AuthCard";
import { AccessDenied } from "@/components/AccessDenied";
import { RouletteView } from "@/components/retrospectivas/RouletteView";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/retrospectivas")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Retrospectivas — Roleta de sorteio do time" },
      {
        name: "description",
        content: "Sorteia quem conduz a próxima retro, com estado que sobrevive ao refresh.",
      },
    ],
  }),
  component: RetrospectivasPage,
});

function RetrospectivasPage() {
  const { session, loading, canView } = useAuthorizedSession();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!session) return <AuthCard />;

  // canView, não canEdit: sortear não escreve no banco. E não é público — os
  // dados exibidos são exatamente o que a migration de RBAC fechou nas tabelas
  // do board.
  if (!canView) {
    return (
      <AccessDenied
        title="Acesso ainda não liberado"
        description="Sua conta existe, mas nenhum papel foi atribuído. Peça acesso a um administrador da plataforma."
        action={
          <Button variant="outline" className="w-full" onClick={() => supabase.auth.signOut()}>
            Sair
          </Button>
        }
      />
    );
  }

  return <RouletteView email={session.user.email ?? ""} />;
}
```

- [ ] **Step 2: Regenerar a árvore de rotas**

O `@tanstack/router-plugin` regenera `src/routeTree.gen.ts` durante o build. Sem isso, `createFileRoute("/retrospectivas")` e `<Link to="/retrospectivas">` **não compilam** — a rota ainda não existe no tipo.

Confirmar que o cache de fotos continua ausente e buildar:

```bash
ls src/lib/retrospectivas
npm run build
grep -c "retrospectivas" src/routeTree.gen.ts
```

Esperado: `ls` sem `photos-cache.ts` (portão do spec: build de clone limpo); build em exit 0; `grep` retorna um número maior que zero.

- [ ] **Step 3: Acrescentar o link no header do board**

Em `src/components/BoardGrid.tsx`, no import de `lucide-react` (linhas 8–19), inserir `Dices,` entre `ClipboardList,` e `ExternalLink,`:

```tsx
import {
  CalendarPlus,
  ClipboardList,
  Dices,
  ExternalLink,
  LayoutGrid,
  LogOut,
  Pencil,
  Plus,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
```

E, logo depois do bloco do link "Compromisso" (que termina na linha 219, com `</Button>`), inserir:

```tsx
            <Button size="sm" variant="ghost" asChild>
              <Link to="/retrospectivas">
                <Dices className="size-4" /> Retrospectivas
              </Link>
            </Button>
```

Sem gate condicional — ao contrário do link "Usuários", que é `isAdmin`. Qualquer pessoa com papel vê a roleta.

- [ ] **Step 4: Verificar tipos, lint e build**

```bash
npx prettier --write src/routes/retrospectivas.tsx src/components/BoardGrid.tsx
npx tsc --noEmit
npm run lint
npm run build
```

Esperado: exit 0 nos três. Se `tsc` reclamar de `"/retrospectivas"` não ser um caminho válido, o Step 2 não regenerou a árvore — rodar `npm run build` de novo antes de investigar qualquer outra coisa.

- [ ] **Step 5: Fumaça no navegador**

```bash
npm run dev
```

`vite dev` não retorna — rodar em segundo plano e deixar de pé até o fim da Task 10. Com o servidor no ar, logado como alguém com papel `viewer` ou superior:

1. `/` mostra o botão "Retrospectivas" com o ícone de dados, ao lado de "Compromisso"; clicar leva à roleta.
2. A roleta mostra 20 cards com iniciais coloridas (o cache de fotos ainda não existe) e o contador "0 / 20 sorteados".
3. "Sortear" pisca por ~1,4 s e revela um vencedor no palco.
4. Recarregar a página mantém o sorteado apagado e o card do vencedor no palco.
5. O botão "Quadro" volta para `/`.
6. Console do navegador sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/routes/retrospectivas.tsx src/components/BoardGrid.tsx src/routeTree.gen.ts
git commit -m "feat(retro): add /retrospectivas route guarded by canView and link it from the board"
```

---

### Task 9: Popular o cache de fotos (passo manual) e verificação visual

**Files:**
- Create: `src/lib/retrospectivas/photos-cache.ts` (**fora do git — esta task não gera commit**)

**Interfaces:**
- Consumes: `import.meta.glob("./photos-cache*.ts")` de `photos.ts`; o arquivo precisa exportar `PHOTOS: Record<string, string>`.
- Produces: fotos reais nos avatares durante `npm run dev`.

> Esta etapa é manual e **deliberadamente não automatizada**: automatizá-la é reintroduzir o proxy OAuth do MS Graph pela porta dos fundos. Não escrever script de geração, não chamar o Graph, não baixar nada.

- [ ] **Step 1: Converter o cache do legado**

O conteúdo real já existe em `jira-live/static/photos-cache.js`. A conversão é mecânica — é o mesmo objeto:

1. Copiar o arquivo para `src/lib/retrospectivas/photos-cache.ts`.
2. Trocar o cabeçalho `export const PHOTOS = {` por `export const PHOTOS: Record<string, string> = {`.
3. Garantir que **todas as chaves estejam em minúsculas** — `getPhoto` normaliza a consulta para minúsculas, então uma chave com maiúscula nunca casa.

Nada além disso muda: sem download, sem chamada ao Graph, sem reformatação.

- [ ] **Step 2: Confirmar que o arquivo é invisível para o git**

```bash
git status --porcelain
git status --porcelain --ignored=matching -- src/lib/retrospectivas
```

Esperado: o primeiro comando **não** menciona `photos-cache.ts`; o segundo mostra `!! src/lib/retrospectivas/photos-cache.ts`.

Se o arquivo aparecer como `??` no primeiro, o `.gitignore` da Task 1 foi para o lugar errado: **parar imediatamente** e corrigir antes de qualquer `git add`.

- [ ] **Step 3: Portão do spec — lint com o cache presente**

```bash
npm run lint
npx prettier --list-different .
```

Esperado: lint em exit 0 e `photos-cache.ts` ausente da lista do Prettier. Este é o cenário que o spec exige exercitar — 1,3 MB de data URI passando pelo ESLint ou pelo Prettier a cada execução é exatamente o que os `ignores` evitam.

- [ ] **Step 4: Verificação visual**

Com `npm run dev` rodando e a tela aberta:

1. Os cards mostram fotos, não iniciais. Quem não tem foto no cache continua com inicial colorida — é o esperado, não é bug.
2. Console do navegador sem erro.
3. Sumir temporariamente com o arquivo e recarregar: **todos** os cards caem em iniciais, com as cores certas, sem erro no console (item 11 do roteiro manual).

```bash
mv src/lib/retrospectivas/photos-cache.ts ../photos-cache-backup.ts   # fora do repositório
# recarregar a tela, conferir, e devolver:
mv ../photos-cache-backup.ts src/lib/retrospectivas/photos-cache.ts
```

O destino precisa ser **fora do repositório**. Renomear para `photos-cache.bak` dentro de `src/lib/retrospectivas/` deixaria o arquivo de PII visível como `??` no `git status` — só o nome exato `photos-cache.ts` está no `.gitignore`.

- [ ] **Step 5: Sem commit**

Esta task não produz nada versionável — o único arquivo criado é ignorado de propósito. Não rodar `git add`. Seguir para a Task 10.

---

### Task 10: Roteiro manual completo e encerramento

**Files:** nenhum arquivo de código. Verificação de ponta a ponta, com `npm run dev` rodando.

**Interfaces:**
- Consumes: tudo o que as Tasks 1–9 produziram.
- Produces: a confirmação de que o legado pode ser desligado.

- [ ] **Step 1: Gates de autorização (itens 1–4 do spec)**

1. Sem sessão, abrir `/retrospectivas` → `AuthCard`.
2. Logado sem papel → `AccessDenied`, **sem vazar a lista de participantes** (conferir também que a lista não aparece no HTML da página, não só na tela).
3. Como `viewer` → a tela funciona por inteiro: sortear, marcar ausente, desfazer.
4. Link "Retrospectivas" aparece no header do quadro para qualquer papel; o botão "Quadro" volta da roleta.

- [ ] **Step 2: Fluxo do sorteio (itens 5–8)**

5. "Sortear" → ~1,4 s de piscada, um vencedor, card com foto (ou iniciais) e as duas primeiras palavras do nome.
6. Recarregar a página → sorteados continuam apagados, vencedor continua exibido.
7. Clicar num sorteado → volta a elegível; se era o vencedor, o card do palco some.
8. Marcar 2 ausentes → contador exibe "· 2 ausentes"; nenhum dos dois sai no sorteio (repetir alguns sorteios para confirmar).

- [ ] **Step 3: Bordas e regressões (itens 9–13)**

9. Sortear até esgotar → "Sortear" desabilita. Depois de "Reiniciar", marcar **todos** como ausentes → o botão também desabilita (desvio 3: o legado deixava clicável e não fazia nada).
10. "Reiniciar" → tudo volta ao estado inicial, inclusive depois de recarregar.
11. Mover `photos-cache.ts` para fora do repositório (comando na Task 9, Step 4) → todos os cards caem em iniciais, com as cores certas, sem erro no console. Devolver o arquivo depois.
12. Alternar tema claro/escuro → sorteado (apagado), ausente (âmbar) e destaque (anel primário) continuam legíveis nos dois temas.
13. Ligar `prefers-reduced-motion: reduce` no SO (Windows: *Configurações → Acessibilidade → Efeitos visuais → Efeitos de animação*) e recarregar → o vencedor aparece sem a piscada de 1,4 s.

Extra de acessibilidade, que o legado não tinha: navegar com **Tab** até um card e acionar com **Enter** — o botão "marcar ausente" é alcançável por teclado e anuncia "Marcar {nome} como ausente".

- [ ] **Step 4: Marcar o plano como concluído e commitar**

Marcar os checkboxes deste arquivo e commitar:

```bash
git add docs/superpowers/plans/2026-08-09-retrospectivas-roleta.md
git commit -m "docs: mark retrospective roulette plan as completed"
```

---

## Encerramento

Ao final da Task 10 o repositório tem 9 commits locais — 8 de código (Tasks 1 a 8) mais o de documentação — e nenhum push foi feito. Publicar para o Lovable é decisão do usuário:

```bash
git push origin main
```

**Antes de publicar, conferir uma última vez** que o cache de fotos não entrou em nenhum commit:

```bash
git log --oneline --name-only | grep photos-cache
```

Esperado: nenhuma linha. Se aparecer, **não publicar** — reescrever histórico de um repositório sincronizado com o Lovable é exatamente o que o `AGENTS.md` pede para evitar, e o assunto vira conversa com o usuário.

**Consequência conhecida, já decidida no spec:** o app em produção é construído a partir do git, e o cache é ignorado pelo git. Logo, **em produção a roleta cai no fallback de iniciais**; as fotos só aparecem em `npm run dev` na máquina que tem o arquivo. Isso não é bug desta implementação — é o preço de manter PII fora do histórico. Se o time reclamar, a saída desenhada é o bucket privado no Supabase Storage, que troca apenas o corpo de `getPhoto` e não toca em componente nenhum.

Com a roleta no ar, o `jira-live` não tem mais feature exclusiva: o Windows Service da porta 8000 pode ser desligado.
