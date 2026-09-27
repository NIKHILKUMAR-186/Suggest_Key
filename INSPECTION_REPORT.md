# Frontend Architecture Inspection Report

## Project Overview
- **Stack**: React 19 + Vite 8 + Tailwind CSS v4 + TypeScript
- **Routing**: Custom client-side router (`NavigationContext` with `history.pushState`)
- **UI Library**: Headless — all components are custom-built with Tailwind + CSS variables
- **Animation**: Framer Motion (`motion/react`)
- **Icons**: Lucide React
- **Alias**: `@/` maps to project root

---

## 1. Light/Dark Theme System

### Architecture Summary
Theme switching uses a **CSS variable + class toggling** approach with three modes: `light`, `dark`, and `system` (auto-detect from `prefers-color-scheme`).

### Key Files

#### `src/index.css` (1–1248 lines)
The single global stylesheet. Contains:
- `@import "tailwindcss"` (Tailwind CSS v4 — no config file exists; Tailwind v4 uses the `@import` directive directly)
- CSS custom properties defined in `:root` (light mode) and `.dark` (dark mode)
- A large set of "premium" utility classes for auth, landing, seeker marketplace, mentor availability surfaces

#### `src/context/ThemeContext.tsx` (119 lines)
React Context-based theme manager:
- **`ThemeMode`** type: `'light' | 'dark' | 'system'`
- **`ThemeProvider`** component wraps the entire app (see `App.tsx` line 14)
- **`useTheme()`** hook exposes: `{ mode, theme, setMode, toggle }`
- Reads preference from `localStorage` key `sk-theme-mode` (defaults to `'system'`)
- Detects system theme via `window.matchMedia('(prefers-color-scheme: dark)')`
- `applyThemeToDocument()` adds both `data-theme` attribute and `light`/`dark` class to `<html>`
- `color-scheme` CSS property set to `'light'` or `'dark'` (line 171, 289)
- Theme transitions: adds `.theme-transition` class for 220ms smooth transition on theme change (lines 340–354)
- `prefers-reduced-motion` respected (lines 570–591)

#### `public/theme-early.js` (40 lines)
Inline script that runs **before React renders** to prevent flash of wrong theme:
- Reads `localStorage` `sk-theme-mode`
- Resolves theme and applies `light`/`dark` class to `<html>` + sets background color + updates `<meta name="theme-color">`
- This script is injected into `index.html` (not read from a file — found at `public/` root)

#### `src/components/ui/ThemeToggle.tsx` (129 lines)
The single shared theme toggle component:
- Uses `useTheme()` from `ThemeContext`
- Three-mode radio button style dropdown: Light (Sun icon), Dark (Moon icon), System (Monitor icon)
- Two variants: `'icon'` (compact button) and `'labeled'` (shows "Theme" text)
- Used in: `TopNavigation.tsx:164`, `LandingPage.tsx:161,228`, `AdminSidebar.tsx:158,217`, `AuthLayout.tsx:28`

### Theme Token System (CSS Variables)

All colors are **CSS custom properties** using a `--color-shell-*` naming convention. Components reference them as `var(--color-shell-*)` in Tailwind class strings.

| Token Category | Light Mode (`:root`) | Dark Mode (`.dark`) |
|---|---|---|
| **Background** | `--color-shell-bg: #f4f7fc` | `#050609` |
| **Surface** | `--color-shell-surface: #ffffff` | `#0b0d1a` |
| **Text primary** | `--color-shell-text: #0b1220` | `#e8edf7` |
| **Text muted** | `--color-shell-text-muted: #47566e` | `#9da7ba` |
| **Text subtle** | `--color-shell-text-subtle: #64748b` | `#6b7385` |
| **Text contrast** (on primary) | `#ffffff` | `#ffffff` |
| **Border** | `rgba(11,18,32,.10)` | `rgba(186,215,247,.12)` |
| **Border strong** | `rgba(11,18,32,.18)` | `rgba(186,215,247,.20)` |
| **Primary** (violet) | `#663af3` | `#663af3` (same) |
| **Primary hover** | `#5a30e0` | `#5230d4` |
| **Primary soft** | `rgba(102,57,243,.10)` | `rgba(102,57,243,.12)` |
| **Accent** (blue) | `#2563eb` | `#60a5fa` |
| **Success** | `#15803d` | `#34d399` |
| **Warning** | `#b45309` | `#fbbf24` |
| **Error** | `#dc2626` | `#f87171` |
| **Focus ring** | `#2563eb` | `#60a5fa` |

**ShadCN-style aliases** (lines 51–74 of index.css) map to shell tokens:
`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--border`, `--input`, `--ring`, `--success`, `--warning`, `--destructive`, `--info`

**Shadows**: `--shadow-xs` through `--shadow-xl` (theme-specific values, defined in `:root` and `.dark`).

**Radius**: `--radius-sm` (0.375rem) through `--radius-full` (9999px).

### Additional Theme Layers
- **Seeker marketplace tokens** (lines 659–753): `--seeker-*` prefixed variables for hero scrim, panel background, card shadows, segment pills, date chips — all theme-aware (light + dark variants).
- **Mentor theme tokens** (lines 109–126, 229–246): `--mentor-*` prefixed (light warm amber palette vs dark slate).
- **Status tokens** (lines 132–154, 248–272): `--status-*-strong`, `--status-*-soft`, `--status-*-border` for success/warning/error/info.
- **Brand tokens** (lines 133–134, 251–252): `--brand-primary-strong`, `--brand-accent-strong`.
- **Gradient tokens**: `--gradient-hero-text`, `--landing-grid-line`, `--landing-aurora-*`, `--glass-card-bg`, `--hero-card-shadow`, `--hero-card-inset-highlight`.

---

## 2. Shared Components

### Component Organization
```
src/components/
├── ui/           # Headless-style primitive UI components
├── shared/       # Cross-role layout/state components
├── seeker/       # Seeker-specific marketplace components
├── mentor/       # Mentor-specific components
├── landing/      # Landing page sections
├── auth/         # Auth layout + brand panel
├── navigation/   # TopNavigation + AdminSidebar
├── layout/       # AppShell + role shells
├── admin/        # Admin primitives
└── notifications/ # Notification components
```

### `src/lib/utils.ts` (6 lines)
```ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```
The standard `clsx` + `tailwind-merge` utility for conditional className composition. Used in virtually every component.

### UI Components (`src/components/ui/`)

| File | Component | Notes |
|---|---|---|
| `Button.tsx` | `Button` | 6 variants (`default`, `outline`, `secondary`, `ghost`, `destructive`, `accent`), 3 sizes (`sm`, `md`, `lg`). Uses CSS variables for all colors. ForwardRef. Loading state with `Loader2` spinner. |
| `Input.tsx` | `Input` | Label, error, helperText, success states. Uses `React.useId()` for accessibility. `auth-input` class used in auth pages. |
| `PasswordInput.tsx` | `PasswordInput` | Extends `Input` with eye/eye-off toggle. |
| `Textarea.tsx` | `Textarea` | Label, error, character count (`showCount` + `maxLength`). |
| `Card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | ShadCN pattern. All use CSS variables. |
| `Badge.tsx` | `Badge` | 6 variants: `default`, `secondary`, `outline`, `success`, `warning`, `destructive`. |
| `Modal.tsx` | `Modal` | Custom modal with `motion/react` animations, backdrop blur, Escape-to-close, focus trapping. `maxWidth` prop. |
| `Dialog.tsx` | `Dialog` | Thin wrapper over `Modal` — provides `open`/`onOpenChange` API for Radix-style usage. |
| `Skeleton.tsx` | `Skeleton`, `SkeletonText`, `SkeletonCard`, `SkeletonTableRow` | Pulse animation with gradient. `aria-hidden="true"`. |
| `ThemeToggle.tsx` | `ThemeToggle` | See section 1 above. |

### Shared Components (`src/components/shared/`)

| File | Component | Notes |
|---|---|---|
| `EmptyState.tsx` | `EmptyState` | Motion-animated placeholder with icon, title, description, optional action button. Default icon: `Inbox`. |
| `SuccessState.tsx` | `SuccessState` | Green-tinted success state with optional primary + secondary actions. Default icon: `CheckCircle2`. |
| `LoadingState.tsx` | `LoadingState` | Spinner in accent color, optional message/description. Uses `sr-only` for screen readers. |
| `ErrorState.tsx` | `ErrorState` | Red-tinted error state with `AlertCircle` icon, optional retry button. `aria-live="assertive"`. |
| `ShortId.tsx` | `ShortId`, `shortId()` | Truncates UUIDs to 8 chars with full value in `title`/`aria-label`. Monospace, `tabular-nums`. |

---

## 3. Layouts

### `src/components/layout/AppShell.tsx` (64 lines)
**Role-aware shell router.** Reads `activeRole` from `AuthContext` and renders the appropriate shell:
- `admin` → `AdminShell`
- `mentor` → `MentorShell`
- default → `SeekerShell`

**Public routes bypass shells** — `/`, `/auth/*`, `/login`, `/signup`, `/403`, `/mentor/signup` render children directly without any shell wrapper. The 404 page is also unwrapped.

During auth loading, shows a full-screen spinner with `bg-[#050609]` (hardcoded dark background) and a `#663af3` border spinner.

Uses `useNavigation()` for `currentPath` and `isKnownRoute()` to determine if a route is valid.

### `src/components/layout/SeekerShell.tsx` (23 lines) and `MentorShell.tsx` (23 lines)
Nearly identical — both render:
1. Skip link (`sr-only` → `focus:not-sr-only`)
2. `TopNavigation` component
3. `<main id="main-content">` with `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8`

Background: `bg-[var(--color-shell-bg)]`, text: `var(--color-shell-text)`, `antialiased`, custom selection colors.

**Difference**: `SeekerShell` uses `flex-col` on the outer div; `MentorShell` is identical in structure.

### `src/components/layout/AdminShell.tsx` (25 lines)
Desktop sidebar layout:
- Mobile: `AdminSidebar` renders a header bar (`md:hidden`)
- Desktop: persistent sidebar (`hidden md:flex w-64`)
- Main content area: `flex-1 flex flex-col min-w-0`
- `<main id="main-content">` with `max-w-7xl` replaced by plain `w-full px-4 sm:px-8`

### `src/components/navigation/TopNavigation.tsx` (392 lines)
Role-aware top navigation bar:
- `ROLE_NAVIGATION` config determines nav items per role (seeker: Home, Bookings, Notifications, Settings; mentor: adds Availability; admin: handled by sidebar)
- Sticky header: `sticky top-0 z-40`, `backdrop-blur-xl`, border-bottom
- Desktop nav links with active state (purple background + text-white, purple shadow)
- Mobile drawer menu with `motion/react` animations, full-screen overlay
- User dropdown with profile info, role badges, sign-out
- ThemeToggle in both desktop and mobile header
- Uses `useNotifications()` for unread badge counts

### `src/components/navigation/AdminSidebar.tsx` (264 lines)
Persistent admin sidebar:
- Collapsible on mobile (slide-in overlay with backdrop blur)
- Desktop: `w-64` persistent, `border-r`
- Admin navigation organized under "Operations & Governance" section header
- ThemeToggle at bottom (labeled variant)
- User profile card with role badge
- "RLS & Security Definers" footer note with PostgreSQL badge

### `src/components/auth/AuthLayout.tsx` (63 lines)
Auth page wrapper with two variants:
- `'centered'`: full-width centered card
- `'split'` (default): branded left panel + form right panel (50/50 split on `lg+`)
- `ThemeToggle` in header (top-right)
- Uses `.auth-background` CSS class (from index.css) with ambient aurora gradients
- Exports `AuthEyebrow`, `AuthHeading`, `AuthBody` sub-components with font variables

### `src/components/auth/ProtectedRoute.tsx` (166 lines)
Multi-layered auth/authorization wrapper:
1. Loading state (spinner)
2. Unauthenticated → redirect card with sign-in button
3. Mentor onboarding check → verification required card
4. Role authorization → 403 card with RLS explanation

---

## 4. Tailwind / Theme Tokens

### Tailwind Configuration
**No `tailwind.config.js` or `tailwind.config.ts` file exists.** The project uses **Tailwind CSS v4** via the `@tailwindcss/vite` plugin (see `vite.config.ts` line 1, `package.json` line 18/39).

In Tailwind v4, the setup is:
```ts
// vite.config.ts
import tailwindcss from '@tailwindcss/vite';
plugins: [react(), tailwindcss()]
```

Tailwind v4 uses `@import "tailwindcss"` in `src/index.css` (line 1) instead of a config file. **Tailwind is used for utility classes** (spacing, layout, flex, grid, responsive prefixes `sm:`, `lg:`, etc.), while **design tokens (colors, shadows, fonts) are exclusively CSS custom properties**.

### Token Strategy
- **CSS Variables** (`--color-shell-*`, `--shadow-*`, `--radius-*`, `--font-*`, `--seeker-*`, `--mentor-*`) are the single source of truth for colors, shadows, radii, and fonts
- **Tailwind utilities** are used for layout/structure only (`flex`, `grid`, `p-4`, `rounded-xl`, `space-y-3`, etc.)
- **No `tailwind.config` theme extension** — all theming is via CSS custom properties in `:root` / `.dark`
- The `cn()` utility (`clsx` + `tailwind-merge`) merges conditional classes, but most Tailwind classes in components are hardcoded
- **Design tokens file**: `src/config/design-tokens.ts` (205 lines) contains a JavaScript object mirror of the design tokens (colors, typography, spacing, radius, shadows). This appears to be a **reference/documentation file** — it's imported nowhere in the components (all components use CSS variables directly). It contains:
  - `colors` object with named tokens like `midnightCanvas`, `steelPlate`, `voidViolet`, etc.
  - `typography` with font families and scales
  - `spacing` with a 4px-base scale
  - `radius` with named radii
  - `shadows` with subtle inset effects
  - `mentorTheme` — a separate warm amber palette (note: this differs from the `--mentor-*` CSS variables)
  - `mentorTypography` — mentor-specific scale using `zinc-*` colors

### Font System
Defined in `src/index.css` `:root`:
- `--font-untitled-sans`: `'Inter'` — body font
- `--font-aeonikpro`: `'Space Grotesk'` — heading/display font (applied via `font-display` class and `style={{ fontFamily: 'var(--font-aeonikpro)' }}`)
- `--font-dotdigital`: `'JetBrains Mono'` — monospace (used for eyebrows, code, `section-eyebrow` class)

Legacy aliases: `--font-sans`, `--font-heading`, `--font-mono` (kept for backward compat).

HTML root sets `font-family: var(--font-untitled-sans)` globally; headings use `var(--font-aeonikpro)`.

### CSS Utility Classes
`src/index.css` defines numerous theme-aware utility classes:
- `.glass-card` — frosted glass background + border
- `.hero-card` — deep glass card with inset highlight + shadow
- `.hero-text-gradient` — gradient text clip
- `.section-eyebrow` — uppercase label with decorative lines
- `.landing-grid` — grid pattern background with mask
- `.landing-spotlight` — conic gradient spotlight
- `.auth-background` — auth page with aurora backdrop
- `.auth-card` — auth form card
- `.auth-input` — auth input styling
- `.seeker-page` — seeker page with ambient glow background
- `.seeker-hero` — hero card frame
- `.seeker-panel` — glass control deck (backdrop-filter blur)
- `.seeker-card` — mentor card surface
- `.seeker-segment` — segment pill with selected state
- `.seeker-date-chip` — date selection chip
- `.seeker-empty-halo` — empty state glow
- `.av-*` — mentor availability scheduling components
- `.card-premium`, `.btn-primary-premium`, `.btn-ghost-premium`, `.input-premium`, `.section-divider` — legacy premium utility classes
- `.theme-transition` — smooth transition wrapper during theme switch
- `.flex-safe > *`, `.grid-safe > *` — overflow prevention
- `.token-wrap` — long string wrapping utility
- `.log-scroll` — code/log overflow container
- `.table-scroll` — horizontal table scroll
- `.no-wrap-token` — nowrap utility
- `.min-touch`, `.min-touch-icon` — mobile touch targets (44px minimum)

### Responsiveness
- Tailwind responsive prefixes: `sm:`, `md:`, `lg:`, `xl:` used throughout
- `max-w-7xl`, `max-w-[1200px]`, `max-w-[1240px]` — standard container widths
- `pointer: coarse` media query for touch targets
- `prefers-reduced-motion` respected globally (animations disabled)

---

## 5. Page-Specific Styling

### Landing Page (`src/pages/public/LandingPage.tsx`, 629 lines)
- Full-height page: `min-h-screen bg-[var(--color-shell-bg)]`
- **Background**: Fixed grid pattern (`landing-grid`) + blurred spotlight (`landing-spotlight`) with `z-0` and `pointer-events-none`
- **Header**: `z-50` sticky, `backdrop-blur-md`, border-bottom
- **Hero section**: Centered text content with `motion/react` fade-up, `hero-text-gradient` span for gradient text, max-width `3xl`
- **Feature section**: Delegates to `LandingFeatureSection` component (SVG illustrations with glow filters)
- **How It Works section**: Delegates to `LandingHowItWorksSection` component
- **Sections**: All use `max-w-[1200px] mx-auto`, `px-4 sm:px-6 lg:px-8 py-20 sm:py-28`
- **Segment cards**: Grid of 3 cols (`sm:grid-cols-2 lg:grid-cols-3`), use `cn()` for conditional classes, `boxShadow: var(--hero-card-shadow)` via inline style
- **Trust principles**: 4-column grid on `lg+`, cards with `bg-[var(--color-shell-surface)]/60`
- **Footer**: `border-t`, logo + footer nav + copyright
- **Back to top**: `fixed bottom-8 right-8` with motion animation, appears on scroll >400px

### Seeker Home Page (`src/pages/seeker/SeekerHomePage.tsx`, 394 lines)
- Root wrapper: `className="seeker-page"` (applies ambient glow background via CSS `::before`/`::after`)
- Uses `SeekerHero` component (top control surface with search, segments, date picker)
- Results section: `mt-10 space-y-8` with motion-staggered content
- `FilterBar` above results with language + experience filters
- `AvailableMentorsHeader` with count
- Error states inline (segment-level red banner, mentor-level red banner)
- Loading: `MentorGridSkeleton` with 3 cards
- Empty states: `EmptyMentorState` with context-aware actions (clear filters, try tomorrow, view all)
- `SegmentMentorsSection` for Section B (all mentors in segment)
- All colors via CSS variables; uses `cn()` for conditional styling

### Mentor Home Page (`src/pages/mentor/MentorHomePage.tsx`, 250 lines)
- Two render modes:
  1. **Verification required**: centered card with warning theme (`bg-[var(--color-shell-warning-soft)]`)
  2. **Approved mentor**: full dashboard
- **Action-required banner**: mentor-pending booking card with warning theme, meeting URL input
- **Today's sessions**: bordered card with table-like layout, confirmed sessions list
- Loading: inline pulse skeleton (hardcoded `bg-[var(--color-shell-border)]` blocks)
- All tokens from CSS variables

### Admin Dashboard (`src/pages/admin/AdminDashboardPage.tsx`, 788 lines)
- Uses `OperationsPrimitives` component library from `@/src/components/admin/`
- Grid layouts: 2-col → 4-col metric tiles (`grid-cols-2 lg:grid-cols-4`)
- All colors via CSS variables (`--color-shell-*`, `--status-*`)
- Status pills for booking states
- Section cards with `SectionCard` wrapper
- Loading: `Skeleton` and `MetricSkeleton` components
- Error/empty states: `PanelErrorState`, `PanelEmptyState`
- Last-updated timestamp with `tabular-nums`
- All sections use `space-y-3` or `space-y-6` consistent spacing

### Auth Pages (`src/pages/auth/LoginPage.tsx`, 254 lines)
- Uses `AuthLayout` with `BrandPanel` for split layout
- Form card: `auth-card` class (from index.css)
- Inputs: `auth-input` class
- Dev-only test personas section (visible in `DEV` mode only)
- Error states: red banners with `AlertCircle` icon
- Google sign-in button with SVG logo

---

## 6. Navigation Context & Routing

### `src/context/NavigationContext.tsx` (57 lines)
- Simple client-side router using `window.history.pushState`
- Exposes: `currentPath`, `currentRole`, `navigate(path)`
- `popstate` listener keeps state in sync with browser back/forward
- No route matching, param parsing, or nested routes — fully manual in `Router.tsx`

### `src/routes/Router.tsx` (192 lines)
- Manual if/else chain matching `currentPath`
- Route groups: public, auth, admin (protected, admin role), mentor (protected, mentor role), seeker (protected, seeker role)
- `ProtectedRoute` wraps protected sections with role-based authorization

---

## 7. Key Patterns & Conventions

### Styling Conventions
1. **All colors/shadows/borders use CSS variables** — no hardcoded hex colors in Tailwind class strings (except in `AuthLayout` loading spinner: `bg-[#050609]`, `border-[#663af3]`)
2. **`cn()` utility** (`clsx` + `tailwind-merge`) used for all conditional className composition
3. **CSS variable references inside Tailwind classes**: `bg-[var(--color-shell-bg)]`, `text-[var(--color-shell-text)]`, `border-[var(--color-shell-border)]`
4. **Inline `style` for dynamic shadows**: `style={{ boxShadow: 'var(--hero-card-shadow)' }}` when the token is a multi-layer shadow not available as a Tailwind class
5. **Font variables**: `var(--font-aeonikpro)` and `var(--font-untitled-sans)` applied via inline styles or CSS classes
6. **`.dark` class on `<html>`** (applied by ThemeContext) enables all dark-mode CSS variable overrides in `:root`/`dark` blocks in `index.css`

### Accessibility
- Focus-visible rings: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]`
- `aria-label`, `aria-hidden`, `aria-current`, `aria-expanded`, `aria-haspopup` used consistently
- `sr-only` skip links in all shells
- `role="alert"`, `aria-live` on error/success states
- `prefers-reduced-motion` media queries

### Animation
- `motion/react` (Framer Motion v12) used throughout
- Consistent easing: `EASE = [0.23, 1, 0.31, 1]` in `SeekerHero`, `easeOut`/`ease` elsewhere
- `useReducedMotion()` check in `LandingFeatureSection`
- Staggered children via `variants`

### Responsive Design
- Standard Tailwind breakpoints: `sm:`, `md:`, `lg:`, `xl:`
- Mobile-first approach
- Touch target minimums via `@media (pointer: coarse)` → `.min-touch` (44px)
- `overflow-wrap: break-word` on `body` to prevent horizontal scroll
