# Visão Agile Theme Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Dev Demand Flow ("Sprint Board") app's visual design system — colors, typography, cards, badges, header — match the Way2 "Visão Agile" dashboard (apontamentos.way2.com.br/visao-agile), so both internal tools feel like part of the same family.

**Architecture:** This is a pure design-system/styling change. One CSS file (`src/styles.css`) defines every color token as a single fixed dark theme (no more light/dark split). Two small helper functions in `src/lib/board.ts` expose the new "wash background" + "accent border" pattern for allocation cards. `src/components/BoardGrid.tsx` and `src/components/AuthCard.tsx` consume the new tokens/helpers. No data model, auth, or routing changes.

**Tech Stack:** React 19, TanStack Start/Router, Vite 8, Tailwind CSS v4 (`@theme inline` token system), shadcn/ui (Radix), TypeScript. Package manager available in this environment: **npm** (node_modules already installed; `npm run build` verified working as of this plan).

## Global Constraints

- No light theme, no theme toggle — the app is dark by default and stays dark always (confirmed with the user).
- Semantic chip palette is **locked** (validated with the user via visual mockup): Especificada = blue, Não especificada = âmbar, Bug = vermelho, Férias = verde.
- Out of scope: authentication method (stays Supabase email/password), hub navigation integration, data model, drag-and-drop logic.
- Color tokens are written as `hsl(...)` / `rgba(...)` literals (not oklch) — matches the values measured live from Visão Agile and keeps 1:1 traceability to that source.
- `npm run lint` currently fails repo-wide (6323 pre-existing CRLF/prettier errors unrelated to this work) — do **not** use it as a pass/fail gate for this plan. Use `npm run build` instead; it was verified clean before this plan started.
- Full spec: [docs/superpowers/specs/2026-08-06-visao-agile-theme-design.md](../specs/2026-08-06-visao-agile-theme-design.md)

---

### Task 1: Replace the color/typography design tokens

**Files:**
- Modify: `src/styles.css` (entire file, 231 lines → new content below)

**Interfaces:**
- Produces: every `--color-*` CSS variable consumed by Tailwind utilities across the whole app (`bg-background`, `bg-card`, `bg-primary`, `border-border`, `text-muted-foreground`, `bg-surface`, `bg-surface-2`, `bg-header`, `text-header-foreground`, `border-grid-line`, `bg-st-{especificada,nao-especificada,bug,ferias}`, `text-st-*-fg`, `border-st-*-fg`, `shadow-card`, `shadow-pop`, `font-sans`). No component code changes in this task — later tasks rely on these names existing.

- [ ] **Step 1: Replace the full contents of `src/styles.css`**

```css
@import "tailwindcss" source(none);
@source "../src";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));


/*
 * Design system definition.
 *
 * The @theme inline block maps CSS custom properties to Tailwind utility
 * classes (e.g. --color-primary -> bg-primary, text-primary).
 *
 * The :root block below defines the actual color values, matched 1:1 to
 * the Way2 "Visão Agile" dashboard (apontamentos.way2.com.br) so both
 * internal tools share one dark design system. There is no light theme —
 * every color lives only in :root, written as hsl()/rgba() to stay
 * traceable to the values measured on that reference dashboard.
 *
 * To add a new semantic color:
 * 1. Add the variable to :root
 * 2. Register it in @theme inline as --color-<name>: var(--<name>)
 */

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
  --radius-3xl: calc(var(--radius) + 12px);
  --radius-4xl: calc(var(--radius) + 16px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-ring-offset-background: var(--background);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

:root {
  --radius: 0.5rem;

  --background: hsl(217 33% 10%);
  --foreground: hsl(210 40% 98%);
  --card: hsl(217 33% 13%);
  --card-foreground: hsl(210 40% 98%);
  --popover: hsl(217 33% 13%);
  --popover-foreground: hsl(210 40% 98%);

  --primary: hsl(212 100% 50%);
  --primary-foreground: hsl(0 0% 100%);
  --secondary: hsl(217 33% 17%);
  --secondary-foreground: hsl(210 40% 98%);
  --muted: hsl(217 33% 17%);
  --muted-foreground: hsl(215 20% 65%);
  --accent: hsl(217 33% 20%);
  --accent-foreground: hsl(210 40% 98%);
  --destructive: hsl(0 63% 31%);
  --destructive-foreground: hsl(210 40% 98%);
  --border: hsl(217 33% 17%);
  --input: hsl(217 33% 17%);
  --ring: hsl(212 100% 50%);

  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: hsl(217 33% 13%);
  --sidebar-foreground: hsl(210 40% 98%);
  --sidebar-primary: hsl(212 100% 50%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(217 33% 17%);
  --sidebar-accent-foreground: hsl(210 40% 98%);
  --sidebar-border: hsl(217 33% 17%);
  --sidebar-ring: hsl(212 100% 50%);
}

@layer base {
  * {
    border-color: var(--color-border);
  }

  body {
    background-color: var(--color-background);
    color: var(--color-foreground);
  }
}

/* ---------------------------------------------------------------
 * Sprint Board — design system
 * Matches the Way2 "Visão Agile" dashboard: dark navy chrome, vivid
 * blue primary, semantic status colours (blue/amber/red/green).
 * ------------------------------------------------------------- */

@theme inline {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;

  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-grid-line: var(--grid-line);
  --color-header: var(--header);
  --color-header-foreground: var(--header-foreground);

  --color-st-nao-especificada: var(--st-nao-especificada);
  --color-st-nao-especificada-fg: var(--st-nao-especificada-fg);
  --color-st-especificada: var(--st-especificada);
  --color-st-especificada-fg: var(--st-especificada-fg);
  --color-st-bug: var(--st-bug);
  --color-st-bug-fg: var(--st-bug-fg);
  --color-st-ferias: var(--st-ferias);
  --color-st-ferias-fg: var(--st-ferias-fg);

  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.24), 0 1px 1px rgb(0 0 0 / 0.16);
  --shadow-pop: 0 10px 30px -10px rgb(0 0 0 / 0.45);
}

:root {
  --surface: var(--card);
  --surface-2: hsl(217 33% 17%);
  --grid-line: var(--border);
  --header: var(--card);
  --header-foreground: var(--foreground);

  --st-nao-especificada: rgba(234, 179, 8, 0.12);
  --st-nao-especificada-fg: #facc15;
  --st-especificada: rgba(59, 130, 246, 0.12);
  --st-especificada-fg: #60a5fa;
  --st-bug: rgba(239, 68, 68, 0.12);
  --st-bug-fg: #f87171;
  --st-ferias: rgba(34, 197, 94, 0.12);
  --st-ferias-fg: #4ade80;
}

@layer base {
  body {
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }
}

@utility board-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--grid-line) transparent;
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: ends with `✓ built in <time>` and no errors (a Tailwind error here usually means a typo in a `--color-*` variable name).

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: replace design tokens with Visão Agile dark theme palette"
```

---

### Task 2: Swap the web font and enable dark toast styling

**Files:**
- Modify: `src/routes/__root.tsx:91-97` (Google Fonts `<link>`)
- Modify: `src/routes/__root.tsx:133` (`<Toaster>` usage)

**Interfaces:**
- Consumes: `--font-sans: "Inter", ...` from Task 1 (the CSS variable already points at Inter; this task makes sure the actual font file is loaded).
- Produces: nothing consumed by later tasks — this is a leaf change.

- [ ] **Step 1: Replace the Google Fonts link**

In `src/routes/__root.tsx`, find (inside the `links` array, currently lines 94-97):

```tsx
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Outfit:wght@500;600;700&display=swap",
      },
```

Replace with:

```tsx
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
```

- [ ] **Step 2: Force dark toast styling**

In the same file, find (in `RootComponent`, currently line 133):

```tsx
      <Toaster position="top-center" richColors />
```

Replace with:

```tsx
      <Toaster position="top-center" richColors theme="dark" />
```

`sonner`'s `richColors` picks its success/error accent colors based on the `theme` prop (defaults to `"light"` when omitted); since the app has no light mode anymore, pin it to `"dark"` so toast colors read correctly on the dark background.

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: ends with `✓ built in <time>` and no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "style: load Inter instead of IBM Plex Sans/Outfit, pin toasts to dark theme"
```

---

### Task 3: Add wash/accent color helpers to the board domain module

**Files:**
- Modify: `src/lib/board.ts:78-86` (right after the existing `chipClassFor`)

**Interfaces:**
- Consumes: `Allocation` type, `Pick<Allocation, "tipo" | "status">`, `st-*`/`st-*-fg` Tailwind color tokens from Task 1.
- Produces: `washClassFor(a): string` and `accentClassFor(a): string`, both exported from `src/lib/board.ts`, used by `AllocationChip` in Task 4.

- [ ] **Step 1: Add the two helper functions**

In `src/lib/board.ts`, immediately after the existing `chipClassFor` function (currently ending at line 86, right before `export function formatRange`), add:

```ts
/** Background-only wash for the allocation card body (translucent tint over the dark surface behind it). */
export function washClassFor(a: Pick<Allocation, "tipo" | "status">) {
  if (a.tipo === "bug") return "bg-st-bug";
  if (a.tipo === "ferias") return "bg-st-ferias";
  return a.status === "especificada" ? "bg-st-especificada" : "bg-st-nao-especificada";
}

/** Solid left-border accent using the same semantic color as washClassFor. */
export function accentClassFor(a: Pick<Allocation, "tipo" | "status">) {
  if (a.tipo === "bug") return "border-st-bug-fg";
  if (a.tipo === "ferias") return "border-st-ferias-fg";
  return a.status === "especificada"
    ? "border-st-especificada-fg"
    : "border-st-nao-especificada-fg";
}
```

Note: `chipClassFor` (bg + text combined) stays untouched — it is still the correct helper for the small pill badges inside the hover card, which *do* want colored text. The two new helpers are only for the outer draggable card, which wants a neutral-text card with just a background tint and a colored border.

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: ends with `✓ built in <time>` and no errors. (`washClassFor`/`accentClassFor` are unused until Task 4, but TypeScript/Vite won't fail on an unused exported function.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/board.ts
git commit -m "feat: add washClassFor/accentClassFor helpers for the new card style"
```

---

### Task 4: Restyle the allocation card (AllocationChip)

**Files:**
- Modify: `src/components/BoardGrid.tsx:17-30` (import list)
- Modify: `src/components/BoardGrid.tsx:424-508` (`AllocationChip` function)

**Interfaces:**
- Consumes: `washClassFor`, `accentClassFor` from `src/lib/board.ts` (Task 3); `chipClassFor`, `statusInfo`, `tipoInfo` (already imported, unchanged).
- Produces: no new exports — `AllocationChip` is a private component used only inside `BoardGrid.tsx`.

- [ ] **Step 1: Add the new imports**

In `src/components/BoardGrid.tsx`, find the `@/lib/board` import block (currently lines 17-30):

```tsx
import {
  chipClassFor,
  formatRange,
  statusInfo,
  tipoInfo,
  STATUS_LIST,
  TIPO_LIST,
  type Allocation,
  type AllocationStatus,
  type AllocationTipo,
  type Dev,
  type Sprint,
  type Team,
} from "@/lib/board";
```

Replace with:

```tsx
import {
  accentClassFor,
  chipClassFor,
  formatRange,
  statusInfo,
  tipoInfo,
  washClassFor,
  STATUS_LIST,
  TIPO_LIST,
  type Allocation,
  type AllocationStatus,
  type AllocationTipo,
  type Dev,
  type Sprint,
  type Team,
} from "@/lib/board";
```

- [ ] **Step 2: Rewrite `AllocationChip`**

Replace the entire `AllocationChip` function (currently lines 424-508) with:

```tsx
function AllocationChip({
  allocation,
  dimmed,
  allowWrap,
  onEdit,
}: {
  allocation: Allocation;
  dimmed: boolean;
  allowWrap: boolean;
  onEdit: () => void;
}) {
  const chipClass = chipClassFor(allocation);
  const washClass = washClassFor(allocation);
  const accentClass = accentClassFor(allocation);
  return (
    <HoverCard openDelay={300}>
      <HoverCardTrigger asChild>
        <div
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/allocation", allocation.id)}
          onClick={onEdit}
          className={`shrink-0 cursor-grab overflow-hidden rounded-md border-l-[3px] px-2 py-1.5 text-left text-foreground shadow-card transition-opacity active:cursor-grabbing ${washClass} ${accentClass} ${
            dimmed ? "opacity-25" : ""
          }`}
        >
          <p
            className={`text-xs font-medium leading-snug ${allowWrap ? "line-clamp-4" : "truncate"}`}
          >
            {allocation.title}
          </p>
          {allowWrap && (allocation.ticket_key || allocation.notes) ? (
            <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-80">
              {allocation.ticket_key ? (
                allocation.ticket_url ? (
                  <a
                    href={allocation.ticket_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 font-mono underline underline-offset-2"
                  >
                    {allocation.ticket_key}
                    <ExternalLink className="size-2.5" />
                  </a>
                ) : (
                  <span className="font-mono">{allocation.ticket_key}</span>
                )
              ) : null}
              {allocation.notes ? <span className="truncate">{allocation.notes}</span> : null}
            </div>
          ) : null}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-72 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusInfo(allocation.status).chip}`}
          >
            {statusInfo(allocation.status).label}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${chipClass}`}>
            {tipoInfo(allocation.tipo).label}
          </span>
          {allocation.ticket_key ? (
            allocation.ticket_url ? (
              <a
                href={allocation.ticket_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-mono text-xs underline underline-offset-2"
              >
                {allocation.ticket_key}
                <ExternalLink className="size-2.5" />
              </a>
            ) : (
              <span className="font-mono text-xs">{allocation.ticket_key}</span>
            )
          ) : null}
        </div>
        <p className="text-sm font-medium leading-snug">{allocation.title}</p>
        {allocation.notes ? (
          <p className="text-xs text-muted-foreground">{allocation.notes}</p>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
```

What changed vs. the original: the outer `<div>` no longer gets `chipClass` (solid bg + colored text covering the whole card). It now gets `washClass` (translucent tint background), `accentClass` (3px solid-color left border), and an explicit `text-foreground` so the title stays neutral white/near-white instead of colored. The two small badges inside the hover card switch from `rounded` to `rounded-full` (true pill shape, matching the Visão Agile badge pattern) and their padding/weight adjust to `px-2 py-0.5 font-medium` to match the measured badge spec.

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: ends with `✓ built in <time>` and no errors.

- [ ] **Step 4: Visual check**

Run: `npm run dev`, open the board in a browser, and create (or look at existing) allocations covering all four chip kinds (Especificada, Não especificada, Bug, Férias) in the same sprint/dev cell. Confirm each renders as a dark card with a colored left border and neutral white title text — no more solid-color blocks. Stop the dev server when done (`Ctrl+C`).

- [ ] **Step 5: Commit**

```bash
git add src/components/BoardGrid.tsx
git commit -m "style: redesign allocation card as dark card + accent border + pill badges"
```

---

### Task 5: Restyle the header chrome (logo, search, filters, sprint badge, logout)

**Files:**
- Modify: `src/components/BoardGrid.tsx:156-238` (header markup)
- Modify: `src/components/BoardGrid.tsx:367` (sprint quarter badge, inside `SprintRow`)
- Modify: `src/components/BoardGrid.tsx:510-531` (`FilterChip` function)
- Modify: `src/components/AuthCard.tsx:44` (logo badge, for consistency with the header)

**Interfaces:**
- Consumes: tokens from Task 1 only (`bg-primary`, `text-primary`, `bg-accent`, `text-muted-foreground`, `bg-border`, etc.). No new exports.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Restyle the logo badge, search input, and logout button**

In `src/components/BoardGrid.tsx`, inside the `<header>` block, find:

```tsx
            <span className="flex size-9 items-center justify-center rounded-lg bg-white/10">
              <LayoutGrid className="size-4" />
            </span>
```

Replace with:

```tsx
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <LayoutGrid className="size-4" />
            </span>
```

Find:

```tsx
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-header-foreground/50" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar demanda ou ticket"
                className="h-9 w-56 border-white/15 bg-white/10 pl-8 text-header-foreground placeholder:text-header-foreground/50"
              />
            </div>
```

Replace with:

```tsx
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar demanda ou ticket"
                className="h-9 w-56 pl-8"
              />
            </div>
```

(The `Input` component already styles `border-input bg-transparent placeholder:text-muted-foreground` by default — see `src/components/ui/input.tsx:11` — so no header-specific override is needed anymore now that the header shares the same dark surface as the rest of the app.)

Find:

```tsx
            <Button
              size="sm"
              variant="ghost"
              className="text-header-foreground hover:bg-white/10 hover:text-header-foreground"
              onClick={() => supabase.auth.signOut()}
              title={email}
            >
              <LogOut className="size-4" />
            </Button>
```

Replace with:

```tsx
            <Button
              size="sm"
              variant="ghost"
              onClick={() => supabase.auth.signOut()}
              title={email}
            >
              <LogOut className="size-4" />
            </Button>
```

(The `ghost` button variant already provides `hover:bg-accent hover:text-accent-foreground` — see `src/components/ui/button.tsx:17` — so the custom white-overlay classes are redundant now.)

- [ ] **Step 2: Restyle the filter row divider and labels**

In the same file, find:

```tsx
          <div className="flex flex-wrap items-center gap-1.5 border-t border-white/10 px-4 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-header-foreground/40">
              Tipo
            </span>
```

Replace with:

```tsx
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Tipo
            </span>
```

A few lines below, find the matching "Status" section:

```tsx
            <span className="mx-1 h-4 w-px bg-white/15" />

            <span className="text-[11px] font-medium uppercase tracking-wider text-header-foreground/40">
              Status
            </span>
```

Replace with:

```tsx
            <span className="mx-1 h-4 w-px bg-border" />

            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Status
            </span>
```

- [ ] **Step 3: Restyle the sprint quarter badge**

In the same file, inside `SprintRow`, find:

```tsx
          {sprint.quarter ? (
            <span className="rounded bg-header px-1.5 py-0.5 text-[10px] font-semibold text-header-foreground">
              {sprint.quarter}
            </span>
          ) : null}
```

Replace with:

```tsx
          {sprint.quarter ? (
            <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {sprint.quarter}
            </span>
          ) : null}
```

(`bg-header` now equals `bg-card`, which is nearly the same tone as the surrounding `bg-surface-2` cell — the badge would barely be visible. `bg-primary` makes it pop, matching how Visão Agile uses its primary blue for small tags.)

- [ ] **Step 4: Restyle `FilterChip`**

Replace the entire `FilterChip` function (currently lines 510-531) with:

```tsx
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 5: Match the logo badge in `AuthCard`**

In `src/components/AuthCard.tsx`, find:

```tsx
          <span className="flex size-10 items-center justify-center rounded-lg bg-header text-header-foreground">
            <LayoutGrid className="size-5" />
          </span>
```

Replace with:

```tsx
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <LayoutGrid className="size-5" />
          </span>
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: ends with `✓ built in <time>` and no errors.

- [ ] **Step 7: Visual check**

Run: `npm run dev`, open the board. Confirm: the logo badge is a blue-tinted rounded square, the search input has a normal (not white-tinted) border, Tipo/Status filter chips highlight in blue when active, sprint code chips show a solid blue quarter tag, and the logout button's hover state uses the same subtle highlight as other ghost buttons. Also open the sign-in screen (sign out first, or open in an incognito window) and confirm its logo badge matches the header's. Stop the dev server (`Ctrl+C`).

- [ ] **Step 8: Commit**

```bash
git add src/components/BoardGrid.tsx src/components/AuthCard.tsx
git commit -m "style: align header chrome (logo, search, filters, badges) with new theme"
```

---

### Task 6: Full visual verification pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` and open the printed local URL in a browser.

- [ ] **Step 2: Walk through every screen**

Check each of the following against the approved design (`docs/superpowers/specs/2026-08-06-visao-agile-theme-design.md`):
- Sign-in screen (`AuthCard`): dark background, blue logo badge, readable form fields.
- Empty board state (`EmptyState`, no sprints/devs yet): dark dashed card, readable text and buttons.
- Populated board (`BoardGrid`): header, dev columns, sprint rows, all four allocation chip colors side by side, hover card on a chip, drag-and-drop between two cells still works.
- `AllocationDialog`, `DevDialog`, `SprintDialog`: open each, confirm dark background, readable labels/inputs, status/tipo dots in the `Select` dropdowns show the new colors, destructive ("Remover"/"Excluir") buttons still read as red.
- Toast: trigger one error toast (e.g. temporarily disconnect network and try saving) and confirm it renders with dark styling, not a white flash.

- [ ] **Step 3: Check for console/runtime errors**

While clicking through the above, watch the browser devtools console for errors (React warnings about missing keys are pre-existing/out of scope; anything about missing CSS variables or failed Supabase calls unrelated to auth should be investigated).

- [ ] **Step 4: Final build check**

Run: `npm run build`
Expected: ends with `✓ built in <time>` and no errors.

- [ ] **Step 5: Stop the dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

No commit in this task — it's verification only. If any issue is found, fix it as part of the task that introduced it (amend that task's changes with a new commit) before considering the plan complete.
