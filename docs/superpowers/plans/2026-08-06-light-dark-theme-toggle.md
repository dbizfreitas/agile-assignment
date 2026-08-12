# Light/Dark Theme Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a light theme alongside the existing dark theme in the Dev Demand Flow ("Sprint Board") app, with a sun/moon toggle button matching the Way2 "Visão Agile" dashboard's own light/dark switcher, opening light by default on a first visit with no saved preference.

**Architecture:** `src/styles.css` goes back to the standard shadcn dual-theme shape — `:root` holds light values, a `.dark` class block overrides them for dark — using the exact dark values already shipped, plus new light values measured live from Visão Agile. A new `useTheme` hook reads/writes a `localStorage` flag and toggles the `dark` class on `<html>`; a new `ThemeToggle` button (sun/moon icon) consumes it and is rendered in both the header (`BoardGrid.tsx`) and the sign-in screen (`AuthCard.tsx`). A tiny inline script in the document shell (`__root.tsx`) applies `.dark` before hydration so returning dark-mode users don't see a flash of light.

**Tech Stack:** React 19, TanStack Start/Router, Vite 8, Tailwind v4 (`@theme inline` token system), shadcn/ui (Radix), `lucide-react` (already a dependency, provides `Sun`/`Moon` icons), TypeScript. Package manager: npm (`npm run build` is the correctness gate; no automated test suite; `npm run lint` is broken repo-wide on ~6300 pre-existing CRLF/prettier errors unrelated to this work — do not use it as a gate).

## Global Constraints

- No saved preference → app opens **light** (confirmed with the user — this is the opposite of Visão Agile's own default, which opens dark; everything else about the toggle behavior mirrors Visão Agile).
- Toggle persists to `localStorage` and is restored on reload.
- Light-mode tokens below are measured live from Visão Agile (06/08/2026) — use them verbatim, do not approximate.
- Semantic chip palette stays locked to the same four colors already shipped for dark (blue/amber/red/green) — light mode uses the "600" shade of each instead of "400", per the design spec.
- `TEAM_COLORS` in `src/lib/board.ts`, and the `chipClassFor`/`washClassFor`/`accentClassFor` functions, must NOT change — they already work correctly in both themes once the CSS tokens are theme-conditional.
- Full spec: [docs/superpowers/specs/2026-08-06-light-dark-theme-toggle-design.md](../specs/2026-08-06-light-dark-theme-toggle-design.md)

---

### Task 1: Restore the dual light/dark theme in styles.css

**Files:**
- Modify: `src/styles.css` (entire file, 177 lines → new content below)

**Interfaces:**
- Produces: every `--color-*` CSS variable, now theme-conditional via `:root` (light) vs `.dark` (dark). No component code changes in this task — later tasks add the toggle mechanism that flips the `.dark` class.

- [ ] **Step 1: Replace the full contents of `src/styles.css`**

```css
@import "tailwindcss" source(none);
@source "../src";
@import "tw-animate-css";

/* Drives the `dark:` variant and the .dark token overrides below — toggled
   by src/hooks/use-theme.ts. */
@custom-variant dark (&:is(.dark *));


/*
 * Design system definition.
 *
 * The @theme inline block maps CSS custom properties to Tailwind utility
 * classes (e.g. --color-primary -> bg-primary, text-primary).
 *
 * The :root block below defines the LIGHT theme values; the .dark block
 * (applied by toggling the `dark` class on <html>, see
 * src/hooks/use-theme.ts) overrides them for the DARK theme. Both sets are
 * matched 1:1 to the Way2 "Visão Agile" dashboard (apontamentos.way2.com.br)
 * so both internal tools share one design system in either mode. Values are
 * written as hsl()/rgba() to stay traceable to the values measured on that
 * reference dashboard.
 *
 * To add a new semantic color:
 * 1. Add the variable to :root (light value) and .dark (dark value)
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
  color-scheme: light;

  --background: hsl(0 0% 98%);
  --foreground: hsl(217 33% 17%);
  --card: hsl(0 0% 100%);
  --card-foreground: hsl(217 33% 17%);
  --popover: hsl(0 0% 100%);
  --popover-foreground: hsl(217 33% 17%);

  --primary: hsl(212 100% 40%);
  --primary-foreground: hsl(0 0% 100%);
  --secondary: hsl(210 40% 96%);
  --secondary-foreground: hsl(217 33% 17%);
  --muted: hsl(210 40% 96%);
  --muted-foreground: hsl(215 16% 47%);
  --accent: hsl(212 100% 95%);
  --accent-foreground: hsl(212 100% 40%);
  --destructive: hsl(0 84% 60%);
  --destructive-foreground: hsl(210 40% 98%);
  --border: hsl(214 32% 91%);
  --input: hsl(214 32% 91%);
  --ring: hsl(212 100% 40%);

  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: hsl(0 0% 100%);
  --sidebar-foreground: hsl(217 33% 17%);
  --sidebar-primary: hsl(212 100% 40%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(210 40% 96%);
  --sidebar-accent-foreground: hsl(217 33% 17%);
  --sidebar-border: hsl(214 32% 91%);
  --sidebar-ring: hsl(212 100% 40%);
}

.dark {
  color-scheme: dark;

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
 * Matches the Way2 "Visão Agile" dashboard in both light and dark:
 * vivid blue primary, semantic status colours (blue/amber/red/green).
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
  --surface-2: hsl(210 40% 98%);
  --grid-line: hsl(214 32% 85%);
  --header: var(--card);
  --header-foreground: var(--foreground);

  --st-nao-especificada: rgba(234, 179, 8, 0.1);
  --st-nao-especificada-fg: #ca8a04;
  --st-especificada: rgba(59, 130, 246, 0.1);
  --st-especificada-fg: #2563eb;
  --st-bug: rgba(239, 68, 68, 0.1);
  --st-bug-fg: #dc2626;
  --st-ferias: rgba(34, 197, 94, 0.1);
  --st-ferias-fg: #16a34a;
}

.dark {
  --surface: var(--card);
  --surface-2: hsl(217 33% 15%);
  --grid-line: hsl(217 33% 22%);
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
Expected: ends with `✓ built in <time>` and no errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: restore light theme alongside dark, tokens measured from Visão Agile"
```

---

### Task 2: Add the theme hook and toggle button

**Files:**
- Create: `src/hooks/use-theme.ts`
- Create: `src/components/ThemeToggle.tsx`

**Interfaces:**
- Consumes: nothing from other tasks (pure new files); relies on the `dark` class mechanism wired up in Task 1's CSS.
- Produces: `useTheme(): { theme: "light" | "dark", toggleTheme: () => void }` exported from `src/hooks/use-theme.ts`; `ThemeToggle` component exported from `src/components/ThemeToggle.tsx`, consumed by Tasks 3 and 4.

- [ ] **Step 1: Create `src/hooks/use-theme.ts`**

```ts
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const initial: Theme = stored === "dark" ? "dark" : "light";
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      return next;
    });
  };

  return { theme, toggleTheme };
}
```

No saved value (`stored` is `null`) resolves to `"light"` — this is what makes the app open light by default on a first visit.

- [ ] **Step 2: Create `src/components/ThemeToggle.tsx`**

```tsx
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={toggleTheme}
      title={theme === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro"}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: ends with `✓ built in <time>` and no errors. (Neither new file is imported anywhere yet — that's expected and must not cause a build error.)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-theme.ts src/components/ThemeToggle.tsx
git commit -m "feat: add useTheme hook and ThemeToggle button"
```

---

### Task 3: Wire the toggle into the sign-in screen and prevent a flash on load

**Files:**
- Modify: `src/routes/__root.tsx` (`RootShell` function)
- Modify: `src/components/AuthCard.tsx`

**Interfaces:**
- Consumes: `ThemeToggle` from `src/components/ThemeToggle.tsx` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the no-flash script to the document shell**

In `src/routes/__root.tsx`, find (currently lines 112-124):

```tsx
function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
```

Replace with:

```tsx
function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          // Applies a previously saved dark-mode choice before hydration, so
          // returning dark-mode users don't see a flash of the light theme
          // (which is the default with no script needed).
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("theme")==="dark"){document.documentElement.classList.add("dark")}}catch(e){}',
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Render the toggle on the sign-in screen**

In `src/components/AuthCard.tsx`, add the import (after the existing `lucide-react` import, currently line 7):

```tsx
import { ThemeToggle } from "@/components/ThemeToggle";
```

Then find (currently lines 43-51):

```tsx
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <LayoutGrid className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Sprint Board</h1>
            <p className="text-xs text-muted-foreground">Alocação de demandas do time</p>
          </div>
        </div>
```

Replace with:

```tsx
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
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: ends with `✓ built in <time>` and no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/__root.tsx src/components/AuthCard.tsx
git commit -m "feat: add no-flash dark-mode script and theme toggle to sign-in screen"
```

---

### Task 4: Wire the toggle into the board header

**Files:**
- Modify: `src/components/BoardGrid.tsx`

**Interfaces:**
- Consumes: `ThemeToggle` from `src/components/ThemeToggle.tsx` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the import**

In `src/components/BoardGrid.tsx`, add after the existing relative imports at the bottom of the import block (currently lines 35-37):

```tsx
import { AllocationDialog, toDraft, type AllocationDraft } from "./AllocationDialog";
import { DevDialog } from "./DevDialog";
import { SprintDialog } from "./SprintDialog";
import { ThemeToggle } from "./ThemeToggle";
```

(Only the new `ThemeToggle` line is added; the three existing lines are unchanged.)

- [ ] **Step 2: Render the toggle next to the logout button**

Find (currently lines 192-199):

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

Replace with:

```tsx
            <ThemeToggle />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => supabase.auth.signOut()}
              title={email}
            >
              <LogOut className="size-4" />
            </Button>
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: ends with `✓ built in <time>` and no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/BoardGrid.tsx
git commit -m "feat: add theme toggle to the board header"
```

---

### Task 5: Full visual verification pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` and open the printed local URL in a browser with a clean `localStorage` (e.g. an incognito/private window, or run `localStorage.clear()` in devtools then reload).

- [ ] **Step 2: Confirm the default**

With no saved preference, the sign-in screen must render **light** (white/near-white background, navy text, blue primary). Confirm the toggle button shows a moon icon (meaning "click to go dark").

- [ ] **Step 3: Confirm the toggle and persistence**

Click the toggle: the screen switches to the dark theme already shipped (verify against `docs/superpowers/specs/2026-08-06-visao-agile-theme-design.md`) and the icon switches to a sun. Reload the page: it must still be dark (persisted). Click the toggle again to go back to light, reload: must still be light.

- [ ] **Step 4: Confirm no-flash behavior**

With `theme` set to `"dark"` in `localStorage`, do a hard reload (Ctrl+Shift+R or devtools "Disable cache" + reload) and watch closely for a flash of the light theme before dark applies. There should be none — the inline script in `RootShell` applies `.dark` before React hydrates.

- [ ] **Step 5: Walk through every screen in both themes**

For both light and dark, check: sign-in screen, empty board state (if no sprints/devs), populated board (all four allocation chip colors together in one cell — confirm each uses the "600"-shade text/border in light and "400"-shade in dark), `AllocationDialog`/`DevDialog`/`SprintDialog` (including the Status/Tipo `Select` dropdown dot colors), and a toast (e.g. trigger a save error) — none should look broken or low-contrast in either theme.

- [ ] **Step 6: Final build check**

Run: `npm run build`
Expected: ends with `✓ built in <time>` and no errors.

- [ ] **Step 7: Stop the dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

No commit in this task — it's verification only. If any issue is found, fix it as part of the task that introduced it (amend that task's changes with a new commit) before considering the plan complete.
