# Suggest Key — UI Design System & Frontend Design Bible

**Version:** 2.0
**Status:** As-built
**Last verified:** 2026-09-27
**Scope:** Frontend UI/UX only

> Version 1.0 of this document was a pre-implementation proposal. It listed
> components and utilities that were never built. This version describes the
> system that **actually exists**, and keeps the design principles that still
> govern it. Anything not present in the repository is marked
> **Not currently implemented.**

---

## 1. Purpose

This document defines the visual language, component inventory, theme
architecture, and frontend quality standards for Suggest Key.

Suggest Key should feel: premium, calm, human, trustworthy, modern, focused.

The UI must feel like a premium mentorship platform, not a generic SaaS
dashboard.

---

## 2. Product UX Principles

### 2.1 Clarity First

Every page should make the user's current task obvious: where they are, what
matters, what the primary action is, what state the system is in, and what
happens next.

### 2.2 Visual Hierarchy

Priority order: primary task/action → important context → supporting information
→ metadata. Use hierarchy rather than decoration.

### 2.3 Minimal Visual Noise

Avoid excessive cards, borders, shadows, gradients, glassmorphism, decorative
animation, repeated containers, and generic dashboard styling.

### 2.4 Consistency

Equivalent concepts look and behave identically everywhere. The same button
type, input, status, card, modal, navigation item and loading state must use the
same design language.

---

## 3. Role-Specific UX Direction

### Seeker

```text
Discover → Book → Attend → Review outcome
```

Clean, focused, discovery-oriented, low cognitive load, strong booking CTA.
Top navigation shell: Home, My Bookings, Notifications, Settings.

### Mentor

```text
Manage availability → Manage bookings → Conduct session → Document outcome
```

Clean, operational, action-oriented, clear session states.
Top navigation shell: Home, My Bookings, Availability, Notifications, Settings.

### Admin

```text
Monitor → Verify → Control → Resolve
```

Operational, information-dense, efficient, clear queues and actions.
Sidebar shell: Dashboard, Users, Mentors, Mentor Verification, Segments,
Bookings, Workspaces, Payments, Notifications, System Health, Settings.

---

## 4. Frontend-Only Constraint

Frontend work must not change backend architecture or business rules.

Do not modify:

- database schema
- Supabase RLS
- authentication architecture
- booking, payment or availability business logic
- server-side authorization
- API contracts
- real data flows

Do not introduce fake production business data or bypass existing state rules.
The UI must represent real backend state; the backend remains the source of truth.

---

## 5. Technology

| Concern | Implementation |
|---|---|
| Framework | React 19 |
| Build | Vite 8.3.0 |
| Language | TypeScript 7 |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` |
| Animation | `motion` |
| Icons | `lucide-react` |
| Theming | CSS custom properties in `src/index.css`, light + `.dark` |
| Routing | Hand-written matcher, `src/routes/Router.tsx` |
| Component library | None. The primitives below are first-party. |

**Not used:** Next.js, shadcn/ui, Framer Motion, styled-components, any
third-party component kit.

> shadcn-style semantic aliases (`bg-background`, `text-foreground`,
> `bg-card`, `border-border`, …) **are** declared in `index.css` and map onto the
> shell tokens, so they work. In practice components reference the tokens
> directly, e.g. `bg-[var(--color-shell-bg)]`. Both forms are valid; be
> consistent within a file.

---

## 6. Theme Architecture

Light and dark are both intentionally designed, not inversions. The `.dark`
class on a root ancestor switches the token block.

`src/index.css` is ~1,100 lines and defines the tokens in `@layer base`. It is
the **single live source of visual truth**.

### 6.1 Semantic token groups (live)

**Shell (core)**
```text
--color-shell-bg            --color-shell-bg-hover
--color-shell-surface       --color-shell-surface-hover
--color-shell-surface-elevated      --color-shell-surface-elevated-hover
--color-shell-text          --color-shell-text-muted
--color-shell-text-subtle  --color-shell-text-contrast
--color-shell-border        --color-shell-border-strong
--color-shell-focus
```

**Shell (brand + status)**
```text
--color-shell-primary       --color-shell-primary-hover
--color-shell-primary-soft
--color-shell-accent        --color-shell-accent-hover
--color-shell-accent-soft
--color-shell-success       --color-shell-success-soft
--color-shell-warning       --color-shell-warning-soft
--color-shell-error         --color-shell-error-soft
--color-shell-info          --color-shell-info-soft
```

**Role-scoped**: `--mentor-*` (mentor surface), `--seeker-*` (seeker hero,
panels, cards, selection states), `--brand-*`, `--status-*`.

**Compositional**: `--overlay-backdrop`, `--gradient-hero-text`,
`--landing-*`, `--glass-card-*`, `--hero-card-*`, `--seeker-hero-*`.

**Non-color**: `--radius-sm|md|lg|xl|2xl|full`, `--shadow-xs|sm|md|lg|xl`.

### 6.2 Live color values

| Role | Light | Dark |
|---|---|---|
| Background | `#f4f7fc` | `#05060f` |
| Surface | `#ffffff` | `#0b0d1a` |
| Surface elevated | `#ffffff` | `#111424` |
| Text | `#0b1220` | `#e8edf7` |
| Text muted | `#47566e` | `#9da7ba` |
| Primary | `#663af3` | `#663af3` |
| Accent | `#2563eb` | `#60a5fa` |
| Success | `#15803d` | `#34d399` |
| Warning | `#b45309` | `#fbbf24` |
| Error | `#dc2626` | `#f87171` |
| Focus ring | `#2563eb` | `#60a5fa` |

Both themes avoid pure white everywhere and pure black everywhere: hierarchy comes
from subtle surface steps plus borders.

### 6.3 Known token divergence — do not treat `design-tokens.ts` as live

`src/config/design-tokens.ts` still describes the earlier **"frosted glass
cathedral at midnight"** theme (`midnightCanvas: '#05060f'`,
`voidViolet: '#663af3'`, `emberGlow: '#e46d4c'`, `signalBlue: '#027dea'`,
`gridlineBlue: '#3f4959'`, plus `Untitled Sans` / `aeonikPro` / `dotDigital`
font names) and a separate **warm-amber mentor theme** (`accent: '#b8860b'`).

It contradicts `index.css` — most visibly the mentor accent, `#b8860b` in the
TypeScript file versus `#663af3` in the stylesheet. It is **not** what the app
renders. When changing visual values, change `index.css`. Retire or reconcile
`design-tokens.ts` rather than adding values there.

---

## 7. Typography

Fonts are declared as stacks with no bundled font files, so they resolve to the
platform UI font when the named face is absent.

| Token | Stack |
|---|---|
| `--font-sans` | Inter → system-ui → … |
| `--font-heading` | Space Grotesk → system-ui → … |
| `--font-mono` | JetBrains Mono → monospace stack |

Rules:

- The same semantic level gets the same treatment everywhere.
- Page titles, section titles and card titles must be visually distinct.
- Supporting text is visibly subordinate.
- No arbitrary one-off font sizes.

`design-tokens.ts` also carries an unused px scale (`caption` 12px … `display`
48px) and a Tailwind-class mentor scale. Neither is what the stylesheet applies.

---

## 8. Spacing, Radius, Elevation

**Spacing** follows the Tailwind scale. Avoid arbitrary values such as 17px,
23px, 37px unless there is a design reason.

**Radius** (`--radius-*`):

```text
sm  0.375rem   badges, compact controls
md  0.5rem     inputs, buttons
lg  0.75rem    cards
xl  1rem       panels
2xl 1.5rem     major surfaces
full           pills
```

Do not make every element pill-shaped. Reserve pills for tags, compact status
indicators, and explicit pill controls.

**Elevation** is a small system:

```text
Level 0  page background
Level 1  normal surface
Level 2  elevated card, dropdown
Level 3  dialog, modal, overlay
```

Light mode uses subtle shadows (`--shadow-xs` … `--shadow-xl`). Dark mode leans on
surface contrast and borders. Avoid large dramatic shadows.

---

## 9. Iconography

One icon family: `lucide-react`. Keep stroke style, weight, size, alignment and
color consistent. Do not mix unrelated icon styles, random inline SVGs, Unicode
symbols, and emoji into one system. Icons support comprehension; they are not
decoration.

---

## 10. Component Inventory (as-built)

### 10.1 Primitives — `src/components/ui/` (10 files)

| Component | Verified API |
|---|---|
| `Button` | `variant: 'default' \| 'outline' \| 'secondary' \| 'ghost' \| 'destructive' \| 'accent'`, `size: 'sm' \| 'md' \| 'lg'`, `isLoading` (renders a spinning `Loader2`), accepts `className` |
| `Badge` | `variant: 'default' \| 'secondary' \| 'outline' \| 'success' \| 'warning' \| 'destructive'` |
| `Card` | styled `div` wrapper extending `HTMLAttributes<HTMLDivElement>` |
| `Input` | extends `InputHTMLAttributes`; adds `error?: boolean` and `success?: boolean`, which drive border, focus ring and trailing-space treatment |
| `Textarea` | extends `TextareaHTMLAttributes`; resizable, themed border and background |
| `PasswordInput` | extends `InputHTMLAttributes`; adds show/hide affordance |
| `Skeleton` | `variant: 'rectangular' \| 'circular' \| 'rounded'` |
| `Modal` | `isOpen`, `onClose` |
| `Dialog` | same surface as `Modal` minus `isOpen`/`onClose` (self-managed) |
| `ThemeToggle` | `variant: 'icon' \| 'labeled'`; switches light/dark |

### 10.2 Shared states — `src/components/shared/`

`EmptyState`, `ErrorState`, `LoadingState`, `SuccessState`, `ShortId`.

### 10.3 Shells — `src/components/layout/`

`AppShell` (role dispatch) → `SeekerShell`, `MentorShell`, `AdminShell`.

### 10.4 Not currently implemented

There is **no** `Select`, `Checkbox`, `Switch`, `Tabs`, `Toast`, `Table` or
`Dropdown` primitive. Version 1.0 of this document listed all of these as
planned Phase 2/3 primitives; they do not exist. Pages that need those
affordances build them locally. Introducing a shared primitive for one is a
reasonable refactor, but do not document one as existing.

---

## 11. Button System

`default` is the primary action (Book Session, Confirm Session, Join Session,
Save Changes). `outline` and `secondary` are supporting actions (View Details,
Edit, Back). `ghost` is low-emphasis contextual. `destructive` covers Reject,
Delete, Deactivate. `accent` is a secondary brand emphasis.

Every interactive state must be defined and readable in both themes: default,
hover, pressed (`active:scale-[0.98]` is used), focus, disabled, loading.
`isLoading` shows an inline spinner and is the correct pattern for a submitting
action.

---

## 12. Forms and Inputs

```text
Label
  ↓
Input
  ↓
Helper text / validation
```

Every meaningful input supports default, hover, focus, filled, disabled, error,
and success where appropriate. Error and success are first-class `Input` props.

**Error communication must not rely on colour alone** — pair it with clear text,
an icon where useful, correct field association, and `aria` wiring.

All input text is HTML-stripped server-side before length validation
(`stripHtmlTags`). Client validation mirrors the server schemas in
`src/lib/validation.ts`; the server remains authoritative.

---

## 13. Cards and Surfaces

Do not put every piece of content in a card. Cards earn their place when they
group something interactive or meaningful: mentor profile, mentor offering,
booking summary, payment summary, operational queue item, workspace section.

Avoid cards for paragraphs, headings, small metadata, or sections that spacing
alone can group.

---

## 14. Mentor Card

Discovery is a core experience. Prioritise:

```text
Avatar
Name
Segment / Gig
Short bio
Duration        Price
Next available slot
[ View Mentor ]
```

Do not overload the card. A mentor with no bookable slot does not appear in
available results at all; in the directory it appears with an explanation and a
"choose another date" affordance.

---

## 15. Status System

Status visuals are centralized and never conveyed by colour alone — every status
has a text label, a semantic treatment, and optionally a supporting icon.

**Booking**: `PAYMENT_PENDING`, `PENDING_VERIFICATION`, `MENTOR_PENDING`,
`CONFIRMED`, `COMPLETED`, `CANCELLED`, `REJECTED`

**Payment**: `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`

**Hold**: `ACTIVE`, `CONVERTED`, `EXPIRED`, `RELEASED`

**Session projection**: `SCHEDULED`, `ACCESS_OPEN`, `IN_PROGRESS`, `COMPLETED`,
`CANCELLED`

`IN_PROGRESS` is a computed session state, not a `bookings.status` value. Do not
style it as though it were a database status.

Map these onto `Badge` variants (`success`, `warning`, `destructive`,
`secondary`, `outline`) consistently across every page.

---

## 16. Booking Progress

Make state progression visible without exposing internal plumbing:

```text
✓ Slot selected
✓ Payment submitted
● Awaiting verification
○ Mentor confirmation
○ Session
```

---

## 17. Loading, Empty, Error, Success States

Every meaningful asynchronous area needs a deliberate state.

- **Loading**: prefer `Skeleton` when content shape is known; reserve full-page
  spinners for whole-route transitions; use `Button isLoading` for submits.
- **Empty**: say what is empty, why, and what to do next. No unexplained blank
  space. `EmptyState` exists for this.
- **Error**: human-readable and actionable, with a retry. Do not surface raw
  technical errors as primary UI. `ErrorState` exists for this.
- **Success**: least disruptive appropriate feedback — toast, inline
  confirmation, or a status transition. `SuccessState` exists for this.

`ShortId` renders a truncated identifier with the full value available, so
booking codes and payment ids stay readable in dense tables.

---

## 18. Dialogs and Modals

Use `Modal` / `Dialog` for focused decisions and contained workflows. Actions
are predictable (Cancel / Confirm). Destructive actions must state their
consequence. Style sizes consistently; the components do not expose a size prop
today — apply consistent classes at the call site.

There is no Toast system component. Success feedback is currently inline or
status-transition based.

---

## 19. Navigation

Centralized and role-aware in `src/config/navigation.ts`, consumed by the
shells. Do not build ad-hoc navigation inside pages.

Desktop: horizontal top nav for seeker/mentor; persistent sidebar for admin.
Mobile: compact header with a collapsible menu for seeker/mentor; collapsible
drawer for admin.

Changing the navigation UI is not authorization. Role access is enforced by
`ProtectedRoute` in the client and by `requireAuth` / `requireRole` /
`requireAdmin` on the server.

---

## 20. Session Experience

The session UI is time-sensitive and should communicate:

```text
Before T−5  → "Session starts in X minutes"
At T−5     → Join becomes available
During     → Join available
After end  → Session ended
```

Countdown ticks run locally at 1 s for display. Authoritative revalidation
happens every 20 s and on realtime booking events, always against the server.
**The countdown is UX only and is never a security control** — the server
evaluates the T−5 gate on its own clock and ignores any client-supplied time.

---

## 21. Animation

Animation is purposeful: page transitions, modal entrance, dropdown opening,
button feedback, skeletons, slot selection, status transitions.

Avoid scroll hijacking, constant floating elements, heavy parallax, animation on
every component, and long transitions that slow a workflow.

> The interface should feel alive, not animated.

---

## 22. Responsive Design

Design for mobile, tablet, desktop and large desktop. Do not simply shrink
desktop layouts; information hierarchy may need to change. The mentor card
stacks from a horizontal row to a vertical stack. Tailwind breakpoints handle
most of this.

---

## 23. Accessibility Baseline

Sufficient contrast in both themes, visible keyboard focus, proper labels, clear
navigation, responsive layouts, non-colour-only status communication, usable
touch targets, logical reading order, and reduced-motion consideration.

Accessibility is part of the system, not a final patch.

---

## 24. Theme QA Matrix

Every reusable component should be checked in both themes.

| Component | Light | Dark | Hover | Focus | Disabled | Mobile |
|---|---|---|---|---|---|---|
| Button | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Input | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Card | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Modal | ✓ | ✓ | — | ✓ | — | ✓ |
| Badge | ✓ | ✓ | — | — | — | ✓ |
| Skeleton | ✓ | ✓ | — | — | — | ✓ |
| ThemeToggle | ✓ | ✓ | ✓ | ✓ | — | ✓ |

A component is not finished until both themes are intentionally validated.

---

## 25. Frontend QA Checklist

A page is complete only when:

```text
✓ Light mode works
✓ Dark mode works
✓ Mobile / tablet / desktop work
✓ Typography and spacing are consistent
✓ Components are reused, not re-implemented
✓ Loading, empty, error and success states all exist
✓ Focus states work
✓ Status is understandable without colour
✓ Primary action is obvious
✓ No fake business data, metrics, availability or notifications
✓ No hardcoded slot times
✓ Backend behaviour is preserved
```

---

## 26. AI Coding Agent Rules

When implementing UI in this repository:

1. Inspect the existing frontend before modifying it.
2. Reuse existing working functionality and shared components.
3. Put design values in `src/index.css`, not in `src/config/design-tokens.ts`
   and not inline in components.
4. Do not solve theme problems with per-page overrides.
5. Do not hardcode business data.
6. Do not change backend logic for a frontend-only change.
7. Do not modify authentication, booking, payment or availability rules unless
   explicitly asked.
8. Preserve the real Supabase data flow.
9. Validate both themes and responsive layouts.
10. Preserve role-based navigation.
11. Avoid unnecessary dependencies and avoid rewriting unrelated modules.
12. Test critical UI states after changes.
13. Keep business logic out of presentational components where practical.
14. Run `npm run lint` (`tsc --noEmit`) and `npm test` before declaring done.

---

## 27. Anti-Patterns

Do not introduce:

```text
❌ Random colors, typography, card styles or button styles per page
❌ Pure black everywhere in dark mode
❌ Pure white everywhere in light mode
❌ Excessive borders, shadows, gradients or glassmorphism
❌ Every section inside a card
❌ Fake charts, metrics, notifications or availability
❌ Hardcoded production data
❌ Page-specific theme hacks
❌ Duplicate navigation implementations
❌ Emoji as a substitute for a proper icon system
❌ Client-side timestamps treated as authoritative
❌ Documenting components that do not exist
```

---

## 28. Core Design Principle

> Do not make individual pages beautiful at the expense of making the product
> inconsistent.

```text
Design tokens (src/index.css)
      ↓
Primitives (src/components/ui)
      ↓
Shared states (src/components/shared)
      ↓
Shells (src/components/layout)
      ↓
Domain components
      ↓
Pages (src/pages)
      ↓
Light/Dark QA → Responsive QA → Accessibility QA
```

---

## 29. Final Design Goal

A user should be able to move from Home → Discovery → Mentor Detail → Slot
Selection → Payment → Booking → Session → Workspace without feeling each page
was designed by a different person. The same coherence should hold for the
mentor flow and the admin console, while preserving the three roles' different
jobs.

A strong frontend is not a collection of beautiful pages. It is a design system,
plus reusable components, plus consistent states, plus responsive layout, plus
theme architecture, plus accessibility, plus real application state.
