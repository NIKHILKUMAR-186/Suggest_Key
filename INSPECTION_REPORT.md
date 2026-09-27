# Frontend Architecture Inspection Report

## Project Summary
- **Framework**: React 19 + Vite 8 + TypeScript
- **Styling**: Tailwind CSS v4 + CSS custom properties (no `tailwind.config.*`)
- **Animation**: Framer Motion (`motion/react`)
- **Icons**: Lucide React
- **State**: React Context (Auth, Navigation, Theme, Notifications, PageMeta, Toast)
- **Routing**: Custom client-side router with role-based `ProtectedRoute`
- **Lint**: `tsc --noEmit` (ESLint not configured)

---

## 1. Light/Dark Theme System

### Architecture: CSS Variables + Class Toggling
Theme is managed through React Context, with CSS custom properties as the single source of truth for all design tokens. The `.dark` class on `<html>` triggers dark-mode overrides.

### Key Files

#### `src/index.css` (1,248 lines — the ONLY global CSS file)
- Line 1: `@import "tailwindcss"` — Tailwind v4 import (no config file)
- **`:root` block (lines 4–172)**: All LIGHT mode CSS custom properties
- **`.dark` block (lines 174–290)**: All DARK mode CSS custom properties
- Lines 3–319: `@layer base` containing all token definitions + base element styles
- Lines 321–422: Scrollbar, theme transition, landing/hero ambient effects
- Lines 424–651: Auth design system + brand panel typography
- Lines 653–753: Seeker marketplace V2 surface (second `:root` + `.dark` blocks)
- Lines 820–1145: Mentor availability surface (`.av-*` classes)
- Lines 1147–1246: Overflow safety + touch targets

**Critical issue**: The `@layer base` block (lines 3–319) defines `:root` light values AND `.dark` dark values. But the SECOND `:root` block (lines 659–705) defining `--seeker-*` tokens is **outside** `@layer base`, as is the second `.dark` block (lines 707–753). This works because CSS variable inheritance is order-independent for resolution, but the structural inconsistency is notable.

**Duplicated code bug**: `prefers-reduced-motion` media query block appears twice (lines 570–579 and 582–591), identical content.

#### `src/context/ThemeContext.tsx` (119 lines)
- `ThemeProvider` wraps the entire app (`App.tsx:14`)
- **`ThemeMode` type**: `'light' | 'dark' | 'system'`
- **`ResolvedTheme`**: `'light' | 'dark'` (resolves `system` to the OS preference)
- State stored in `localStorage` under key `sk-theme-mode` (defaults to `'system'`)
- `applyThemeToDocument()` (lines 30–42):
  - Sets `data-theme` attribute on `<html>` (never read by any CSS)
  - Adds/removes `light`/`dark` class on `<html>` (only `.dark` is defined in CSS; `.light` is a no-op)
  - Sets `colorScheme` property
  - Sets `backgroundColor` on document element (`#050609` dark / `#f4f7fc` light)
  - Updates `<meta name="theme-color">` content
- Re-subscribes to `matchMedia('(prefers-color-scheme: dark)')` when mode is `system`
- Theme transition: adds `.theme-transition` class for 220ms (`THEME_TRANSITION_MS = 220`)

#### `public/theme-early.js` (40 lines)
Synchronous pre-paint script (`index.html:24`) that applies the correct theme class *before* React mounts, preventing FOUC. Duplicates the logic from `ThemeContext.tsx` (no shared code).

#### `index.html` (28 lines)
- Line 7: `<meta name="theme-color" content="#f4f7fc">` (light default; JS updates it)
- Lines 15–17: Google Fonts — Inter, Space Grotesk, JetBrains Mono
- Line 24: `<script src="/theme-early.js">` (pre-paint)
- Line 25: `<script type="module" src="/src/main.tsx">`

#### `src/main.tsx` (10 lines)
```ts
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

#### `src/App.tsx` (32 lines) — Provider chain
```
ThemeProvider → AuthProvider → NotificationProvider → NavigationProvider → PageMetaProvider → ToastProvider
→ PageMetaRunner + AppShell > Router
```
Note: `StrictMode` is applied both in `main.tsx` and `App.tsx` (doubled).

### Theme Token Inventory (CSS Custom Properties)

**Primary semantic layer (`--color-shell-*`)**: ~30 tokens covering bg, surface, surface-hover, surface-elevated, surface-elevated-hover, text, text-muted, text-subtle, text-contrast, border, border-strong, primary (+hover, +soft), accent (+hover, +soft), success (+soft), warning (+soft), error (+soft), info (+soft), focus.

**ShadCN-style aliases** (lines 51–74): `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--border`, `--input`, `--ring`, `--surface`, `--surface-elevated`, `--surface-hover`, `--success`, `--warning`, `--destructive`, `--info`.
- **These are defined but NEVER consumed** by any component — every component uses raw `--color-shell-*` names instead.

**Other token families**:
- `--font-untitled-sans` (Inter), `--font-aeonikpro` (Space Grotesk), `--font-dotdigital` (JetBrains Mono) + legacy `--font-sans/--heading/--mono`
- `--radius-sm` through `--radius-full`
- `--shadow-xs` through `--shadow-xl` (theme-aware)
- `--color-shell-success/info/error/warning` (semantic colors, used by components)
- `--status-{success,warning,error,info}-{strong,soft,border}` (defined, only some used)
- `--brand-{primary,accent}-strong` (defined, unused)
- `--overlay-backdrop` (used by `Modal.tsx:69`)
- `--gradient-hero-text`, `--landing-grid-line`, `--landing-aurora-1/2`, `--landing-spotlight`, `--glass-card-*` (used via CSS classes)
- `--hero-card-shadow`, `--hero-card-inset-highlight` (used via CSS classes + inline styles in components)

**Seeker-specific tokens** (`--seeker-*`, lines 659–753): Actively consumed. Includes `--seeker-panel-bg`, `--seeker-panel-border`, `--seeker-panel-shadow`, `--seeker-hero-*`, `--seeker-card-bg`, `--seeker-card-shadow`, `--seeker-segment-active-*`, `--seeker-date-active-*`, `--seeker-trust-*`, `--seeker-empty-halo`, `--seeker-section-glow`.

**Mentor tokens** (`--mentor-*`, lines 109–126, 230–246): **DEAD CODE** — defined in CSS but never referenced by any `.tsx` file. A parallel warm-amber palette that contradicts the actual violet/blue theme.

### Theme Toggle Component

#### `src/components/ui/ThemeToggle.tsx` (129 lines)
- The **single shared theme toggle** for the entire application
- Three modes: Light (Sun), Dark (Moon), System (Monitor) — presented as a radio-button dropdown menu
- Two variants: `'icon'` (default, compact button) and `'labeled'` (shows "Theme" text)
- Uses `useTheme()` hook — **the only consumer of `useTheme()`** in the codebase
- Active icon reflects the *resolved* theme (`theme === 'dark' ? Moon : Sun`), not the preference
- Selected item shows a purple dot indicator

**Mount points (6 locations):**
1. `TopNavigation.tsx:164` (desktop header)
2. `TopNavigation.tsx:254` (mobile header bar)
3. `TopNavigation.tsx:384` (mobile drawer, labeled variant)
4. `AdminSidebar.tsx:158` (sidebar, labeled, full-width)
5. `AdminSidebar.tsx:217` (mobile top bar)
6. `AuthLayout.tsx:28` (auth header)
7. `LandingPage.tsx:161` (landing desktop header)
8. `LandingPage.tsx:228` (landing mobile menu, labeled)
9. `NotFoundPage.tsx:54` (404 page header)

---

## 2. Shared Components

### `src/lib/utils.ts` (6 lines)
```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```
Standard `clsx` + `tailwind-merge` pattern. Used in virtually every component for conditional class composition.

### `src/components/ui/` — 10 Primitive UI Components

| File | Exports | Description |
|---|---|---|
| `Button.tsx` (65 lines) | `Button` | `forwardRef`. 6 variants: `default`, `outline`, `secondary`, `ghost`, `destructive`, `accent`. 3 sizes: `sm`, `md`, `lg`. Loading state with `Loader2` spinner. All colors via CSS variables. Consistent focus rings. |
| `Card.tsx` (50 lines) | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | ShadCN pattern. All use CSS variables. Fixed padding `p-6`, `rounded-xl`, `border-[var(--color-shell-border)]`, `bg-[var(--color-shell-surface)]`, `shadow-xs`. |
| `Input.tsx` (69 lines) | `Input` | Optional `label`/`error`/`helperText`/`success`. `React.useId()` for id generation. `aria-invalid`, `aria-describedby`. Focus ring via `ring-3`. Error icon (`AlertCircle`) / success icon (`CheckCircle2`) on right. |
| `Textarea.tsx` (72 lines) | `Textarea` | Same contract + `showCount`/`maxLength` character counter. `resize-y`, `font-mono` counter. |
| `PasswordInput.tsx` (73 lines) | `PasswordInput` | Eye/EyeOff toggle. **Inconsistency**: error focus ring uses hardcoded `rgba(220,38,38,0.10)` instead of `var(--color-shell-error-soft)` (line 41). |
| `Badge.tsx` (32 lines) | `Badge` | 6 variants: `default`, `secondary`, `outline`, `success`, `warning`, `destructive`. All token-driven. `rounded-full px-2.5 py-0.5 text-xs font-semibold`. |
| `Modal.tsx` (114 lines) | `Modal` | `motion` + `AnimatePresence`. Backdrop with `backdrop-blur-xs` + `style={{ backgroundColor: 'var(--overlay-backdrop)' }}`. Body scroll lock, Escape to close. `maxWidth` prop (sm→2xl). |
| `Dialog.tsx` (18 lines) | `Dialog` | Thin Radix-style alias: maps `open`/`onOpenChange` → `isOpen`/`onClose` on `Modal`. |
| `Skeleton.tsx` (97 lines) | `Skeleton`, `SkeletonText`, `SkeletonCard`, `SkeletonTableRow` | `animate-pulse` with gradient using `--color-shell-surface-elevated` / `--color-shell-surface`. `aria-hidden="true"`. |
| `ThemeToggle.tsx` (129 lines) | `ThemeToggle` | See section 1 above. |

### `src/components/shared/` — 5 State Components

| File | Component | Pattern |
|---|---|---|
| `EmptyState.tsx` (49 lines) | `EmptyState` | `motion` fade-up, `role="status"`, icon (default `Inbox`), title, description, optional action `Button`. `min-h-[300px] rounded-2xl`. All CSS variable colors. |
| `LoadingState.tsx` (38 lines) | `LoadingState` | `motion` fade, `role="status"`, `aria-live="polite"`, `Loader2` spinner in accent-tinted tile. `min-h-[220px]`. |
| `ErrorState.tsx` (51 lines) | `ErrorState` | `motion` scale, `role="alert"`, `aria-live="assertive"`, red-tinted (`--color-shell-error*/--color-shell-error-soft`). Retry button with error-tinted hover. |
| `SuccessState.tsx` (63 lines) | `SuccessState` | Green-tinted (`--color-shell-success*`). Primary + optional secondary actions. |
| `ShortId.tsx` (43 lines) | `ShortId`, `shortId()` | Truncates UUIDs to 8 chars (uppercase, hyphens removed). Full ID in `title`/`aria-label`. `font-mono text-[11px] tabular-nums`. |

### Domain-Specific Component Folders

| Folder | Files | Key Components |
|---|---|---|
| `components/seeker/` | 11 files | `SeekerHero`, `HeroVisual`, `FilterBar`, `SegmentSelector`, `SegmentMentorsSection`, `MentorGrid`, `MentorCard` (400 lines), `MentorSearch`, `DateSelector`, `AvailableMentorsHeader`, `EmptyMentorState`, `MarketplaceBadge` |
| `components/mentor/` | 9 files | `MentorAvailabilitySchedule`, `MentorBookingCard`, `MentorCard`, `MentorMetrics`, `MentorStatCard`, `MentorTabNav`, `MentorExceptionList`, `MentorBadge`, `MentorAttentionCard`, `MentorStateWrappers` |
| `components/admin/` | 3 files | `OperationsPrimitives`, `ControlTabs`, `SystemHealthChart` |
| `components/landing/` | 1 file | `LandingFeatureSection` (exports `LandingFeatureSection` + `LandingHowItWorksSection`) |
| `components/auth/` | 3 files | `AuthLayout` (+ `AuthEyebrow`, `AuthHeading`, `AuthBody`), `BrandPanel`, `ProtectedRoute` |
| `components/navigation/` | 2 files | `TopNavigation`, `AdminSidebar` |
| `components/layout/` | 4 files | `AppShell`, `SeekerShell`, `MentorShell`, `AdminShell` |
| `components/notifications/` | 1 file | `NotificationCard` |

**No barrel/index file** exists in `src/components/` — every import is a direct file path.

---

## 3. Layouts

### `src/components/layout/AppShell.tsx` (64 lines) — Role-Aware Router
The outermost layout router. Reads `activeRole` from `AuthContext` and renders the appropriate shell:
- `admin` → `AdminShell`
- `mentor` → `MentorShell`
- default → `SeekerShell`

**Public routes bypass shells entirely** (render children directly):
```ts
// AppShell.tsx:9-18
const isPublicRoute = (pathname) =>
  pathname === '/' || pathname.startsWith('/auth') ||
  pathname === '/login' || pathname === '/signup' ||
  pathname === '/403' || pathname === '/mentor/signup';
```

Unknown routes (`!isKnownRoute`) also bypass the shell. During auth loading, shows a full-screen spinner.

**Hardcoded dark-mode bug (lines 46–49)**: The loading state uses hardcoded colors that will render incorrectly in light mode:
```tsx
<div className="min-h-screen flex items-center justify-center bg-[#050609]">
  <div className="h-8 w-8 rounded-full border-2 border-[#663af3] border-t-transparent animate-spin mx-auto" />
  <p className="text-xs text-[#9da7ba]">Loading session...</p>
</div>
```
`#050609` (deep dark) is the dark-mode background — in light mode this flashes a near-black screen.

### The Three Role Shells

**`SeekerShell.tsx` and `MentorShell.tsx`** are nearly identical (23 lines each):
- Root: `min-h-screen flex flex-col bg-[var(--color-shell-bg)] text-[var(--color-shell-text)] antialiased`
- Custom selection: `selection:bg-[var(--color-shell-primary)] selection:text-white`
- Skip-to-content link (sr-only → focus:not-sr-only)
- `<TopNavigation />`
- `<main id="main-content" tabIndex={-1}>` with `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8`

**`AdminShell.tsx`** (25 lines):
- Root: same but `flex-col md:flex-row` (sidebar layout)
- `<AdminSidebar />` (left, `hidden md:flex w-64`)
- Main content: `flex-1 flex flex-col min-w-0` (no max-width centering — sidebar provides the frame)

### `src/components/navigation/TopNavigation.tsx` (392 lines)
Shared by seeker + mentor (not admin — admin uses sidebar). Role-aware nav from `ROLE_NAVIGATION` config:
- Sticky header: `sticky top-0 z-40`, `bg-[var(--color-shell-bg)]/80 backdrop-blur-xl` + hardcoded rgba shadow
- Brand mark: gradient `from-[var(--color-shell-primary)] to-[var(--color-shell-accent)]`
- Desktop nav links with active state (purple bg + white text + hardcoded `rgba(102,57,243,0.9)` glow)
- User dropdown with profile, role badges, sign-out
- Mobile drawer: full-screen overlay with `AnimatePresence` + Motion, `bg-black/70` backdrop (hardcoded)
- ThemeToggle in both desktop and mobile

### `src/components/navigation/AdminSidebar.tsx` (264 lines)
- Mobile: sticky top bar (`md:hidden`) with hamburger + theme toggle
- Desktop: persistent 64px sidebar (`hidden md:flex w-64`)
- Navigation under "Operations & Governance" section
- ThemeToggle labeled variant at bottom
- User profile card + "RLS & Security Definers" footer note

### `src/components/auth/AuthLayout.tsx` (63 lines)
Two variants: `'centered'` and `'split'` (default):
- Split: branded left panel (50% width on `lg+`) + form content pushed right (`lg:ml-[50%]`)
- ThemeToggle in top-right header
- Exports `AuthEyebrow`, `AuthHeading`, `AuthBody` with font variables

### `src/components/auth/ProtectedRoute.tsx` (166 lines)
Four render states: loading spinner, unauthenticated card, mentor-unverified card, 403 forbidden card. All use CSS variables.

---

## 4. Tailwind / Theme Tokens

### Tailwind Setup — v4 with NO Config File
**No `tailwind.config.js`, `tailwind.config.ts`, `tailwind.config.mjs`, or any Tailwind config file exists anywhere in the repository.** Grep for these returned zero results.

Tailwind v4 is set up via the `@tailwindcss/vite` plugin:
```ts
// vite.config.ts:1-8
import tailwindcss from '@tailwindcss/vite';
plugins: [react(), tailwindcss()]
```

The CSS entry point is a minimal import:
```css
/* index.css:1 */
@import "tailwindcss";
```

**Critically, there is NO `@theme`, `@custom-variant`, `@apply`, or `@config` directive** anywhere in the codebase. Grep for `@theme|@custom-variant|@apply|@config|@source|@plugin|@variant` matched only a documentation file (`auth_design.md:413`), not any actual CSS or config.

This means:
1. **Tailwind's default `dark` variant is `@media (prefers-color-scheme: dark)`** — it responds to OS preference, NOT the app's `.dark` class. There is no `@custom-variant dark (&:where(.dark, .dark *))` to remap it.
2. **No design tokens are registered in Tailwind's namespace** — all colors are consumed via arbitrary values like `bg-[var(--color-shell-bg)]`, not via `bg-background` or `bg-primary`.

### Token Consumption Strategy
| Layer | Mechanism | Example |
|---|---|---|
| Colors, borders, text | CSS custom properties referenced via Tailwind arbitrary values | `bg-[var(--color-shell-bg)]`, `text-[var(--color-shell-text)]`, `border-[var(--color-shell-border)]` |
| Shadows | CSS variables via inline `style` (when multi-layer) or Tailwind arbitrary values | `shadow-[var(--shadow-sm)]`, `style={{ boxShadow: 'var(--hero-card-shadow)' }}` |
| Layout | Pure Tailwind utilities | `flex`, `grid`, `p-4`, `rounded-xl`, `space-y-3`, `max-w-7xl` |
| Fonts | CSS variables + Tailwind `font-[family]` via inline style or class | `style={{ fontFamily: 'var(--font-aeonikpro)' }}`, `.font-display` class |

### `src/config/design-tokens.ts` (205 lines) — DEAD CODE
JavaScript object mirror of design tokens. Exports `colors`, `typography`, `spacing`, `radius`, `shadows`, `layout`, `surfaces`, `mentorTheme`, `mentorTypography`. **No `.tsx` file imports it** (grep confirmed zero imports). Its values contradict the actual CSS:
- `mentorTheme.accent = '#b8860b'` (amber) vs CSS `--mentor-accent: #663af3` (violet)
- `mentorTypography.scale` uses `text-zinc-950`, `text-zinc-500` etc. — Tailwind default palette, not the project's token system

### Font System
Defined in `src/index.css` `:root`:
- `--font-untitled-sans`: `'Inter'` — body/default font
- `--font-aeonikpro`: `'Space Grotesk'` — headings (applied via `.font-display` CSS class and inline `style` on individual elements)
- `--font-dotdigital`: `'JetBrains Mono'` — monospace (eyebrows, code, section labels)

`html` sets `font-family: var(--font-untitled-sans)` globally. Headings (`h1–h6`) use `var(--font-aeonikpro)`. Loaded from Google Fonts in `index.html` (Inter 400/500/600/700, Space Grotesk 400/500, JetBrains Mono 400/500/600).

### CSS Utility Classes (in `index.css`)
The stylesheet defines ~50 hand-written, theme-aware CSS classes for recurring patterns:

**Layout/atmosphere:**
- `.landing-grid` — 80px grid pattern with radial mask
- `.landing-spotlight` — conic gradient spotlight
- `.glass-card` — frosted glass (token bg + border)
- `.hero-card` — deep glass card with inset highlight + shadow
- `.hero-text-gradient` — gradient text clip
- `.section-eyebrow` — uppercase label with divider lines (uses `--font-dotdigital`)
- `.dark-scene` — forces `color-scheme: dark` for SVG panels

**Auth system:**
- `.auth-background` — auth page with aurora backdrop gradients
- `.auth-card` — form card (`--radius-2xl`, shadow, border)
- `.auth-input` — input styling with focus/error states
- `.auth-link-button` — ghost link button

**Brand panel:**
- `.brand-headline` — clamp() responsive headline (28px→44px)
- `.brand-body` — body copy
- `.brand-feature-list` — feature list layout

**Seeker marketplace (theme-aware):**
- `.seeker-page` — ambient glow + grid background via `::before`/`::after`
- `.seeker-hero` — hero card frame
- `.seeker-panel` — glass control deck (backdrop-filter blur)
- `.seeker-card` — mentor card surface
- `.seeker-segment` / `[data-selected]` — segment pill
- `.seeker-date-chip` / `[data-selected]` — date chip
- `.seeker-empty-halo` — empty state glow
- `.seeker-rail` — horizontal scroll (hidden scrollbar)

**Mentor availability (theme-aware):**
All `.av-*` classes: `.av-panel`, `.av-day` (+`[data-state]`/`[data-active]`), `.av-toggle*` family, `.av-window`, `.av-time-input`, `.av-icon-btn`, `.av-callout` — all use CSS variables and `color-mix()` for state blending.

**Responsive safety (lines 1147–1224):**
- `.flex-safe > *`, `.grid-safe > *` — `min-width: 0` to prevent overflow
- `.token-wrap` — `overflow-wrap: anywhere`
- `.log-scroll` — code block overflow
- `.table-scroll` — horizontal table scroll
- `.no-wrap-token` — nowrap utility

**Touch targets (lines 1226–1246):**
- `@media (pointer: coarse)`: `.min-touch` (44px), `.min-touch-icon` (44px)
- `@media (hover: none)`: `.no-sticky-hover` — prevents hover state sticking after tap

---

## 5. Page-Specific Styling

### Dominant Pattern
Pages do **not** define their own theme layer. The shell provides `bg-[var(--color-shell-bg)]` / `text-[var(--color-shell-text)]`, and pages compose cards using a **repeated inline literal** rather than the `Card` component:

```tsx
// Copy-pasted ~30+ times across the codebase:
className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs"
```

This pattern appears in: `SeekerMentorDetailPage.tsx`, `SeekerBookingsPage.tsx`, `SeekerSettingsPage.tsx`, `SeekerPaymentPage.tsx`, `LandingPage.tsx`, `NotFoundPage.tsx`, `SeekerMentorListPage.tsx`, etc.

### Page Root Containers
Most pages use bare `<div className="space-y-6">` (shell provides surface). Width-constrained variants:
- `max-w-4xl mx-auto` — settings/notifications pages
- `max-w-3xl mx-auto` — detail/session pages
- `max-w-5xl mx-auto` — workspace pages
- `mx-auto w-full max-w-[1400px]` — mentor availability page

Pages with custom atmosphere layers:
- `SeekerHomePage.tsx:268` — `<div className="seeker-page">` (glow + grid background)
- `SeekerMentorListPage.tsx:209` — `<div className="seeker-page space-y-8">`
- Auth pages — `<div className="auth-card space-y-6">`
- `LandingPage.tsx:124` — `<div className="min-h-screen bg-[var(--color-shell-bg)]">` + `.landing-grid` + `.landing-spotlight`

### CRITICAL: `dark:` Tailwind Variants Are Broken (49 occurrences)

The codebase uses Tailwind `dark:` variants in `src/pages/seeker/` files (53 `dark:` usages). **Because there is no `@custom-variant dark (&:where(.dark, .dark *))` directive in the CSS, these `dark:` variants bind to the OS `prefers-color-scheme: dark` media query — NOT the app's `.dark` class toggle.**

This means: a user who explicitly selects **Light** mode on a dark-OS device will still see `dark:bg-emerald-50/40`, `dark:text-emerald-200`, etc. on these elements. The theme toggle has no effect on them.

Files and line counts:
- `SeekerPaymentPage.tsx` — ~25 `dark:` occurrences (lines 509–935)
- `SeekerBookingDetailPage.tsx` — ~15 `dark:` occurrences (lines 263–494)
- `SeekerBookingsPage.tsx` — 3 `dark:` occurrences (lines 38, 170, 357)

These pages mix `dark:` variants with CSS variable colors (`var(--color-shell-*)`) in the same file, creating inconsistent theming within a single page.

### CRITICAL: Hardcoded Non-Token Colors Are Used Extensively

Numerous components use Tailwind's default palette (`zinc-*`, `white`, `emerald-*`, `amber-*`, `rose-*`, `sky-*`) without corresponding `dark:` handling or CSS variable fallbacks. These will **not adapt** to the theme system and some render incorrectly in dark mode:

**Mentor components (warm-amber `zinc` palette — light-only, no dark handling):**
- `MentorTabNav.tsx` (70 lines) — `zinc-950`, `zinc-200`, `zinc-950`, `zinc-100`, `zinc-500`, `zinc-800` (lines 29, 44, 46, 47, 48, 59, 60, 61)
- `MentorBookingCard.tsx` (251 lines) — `bg-white`, `border-zinc-200`, `text-zinc-600`, `bg-zinc-50`, `text-amber-800`, `bg-amber-100`, `text-emerald-700`, `bg-emerald-50` (100+ occurrences)
- `MentorMetrics.tsx` — `border-zinc-200 bg-white` (line 74)
- `MentorCard.tsx` (44 lines) — `hover:border-zinc-300` (line 35)
- `MentorStatCard.tsx` (58 lines) — uses CSS variables throughout (correct pattern)

**Seeker pages using `zinc`/`emerald`/`amber` with mixed `dark:`:**
- `SeekerSessionPage.tsx` — `text-zinc-950`, `bg-zinc-50`, `text-zinc-400`, `text-emerald-50`, `text-amber-300`, `bg-amber-100`, `bg-zinc-300`
- `SeekerWorkspacePage.tsx` — `text-zinc-950`, `bg-zinc-200`, `bg-white`, `text-zinc-600`, `text-zinc-400`, `bg-zinc-100`
- `SeekerSettingsPage.tsx` — `border-amber-600`, `bg-emerald-50`, `bg-zinc-100`
- `MentorDirectoryPage.tsx` — `bg-zinc-900`, `text-white` (lines 253, 269) — dark-only hardcoded

**Admin pages:**
- `AdminBookingsPage.tsx` — `bg-zinc-50`, `text-zinc-900`, `border-zinc-200` (30+ occurrences)

**Notifications:**
- `NotificationCard.tsx` (233 lines) — uses CSS variables throughout (correct pattern)

**Other inconsistencies:**
- `PasswordInput.tsx:41` — `focus:ring-[rgba(220,38,38,0.10)]` (hardcoded error ring instead of `var(--color-shell-error-soft)`)
- `TopNavigation.tsx:94` — header shadow uses hardcoded `rgba(0,0,0,0.9)` 
- `TopNavigation.tsx:132,331` — active nav pill uses hardcoded `rgba(102,57,243,0.9)` glow
- `TopNavigation.tsx:291` — mobile backdrop `bg-black/70`
- `AdminSidebar.tsx:244` — mobile backdrop `bg-black/60`
- `TopNavigation.tsx:149,341` / `AdminSidebar.tsx:138` — `bg-white/20 text-white` (acceptable: text on saturated fills)

---

## 6. Navigation & Routing

### `src/routes/Router.tsx` (192 lines)
Manual if/else path matching (no React Router). Route groups:
- `/` → `LandingPage` (always public)
- `/auth/*` → Auth pages (always public)
- `/mentor/signup` → Public
- `/admin/*` → `ProtectedRoute` (admin role)
- `/mentor/*` → `ProtectedRoute` (mentor or admin role)
- `/seeker/*` → `ProtectedRoute` (seeker or admin role)
- `/mentors` → `ProtectedRoute` (seeker or admin)
- Fallback → `NotFoundPage`

### `src/context/NavigationContext.tsx` (57 lines)
- Custom client-side router using `window.history.pushState`
- Exposes: `currentPath`, `currentRole`, `navigate(path)`
- `popstate` listener for back/forward
- Note: `/mentors` route is matched before `/mentor` (prefix caution noted in comments)

### `src/config/navigation.ts` (75 lines)
Role-based navigation config:
- **Seeker**: Home, My Bookings, Notifications, Settings
- **Mentor**: Home, My Bookings, Availability, Notifications, Settings
- **Admin**: Dashboard, Users, Mentors, Mentor Verification, Segments, Bookings, Workspaces, Payments, Notifications, System Health, Settings

---

## 7. Key Findings Summary

### Strengths
1. **Well-structured token system**: CSS custom properties provide a clean, theme-switchable foundation with ~30 primary tokens and domain-specific layers
2. **Pre-paint theme application**: `theme-early.js` prevents FOUC
3. **Consistent `cn()` utility**: `clsx` + `tailwind-merge` used everywhere
4. **Shared UI primitives**: 10 components in `ui/`, 5 in `shared/` with consistent API patterns (forwardRef, variant props)
5. **Role-aware shells**: Clean separation of admin/mentor/seeker layouts
6. **Accessibility focus**: focus-visible rings, aria labels, sr-only skip links, `prefers-reduced-motion` support
7. **Animation consistency**: Framer Motion with consistent easing curves

### Critical Issues

| # | Issue | Impact | Location |
|---|---|---|---|
| 1 | **No `@custom-variant dark`** — Tailwind `dark:` binds to OS media query, not `.dark` class | Theme toggle has NO effect on 49 elements across 3 seeker pages | `index.css` (missing directive) |
| 2 | **Hardcoded dark loading state** in `AppShell` | Light mode flashes near-black screen during auth load | `AppShell.tsx:46-49` |
| 3 | **`--mentor-*` CSS variables defined but unused** | Dead code, contradicts `mentorTheme` in design-tokens.ts | `index.css:109-126, 230-246` |
| 4 | **`design-tokens.ts` is dead code** | Unimported reference file with contradictory values | `src/config/design-tokens.ts` |
| 5 | **ShadCN-style aliases (`--background`, `--card`, etc.) never consumed** | Dead tokens; contradicts design system docs | `index.css:51-74` |
| 6 | Mentor components use `zinc-*`/`white`/`emerald-*`/`amber-*` colors with no dark handling | Light-only styling in dark mode | `MentorTabNav`, `MentorBookingCard`, `MentorMetrics`, `MentorCard` |
| 7 | Duplicated `prefers-reduced-motion` block | Redundancy (lines 570-579 identical to 582-591) | `index.css:569-591` |

### Minor Inconsistencies
- `PasswordInput.tsx:41`: hardcoded `rgba(220,38,38,0.10)` focus ring instead of `var(--color-shell-error-soft)`
- `SeekerTabNav` in `MentorDirectoryPage.tsx`: uses `bg-zinc-900 text-white` (dark-only)
- `SeekerWorkspacePage.tsx`: hardcoded `zinc-*` palette throughout
- Double `StrictMode` wrapping (in both `main.tsx` and `App.tsx`)
