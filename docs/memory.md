# Suggest Key — Project Memory

Version: 3.2
Status: As-built / Current
Last verified: 2026-10-02

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
| Admin | Dashboard, Users, Mentors, Mentor Verification, Segments, Bookings, Workspaces, Payments, Coupons, Notifications, System Health, Support, Settings (13) | sidebar |

Support is a seeker/mentor **Settings** destination (`/seeker/support`,
`/mentor/support`), not a top-nav item, so their nav shape is unchanged.

A user may hold more than one role. `user_roles` has `UNIQUE (user_id, role)`,
not a per-user unique.

## Stack

React 19 · Vite 8 · TypeScript 7 · Tailwind v4 · Express 4 (`server.ts` →
`api/index.cjs`) · Supabase Auth/Postgres/Storage/Realtime/`pg_cron` · Vercel.
Tests `tsx --test`; lint `tsc --noEmit`. Node 22.

**Deployment shape worth remembering:** `api/index.cjs` is a build artefact and
the *only* file in `api/`. `vercel.json` must name it explicitly with
`@vercel/node`, because Vercel's automatic `api/` discovery silently produced a
zero-function deployment and every `/api/*` call fell through to the SPA shell.
`tests/vercel_deployment_architecture.test.ts` pins this.

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
| Meeting-link deadline (mentor guidance) | **5 min** | 2 h |
| Normal cancellation / reschedule window | **10 min** | 24 h |
| Default timezone | `Asia/Kolkata` | unchanged |

> If you find a document quoting 15 min or 2 h for hold, cutoff or the
> meeting-link deadline, it is wrong. If you find 24 h for cancellation, it is
> wrong.

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

**Support ticket** (`support_tickets.status`): `OPEN`, `IN_PROGRESS`,
`WAITING_FOR_USER`, `RESOLVED`, `CLOSED`. Priority: `LOW`, `NORMAL`, `HIGH`,
`URGENT`. A `RESOLVED` ticket must carry a resolution body — that is a database
CHECK, not a UI rule.

**Coupon usage** (`coupon_usage.status`): `RESERVED`, `REDEEMED`, `RELEASED`.
One row per booking for its whole life (`UNIQUE (booking_id)`), driven by an
`AFTER UPDATE` trigger on `bookings.status`.

**Refund** (`payments.refund_status`): independent of `payments.status`. A
`PENDING` refund with `manual_refund_required = true` means "a human must move
the money" — it never means a refund was initiated.

**Mentor approval** (`mentor_profiles.approval_status`): `draft`,
`pending_review`, `approved`, `rejected`.

**Session projection** — computed, **not a column**: `SCHEDULED`, `ACCESS_OPEN`,
`IN_PROGRESS`, `COMPLETED`, `CANCELLED`. Only `COMPLETED` and `CANCELLED` are
also real booking statuses. The name is `SCHEDULED`, **not** `UPCOMING` —
`UPCOMING` is only a list-tab label in the UI.

**Mentor lifecycle bucket** — computed, **not a column**:
`AWAITING_PAYMENT`, `AWAITING_VERIFICATION`, `PENDING_CONFIRMATION`, `OVERDUE`,
`CONFIRMED`, `COMPLETED`, `CANCELLED`. `OVERDUE` is the one that surprises
people: a `MENTOR_PENDING` row that passed its 5-minute meeting-link deadline
with no link. It is **derived on read** by `resolveBookingLifecycle()`
(`src/lib/bookingLifecycle.ts`), stamped onto every booking projection by the
server, and grouped on by the mentor ledger — never persisted, never a
`bookings.status` value. Crossing the deadline **does not cancel** anything and
raises no refund; it only relabels the booking and surfaces it for resolution.

> Four concepts, four vocabularies. `IN_PROGRESS` is not a booking status.
> `FAILED` / `REFUNDED` are payment statuses, not booking statuses.
> `OVERDUE` is neither a status nor a column.

## Entities — 36 public tables

Identity `profiles`, `user_roles` · catalog `segments`, `segment_topics`,
`gig_topics` · profiles `mentor_profiles`, `mentor_segments`,
`seeker_profiles`, `gigs` · availability `mentor_availability`,
`mentor_availability_exceptions` · booking `slot_holds`, `bookings`,
`reschedule_requests` · payment `payments`, `payment_events`,
`webhook_events`, `razorpay_unmatched_captures` · promotions `coupons`,
`coupon_usage` · content `session_workspaces` · support `support_tickets`,
`support_messages`, `support_attachments`, `support_audit_events` · onboarding
`mentor_applications`, `mentor_verification_documents`, `mentor_document_types`,
`mentor_application_audit` · operations `platform_config`, `audit_logs`,
`system_logs`, `system_log_retention`, `login_failure_config`,
`login_failure_trackers`.

All 36 have RLS enabled. Five storage buckets: `payment-proofs`,
`mentor-verification-documents` and `support-attachments` are private;
`payment-qr` and `segment-hero` are public by intent.

`supabase/schema.sql` is a **stub** (968 bytes). Use `supabase/migrations/` —
**53** files, applied in timestamp order. Note the `phase7*`/`phase8*` files
carry later timestamps and therefore apply last.

**The lesson from `payment-qr`:** a database object the code depends on but no
migration creates is invisible until someone builds the environment. One such
object still exists — `notifications` is in the live `supabase_realtime`
publication, added out of band. See Known Defects.

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

160 `/api/*` routes plus one SPA catch-all, all in `server.ts`. 88 are admin
routes. Auth chain: `requireAuth` → `requireAdmin` / `requireRole` /
`requireActiveMentor` → `expensiveRouteLimiter` → `validateBody` (zod).

**Nine routes sit outside `requireAuth`**, each public for a stated reason:
`GET /api/health`; `POST /api/auth/demo-login` (gated by `ENABLE_DEMO_PERSONAS`
plus a ≥32-char secret); `POST /api/auth/login-failure` and
`POST /api/auth/login-success` (bounded telemetry that can only move a counter);
`POST /api/webhooks/razorpay` (HMAC over the raw body only); and four public
discovery reads (`GET /api/seeker/segments/:slug/experience`, `…/topics`,
`…/mentors`, `GET /api/seeker/mentors/:id/profile`). The last two read through
the service role, so they re-implement the eligibility rule in TypeScript and use
an explicit column list — `SELECT *` is never used.

## Realtime

Publication `supabase_realtime` contains exactly 11 tables:
`mentor_availability`, `mentor_availability_exceptions`, `slot_holds`,
`bookings`, `gigs`, `segments`, `segment_topics`, `payments`,
`payment_events`, `webhook_events`, `notifications`.

**`notifications` is in the publication but no migration adds it.** It was added
out of band, so an environment built purely from `supabase/migrations/` would
not have it. This is the single most likely thing to bite a fresh deploy.

`REPLICA IDENTITY FULL` is set on 6 of the 11; `payments`, `payment_events`,
`webhook_events` and `segment_topics` are key-only.

`useNotificationSync` subscribes to `notifications` filtered
`user_id = eq.<uid>` — the same predicate as its RLS policy, so a subscription
cannot widen a user's reads — with a visibility-gated 60 s fallback (floor 30 s),
revalidation on focus/visibility, and channel cleanup on unmount.

**Only `AdminNotificationsPage` uses that hook.** The seeker and mentor
notification pages still read through `NotificationContext`, which polls every
30 s with **no** visibility gate. That is an inconsistency, not a design, and it
is the remaining half of the realtime work.

Other polling: availability 45 s (floor 15 s), payments 60 s (floor 30 s), all
visibility-gated; `useSessionSync` revalidates every 20 s.

## Testing

68 test files. `npm test` = `tsx --test --test-force-exit "tests/**/*.test.ts"`.
`npm run lint` = `tsc --noEmit`, clean as of 2026-10-02.

**`npm test` currently fails 2 of 1785 tests.** Both are assertions about the
*text* of a file, not about behaviour: one expects the payment-proof route
registration to be on one line, the other expects the phase 37 migration to
contain the literal `NOT t.tgenabled` where it actually uses the equivalent
`tgenabled <> 'O'`. Neither is a product defect, and the fix is to relax the
assertions — but the suite is red, so no document here claims it passes.

Three suites are regression guards written against findings that are now fixed
and must not regress: `security_containment_regression`,
`rls_coverage_regression`, `vercel_deployment_architecture`.

10 files in `scripts/`. Nine need a live Supabase project and/or a running
server and are not part of `npm test`; `verify-dist` runs inside `npm run build`.

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
- **Refunds are implemented, in two shapes.** A Razorpay refund is issued through
  the gateway by `runCreateRazorpayRefund` on cancellation. A manual UPI/QR
  refund is completed by an admin recording the external transfer, via
  `complete_manual_refund(...)` — a `SECURITY DEFINER` RPC that re-checks role,
  owner, gateway, state, amount, method and proof path **before** taking a
  `FOR UPDATE` lock, then does the transition, the event row and one notification
  in a single transaction. Two admins racing the same refund serialise; the loser
  gets `ALREADY_REFUNDED`.
- **A refund that only needs a human is never described as "initiated".** It is
  `PENDING` with `manual_refund_required = true`, and the seeker-facing notice
  says exactly that. Nothing was initiated, so nothing may claim it was.
- **An unmatched capture is durable, not lost.** A `payment.captured` event that
  matches no local `payments` row is written to `razorpay_unmatched_captures`
  *before* the webhook returns non-2xx, so Razorpay keeps redelivering and a
  duplicate delivery increments `delivery_count` on the same row rather than
  creating a second one. `reconcileUnmatchedCapture` resolves only through the
  recorded gateway identifiers, and every check is a refusal: wrong gateway, not
  capturable, already captured elsewhere, amount mismatch, currency mismatch. On
  success it reuses the normal capture path, so a reconciled payment moves
  through exactly the same guarded transitions a live webhook uses.
- **Coupons are server-priced.** The request carries a code and a booking id and
  nothing else. The base comes from the booking's own snapshot, never the live
  `gigs.price_inr`, so a price edit between hold and checkout cannot move what an
  existing booking is discounted from. `CHECK (amount_inr = base_amount_inr -
  discount_amount_inr)` makes the arithmetic a database fact.

## Time

Store UTC. Mentor availability is interpreted in the mentor's IANA timezone.
Bookings snapshot `seeker_timezone` and `mentor_timezone`. The browser clock is
never authoritative; `useSessionSync` samples the offset on every revalidation.

`pg_cron` runs **three** jobs: `expire-stale-holds-every-minute` and
`complete-expired-sessions-every-minute` (both `* * * * *`), and
`expire-stale-reschedule-requests-every-minute`. The hold and session jobs are
`service_role`-only, as are `reconcile_expired_bookings`,
`complete_expired_sessions` and the reschedule expiry function.

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

There are **no** Select, Checkbox, Switch, Tabs, Table or Dropdown primitives.
(Toast exists as a provider and hook, not as a primitive in `ui/`.) Navigation
config lives in `src/config/navigation.ts`.

`Router.tsx` is a hand-rolled `if` chain over `useNavigation().currentPath`, not
React Router. Order matters: `/mentors` is matched before `/mentor`.

## Known Defects

Open as of 2026-10-02. Detail and evidence in `docs/technical-audit.md`.

1. **`notifications` is in the realtime publication with no migration adding
   it.** A rebuild from `supabase/migrations/` alone silently loses notification
   realtime. Same class of defect as the `payment-qr` bucket, and the most
   likely to bite a fresh deploy.
2. **`npm test` fails 2 of 1785 tests.** Both are text-based assertions, not
   behaviour defects, but the suite is red and no document may claim it passes.
3. `src/types/database.ts` `BookingStatus` omits `'PAYMENT_PROCESSING'` — and
   `statusTone.ts` `BOOKING_LIFECYCLE` has only 5 entries. **Latent:** no code
   writes that value to a booking, so nothing is user-visible today.
4. `notifications.type` has **no CHECK** constraint — the phase4 constraint was
   dropped and not restored.
5. `mentor_application_audit`: the `action` CHECK **is** enforced (phase12 creates
   it; phase13's `CREATE TABLE IF NOT EXISTS` is a no-op), but phase12 and phase13
   declare `admin_user_id` and `metadata` differently, so the table shape depends
   on migration order.
6. Seeker and mentor notification pages have no realtime channel; only admin
   does. They still poll through an ungated 30 s `NotificationContext`.
7. `REPLICA IDENTITY FULL` missing on `payments`, `payment_events`,
   `webhook_events`, `segment_topics`.
8. Rate limiting is per-process, so limits multiply with instance count.
9. `razorpay_unmatched_captures` has **no admin UI**. The two reconcile routes
   work, but nothing in `src/` calls them, so an operator has to use the API or
   read `audit_logs`.
10. No sweep over `refund_status='PENDING'`, so a forgotten manual refund stays
    pending until a human looks.
11. `mentor_profiles.rating` / `review_count` are stored columns with no
    computation behind them — no reviews table, no reviews feature.
12. `src/lib/logger.ts.tmp` is an unreferenced 15 KB temp file.
13. `fetchMentorTopics` in `src/lib/mentorTopics.ts` has no importer.
14. No code splitting; single large JS bundle.

### Closed since v3.1

Do not re-investigate these; they were real and they are fixed.

| Was | Closed by |
|---|---|
| `payment-qr` bucket never created — blocked the admin QR upload on the default payment path | `20261002000000_phase27_…` |
| `GET /api/admin/bookings/overdue-links` served hardcoded fixtures and never queried the database | Rewritten to read real `bookings` via `getSupabaseAdmin()`, sharing the canonical `resolveBookingLifecycle()` resolver |
| `platform_config` had no RLS | `20261009000000_phase35_…` — admin-only `FOR ALL` policy |
| An unmatched Razorpay capture was discarded | `20261003000000_phase28_…` — durable ledger plus two reconciliation routes |
| Nothing initiated a refund | `runCreateRazorpayRefund` + `complete_manual_refund(...)` (phase 40) |
| Notifications could not be realtime | `notifications` published (out of band) + `useNotificationSync` built; participant pages are the remaining half |

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
- **Support is a request to the platform, not a channel between participants.**
  Both can open a ticket and admins answer it. There is no direct seeker ↔
  mentor messaging, and adding "chat" as a synonym for support would be wrong.

## Future Direction

Not MVP requirements, not implemented. Listed in full in `docs/prd.md` §19:
email/SMS/push, real reviews, calendar invites, video provider integration,
session recording, multi-session packages, payouts, matching, group sessions,
support SLA/macros, and a realtime support thread.

The most likely next production change is enabling Razorpay, which requires only
configuration plus a live credential check. The most likely next engineering
change is retiring the manual payment path, which should not happen before that.
