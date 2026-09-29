# Suggest Key — Project Memory

Version: 3.1
Status: As-built / Current
Last verified: 2026-09-29

Long-term project context: the decisions and invariants that should survive
someone else's tenure. Debugging notes and transient state have been removed.
Anything that reads as a fact below is traceable to code or a migration;
anything aspirational lives in `docs/prd.md` §19 instead.

---

## Product

A 1:1 mentorship marketplace for India. Seeker discovers a mentor, books a
slot, pays, attends, and reads a mentor-authored workspace. INR. No video
provider: the mentor supplies the meeting link.

## Core Loop

```text
Discover → Select slot → Hold (5 min) → Pay → Mentor confirm
                                                  │
   Read workspace ← Complete ← Join (T−5) ←────────┘
```

`Pay` forks: manual UPI/QR (default, human-verified) or Razorpay (opt-in,
machine-verified).

## Roles

| Role | Nav | Shell |
|---|---|---|
| Seeker | Home, My Bookings, Notifications, Settings | top nav |
| Mentor | Home, My Bookings, Availability, Notifications, Settings | top nav |
| Admin | Dashboard, Users, Mentors, Mentor Verification, Segments, Bookings, Workspaces, Payments, Notifications, System Health, Settings | sidebar |

A user may hold more than one role. `user_roles` has `UNIQUE (user_id, role)`,
not a per-user unique.

## Stack

React 19 · Vite 8 · TypeScript 7 · Tailwind v4 · Express 4 (`server.ts` →
`dist/server.cjs`) · Supabase Auth/Postgres/Storage/Realtime/`pg_cron` · Vercel.
Tests `tsx --test`; lint `tsc --noEmit`. Node 22.

**Deliberately absent:** Next.js, shadcn/ui, a routing library, a state
library, a form library, a test framework beyond the Node runner, Sentry,
PostHog, and any payment-provider SDK. Razorpay is integrated over plain
`fetch` behind an interface, which is what makes the gateway swappable.

## Timing Constants — single source of truth

`src/config/app.ts`, mirrored in `platform_config.hold_duration_minutes`.

| Rule | Value | Was |
|---|---|---|
| Hold duration | **5 min** | 15 min |
| Booking cutoff before start | **5 min** | 2 h |
| Session access window (T−5) | 5 min | unchanged |
| Meeting-link deadline (mentor guidance) | 2 h | unchanged |
| Normal cancellation / reschedule window | **10 min** | 24 h |
| Default timezone | `Asia/Kolkata` | unchanged |

> If you find a document quoting 15 min or 2 h for hold or cutoff, it is wrong.
> If you find 24 h for cancellation, it is wrong.

## States

**Booking** (`bookings.status`, 8 values permitted by the CHECK, **7 reachable**):
`PAYMENT_PENDING`, `PENDING_VERIFICATION`, `MENTOR_PENDING`, `CONFIRMED`,
`COMPLETED`, `CANCELLED`, `REJECTED`. `PAYMENT_PROCESSING` is permitted but
**written by no current code path** — the Razorpay flow holds the booking at
`PAYMENT_PENDING` until capture, because `expire_stale_holds()` only cancels
`PAYMENT_PENDING` rows.

**Payment** (`payments.status`, 8 values): `PENDING_VERIFICATION`, `VERIFIED`,
`REJECTED`, `PAYMENT_PENDING`, `PAYMENT_PROCESSING`, `FAILED`, `REFUNDED`,
`REFUND_FAILED`. `PAYMENT_PROCESSING` lives **here**, not on the booking.

**Hold** (`slot_holds.status`): `ACTIVE`, `CONVERTED`, `EXPIRED`, `RELEASED`.

**Workspace** (`session_workspaces.status`): `PENDING`, `PUBLISHED`.

**Mentor approval** (`mentor_profiles.approval_status`): `draft`,
`pending_review`, `approved`, `rejected`.

**Session projection** — computed, **not a column**: `SCHEDULED`, `ACCESS_OPEN`,
`IN_PROGRESS`, `COMPLETED`, `CANCELLED`. Only `COMPLETED` and `CANCELLED` are
also real booking statuses. The name is `SCHEDULED`, **not** `UPCOMING` —
`UPCOMING` is only a list-tab label in the UI.

> Three concepts, three vocabularies. `IN_PROGRESS` is not a booking status.
> `FAILED` / `REFUNDED` are payment statuses, not booking statuses.

## Entities — 28 public tables

Identity `profiles`, `user_roles` · catalog `segments`, `segment_topics`,
`gig_topics` · profiles `mentor_profiles`, `mentor_segments`,
`seeker_profiles`, `gigs` · availability `mentor_availability`,
`mentor_availability_exceptions` · booking `slot_holds`, `bookings`,
`payments`, `payment_events`, `webhook_events` · content
`session_workspaces` · onboarding `mentor_applications`,
`mentor_verification_documents`, `mentor_document_types`,
`mentor_application_audit` · operations `platform_config`, `audit_logs`,
`system_logs`, `system_log_retention`, `login_failure_config`,
`login_failure_trackers`.

`supabase/schema.sql` is a **stub** (968 bytes). Use `supabase/migrations/` —
38 files, applied in timestamp order. Note the two `phase7*`/`phase8*` files
carry later timestamps and therefore apply last.

## Critical Invariants

- Real data only in production; the server and the database are the source of
  truth, not the browser.
- Mentor availability is **global across gigs**, not per gig.
- No two `ACTIVE` holds overlap for a mentor (EXCLUDE constraint).
- No two live bookings overlap for a mentor (EXCLUDE constraint). `CANCELLED`
  and `REJECTED` are excluded, so `PENDING_VERIFICATION` correctly still blocks
  the slot.
- At most one **active** gig per mentor per segment (partial unique index, not
  a hard unique — retired gigs are kept).
- Booking creation is one transaction (`create_booking_with_hold`), not a
  sequence.
- Booking state can only be written by a `SECURITY DEFINER` RPC or the
  service-role client. `authenticated` may update only `cancellation_reason`
  and `updated_at`.
- The browser never supplies a payment amount.
- The meeting link has exactly one door: T−5, participants only, revoked
  permanently once `actual_ended_at` is set.
- Time gates are evaluated on the server clock; the client only renders.
- `session_workspaces` is invisible to the seeker until `PUBLISHED`.
- Slots are generated on the server only. There is no slot table and no
  `generate_slots` RPC.
- Expired holds release the slot; payment rejection releases it; payment
  approval does not.

## API

131 `/api/*` route registrations plus one SPA catch-all, all in `server.ts`.
79 are admin routes. Auth chain: `requireAuth` → `requireAdmin` / `requireRole` /
`requireActiveMentor` → `expensiveRouteLimiter` → `validateBody` (zod).

Only two routes are outside `requireAuth`: `GET /api/health` and
`POST /api/webhooks/razorpay` (authorised by HMAC over the raw body).

## Realtime

Publication `supabase_realtime` contains exactly 10 tables:
`mentor_availability`, `mentor_availability_exceptions`, `slot_holds`,
`bookings`, `gigs`, `segments`, `segment_topics`, `payments`,
`payment_events`, `webhook_events`.

`notifications` is **not** published — notification freshness is polling only.
`REPLICA IDENTITY FULL` is set on 6 of the 10; `payments`, `payment_events`,
`webhook_events` and `segment_topics` are key-only.

Polling: availability 45 s (floor 15 s), payments 60 s (floor 30 s),
notifications 60 s (floor 30 s) — all visibility-gated. `useSessionSync`
revalidates every 20 s. `NotificationContext` polls every 30 s with **no**
visibility gate, which is an inconsistency, not a design.

## Testing

43 test files. `npm test` = `tsx --test tests/**/*.test.ts`. `npm run lint` =
`tsc --noEmit`, clean as of 2026-09-29.

Test-count and pass/fail totals are deliberately not restated here — they go
stale and are not architecture. The file count and the coverage map in
`docs/technical-audit.md` §6 are verified.

8 operational scripts in `scripts/` need a live Supabase project and a running
server. They are not part of `npm test`.

## Payment

Current state: **hybrid**. Manual UPI/QR is the default and always live.
Razorpay is fully implemented and feature-flagged **off**
(`RAZORPAY_ENABLED` defaults to `"false"`).

Design decisions worth remembering:

- `razorpayService.ts` is written against two ports, `RazorpayGatewayClient`
  and `RazorpayStore`, supplied by `createRazorpayGatewayClient()` and
  `createSupabaseRazorpayStore(admin)`. Adding a second gateway means writing
  an adapter, not editing the orchestration.
- Order amount is server-derived from stored data. A browser amount is never
  used, and a mismatch is refused and audited.
- Signature verification happens server-side against the key secret. Failure
  audits the error *code* only; signatures are proof material and are never
  logged.
- The webhook verifies over the **raw body** captured by a JSON `verify` hook.
  Using `req.body` would fail the HMAC. This is commented in place.
- Idempotency exists at all three entry points: order reuse, duplicate-tolerant
  verify, and `UNIQUE (gateway, event_id)` on `webhook_events`.
- `RAZORPAY_ORDER_EXPIRY_SECONDS` is **derived** from `HOLD_DURATION_MS`, never
  a second literal, so an order cannot outlive its hold.
- `recoverCaptureAgainstDeadBooking()` refuses to revive a cancelled booking; it
  marks the payment `FAILED` and writes a `payment_events` row.
- The manual admin queue remains correct and is not vestigial: it serves
  `gateway = 'manual'` rows, which is the only path needing a human.
- Refund **events** are consumed. Nothing initiates a refund.

## Time

Store UTC. Mentor availability is interpreted in the mentor's IANA timezone.
Bookings snapshot `seeker_timezone` and `mentor_timezone`. The browser clock is
never authoritative; `useSessionSync` samples the offset on every revalidation.

`pg_cron` runs two jobs, both `* * * * *`: `expire_stale_holds()` and
`complete_expired_sessions()`. The first is `service_role`-only, as are
`reconcile_expired_bookings` and `complete_expired_sessions`.

## Workspace

Overview/summary, mentor notes, key takeaways, suggestions, next steps, action
items, resources, optional follow-up recommendation. Mentor authors and
publishes; the seeker reads only after `PUBLISHED` (RLS, not UI).

## UI

`src/index.css` (97 KB of Tailwind v4 custom properties, light + `.dark`) is
the **live** token source. `src/config/design-tokens.ts` describes an older
"frosted glass cathedral at midnight" palette and an amber mentor theme that
the stylesheet does not apply — it contradicts `index.css` (mentor accent
`#b8860b` vs `#663af3`) and is a known divergence, not the source of truth.

Segment experiences carry their **own** runtime theme via
`SegmentThemeContext` / `segmentThemes.ts` / `SegmentExperienceRenderer`.

Primitives in `src/components/ui`: `Badge`, `Button`, `Card`, `Dialog`, `Input`,
`Modal`, `PasswordInput`, `Skeleton`, `Textarea`, `ThemeToggle`. Shared states:
`EmptyState`, `ErrorState`, `LoadingState`, `SuccessState`, `ShortId`. Shells:
`AppShell`, `SeekerShell`, `MentorShell`, `AdminShell`.

There are **no** Select, Checkbox, Switch, Tabs, Toast, Table or Dropdown
primitives. Navigation config lives in `src/config/navigation.ts`.

`Router.tsx` is a hand-rolled `if` chain over `useNavigation().currentPath`, not
React Router. Order matters: `/mentors` is matched before `/mentor`.

## Known Defects

Open as of 2026-09-29. Detail and evidence in `docs/technical-audit.md`.

1. `payment-qr` storage bucket is referenced by code but **never created by any
   migration** — blocks the admin QR upload on the default payment path.
2. `GET /api/admin/bookings/overdue-links` serves hardcoded in-memory fixtures
   and never queries the database.
3. `src/types/database.ts` `BookingStatus` omits `'PAYMENT_PROCESSING'` — and
   `statusTone.ts` `BOOKING_LIFECYCLE` has only 5 entries. **Latent:** no code
   writes that value to a booking, so nothing is user-visible today.
4. `notifications.type` and `mentor_application_audit.action` have **no CHECK**
   constraint — the phase4/phase12 constraints were dropped and not restored.
5. `platform_config` has **no RLS enabled**.
6. `REPLICA IDENTITY FULL` missing on `payments`, `payment_events`,
   `webhook_events`, `segment_topics`.
7. Rate limiting is per-process, so limits multiply with instance count.
8. `NotificationContext` polls every 30 s regardless of tab visibility.
9. `mentor_profiles.rating` / `review_count` are stored columns with no
   computation behind them — no reviews table, no reviews feature.
10. `src/lib/logger.ts.tmp` is an unreferenced 15 KB temp file.
11. `fetchMentorTopics` in `src/lib/mentorTopics.ts` has no importer.
12. No code splitting; single large JS bundle.

## Decisions Worth Remembering

- **Hold and cutoff are both 5 minutes.** They were deliberately converged.
  A 15-minute hold was sized for "upload a screenshot and wait for an admin",
  which automated capture no longer needs; matching the cutoff also removes a
  long "money locked, nothing happening" window.
- **The manual payment path is not being retired yet.** It is the working
  default. Removing it before Razorpay is enabled and verified live would
  remove the platform's only working revenue route.
- **Reconciliation must never set `CANCELLED`.** It returns `NULL` when there
  is nothing to do. This was a real data-corrupting bug, fixed in
  `20260927060000`.
- **Redaction belongs on the projection, not just the action.** Gating the join
  endpoint while returning the link in the list made the gate decorative.
- **Once-only notification is a database constraint**, not application logic.
- **Booking state is column-privilege-reduced.** A client physically cannot
  confirm a booking or set a meeting URL.
- **There is no reviews feature.** `rating` and `review_count` are unearned
  stored defaults. Do not present a rating as if it were meaningful.

## Future Direction

Not MVP requirements, not implemented. Listed in full in `docs/prd.md` §19:
automated refunds, email/SMS/push, real reviews, calendar invites, video
provider integration, session recording, multi-session packages, payouts,
matching, in-app chat, group sessions.

The most likely next production change is enabling Razorpay, which requires
only configuration plus a live credential check. The most likely next
engineering change is retiring the manual payment path, which should not
happen before that.
