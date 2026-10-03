# Suggest Key — Technical Audit

Version: 3.2
Status: As-built / Current
Last verified: 2026-10-02

A fresh, from-scratch audit. This document is **not** an append-only log, but it
does keep resolved findings visible with their status so that a reader who
remembers the old list does not go looking for them. §3 re-evaluates the v2 audit
(2026-09-27) and every closed v3.1 finding against current code; §4 lists what is
open today.

Line numbers below were verified against the working tree on 2026-10-02.

**Findings are marked FIXED in place, with the date they closed and the evidence
that closed them.** A FIXED finding is not deleted and is not rewritten as if it
had never happened — that is the whole point of keeping it.

---

## 1. Scope and Method

| Source | Inspected |
|---|---|
| `server.ts` | full ~14,570-line file; 160 `/api` route registrations + 1 SPA catch-all enumerated |
| `src/` | `pages/`, `components/`, `context/`, `hooks/`, `lib/`, `config/`, `routes/`, `types/` |
| `supabase/migrations/` | all 53 files, applied in timestamp order |
| live Supabase catalog | `pg_constraint`, `pg_class`, `storage.buckets`, `pg_policies`, `cron.job`, realtime publication — read directly |
| `tests/` | 68 test files + 2 helpers |
| config | `package.json`, `vercel.json`, `vite.config.ts`, `tsconfig.json`, `.env.example` |
| `scripts/` | 10 files |
| git | `git log`, `git status`, `git diff` |

`npm run lint` (`tsc --noEmit`) was run and is **clean**.

`npm test` **was** run on 2026-10-02: **1785 tests, 1783 pass, 2 fail**. Both
failures are recorded as **N1** in §4. No document in `docs/` claims a green
suite.

---

## 2. System Health Summary

| Area | Assessment |
|---|---|
| Schema discipline | **Strong.** Exclusion constraints, partial unique indexes, column-level grant revocation, RLS on all 36 tables, `pg_cron` reconciliation. |
| Payment integrity | **Strong.** Server-derived amounts, server-side HMAC verification, idempotent create/verify/webhook, a durable unmatched-capture ledger, no browser write path. |
| Booking concurrency | **Strong.** Single-RPC atomic booking; no client-side overlap logic. |
| Session time authority | **Strong.** Server clock, raw-body webhook verification, three-layer completion reconciliation. |
| Authorization | **Strong.** Uniform middleware chain, independent database enforcement, fail-closed service-role handling. |
| Refunds | **Strong.** Gateway refunds plus a `SECURITY DEFINER` manual-completion RPC that re-checks everything before locking. |
| Support | **Adequate.** Durable tickets, replies, internal notes and attachments; no SLA, no realtime thread (**O5**, **O6**). |
| Observability | **Adequate.** Structured logging, sanitisation, audit log, System Health UI. |
| Type/schema agreement | **Weak in two places** — see **T1**, **T3**. |
| Migration hygiene | **Weak in one place** — see **T4**. |
| Test suite | **Red on 2 assertions** — see **N1**. |
| Deployment ergonomics | **Adequate.** Explicit function declaration works; see **P2**. |
| Realtime completeness | **One gap remains** — see **R2**. |

---

## 3. Re-evaluation of the v2 Audit (2026-09-27)

> **Two numbering schemes are in play in this file — read the column header.**
> The left-hand column below is the **v2 audit's** numbering (R1, R3, R4, R7,
> R8, R10, R17 …). The findings in §4 use **this document's own** numbering,
> which restarts from R1 and happens to collide: v2's **R1** and **R3** are not
> §4's **R1** and **R3**, and §4's **R2** has no v2 counterpart at all.
> Cross-references *within* §4 onward are unambiguous; references inside this
> table resolve against v2.

The v2 audit was written against commit `de1fec6`-era code and contained 17
numbered findings plus a 7-phase Razorpay migration plan. Status of each:

| v2 ref | Subject | Status now | Evidence |
|---|---|---|---|
| R1 | Reschedule calls `acquire_slot_hold` twice | **FIXED** | `acquire_slot_hold` appears exactly once in `server.ts`, in the reschedule handler. The hold route uses `create_booking_with_hold` and never calls it. |
| R3 | Mentor application submit writes no admin notification (`user_id: null`, error swallowed) | **FIXED** | The submit handler resolves real admin ids and passes real `userIds` to `insertPaymentNotifications`. |
| R4 | Silent fixture fallback in production | **FIXED** | The last unguarded call site was `GET /api/admin/bookings/overdue-links`; it now reads `bookings` through `getSupabaseAdmin()`. See **D1**. |
| R7 | ~15 notification inserts ignore their error | **STILL OPEN** | See **O1**. Several inserts are still not error-checked, e.g. the seven `mentor_application_audit` inserts in `server.ts`. |
| R8 | Reschedule is three non-atomic operations | **PARTIALLY FIXED** | The new-slot hold is acquired before any write to the original booking, so a failed hold leaves the booking untouched. The hold and the booking update are still two operations, not one transaction. |
| R10 | Three overlapping token namespaces | **STILL OPEN** | `src/index.css` and `src/config/design-tokens.ts` still disagree. See **T2**. |
| R17 | `payments` is not in the realtime publication | **FIXED** | `20260927110000_phase25_payment_foundation.sql` adds `payments`, `payment_events`, `webhook_events`. The publication now has 11 tables. |
| R3/type drift | `notifications.type` CHECK drift | **STILL OPEN** | `phase11` dropped `notifications_type_check`; no migration re-adds it. The column is free TEXT. See **T3**. |
| §20 | "Razorpay migration impact assessment" (proposed work) | **NO LONGER RELEVANT** | Fully implemented. |
| §21 | "Hold 15 → 5 min change plan" (proposed) | **NO LONGER RELEVANT** | Done in `20260928000000_phase26_hold_duration_5min.sql` and `src/config/app.ts`. |
| §22 | "Adding PAYMENT_PROCESSING" (proposed) | **PARTIALLY IMPLEMENTED** | The database half landed. The **application half did not**: no code path writes `PAYMENT_PROCESSING` to a booking — it is a `payments.status` value only. See **T1**. |
| §24 | 7-phase recommended migration order | **NO LONGER RELEVANT** | Phases 0–5 are complete. Phase 6 (retire the manual path) is **not** done and is not recommended: the manual path is the live default. |
| §26 | Open questions (5 items) | **ANSWERED** | Capture goes straight to `MENTOR_PENDING`. Hold is 5 min. Amount is server-derived. Notification links are role-aware. **`PAYMENT_PROCESSING` is *not* used on the booking** — the booking deliberately stays `PAYMENT_PENDING` until capture. |

---

## 4. Open Findings

> **Numbering note.** `R1`, `R2` and `R3` in this section are *this document's*
> findings and have nothing to do with the v2 `R1` / `R3` in §3. Prefixes used
> in §4 onward: `D*` = data integrity, `T*` = type/schema agreement, `N*` = test
> suite, `R*` = realtime, `O*` = operational.

Severity: **High** = data-integrity or revenue-path defect; **Medium** =
correctness or security weakness with a workaround; **Low** = quality,
consistency or cost.

### D1 — Admin overdue-links endpoint serves in-memory fixtures, never the database

- **Status:** FIXED. `GET /api/admin/bookings/overdue-links` (`server.ts:4201`) is
  now `async`, resolves `getSupabaseAdmin()`, returns `503` when it is absent,
  and queries real `bookings` rows `status = 'MENTOR_PENDING'` with
  `meeting_url IS NULL`, ordered by `start_time`, capped at 200.
- **Severity when open:** High
- **Why it mattered:** The endpoint is the operational tool for chasing mentors
  who have not added a meeting link. It previously answered with fabricated
  mentors (`Aman Kumar`, `Rahul Sharma`, `Ananya Patel`, `Dr. Vikram Joshi`),
  fabricated prices (999/1200/1299/1500) and fabricated notification text,
  regardless of database state. It was the only place hardcoded business data
  reached an authenticated admin response.
- **Beyond the fix, the route now agrees with the rest of the product.** It calls
  the shared `resolveBookingLifecycle()` instead of carrying its own deadline
  predicate. It previously used a local `deadlineMs <= now` test that disagreed
  with the canonical strict `>` at the exact boundary instant, so an admin tool
  and the mentor's own tab could classify the same booking differently inside
  one millisecond. That second bug was only visible because the route was
  rewritten rather than patched.
- **Residual:** the fixture context in `src/lib/bookingService.ts` still exists
  for local development. It is no longer reachable from this route. See **N2**
  for the absence of a regression test.

### P1 — `payment-qr` storage bucket referenced by code but never created

- **Status:** FIXED by
  `supabase/migrations/20261002000000_phase27_payment_qr_bucket_and_config_audit.sql`.
- **Severity when open:** High
- **Why it mattered:** Against a database built purely from `supabase/migrations/`
  the admin could not upload a payment QR — and manual UPI/QR is the *default*
  payment path, so this broke the primary revenue route. The failure was a raw
  Supabase storage error rather than a validated 4xx.
- **Verified in the live project:** `payment-qr` exists, `public = true`,
  `file_size_limit = 2097152` (2 MB), `allowed_mime_types = {image/jpeg,
  image/png, image/webp}`. `PAYMENT_QR_MAX_BYTES` in `src/lib/paymentProof.ts`
  already matched the cap.
- **Do not** re-create this bucket in a later migration.

### P2 — Vercel had no function, so every API call returned the SPA shell

- **Status:** FIXED, and pinned by `tests/vercel_deployment_architecture.test.ts`.
- **Severity when open:** High
- **Why it mattered:** With `outputDirectory: dist` and a rewrite to
  `/server.cjs`, Vercel's automatic `api/` discovery produced a deployment with
  **zero functions**. The build log showed the server bundle written and no
  function builder ever running. Every `/api/*` request fell through to
  `index.html`, and the client failed with `Unexpected token '<'`. This looks
  like a server bug and is not one.
- **Fix, as recorded in `vercel.json`:** declare the function explicitly
  (`builds: [{ src: "api/index.cjs", use: "@vercel/node" }, …]`), keep the bundle
  in `api/` rather than `dist/`, rewrite `/api/:path*` to `/api`, and keep the
  negative-lookahead SPA fallback so an unreachable function cannot turn back
  into `200 text/html`.
- **Residual:** the server bundle carries no source map, because `api/` is
  packaged into the deployed function and a `.map` beside the entrypoint would
  ship backend source in the artefact. Production stack traces are therefore
  line-number-poor by design.

### T1 — `BookingStatus` in TypeScript omits `PAYMENT_PROCESSING`

- **Status:** STILL OPEN, but **latent rather than reachable** (re-evaluated
  2026-09-29; impact downgraded, not closed).
- **Severity:** Low (was Medium when first written)
- **Area:** `src/types/database.ts` `BookingStatus`
- **Evidence:** `bookings_status_check` permits 8 values including
  `'PAYMENT_PROCESSING'`. The TypeScript union lists 7 and omits it.
  `src/components/booking/statusTone.ts` `BOOKING_LIFECYCLE` lists 5 entries
  (`PAYMENT_PENDING`, `PENDING_VERIFICATION`, `MENTOR_PENDING`, `CONFIRMED`,
  `COMPLETED`) and likewise omits it.
  **Correction carried from v3.1:** an earlier revision cited
  `razorpayService.ts` as proof the Razorpay flow writes that value to a
  booking. It does not — that was an `insertPaymentEvent` payload
  (`status: 'PAYMENT_PROCESSING'` on a `payment_events` row).
  `runCreateRazorpayOrder` only touches `payments`, and the module header states
  the rule: the booking deliberately stays `PAYMENT_PENDING` until capture,
  because `expire_stale_holds()` only cancels `PAYMENT_PENDING` bookings.
- **Impact:** The value cannot be observed in production today, so there is no
  user-visible unstyled state. The present-day consequence is narrower: the
  TypeScript union is out of sync with the database constraint, and
  `statusTone.ts` has no stepper position for a status the schema allows. It
  becomes a live defect the moment any code starts writing the value.
- **Recommended fix:** Add `'PAYMENT_PROCESSING'` to the `BookingStatus` union
  and a position to `BOOKING_LIFECYCLE`.

### T2 — Two live token namespaces disagree

- **Severity:** Low
- **Area:** `src/index.css` vs `src/config/design-tokens.ts`
- **Evidence:** `src/index.css` is a large Tailwind v4 custom-property
  stylesheet with light and `.dark` blocks — this is what the app applies.
  `src/config/design-tokens.ts` describes an older palette
  (`midnightCanvas: '#05060f'`) and a `mentorTheme` with `accent: '#b8860b'`.
  The violet/blue accent in `index.css` is `#663af3`, and the mentor amber is
  not applied by the stylesheet.
- **Impact:** A developer reading `design-tokens.ts` will build against colours
  the app does not use. `AdminColorControls.tsx` and
  `AdminSegmentExperienceEditor.tsx` write theme values; the source of truth for
  those needs to be unambiguous.
- **Recommended fix:** Delete or clearly mark `design-tokens.ts` as legacy, and
  point it at `index.css`.

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
- **Impact:** The database accepts any string. A typo in a server insert produces
  a notification the UI cannot classify, and nothing fails loudly.
- **Recommended fix:** Re-add a CHECK covering the values the server actually
  writes. Enumerate them from the `type:` literals in `server.ts` and
  `notificationService.ts` first — the union in `database.ts` is a guess, not a
  verified list.

### T4 — `mentor_application_audit` table shape depends on migration order

- **Status:** STILL OPEN, but **narrower than v3.1 claimed**.
- **Severity:** Low
- **Area:** `public.mentor_application_audit`
- **Correction to v3.1:** this audit previously reported that `action` is
  **unconstrained TEXT**. That is wrong. `20260924000000_phase12` creates the
  table with the CHECK; `20260925000000_phase13`'s
  `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so an in-order
  build keeps the constraint. Verified present in the live catalog as
  `mentor_application_audit_action_check`, restricting `action` to `created`,
  `updated`, `submitted`, `approved`, `rejected`, `resubmitted`,
  `document_uploaded`, `document_reviewed`.
- **What is actually wrong:** the two migrations declare the same table
  differently. Phase12 adds a foreign key on `admin_user_id` and leaves
  `metadata` nullable; phase13 drops that FK and makes `metadata` `NOT NULL`.
  Whichever runs first wins. The live database has phase12's shape.
- **Impact:** A reader cannot determine the table shape from the latest
  migration alone, and a rebuild that applies the two files out of order would
  produce a different table from the live one.
- **Recommended fix:** `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`
  explicitly in a new migration that states the intended shape, rather than
  relying on `CREATE TABLE IF NOT EXISTS` no-ops.

### S1 — `platform_config` had no row-level security

- **Status:** FIXED by
  `20261009000000_phase35_platform_config_rls.sql`.
- **Severity when open:** Medium
- **Why it mattered:** `platform_config` was the only table in the schema with
  RLS disabled. It holds the UPI id, account name, QR object key and payment
  instructions. Phase19 revoked `anon` on the `public` schema, so an anonymous
  PostgREST call could not read it — but any role holding a table grant could.
  The structural problem was that this table is the one place where a future
  secret would be exposed by default.
- **Resolution:** RLS is enabled with one `FOR ALL` policy
  `USING (is_admin()) WITH CHECK (is_admin())` — admin-only for reads and
  writes. Note this is **stricter** than the "public read, no write" policy v3.1
  recommended: the UPI id and QR reach the browser through
  `GET /api/platform-config`, which reads through the service-role client, so a
  public-read RLS policy was unnecessary. Verified enabled in the live catalog.

### R1 — Notifications had no realtime delivery

- **Status:** MOSTLY FIXED. Re-evaluated 2026-10-02.
- **Severity when open:** Low
- **What was true before:** the publication did not contain `notifications`, and
  `useNotificationSync` had no channel at all — only a visibility-gated 60 s
  interval. `NotificationContext.tsx` additionally ran an unconditional
  `setInterval(refreshNotifications, 30000)` with no visibility gate.
- **What is true now:**
  - `notifications` **is** in the live `supabase_realtime` publication.
  - `useNotificationSync` opens a per-user channel
    (`supabase.channel('notifications:' + userId)`) subscribed to
    `postgres_changes` on `public.notifications` with the filter
    `user_id=eq.<uid>`; it listens for `*` events, revalidates on `focus` and
    `visibilitychange`, skips its interval while the document is hidden, and
    removes the channel and both listeners on unmount.
  - The channel filter is the same predicate as the `notifications` RLS policy,
    so a subscription cannot widen what a user may read.
  - `AdminNotificationsPage` consumes the hook.
- **What is still open:**
  1. **No migration adds `notifications` to the publication.** It was added out
     of band. A rebuild from `supabase/migrations/` alone would not reproduce the
     live publication. This is now the largest realtime gap — see **R2**.
  2. **The seeker and mentor notification pages still use
     `NotificationContext`**, so they poll every 30 s and are not
     visibility-gated. The server-side capability exists and works; those two
     pages have simply not been migrated to it.
- **Recommended fix:** one migration adding `notifications` to the publication
  with `REPLICA IDENTITY FULL`, then move both participant pages onto
  `useNotificationSync` and delete the duplicate interval.

### R2 — Realtime publication is not reproducible from migrations

- **Status:** OPEN (new in v3.2)
- **Severity:** Medium
- **Area:** `supabase_realtime` publication, `supabase/migrations/`
- **Evidence:** the live publication has 11 tables. Ten are added by migrations;
  `notifications` is added by none. Verified by enumerating the live catalog and
  by searching all 53 migration files.
- **Impact:** A fresh environment built purely from `supabase/migrations/`
  silently loses notification realtime. This is the same class of bug as P1 —
  code depends on a database object that no migration creates — and it is
  invisible until someone builds the environment and wonders why notifications
  are 60 s late.
- **Recommended fix:** `ALTER PUBLICATION supabase_realtime ADD TABLE
  public.notifications;` plus `ALTER TABLE public.notifications REPLICA IDENTITY
  FULL;` in a new migration.

### R3 — `REPLICA IDENTITY` not set on three published payment tables

- **Severity:** Low
- **Area:** `payments`, `payment_events`, `webhook_events`
- **Evidence:** `20260926020000_phase17_realtime_availability_sync.sql` sets
  `REPLICA IDENTITY FULL` on the five availability/booking tables;
  `20261001000000_phase8a_segments_realtime.sql` does the same for
  `segments`. `20260927110000_phase25_payment_foundation.sql` adds the three
  payment tables to the publication but sets no replica identity.
- **Impact:** Without `FULL`, Postgres replicates the primary key only. A
  subscriber reading `record` for a `status` change — exactly what
  `usePaymentSync` needs — receives only the id and must re-fetch the row,
  turning a one-message update into two round trips. Functionally correct,
  quietly wasteful.
- **Recommended fix:** `ALTER TABLE public.payments REPLICA IDENTITY FULL;` (and
  the other two) in a new migration. `segment_topics` has the same gap and is
  read by `useSegmentExperienceRealtime`.

### N1 — Two tests assert on file text, and both fail

- **Status:** OPEN (new in v3.2)
- **Severity:** Low for the product, **Medium for trust in the suite**
- **Evidence:** `npm test` on 2026-10-02 → **1785 tests, 1783 pass, 2 fail**.

  | Test | Assertion | Why it fails |
  |---|---|---|
  | `refund_completion.test.ts` → "U. the seeker payment-proof flow is unchanged" | `server.ts` matches `/app\.post\('\/api\/seeker\/bookings\/:id\/payment-proof'/` | The route exists and is correct at `server.ts:2693`, but it is registered across multiple lines (`app.post(` then the path on the next line), so a same-line regex cannot match it. |
  | `workspace_identity_regression.test.ts` → "fails loudly if either trigger did not install" | the phase 37 migration matches `/NOT t\.tgenabled/` | The migration guards disabled triggers with `tgenabled <> 'O'`, which is the correct Postgres enum comparison. Equivalent meaning, different text. |

- **Impact:** **Neither is a behaviour defect.** The seeker payment-proof flow is
  unchanged, and both phase 37 identity triggers (`trg_bookings_offer_identity`,
  `trg_session_workspaces_participant_identity`) are installed and enabled. But a
  red suite is a red suite: it trains reviewers to ignore failures, and it means
  "tests pass" can no longer be claimed in any document — which is why no `docs/`
  file asserts a green suite.
- **Recommended fix:** Relax both assertions to match on structure rather than
  line layout and exact wording. Do not change product code to satisfy them.

### N2 — The fixture path has no regression guard

- **Status:** OPEN (carried from the v3.1 coverage-gap table)
- **Severity:** Medium
- **Area:** `src/lib/bookingService.ts` `getLocalBookingEngineContext()`
- **Evidence:** D1 was a production-serving fixture that survived because no test
  asserted the production routes were unreachable from it. D1 is now fixed, but
  nothing prevents the next one.
- **Recommended fix:** a test that asserts no `requireAuth`-protected route
  returns `getLocalBookingEngineContext()` output without first calling
  `getSupabaseAdmin()`. `tests/booking_overdue_lifecycle.test.ts` already asserts
  the overdue-links route agrees with the canonical resolver at the boundary —
  extend that file rather than starting a new one.

### O1 — Several notification and audit inserts ignore their error

- **Severity:** Low
- **Area:** `server.ts`
- **Evidence:** seven `admin.from('mentor_application_audit').insert({...})` calls
  (e.g. `server.ts:12574`) discard the returned `error` entirely. The surrounding
  handlers do check errors, so the omission is local, not systemic.
- **Impact:** A failed audit write is invisible. For an admin-action audit trail
  that is the wrong failure mode — the action succeeds and the record does not.
- **Recommended fix:** Capture the destructure `{ error }` and log via
  `logSanitizer.safeMessage`, consistent with the rest of the handler.

### O2 — Rate limiting is per-process, not global

- **Severity:** Low
- **Area:** `server.ts`, `express-rate-limit`
- **Evidence:** the limiter uses the default in-process memory store, on a
  serverless platform where each invocation may be a fresh or concurrent
  instance.
- **Impact:** The effective limit scales with instance count. The five-failure
  login threshold that guards the account is separately enforced in the database
  via `login_failure_trackers`, so authentication does not depend on this. The
  exposure is the expensive routes: booking hold, payment proof and Razorpay
  order creation.
- **Recommended fix:** Acceptable at current scale. If abuse becomes real, move
  the limiter store to a shared backend rather than raising the limits.

### O3 — No code splitting

- **Severity:** Low
- **Area:** Build output
- **Evidence:** `vite.config.ts` has no `manualChunks` or dynamic-import
  configuration.
- **Impact:** One large JS bundle; Vite emits a chunk-size warning. First paint
  for a seeker includes admin and mentor code that will never run.
- **Recommended fix:** Route-level `React.lazy` in `Router.tsx`. Performance, not
  correctness; not a release blocker.

### O4 — `supabase/schema.sql` is a stub and will mislead

- **Severity:** Low
- **Area:** `supabase/schema.sql`
- **Evidence:** 968 bytes. It `\i`-includes only a subset of the migration files.
  Anyone who applies it gets a partial schema and a cascade of confusing errors.
- **Impact:** Onboarding hazard. Runtime impact is nil because nothing executes
  it.
- **Recommended fix:** Replace it with a comment pointing at
  `supabase/migrations/`, or delete it.

### O5 — Support is synchronous and text-first

- **Severity:** Low
- **Area:** support tables and RPCs
- **Evidence:** phase 41 gives the system real durability — four tables, ten
  RPCs, ten routes, RLS, a private bucket — but a ticket has no SLA timer, no
  assignment queue beyond a single `assigned_admin_id`, no canned responses, no
  macros, no merge and no escalation.
- **Recommended fix:** Out of scope until there is real volume. Not a defect.

### O6 — No realtime support thread

- **Severity:** Low
- **Area:** `support_tickets`, `support_messages`
- **Evidence:** a ticket updates when its page loads or refreshes. A reply
  arriving in another tab is not pushed. The in-app notification reaches the
  other party, but the open conversation does not live-update.
- **Recommended fix:** Add `support_tickets` and `support_messages` to the
  publication in the same migration that fixes **R2**, then subscribe the thread
  view.

---

## 4a. Also verified since v3.1 (no action needed)

These were checked because earlier documents claimed otherwise, and are now
correct. They are listed so nobody re-investigates them.

| Claim previously wrong | Reality |
|---|---|
| Refunds are unimplemented | `runCreateRazorpayRefund` issues gateway refunds; `complete_manual_refund(...)` records manual ones (phase 40). |
| Coupons are unimplemented | `coupons` + `coupon_usage` exist with server-side price snapshotting and enforced arithmetic (phase 39). |
| Support is unimplemented | Four tables, ten RPCs, ten routes, admin + participant pages. |
| `bookings` has one amount column | `base_amount_inr`, `discount_amount_inr`, `amount_inr`, `original_amount_inr` with `CHECK (amount_inr = base_amount_inr - discount_amount_inr)`. |
| An unmatched Razorpay capture is lost | `razorpay_unmatched_captures` persists it before the webhook returns non-2xx (phase 28), with two admin reconciliation routes. |
| Storage has 3 buckets | Five: `payment-proofs`, `mentor-verification-documents`, `payment-qr`, `segment-hero`, `support-attachments`. |
| The admin sidebar has 12 items | Thirteen. |
| `npm start` runs `node dist/server.cjs` | `npm start` is `tsx server.ts`; the bundle is `api/index.cjs`. |

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
   refused and audited. Coupons extend this: the request carries a code and a
   booking id and nothing else, and
   `CHECK (amount_inr = base_amount_inr - discount_amount_inr)` makes the
   arithmetic a database fact.
5. **Signature verification is server-side and never logged.** The failure audit
   records the error *code* only. The webhook verifies over the raw body via a
   JSON `verify` hook, because `req.body` would fail the HMAC.
6. **Idempotency at all three payment entry points.** Unique order reuse,
   duplicate-tolerant verify, and `(gateway, event_id)` uniqueness on
   `webhook_events`. Unmatched captures upsert on
   `(gateway, razorpay_payment_id)` and increment a delivery counter.
7. **Dead-end capture recovery.** `recoverCaptureAgainstDeadBooking()` refuses to
   revive a cancelled booking, marks the payment `FAILED` with a reason, and
   writes a `payment_events` row.
8. **Meeting-link redaction has exactly one door.**
   `redactMeetingUrlForParticipant()` is applied to every participant-facing
   projection, and `actual_ended_at` revokes the link irrevocably.
9. **Filter-injection shape checks** before any PostgREST `.or()` interpolation.
10. **Order expiry derived, not duplicated.** `RAZORPAY_ORDER_EXPIRY_SECONDS` is
    computed from `HOLD_DURATION_MS`, so it cannot drift from the hold window.
11. **Reconciliation returns `NULL`, not `CANCELLED`.** A subtle data-corrupting
    bug, fixed in `phase24b` and covered by tests.
12. **Once-only `SESSION_COMPLETED`.** Enforced by a partial unique index rather
    than by application logic.
13. **Fail-closed everywhere.** Missing service-role client → `503`. Unknown
    route → `NotFoundPage`. Missing booking identifier shape → refusal.
    Razorpay disabled → `503` with the manual path untouched.
14. **Error and log sanitisation** with dedicated tests.
15. **Manual refund completion re-checks in the database, not the route.**
    `complete_manual_refund(...)` is `SECURITY DEFINER`, re-verifies the admin
    role, owner, gateway, state, amount, method and proof path before taking the
    lock, then does the transition, the event row and the notification in one
    transaction. Two admins racing the same refund serialise; the loser gets
    `ALREADY_REFUNDED`.
16. **Support is durable, not in-memory.** Tickets, replies, internal notes and
    attachments are all in Postgres with RLS; internal notes are filtered out of
    every non-admin read; the resolution body is a database CHECK, not a UI rule.
17. **The deployment contract is pinned by a test.**
    `tests/vercel_deployment_architecture.test.ts` boots the built entrypoint the
    way the Vercel runtime does, so the "function must exist and be declared"
    lesson cannot be relearned by accident.

---

## 6. Test Coverage Map

68 test files. Clusters and the modules they guard:

| Cluster | Files | Guards |
|---|---|---|
| Razorpay | `razorpay_backend`, `razorpay_client`, `razorpay_signature`, `razorpay_state_machine`, `razorpay_store`, `razorpay_webhook_idempotency`, `razorpay_payment_safety`, `razorpay_frontend_review`, `razorpay_readiness_audit`, `razorpay_unmatched_capture` | order creation, signature verification, capture, refunds, webhook idempotency, dead-end recovery, client checkout, unmatched captures |
| Manual payment / refunds | `payment_proof`, `refund_completion` | file/mime/size/reference validation, UPI id, QR file, manual refund recording |
| Coupons | `coupon_system` | price snapshot arithmetic, usage limits, targeting, RPC grants |
| Booking | `booking_concurrency`, `booking_overdue_lifecycle`, `bookingCutoff`, `holdDuration`, `meetingLinkDeadline`, `booking_ui_invariants`, `booking_status_tone`, `mentor_confirmation`, `reschedule_request` | overlap, cutoff, hold TTL, overdue lifecycle, status rendering, confirmation, rescheduling |
| Availability | `availability`, `availability_sync`, `availability_realtime_sync`, `thursday_slot_timezone` | slot generation, exceptions, realtime subscription contract, timezone edges |
| Session | `session_access` | T−5 window, redaction, join authority |
| Auth | `auth_flow`, `rate_limit` | session handling, limiter config, demo-auth fail-closed |
| Admin | `admin_account_control`, `admin_create_user`, `admin_dashboard`, `admin_mentor_control`, `admin_payment_view`, `mentor_applications`, `mentor_creation_source`, `admin_notification_routing` | account status, onboarding, payment projection, notification routing |
| Support | `support_center` | statuses, transitions, categories, permissions |
| Segment experience | `segment_experience`, `segment_experience_normalization`, `segment_experience_renderer`, `segment_dynamic_content`, `segment_hero_upload`, `segment_gig_context`, `segment_mentor_card_intent`, `seeker_experience_topics`, `seeker_experience_rebuild` | CMS payload, topics, hero upload, card semantics |
| Workspaces | `workspace_publish`, `workspace_publish_regression`, `workspace_identity_regression`, `workspace_offer_resolution` | publish permissions, phase 37 identity triggers, offer resolution |
| Security regressions | `security_containment_regression`, `rls_coverage_regression`, `route_contract`, `api_validation_coverage` | grants, RLS coverage, route contracts, validation completeness |
| Observability | `system_health`, `system_health_dashboard`, `system_logs`, `audit_logger` | log queries, retention, audit |
| Sanitisation | `logSanitizer`, `error_sanitisation`, `api_validation` | redaction, zod schemas |
| Deployment | `vercel_deployment_architecture` | function declaration, rewrite order, artefact layout |
| Discovery / nav | `seeker_discovery_dates`, `seeker_header_navigation`, `mentor_discovery_navigation`, `mentor_directory_scope`, `public_mentor_profile` | date handling, nav contract, eligibility predicates |

### Coverage gaps

| Gap | Note |
|---|---|
| `getLocalBookingEngineContext()` fixtures | No test asserts they are unreachable from a production route. This is why **D1** survived for as long as it did. See **N2**. |
| `NotificationContext` polling behaviour | Not covered, so the visibility-gate inconsistency in **R1** is unguarded. |
| Unmatched-capture admin UI | No test can fail, because no UI exists — the routes are exercised only at the service layer. |
| Slot generation for the `admin/mentors/:id/slots` path | The seeker path is covered; the admin path shares `slotEngine`. |
| `webhook_events` `processed = false` re-drive | No test covers reprocessing an event that was recorded but not processed. |

---

## 7. Risk Register

| # | Risk | Likelihood | Impact | Mitigation today |
|---|---|---|---|---|
| 1 | Notification realtime is not reproducible from migrations (**R2**), so a fresh environment silently degrades to 60 s polling | High on any rebuild | Medium | None. |
| 2 | A fixture-context leak returns to production (**N2**) | Low | High | Only the observation of the 2026-10-02 audit. |
| 3 | `npm test` is red (**N1**) and "tests pass" can no longer be claimed | **Certain** | Medium | The two failures are understood and triaged; no document asserts a green suite. |
| 4 | A `PAYMENT_PROCESSING` booking renders without a status tone (**T1**) | **Low** — the value is not written to any booking by current code | Low | Latent only. |
| 5 | Notification latency up to 30 s and a permanently-polling background tab on seeker/mentor pages (**R1**) | Certain | Low | Admin page already migrated; the hook exists for the other two. |
| 6 | Rate limit multiplied by instance count (**O2**) | Certain on serverless | Low | Database-enforced login threshold covers auth; other routes are authenticated-only. |
| 7 | Manual payment path stays the default, so admin verification is a permanent operational queue | Certain | Medium | By design; Razorpay is the intended exit and is already built. |
| 8 | A cancelled post-capture manual booking has no self-service remedy; it needs a human | Certain for manual payments | Medium | Razorpay refunds go through the gateway; manual refunds are queued and completed by an admin recording the external transfer. Still no reconciliation job over `refund_status='PENDING'`. |
| 9 | An unmatched capture sits `PENDING` with no UI to surface it | Medium | Medium | The ledger is durable and `audit_logs` records the event, but reconciliation is API-only. |
| 10 | Single-bundle JS costs first paint (**O3**) | Certain | Low | None. |

---

## 8. Recommended Order of Work

Fix order is by blast radius, not by effort.

**Do first**

1. **N1** — relax the two brittle assertions so the suite is green again. Smallest
   change with the clearest payoff: it restores the ability to say "tests pass".
2. **R2** — add `notifications` to the publication in a migration. One-line fix
   for a real rebuild defect.
3. **N2** — add the regression test that no protected route can serve fixtures.

**Do next — type, schema and audit integrity**

4. **T1** — add `'PAYMENT_PROCESSING'` to `BookingStatus` and `statusTone.ts`.
5. **T3** — re-add the dropped `notifications.type` CHECK, enumerated from what
   the server actually writes.
6. **T4** — state the intended `mentor_application_audit` shape explicitly rather
   than relying on `CREATE TABLE IF NOT EXISTS` ordering.
7. **O1** — capture the seven `mentor_application_audit` insert errors.

**Do next — realtime and efficiency**

8. **R1** — move the seeker and mentor notification pages onto
   `useNotificationSync` and delete the ungated duplicate interval.
9. **R3** — `REPLICA IDENTITY FULL` on `payments`, `payment_events`,
   `webhook_events`, `segment_topics`.
10. **O3** — route-level `React.lazy`.
11. **O4** — replace `supabase/schema.sql` with a pointer.
12. **T2** — mark `design-tokens.ts` as legacy.

**Deliberately not recommended**

- Retiring the manual payment path. It is the live default, it works, and
  Razorpay is off by default. Removing it before Razorpay is enabled and
  verified in production would remove the platform's only working payment route.
- Raising the per-process rate limits in response to **O2**. Fix the store, not
  the threshold.
- An SLA timer or macro system for support (**O5**). Not a defect; premature.

---

## 9. Not Verified

The following could not be confirmed from the repository alone and is **not**
asserted anywhere in this document:

| Item | Why |
|---|---|
| Whether the deployed Vercel project currently matches this `vercel.json` | The configuration is correct and the contract is test-pinned, but the live deployment was not inspected. |
| Runtime behaviour of the Razorpay integration with `RAZORPAY_ENABLED=true` | The flag is unset here; the flow is verified by reading the code and by the `razorpay_*.test.ts` files, not by execution. |
| Actual row counts, actual data, actual business metrics | The live **schema** was read; live **data** was not. |
| Production stack-trace usefulness | The bundle deliberately ships without a source map (see **P2**), so this cannot be assessed. |
| Line numbers in files not opened during this audit | Not stated. Every line number in this document was read. |
