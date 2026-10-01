# Suggest Key — Technical Audit

Version: 3.1
Status: As-built / Current
Last verified: 2026-09-29

A fresh, from-scratch audit. This document is **not** an append-only log. The
previous audit (v2, 2026-09-27) was written before the Razorpay work and the
hold/cutoff change; §3 below re-evaluates every one of its findings against
current code and marks each FIXED / STILL OPEN / PARTIALLY FIXED / NO LONGER
RELEVANT.

Line numbers below were verified against the working tree on 2026-09-29.

---

## 1. Scope and Method

| Source | Inspected |
|---|---|
| `server.ts` | full 12,042-line file; 132 `app.*` registrations enumerated |
| `src/` | 190 files across `pages/`, `components/`, `context/`, `hooks/`, `lib/`, `config/`, `routes/`, `types/` |
| `supabase/migrations/` | all 38 files, applied in timestamp order |
| `tests/` | 43 test files |
| config | `package.json`, `vercel.json`, `vite.config.ts`, `tsconfig.json`, `.env.example` |
| `scripts/` | 8 operational scripts |
| git | `git log --oneline -n 25`, `git status`, `git diff` |

`npm run lint` (`tsc --noEmit`) was run and is **clean**.

`npm test` was not executed as part of this audit; the pass/fail totals in
`docs/memory.md` therefore are not restated here. Where this document needs a
test-count claim it cites the file count, which is verified.

---

## 2. System Health Summary

| Area | Assessment |
|---|---|
| Schema discipline | **Strong.** Exclusion constraints, partial unique indexes, column-level grant revocation, RLS on 27 of 28 tables, `pg_cron` reconciliation. |
| Payment integrity | **Strong.** Server-derived amounts, server-side HMAC verification, idempotent create/verify/webhook, dead-end recovery, no browser write path. |
| Booking concurrency | **Strong.** Single-RPC atomic booking; no client-side overlap logic. |
| Session time authority | **Strong.** Server clock, raw-body webhook verification, three-layer completion reconciliation. |
| Authorization | **Strong.** Uniform middleware chain, independent database enforcement, fail-closed service-role handling. |
| Observability | **Adequate.** Structured logging, sanitisation, audit log, System Health UI. |
| Type/schema agreement | **Weak in one place** — see T1. |
| Data-source hygiene | **One high-severity leak** — see D1. |
| Deployment ergonomics | **Weak in one place** — see P1. |
| Realtime completeness | **One known gap** — see R1. |

---

## 3. Re-evaluation of the v2 Audit (2026-09-27)

The v2 audit was written against commit `de1fec6`-era code and contained 17
numbered findings plus a 7-phase Razorpay migration plan. Status of each:

| v2 ref | Subject | Status now | Evidence |
|---|---|---|---|
| R1 | Reschedule calls `acquire_slot_hold` twice | **FIXED** | `acquire_slot_hold` now appears exactly once in `server.ts`, at `server.ts:2995` (reschedule). The hold route uses `create_booking_with_hold` at `server.ts:1725` and never calls it. |
| R3 | Mentor application submit writes no admin notification (`user_id: null`, error swallowed) | **FIXED** | `server.ts:10181` now calls `resolveActiveAdminIds(admin)` and passes real `userIds` to `insertPaymentNotifications`. |
| R4 | Silent fixture fallback in production | **PARTIALLY FIXED** | 15 of 16 `getLocalBookingEngineContext()` call sites in `server.ts` are now guarded by a real-database branch that returns first (e.g. `server.ts:3100`, `:8919`, `:9348`). `GET /api/admin/bookings/overdue-links` (`server.ts:3138-3152`) is the one that is not — see **D1**. |
| R7 | ~15 notification inserts ignore their error | **STILL OPEN** | Several `insert` calls are not error-checked, e.g. `server.ts:10172-10177` (`mentor_application_audit` insert has no `error` capture). |
| R8 | Reschedule is three non-atomic operations | **PARTIALLY FIXED** | The new-slot hold is acquired before any write to the original booking, so a failed hold leaves the booking untouched. The hold + booking update are still two operations, not one transaction. |
| R10 | Three overlapping token namespaces | **STILL OPEN** | `src/index.css` and `src/config/design-tokens.ts` still disagree (e.g. mentor accent `#b8860b` vs `#663af3`). See **T2**. |
| R17 | `payments` is not in the realtime publication | **FIXED** | `20260927110000_phase25_payment_foundation.sql` adds `payments`, `payment_events`, `webhook_events` to `supabase_realtime`. Publication now has 10 tables. |
| R3/type drift | `notifications.type` CHECK drift | **STILL OPEN** | `phase11` dropped `notifications_type_check`; no migration re-adds it. The column is free TEXT. See **T3**. |
| §20 | "Razorpay migration impact assessment" (proposed work) | **NO LONGER RELEVANT** | Fully implemented. 6 migrations, 5 service modules, 4 routes, 2 UI components, 9 test files. |
| §21 | "Hold 15 → 5 min change plan" (proposed) | **NO LONGER RELEVANT** | Done in `20260928000000_phase26_hold_duration_5min.sql` and `src/config/app.ts`. |
| §22 | "Adding PAYMENT_PROCESSING" (proposed) | **PARTIALLY IMPLEMENTED** | The database half landed: `bookings_status_check` includes `PAYMENT_PROCESSING` and `payments.proof_storage_path` is nullable. The **application half did not**: no code path writes `PAYMENT_PROCESSING` to a booking — it is a `payments.status` value only. See **T1**. |
| §24 | 7-phase recommended migration order | **NO LONGER RELEVANT** | Phases 0–5 are complete. Phase 6 (retire the manual path) is **not** done and is not recommended: the manual path is the live default. |
| §26 | Open questions (5 items) | **ANSWERED** | Capture goes straight to `MENTOR_PENDING` (option A chosen). Hold is 5 min. Amount is server-derived. Notification links are role-aware. **`PAYMENT_PROCESSING` is *not* used on the booking** — the v2 recommendation to adopt it there was deliberately declined in favour of holding the booking at `PAYMENT_PENDING`. |

---

## 4. Open Findings

Severity: **High** = data-integrity or revenue-path defect; **Medium** =
correctness or security weakness with a workaround; **Low** = quality,
consistency or cost.

### D1 — Admin overdue-links endpoint serves in-memory fixtures, never the database

- **Severity:** High
- **Area:** `GET /api/admin/bookings/overdue-links`
- **Evidence:** `server.ts:3138-3152` is a synchronous handler. It never calls
  `getSupabaseAdmin()`. It calls
  `getOverdueBookings(getLocalBookingEngineContext())` and returns the result.
  `getLocalBookingEngineContext()` (`src/lib/bookingService.ts:134-943`) builds
  its `BookingEngineContext` from a hardcoded array containing
  `Aman Kumar`, `Rahul Sharma`, `Ananya Patel`, `Dr. Vikram Joshi`, prices
  `999 / 1200 / 1299 / 1500`, and demo notification text such as
  `"Mentor Rahul Sharma has not provided meeting URL for BK-9022 starting in 75 minutes."`
  The sibling route `GET /api/admin/bookings` (`server.ts:3155`) does the right
  thing and reads `admin.from('bookings')`.
- **Impact:** An admin using this endpoint sees fabricated mentors, fabricated
  bookings and fabricated times. The endpoint is the operational tool for
  chasing mentors who have not added a meeting link, so the data is actively
  misleading during an incident. It is also the only place where hardcoded
  business data reaches an authenticated admin response.
- **Recommended fix:** Make the handler `async`, resolve `getSupabaseAdmin()`,
  return `503` if absent, and query real `bookings` where
  `status = 'CONFIRMED'`, `meeting_url IS NULL`, `start_time > now()`. Retire
  the fixture path entirely rather than guarding it.

### P1 — `payment-qr` storage bucket is referenced by code but never created

- **Status:** RESOLVED by
  `supabase/migrations/20261002000000_phase27_payment_qr_bucket_and_config_audit.sql`.
  Kept here so the earlier reasoning is not re-derived; the evidence and impact
  below describe the state **before** that migration.
- **Severity:** High
- **Area:** Admin platform configuration — UPI QR upload
- **Evidence:** `PAYMENT_QR_BUCKET = 'payment-qr'` is declared in
  `src/lib/paymentProof.ts:49` and used at `server.ts:205` (read),
  `server.ts:8786` (`createSignedUploadUrl`) and `server.ts:8845` (remove).
  `POST /api/admin/platform-config/qr-upload-url` (`server.ts:8745`) and
  `DELETE /api/admin/platform-config/qr` (`server.ts:8814`) are the routes.
  A search of all 38 files in `supabase/migrations/` for `payment-qr` returns
  **no matches**. The three buckets that *are* created are
  `payment-proofs` (phase4), `mentor-verification-documents` (phase12/13) and
  `segment-hero` (phase7b). The QR path format is
  `platform/payment-qr-<13 digits>-<6 hex>.<ext>`, enforced by
  `QR_PATH_PATTERN` at `server.ts:8627`.
- **Impact:** Against a database built purely from `supabase/migrations/`, the
  admin cannot upload a payment QR. The manual UPI flow is the *default*
  payment path, so this breaks the primary revenue route. The failure mode is a
  Supabase storage error, not a validated 4xx, so the admin sees a generic
  failure.
- **Recommended fix:** Add a migration creating the `payment-qr` bucket
  (`public = false`, 2 MB limit, png/jpeg/webp), plus policies: admin-only
  insert/select/delete restricted to the `platform/` folder prefix. The
  `PAYMENT_QR_MAX_BYTES = 2 * 1024 * 1024` constant in `paymentProof.ts` should
  match the bucket limit.
- **Resolution:** phase 27 creates the bucket with exactly those properties
  (`public = false`, 2 MB cap, png/jpeg/webp) and installs the admin-only
  `platform/`-prefixed policies. The `paymentProof.ts` constant already matched.
  Do not re-create this bucket in a later migration.

### T1 — `BookingStatus` in TypeScript omits `PAYMENT_PROCESSING`

- **Status:** STILL OPEN, but **latent rather than reachable** (re-evaluated
  2026-09-29; downgraded in impact only).
- **Severity:** Low (was assessed Medium when this finding was first written)
- **Area:** `src/types/database.ts:135`
- **Evidence:** `bookings_status_check` permits 8 values including
  `'PAYMENT_PROCESSING'` (added by
  `20260927110000_phase25_payment_foundation.sql`, which drops and re-adds the
  constraint). The TypeScript union at `src/types/database.ts:135` lists 7 and
  omits it. `src/components/booking/statusTone.ts:43` `BOOKING_LIFECYCLE` lists
  5 entries (`PAYMENT_PENDING`, `PENDING_VERIFICATION`, `MENTOR_PENDING`,
  `CONFIRMED`, `COMPLETED`) and likewise omits it.
  **Correction to the previous revision of this audit:** it cited
  `razorpayService.ts:546` as proof the Razorpay flow writes that value to a
  booking. That line is an **`insertPaymentEvent` payload**
  (`status: 'PAYMENT_PROCESSING'` on a `payment_events` row), not a booking
  write. `runCreateRazorpayOrder` only touches the `payments` table, and the
  module header (`razorpayService.ts:38-43`) states the rule explicitly: the
  booking deliberately stays `PAYMENT_PENDING` until capture, because
  `expire_stale_holds()` only cancels `PAYMENT_PENDING` bookings.
- **Impact:** Because no code path writes `PAYMENT_PROCESSING` to a booking, the
  value **cannot be observed in production today**, so there is no user-visible
  unstyled state. The real, present-day consequence is narrower: the TypeScript
  union is out of sync with the database constraint, and `statusTone.ts` has no
  stepper position for a status the schema allows. It becomes a live defect the
  moment any code starts using the value.
- **Recommended fix:** Add `'PAYMENT_PROCESSING'` to the `BookingStatus` union
  and add a position to `BOOKING_LIFECYCLE`. Note this is the exact change the
  v2 audit prescribed; only the database half landed.

### T2 — Two live token namespaces disagree

- **Severity:** Low
- **Area:** `src/index.css` vs `src/config/design-tokens.ts`
- **Evidence:** `src/index.css` is 97,738 bytes of Tailwind v4 CSS custom
  properties with light and `.dark` blocks — this is what the stylesheet
  applies. `src/config/design-tokens.ts` (205 lines) describes an older
  "frosted glass cathedral at midnight" palette (`midnightCanvas: '#05060f'`)
  and a `mentorTheme` with `accent: '#b8860b'`. The two do not agree: the
  violet/blue accent in `index.css` is `#663af3`, and the `mentorTheme` amber
  is not applied by the stylesheet.
- **Impact:** A developer reading `design-tokens.ts` will build against colours
  the app does not use. `AdminColorControls.tsx` and
  `AdminSegmentExperienceEditor.tsx` are the admin surfaces that write theme
  values; the source of truth for those needs to be unambiguous.
- **Recommended fix:** Delete or clearly mark `design-tokens.ts` as legacy, and
  point it at `index.css`. If any runtime code still imports it, migrate those
  call sites first.

### T3 — `notifications.type` has no CHECK constraint

- **Severity:** Low
- **Area:** `public.notifications`
- **Evidence:** `20260920000001_phase4_mvp_schema.sql` creates
  `notifications_type_check` restricting `type` to
  `('BOOKING','PAYMENT','SESSION','WORKSPACE','SYSTEM')`.
  `20260921000002_phase11_notifications.sql` runs
  `ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;`
  and re-adds none. `src/types/database.ts` `NotificationType` enumerates 7
  values.
- **Impact:** The database accepts any string. A typo in a server insert
  produces a notification the UI cannot classify, and nothing fails loudly.
- **Recommended fix:** Re-add a CHECK covering the values the server actually
  writes. Enumerate them from the `type:` literals in `server.ts` and
  `notificationService.ts` first — the union in `database.ts` is a guess, not a
  verified list.

### T4 — `mentor_application_audit.action` is unconstrained TEXT

- **Severity:** Low
- **Area:** `public.mentor_application_audit`
- **Evidence:** `20260924000000_phase12_mentor_onboarding.sql` creates the
  table with a CHECK on `action`. `20260925000000_phase13_mentor_onboarding_admin_control.sql`
  re-declares the table without it. `IF NOT EXISTS` means the phase13 body is a
  no-op on a table that already exists, so whether the CHECK survives depends
  on whether phase12 ran first — on a fresh database it does, so this is
  order-dependent behaviour rather than a clean regression.
- **Impact:** Low. The audit table is admin-readable only. The real risk is
  that the schema's shape depends on migration application order, which is not
  something a reader can determine by reading the latest migration.
- **Recommended fix:** Explicitly `DROP CONSTRAINT IF EXISTS` then `ADD
  CONSTRAINT` in a new migration, rather than relying on `CREATE TABLE IF NOT
  EXISTS` no-ops.

### S1 — `platform_config` has no row-level security

- **Severity:** Medium
- **Area:** `public.platform_config`
- **Evidence:** No migration runs `ALTER TABLE public.platform_config ENABLE
  ROW LEVEL SECURITY`. Every other table in the schema does. The phase19
  lockdown revokes `anon` on the `public` schema, so an anonymous PostgREST
  call cannot read it; but any `authenticated` role with the blanket
  `GRANT EXECUTE ON ALL FUNCTIONS` / table grants path can.
- **Impact:** The table holds the UPI id, account name and payment
  instructions. The UPI id and account name are *intended* to be public
  (the seeker needs them to pay), so the practical exposure is limited to
  `updated_at`, `updated_by` and any future column. The structural problem is
  that this table is the one place where a future secret would be exposed by
  default.
- **Recommended fix:** Enable RLS with a `SELECT` policy of `true` (public by
  design) and no `INSERT`/`UPDATE`/`DELETE` policy, so writes are
  service-role-only via the existing `/api/admin/platform-config` routes. That
  matches the actual intent and removes the "no RLS at all" anomaly.

### R1 — Notifications cannot be delivered in realtime

- **Severity:** Low
- **Area:** `public.notifications`, `NotificationContext`
- **Evidence:** The `supabase_realtime` publication contains 10 tables:
  `mentor_availability`, `mentor_availability_exceptions`, `slot_holds`,
  `bookings`, `gigs`, `segments`, `segment_topics`, `payments`,
  `payment_events`, `webhook_events`. `notifications` is **not** among them.
  `useNotificationSync.ts` has no realtime channel at all — only a
  visibility-gated 60 s interval (floor 30 s).
  Separately, `NotificationContext.tsx:48` sets an unconditional
  `setInterval(refreshNotifications, 30000)` that does **not** check
  `document.visibilityState`, unlike `useAvailabilitySync` and
  `usePaymentSync`.
- **Impact:** Worst-case notification latency is ~30 s, not instant. The
  un-gated `NotificationContext` interval means a backgrounded tab keeps
  polling every 30 s forever, which is inconsistent with the rest of the
  codebase's explicit visibility-gating discipline and wastes requests.
- **Recommended fix:** Two independent changes. (a) Add `notifications` to the
  publication, with `REPLICA IDENTITY FULL`, and filter the channel by
  `user_id = auth.uid()`; replace `useNotificationSync`'s polling with a
  realtime channel plus a longer fallback. (b) Add the same visibility gate to
  `NotificationContext`'s interval, or better, remove the duplicate polling and
  have `NotificationContext` consume the hook.

### R2 — `REPLICA IDENTITY` not set on three published payment tables

- **Severity:** Low
- **Area:** `payments`, `payment_events`, `webhook_events`
- **Evidence:** `20260926020000_phase17_realtime_availability_sync.sql` sets
  `REPLICA IDENTITY FULL` on the five availability/booking tables;
  `20261001000000_phase8a_segments_realtime.sql` does the same for
  `segments`. `20260927110000_phase25_payment_foundation.sql` adds the three
  payment tables to the publication but sets no replica identity.
- **Impact:** Without `FULL`, Postgres replicates the primary key only. A
  subscriber reading `record` for a `status` change — which is exactly what
  `usePaymentSync` needs — receives only the id. The hook therefore has to
  re-fetch the row it was told changed, turning a one-message update into two
  round trips. Functionally correct, quietly wasteful.
- **Recommended fix:** `ALTER TABLE public.payments REPLICA IDENTITY FULL;` (and
  the other two) in a new migration. Note `segment_topics` has the same gap
  and is read by `useSegmentExperienceRealtime`.

### O1 — Several notification and audit inserts ignore their error

- **Severity:** Low
- **Area:** `server.ts`
- **Evidence:** `server.ts:10172-10177` inserts into `mentor_application_audit`
  with `admin_user_id: null` and does not capture or check the returned
  `error`. The surrounding code does check errors (e.g. `appErr` at `:10092`,
  `updErr` at `:10157`), so the omission is local, not systemic.
- **Impact:** A failed audit write is invisible. For an admin-action audit trail
  that is the wrong failure mode — the action succeeds and the record does not.
- **Recommended fix:** Capture and log the error via `logSanitizer.safeMessage`
  and surface it in the `audit_logs` row, consistent with the rest of the
  handler.

### O2 — Rate limiting is per-process, not global

- **Severity:** Low
- **Area:** `server.ts`, `express-rate-limit`
- **Evidence:** The limiter is configured in-process with the default memory
  store. `vercel.json` deploys to a serverless platform where each invocation
  may be a fresh or concurrent instance.
- **Impact:** The effective limit scales with instance count. The five-failure
  login threshold that guards the account is separately enforced in the
  database via `login_failure_trackers`, so authentication is not dependent on
  this. The exposure is the expensive routes: booking hold, payment proof and
  Razorpay order creation.
- **Recommended fix:** Acceptable for the current scale. If abuse becomes real,
  move the limiter store to a shared backend rather than raising the limits.

### O3 — No code splitting

- **Severity:** Low
- **Area:** Build output
- **Evidence:** `npm run build` runs `vite build` with no
  `manualChunks`/dynamic-import configuration in `vite.config.ts`; the landing
  feature section alone is a 36 KB single file
  (`src/components/landing/LandingFeatureSection.tsx`).
- **Impact:** One large JS bundle. Vite emits a chunk-size warning. First paint
  for a seeker includes admin and mentor code that will never run.
- **Recommended fix:** Route-level `React.lazy` in `Router.tsx`. This is a
  performance task, not a correctness one, and is not a release blocker.

### O4 — `supabase/schema.sql` is a stub and will mislead

- **Severity:** Low
- **Area:** `supabase/schema.sql`
- **Evidence:** 968 bytes. It `\i`-includes only a subset of the 38 migration
  files. Anyone who applies it gets a partial schema and a cascade of confusing
  errors.
- **Impact:** Documentation and onboarding hazard. Runtime impact is nil
  because nothing executes it.
- **Recommended fix:** Replace it with a comment pointing at
  `supabase/migrations/`, or delete it. `docs/rules.md` rule V-E already
  records the intended usage.

---

## 5. What Is Strong (preserve this)

These are the properties that took real work and that a future change should not
regress. `tests/` covers each.

1. **Atomic booking.** `create_booking_with_hold()` inserts the hold, creates the
   booking, converts the hold and writes the payment in one transaction, and
   returns a `code: REASON` error string the server parses. There is no window
   in which a hold exists without a booking.
2. **Overlap prevention is a database constraint, not application logic.** Two
   `EXCLUDE USING gist` constraints. `PENDING_VERIFICATION` correctly still
   blocks the slot.
3. **Column-level privilege reduction on `bookings`.** `authenticated` can update
   only `cancellation_reason` and `updated_at`. A client physically cannot
   confirm a booking or set a meeting URL.
4. **Server-derived money.** No browser-supplied amount reaches an order or a
   capture. The Razorpay order amount comes from stored data; a mismatch is
   refused and audited.
5. **Signature verification is server-side and never logged.** The failure audit
   records the error *code* only. The webhook verifies over the raw body via a
   JSON `verify` hook, because `req.body` would fail the HMAC — a subtlety that
   is commented in place.
6. **Idempotency at all three payment entry points.** Unique order reuse,
   duplicate-tolerant verify, and `(gateway, event_id)` uniqueness on
   `webhook_events`.
7. **Dead-end capture recovery.** `recoverCaptureAgainstDeadBooking()` refuses to
   revive a cancelled booking, marks the payment `FAILED` with a reason, and
   writes a `payment_events` row.
8. **Meeting-link redaction has exactly one door.**
   `redactMeetingUrlForParticipant()` is applied to every participant-facing
   projection, and `actual_ended_at` revokes the link irrevocably. The previous
   leak — the link being readable from the bookings list at any hour, making the
   join gate decorative — is closed and commented.
9. **Filter-injection shape checks** before any PostgREST `.or()` interpolation.
   The comment explaining the exact attack is in `sessionAccess.ts`.
10. **Order expiry derived, not duplicated.** `RAZORPAY_ORDER_EXPIRY_SECONDS` is
    computed from `HOLD_DURATION_MS`, so it cannot drift from the hold window.
11. **Reconciliation returns `NULL`, not `CANCELLED`.** A subtle data-corrupting
    bug, fixed in `phase24b` and covered by tests.
12. **Once-only `SESSION_COMPLETED`.** Enforced by a partial unique index rather
    than by application logic.
13. **Fail-closed everywhere.** Missing service-role client → `503`. Unknown
    route → `NotFoundPage`. Missing booking identifier shape → refusal.
    Razorpay disabled → `503` with the manual path untouched.
14. **Error and log sanitisation** with dedicated tests (`logSanitizer`,
    `error_sanitisation`).

---

## 6. Test Coverage Map

43 test files. Clusters and the modules they guard:

| Cluster | Files | Guards |
|---|---|---|
| Razorpay | `razorpay_backend`, `razorpay_client`, `razorpay_signature`, `razorpay_state_machine`, `razorpay_store`, `razorpay_webhook_idempotency`, `razorpay_payment_safety`, `razorpay_frontend_review` | order creation, signature verification, capture, refunds, webhook idempotency, dead-end recovery, client checkout |
| Manual payment | `payment_proof` | file/mime/size/reference validation, UPI id, QR file |
| Booking | `booking_concurrency`, `bookingCutoff`, `holdDuration`, `booking_ui_invariants`, `booking_status_tone`, `mentor_confirmation` | overlap, cutoff, hold TTL, status rendering, confirmation |
| Availability | `availability`, `availability_sync` | slot generation, exceptions, realtime fallback |
| Session | `session_access` | T−5 window, redaction, join authority |
| Auth | `auth_flow`, `rate_limit` | session handling, limiter config |
| Admin | `admin_account_control`, `admin_create_user`, `admin_dashboard`, `admin_mentor_control`, `mentor_applications`, `mentor_creation_source`, `admin_notification_routing` | account status, onboarding, notification routing |
| Segment experience | `segment_experience`, `segment_experience_normalization`, `segment_experience_renderer`, `segment_dynamic_content`, `segment_hero_upload`, `seeker_experience_topics`, `seeker_experience_rebuild` | CMS payload, topics, hero upload |
| Observability | `system_health`, `system_health_dashboard`, `system_logs`, `audit_logger` | log queries, retention, audit |
| Sanitisation | `logSanitizer`, `error_sanitisation`, `api_validation` | redaction, zod schemas |
| Discovery / nav | `seeker_discovery_dates`, `seeker_header_navigation` | date handling, nav contract |

### Coverage gaps

| Gap | Note |
|---|---|
| `getLocalBookingEngineContext()` fixtures | No test asserts they are unreachable in production. This is why **D1** survived. |
| `NotificationContext` polling behaviour | Not covered, so the visibility-gate inconsistency in **R1** is unguarded. |
| `platform_config` RLS | No test asserts the absence of RLS (**S1**). |
| Admin overdue-links route | No test, and no test would have failed while it served fixtures (**D1**). |
| Slot generation for the `admin/mentors/:id/slots` path | The seeker path is covered; the admin path shares `slotEngine`. |
| `webhook_events` `processed = false` re-drive | No test covers reprocessing an event that was recorded but not processed. |

---

## 7. Risk Register

| # | Risk | Likelihood | Impact | Mitigation today |
|---|---|---|---|---|
| 1 | Admin cannot upload a payment QR (**P1**), so the default manual payment path is unusable | High on a fresh migration set | High | None. Operator must create the bucket manually. |
| 2 | Admin acts on fabricated data from overdue-links (**D1**) during an incident | Medium | High | None. |
| 3 | A `PAYMENT_PROCESSING` booking renders without a status tone (**T1**) | **Low** — the value is not written to any booking by current code | Low | Latent only. Downgraded from Medium on 2026-09-29. |
| 4 | A future column added to `platform_config` is exposed to `authenticated` (**S1**) | Low | Medium | None. |
| 5 | Notification latency up to 30 s and a permanently-polling background tab (**R1**) | Certain | Low | None. |
| 6 | Rate limit multiplied by instance count (**O2**) | Certain on serverless | Low | Database-enforced login threshold covers auth; other routes are authenticated-only. |
| 7 | Manual payment path stays the default, so admin verification is a permanent operational queue | Certain | Medium | By design for now; Razorpay is the intended exit and is already built. |
| 8 | No automated refund initiation; a cancelled post-capture booking has no self-service remedy | Medium | Medium | Manual intervention via Razorpay dashboard; the webhook records the outcome when it happens. |
| 9 | Single-bundle JS costs first paint (**O3**) | Certain | Low | None. |

---

## 8. Recommended Order of Work

Fix order is by blast radius, not by effort.

**Do first — these are correctness defects on a live path**

1. **P1** — add the `payment-qr` bucket migration. Small, unblocks the default
   payment path.
2. **D1** — rewrite `GET /api/admin/bookings/overdue-links` against the database
   and delete the fixture path.
3. **O1** — capture the `mentor_application_audit` insert error. One line, and
   it is an audit-trail gap.

**Do next — type and schema agreement**

4. **T1** — add `'PAYMENT_PROCESSING'` to `BookingStatus` and to `statusTone.ts`.
5. **T3**, **T4** — re-add the dropped CHECK constraints explicitly rather than
   relying on `CREATE TABLE IF NOT EXISTS` ordering.
6. **S1** — enable RLS on `platform_config` with a public-read, no-write policy.

**Do next — efficiency**

7. **R1** — add `notifications` to the publication with `REPLICA IDENTITY FULL`,
   and add the visibility gate to `NotificationContext`.
8. **R2** — `REPLICA IDENTITY FULL` on `payments`, `payment_events`,
   `webhook_events`, `segment_topics`.
9. **O3** — route-level `React.lazy`.
10. **O4** — replace `supabase/schema.sql` with a pointer.
11. **T2** — mark `design-tokens.ts` as legacy.

**Deliberately not recommended**

- Retiring the manual payment path. It is the live default, it works, and
  Razorpay is off by default. Removing it before Razorpay is enabled and
  verified in production would remove the platform's only working payment
  route.
- Raising the per-process rate limits in response to **O2**. Fix the store, not
  the threshold.

---

## 9. Not Verified

The following could not be confirmed from the repository alone and is **not**
asserted anywhere in this document:

| Item | Why |
|---|---|
| Which migrations are actually applied to the production database | Migrations are applied out of band; no deploy step runs them. `supabase/schema.sql` is a stub, so it cannot be used to infer state. |
| Whether `payment-qr` exists in the live project despite not being in a migration | Requires a live database query. **P1** is scoped to "built purely from `supabase/migrations/`". |
| Runtime behaviour of the Razorpay integration with `RAZORPAY_ENABLED=true` | The flag is unset here; the flow is verified by reading the code and by the 8 `razorpay_*.test.ts` files, not by execution. |
| Actual row counts, actual data, actual business metrics | No data access. |
| Whether the `pg_cron` jobs are actually scheduled in the live project | `cron.schedule` appears in migrations; live scheduling is not verifiable here. |
| Current `npm test` pass/fail totals | Not executed during this audit. `docs/memory.md` does not restate a total. |
| Line numbers in files not opened during this audit | Not stated. Every line number in this document was read. |
