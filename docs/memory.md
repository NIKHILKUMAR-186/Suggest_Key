# Suggest Key — Project Memory

Version: 2.0
Last verified: 2026-09-27

Compact reference. For detail see `docs/architecture.md`, `docs/prd.md`,
`docs/rules.md`, and `docs/DOCUMENTATION-SYNC-REPORT.md`.

---

## Product

A 1:1 mentorship marketplace, India, priced in INR. Seeker discovers a mentor,
books a slot, pays by manual QR, joins, and reads a mentor-authored workspace.

## Core Loop

```text
Discover → Select slot → Hold (15m) → Pay (QR) → Admin verify
→ Mentor confirm → Join (T−5) → Complete → Workspace
```

## Roles

| Role | Job | Nav | Shell |
|---|---|---|---|
| Seeker | Discover → Book → Attend → Review | Home, My Bookings, Notifications, Settings | top nav |
| Mentor | Availability → Bookings → Conduct → Document | Home, My Bookings, Availability, Notifications, Settings | top nav |
| Admin | Monitor → Verify → Control → Resolve | Dashboard, Users, Mentors, Mentor Verification, Segments, Bookings, Workspaces, Payments, Notifications, System Health, Settings | sidebar |

## Stack

React 19 · Vite 8 · TypeScript 7 · Tailwind v4 · Express (`server.ts` →
`dist/server.cjs`) · Supabase Auth/Postgres/Storage/Realtime · Vercel.
Tests: `tsx --test`. Lint: `tsc --noEmit`.

**Not in the stack:** Next.js, shadcn/ui, Framer Motion, Playwright, Vitest,
Sentry, PostHog, any payment provider SDK.

## Timing Constants (`src/config/app.ts`)

| Rule | Value |
|---|---|
| Hold duration | 15 min |
| Booking cutoff before start | 5 min |
| Session access window (T−5) | 5 min |
| Meeting link deadline | 2 h |
| **Normal cancellation / reschedule window** | **10 min** |
| Default timezone | `Asia/Kolkata` |

> Cancellation is 10 minutes, not 24 hours. Any doc saying 24 h is wrong.

## States

**Booking** (`bookings.status`):
`PAYMENT_PENDING` → `PENDING_VERIFICATION` → `MENTOR_PENDING` → `CONFIRMED` → `COMPLETED`, with `CANCELLED` and `REJECTED` exits.

**Payment** (`payments.status`): `PENDING_VERIFICATION` → `VERIFIED` / `REJECTED`.

**Hold** (`slot_holds.status`): `ACTIVE` → `CONVERTED` / `EXPIRED` / `RELEASED`.

**Workspace** (`session_workspaces.status`): `PENDING` → `PUBLISHED`.

**Mentor approval** (`mentor_profiles.approval_status`): `draft` / `pending_review` / `approved` / `rejected`.

**Session projection** (computed, not a column): `SCHEDULED` / `ACCESS_OPEN` /
`IN_PROGRESS` / `COMPLETED` / `CANCELLED`. `IN_PROGRESS` is **not** a
`bookings.status` value.

## Entities (22 tables)

`profiles`, `user_roles`, `segments`, `mentor_segments`, `mentor_profiles`,
`seeker_profiles`, `gigs`, `mentor_availability`,
`mentor_availability_exceptions`, `slot_holds`, `bookings`, `payments`,
`notifications`, `session_workspaces`, `mentor_applications`,
`mentor_verification_documents`, `mentor_document_types`,
`mentor_application_audit`, `system_logs`, `audit_logs`,
`system_log_retention`, `login_failure_config`, `login_failure_trackers`.

> `supabase/schema.sql` includes only 10 of 31 migrations. Use
> `supabase/migrations/`.

## Critical Invariants

- Real database data only in production; backend and database are the source of truth.
- Mentor availability is global across all gigs.
- No overlapping non-cancelled bookings for a mentor (exclusion constraint).
- No overlapping active holds for a mentor (exclusion constraint).
- At most one **active** gig per mentor/segment (partial unique index, not a hard unique).
- Discoverable = approved + active + not suspended/deactivated + in segment + active gig + readable profile + ≥1 valid slot.
- The directory listing deliberately does **not** require bookability.
- Past slots cannot be booked; slots within 5 min of start cannot be booked.
- Expired holds release the slot; payment rejection releases it; payment approval does not.
- Meeting link hidden until T−5; server clock only; participants or admin only.
- Mentor confirmation requires an HTTPS meeting link.
- Slots are generated on the server only; the browser never invents times.

## API

112 route registrations under `/api/*` in `server.ts`, plus one SPA catch-all.
Auth chain: `requireAuth` → `requireAdmin` / `requireRole` / `requireActiveMentor`,
with request-body schemas from `src/lib/validation.ts`.

## Realtime

Published tables: `mentor_availability`, `mentor_availability_exceptions`,
`slot_holds`, `bookings`, `gigs`. `notifications` and `payments` are **not**
published, so those channels are polling-only.

## Testing

23 test files. Verified 2026-09-27: **492 tests / 115 suites / 492 pass / 0
fail**. `tsc --noEmit` clean. `npm run build` succeeds (main JS bundle 1,472 kB
/ 351 kB gzip; Vite emits a chunk-size warning — no code splitting).

Eight operational scripts in `scripts/` require a live Supabase project and a
running server; they are not part of `npm test`.

## Payment

Current: manual QR only. No provider SDK installed. Public UPI/QR/instructions
are nullable and admin-managed — nothing hardcoded.

## Time

Store UTC. Mentor availability is interpreted in the mentor's timezone.
Browser-local time is never authoritative.

## Workspace

Overview, mentor notes, key takeaways, suggestions, next steps, optional
follow-up recommendation. Seeker reads only after `PUBLISHED`.

## UI

Two token sources exist. **`src/index.css` is the live one** (Tailwind v4 CSS
custom properties, light + `.dark`, Inter / Space Grotesk / JetBrains Mono).
`src/config/design-tokens.ts` is a legacy palette that still describes the older
"frosted glass cathedral at midnight" theme and an amber mentor theme; it
contradicts `index.css` (e.g. mentor accent `#b8860b` vs `#663af3`) and is not
what the stylesheet applies.

Primitives that exist in `src/components/ui`: `Badge`, `Button`, `Card`,
`Dialog`, `Input`, `Modal`, `PasswordInput`, `Skeleton`, `Textarea`,
`ThemeToggle`. Shared states: `EmptyState`, `ErrorState`, `LoadingState`,
`SuccessState`, `ShortId`. Shells: `AppShell`, `SeekerShell`, `MentorShell`,
`AdminShell`.

There are **no** Select, Checkbox, Switch, Tabs, Toast, Table or Dropdown
primitives.

## Known Defects

1. `GET /api/admin/bookings/overdue-links` serves hard-coded demo fixtures even
   when Supabase is configured (`server.ts:2729-2744`).
2. Mentor application submission writes no admin notification — `user_id: null`
   against a `NOT NULL` column, error swallowed, route still returns 200
   (`server.ts:8577-8588`).
3. `notifications` and `payments` are missing from the realtime publication.
4. `supabase/schema.sql` is stale.
5. Rate limiting is per-instance, not global.
6. `NotificationContext` polls every 30 s even on hidden tabs.

## Future Direction

Not MVP requirements, not currently implemented: automated payments, outbound
email/SMS, user-submitted reviews, multi-session packages, intelligent mentor
matching, outcome analytics.
