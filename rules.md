# Suggest Key — Rules

Version: 3.1
Status: As-built / Current
Last verified: 2026-09-29

Every rule below is traced to the code that enforces it. Each is tagged with the
layer that owns it, because the layer determines what happens when the rule is
violated:

| Tag | Meaning | Violation result |
|---|---|---|
| **SERVER** | Express handler, service module or RPC body | Request rejected, `4xx`/`5xx` with a stable error code |
| **DATABASE** | CHECK, UNIQUE, EXCLUDE, FK, RLS policy, trigger, `pg_cron` | Statement fails, row hidden, or job corrects it |
| **FRONTEND-ONLY** | React render logic | Nothing enforced; a bypass is possible |

A rule tagged **FRONTEND-ONLY** is presentation guidance, not a control.

---

## 1. Data

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| D1 | Production shows real database data only. | SERVER | Every read goes through `/api/*` → Supabase. |
| D2 | The backend and database are the source of truth. The browser never decides bookability, price, payment state or session state. | SERVER | All four are re-derived server-side on each request. |
| D3 | Money is never taken from the browser. | SERVER | Razorpay order amount and captured amount are both server-derived from `gigs.price_inr` / `bookings.amount_inr`; a mismatch is refused and audited. |
| D4 | `supabase/migrations/` is the schema of record. `supabase/schema.sql` is a stub and is not authoritative. | — | Documentation rule. |
| D5 | Store all instants in UTC (`TIMESTAMPTZ`). Never store a local wall-clock time. | DATABASE | Column types are `TIMESTAMPTZ`. |
| D6 | Browser-local time is never authoritative for a business decision. | SERVER | The server clock decides; the client is told the offset and renders from it. |

---

## 2. Authentication and roles

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| A1 | Every `/api/*` route requires a Supabase session, except `GET /api/health` and `POST /api/webhooks/razorpay`. | SERVER | `requireAuth` middleware, `server.ts`. |
| A2 | The webhook is unauthenticated by necessity and authorised **only** by its HMAC signature over the raw body. | SERVER | `POST /api/webhooks/razorpay` verifies `RAZORPAY_WEBHOOK_SECRET`; `req.body` is never used for verification. |
| A3 | Roles come from `user_roles`, not from client state. | DATABASE | `CHECK (role IN ('seeker','mentor','admin'))`; `has_role()`/`is_admin()` are `SECURITY DEFINER` functions over the table. |
| A4 | A user may hold more than one role. | DATABASE | `UNIQUE (user_id, role)` — uniqueness is per pair, not per user. |
| A5 | Role guards compose: `requireAuth` → `requireAdmin` / `requireRole(x)` / `requireActiveMentor`. | SERVER | Middleware chain; `requireActiveMentor` also re-checks `is_active` and `approval_status` server-side. |
| A6 | A suspended or deactivated account cannot update its own profile. | DATABASE | `profiles` UPDATE policy: `id = auth.uid() AND NOT is_account_suspended(auth.uid())`. |
| A7 | Demo personas exist only when `ENABLE_DEMO_PERSONAS === 'true'` **and** `DEMO_TOKEN_SECRET` ≥ 32 chars **and** `NODE_ENV !== 'production'`. | SERVER | `isDemoAuthEnabled()`; the client also hard-refuses in production. |
| A8 | The admin demo persona additionally requires `ADMIN_PASSWORD` ≥ 12 chars. | SERVER | `POST /api/auth/demo-login`. |
| A9 | Frontend route protection is UX only. | FRONTEND-ONLY | `ProtectedRoute` redirects; the server authorizes independently. |
| A10 | A `MENTOR_PENDING`→`CONFIRMED` transition requires the mentor to own the booking. | SERVER | `confirm_booking(p_booking_id, p_meeting_url, p_mentor_id)` re-checks ownership; non-owners get `FORBIDDEN_NOT_BOOKING_OWNER`. |
| A11 | Login failures are tracked and alerted: 5 consecutive failures for one identifier within 15 minutes raises an admin alert. | DATABASE + SERVER | `record_login_failure()`; `login_failure_config` seeded `(5, 15)`. |
| A12 | Rate limiting applies to demo-login, login-failure, login-success, hold, payment-proof, Razorpay order and Razorpay verify. | SERVER | `expensiveRouteLimiter`. It is per-process, not global. |

---

## 3. Discovery

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| X1 | A mentor is discoverable only when approved **and** active **and** not suspended/deactivated **and** in at least one active segment **and** has at least one active gig **and** has a readable mentor profile. | DATABASE | `mentor_is_publicly_visible(p_mentor_id)`, used in the RLS SELECT policies on `mentor_profiles`, `gigs`, `mentor_segments`, `mentor_availability`, `mentor_availability_exceptions`. |
| X2 | The directory listing does **not** require the mentor to be bookable today. A mentor with no free slot is still listed. | FRONTEND-ONLY | `discoveryService` filtering. |
| X3 | Discovery reads only `is_active` rows. | DATABASE | `segments` SELECT policy `is_active OR is_admin()`; same predicate for topics and gigs. |
| X4 | Slots are generated on the server. The browser never invents a time. | SERVER | `GET /api/mentor-availability/slots`, `src/lib/slotEngine.ts`. |
| X5 | There is no `reviews` table. `mentor_profiles.rating` and `review_count` are stored columns with no computation behind them. | DATABASE | No review entity exists in any migration. |

---

## 4. Segments and gigs

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| S1 | Segment `name` and `slug` are unique. | DATABASE | `UNIQUE` on both. |
| S2 | Segments are ordered by `priority`. | FRONTEND-ONLY | `idx_segments_active_priority` supports the sort; the rule itself is presentation. |
| S3 | A mentor may belong to several segments; at most one is marked `is_primary`. | DATABASE | `UNIQUE (mentor_id, segment_id)` on `mentor_segments`. |
| S4 | At most one **active** gig per mentor per segment. | DATABASE | Partial unique index on `(mentor_id, segment_id) WHERE is_active`. Retired gigs stay in the table. |
| S5 | Gig duration is one of 30, 45, 60, 90 or 120 minutes. | DATABASE | `CHECK (duration_minutes IN (30,45,60,90,120))`. |
| S6 | Gig price is a non-negative integer in INR. | DATABASE | `CHECK (price_inr >= 0)`. |
| S7 | A gig cannot be linked to a topic from a different segment. | DATABASE | Trigger `enforce_gig_topic_segment_ownership` (BEFORE INSERT OR UPDATE on `gig_topics`). |
| S8 | Topic slug matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`; name 1–80 chars; description ≤ 200 chars. | DATABASE | CHECKs on `segment_topics`. |
| S9 | Only an active mentor may create or edit a gig, or write availability. | SERVER | `requireActiveMentor` middleware. |

---

## 5. Availability and slot generation

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| V1 | Mentor availability is **global across all their gigs**, not per gig. | DATABASE | `mentor_availability` has no `gig_id`. |
| V2 | Availability is recurring weekly: `day_of_week` 0–6, `start_time < end_time`. | DATABASE | CHECKs on `mentor_availability`. |
| V3 | Duplicate weekly windows for the same mentor/day are rejected. | DATABASE | `UNIQUE (mentor_id, day_of_week, start_time, end_time)`. |
| V4 | Availability is interpreted in the mentor's IANA timezone, stored per row. | DATABASE + SERVER | `mentor_availability.timezone` default `Asia/Kolkata`. |
| V5 | A date exception is one per mentor per date. An available exception must carry both times. | DATABASE | `UNIQUE (mentor_id, exception_date)`; `chk_exception_times`. |
| V6 | Exceptions override recurring availability for that date. | SERVER | `slotEngine.generateMentorSlots`. |
| V7 | A slot inside an unavailable exception is never generated. | SERVER | `slotEngine`. |
| V8 | Past slots cannot be booked. | SERVER + DATABASE | `create_booking_with_hold()` rejects against `clock_timestamp()`. |
| V9 | A slot whose start is **less than 5 minutes** away cannot be booked. | SERVER + DATABASE | `BOOKING_CUTOFF_MS = 5 min`; enforced in the RPC. *Historical: 2 hours.* |
| V10 | There is no "today only" or same-day restriction beyond V8/V9. | — | The old 2-hour advance rule is **deprecated**. |

---

## 6. Slot holds

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| H1 | A hold reserves the slot for **5 minutes**. | DATABASE | `hold_duration_interval()` reads `platform_config.hold_duration_minutes` (default 5); `acquire_slot_hold()` sets `expires_at = now() + interval`. *Historical: 15 minutes.* |
| H2 | Hold status is one of `ACTIVE`, `CONVERTED`, `EXPIRED`, `RELEASED`. | DATABASE | `CHECK (status IN ('ACTIVE','CONVERTED','EXPIRED','RELEASED'))`. |
| H3 | Two `ACTIVE` holds may never overlap for one mentor. | DATABASE | `EXCLUDE USING gist (mentor_id WITH =, tstzrange(start,end,'[)') WITH &&) WHERE status = 'ACTIVE'`. |
| H4 | Hold creation re-validates live availability at the moment of creation, not just at selection. | DATABASE | `create_booking_with_hold()` re-checks; `assertHoldStillValid()` re-checks again before the Razorpay order. |
| H5 | Only the holding seeker or an admin can insert or update a hold. | DATABASE | `slot_holds` RLS. |
| H6 | Expired holds are released every minute by cron, freeing the slot. | DATABASE | `expire-stale-holds-every-minute` → `expire_stale_holds()`. |
| H7 | Hold expiry also cancels the linked `PAYMENT_PENDING` booking. | DATABASE | `expire_stale_holds()`. |
| H8 | Hold and booking creation are one transaction, not a sequence. | DATABASE | `create_booking_with_hold()` is a single RPC. |
| H9 | A Razorpay order can never outlive the hold it pays for. | SERVER | `RAZORPAY_ORDER_EXPIRY_SECONDS` derived from `HOLD_DURATION_MS / 1000` = 300. |

---

## 7. Booking

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| B1 | `bookings.status` is one of `PAYMENT_PENDING`, `PAYMENT_PROCESSING`, `PENDING_VERIFICATION`, `MENTOR_PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `REJECTED`. | DATABASE | `bookings_status_check`. |
| B2 | Two live bookings may never overlap for one mentor. | DATABASE | `EXCLUDE ... WHERE (status NOT IN ('CANCELLED','REJECTED'))`. `PAYMENT_PROCESSING` and `PENDING_VERIFICATION` therefore still block the slot. |
| B3 | `start_time < end_time`. | DATABASE | `chk_booking_time`. |
| B4 | `meeting_url`, when present, must match `^https://`. | DATABASE | `chk_meeting_url_https`; additionally validated in the zod body schema. |
| B5 | A booking code is unique. | DATABASE | `UNIQUE (booking_code)`. |
| B6 | Only a seeker or admin can create a booking. | DATABASE | `bookings` INSERT RLS; only reachable through `create_booking_with_hold()`. |
| B7 | A client cannot change booking state. `authenticated` may update only `cancellation_reason` and `updated_at`. | DATABASE | `REVOKE UPDATE/DELETE/TRUNCATE` then `GRANT UPDATE(cancellation_reason, updated_at)` — migration `20260927070000`. |
| B8 | Booking state changes are emitted by the server as notifications so the mentor and seeker are not polling. | SERVER | `notifyMentorOfPaymentCaptured` and the notification insert helpers. |
| B9 | The booked gig, segment, mentor and seeker are frozen by `ON DELETE RESTRICT`. | DATABASE | FK actions on `bookings`. |
| B10 | `amount_inr` on the booking is snapshotted at creation and is the amount charged. | DATABASE | `CHECK (amount_inr >= 0)`. |

---

## 8. Payment

### 8.1 Manual UPI/QR — the default path

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| P1 | UPI id, QR image, payment instructions, account name and currency come from `platform_config` and are admin-managed. Nothing is hardcoded. | SERVER | `GET /api/platform-config`. |
| P2 | Only a seeker who owns the booking can submit proof for it. | SERVER | `POST /api/seeker/bookings/:id/payment-proof`, ownership check. |
| P3 | A booking is payable only in `PAYMENT_PENDING` or `PENDING_VERIFICATION`. | SERVER + CLIENT | `PAYABLE_BOOKING_STATUSES`, `isPayableBookingStatus`. |
| P4 | Proof file ≤ 5 MB. The `payment-proofs` **bucket** allows `image/jpeg`, `image/png`, `image/webp` and `application/pdf`, but the **application accepts only the three image types** — `validateProofFile` deliberately rejects `application/pdf`, because an admin must read a UTR off a screenshot. | SERVER + CLIENT | `validateProofFile` (`src/lib/paymentProof.ts`); `PAYMENT_PROOF_MIME_TYPES`; pinned by `tests/payment_proof.test.ts`. |
| P5 | Transaction reference matches `^[A-Za-z0-9_-]+$`, 4–64 characters. | SERVER + CLIENT | `normaliseTransactionReference`; zod schema. |
| P6 | Proof is stored under `<seeker_id>/…` in a private bucket. | DATABASE | `payment-proofs` storage policy: `foldername(name)[1] = auth.uid()::text`. |
| P7 | Submitting proof moves the booking `PAYMENT_PENDING` → `PENDING_VERIFICATION` and the payment to `PENDING_VERIFICATION`. | SERVER | The proof route. |
| P8 | Only an admin can approve or reject a manual payment. | SERVER | `PATCH /api/admin/payments/:id/approve` and `/reject`, both behind `requireAdmin`. |
| P9 | Rejecting requires a reason and cancels the booking. | SERVER + DATABASE | zod `paymentReject`; `review_payment(p_approve := false)`. |
| P10 | A rejected proof is retained; the seeker may submit another. | FRONTEND-ONLY | No delete path for proof objects. |
| P11 | `payments` is one row per booking. | DATABASE | `UNIQUE (booking_id)`. |
| P12 | The browser never writes `payments`. | DATABASE | `payments` UPDATE/DELETE policies are admin-only. |

### 8.2 Razorpay — implemented, off by default

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| P13 | Razorpay is active only when `RAZORPAY_ENABLED` is exactly `"true"`. Otherwise every Razorpay route returns `503` and the manual flow is untouched. | SERVER | `isRazorpayEnabled()`; `assertRazorpayUsable()`. |
| P14 | The order amount is derived on the server from stored data. A browser amount is never used. | SERVER | `toPaise(serverAmount)`. |
| P15 | The capture signature is verified **server-side** against the key secret before anything is written. | SERVER | `razorpaySignature.ts`; failure audited as `razorpay_payment_verification_failed` with only the code. |
| P16 | The key secret, webhook secret and service-role key never leave the server. Only the key id is sent to a browser. | SERVER | `GET /api/payments/razorpay/config` returns `{enabled, currency, razorpayKeyId}` and nothing else. |
| P17 | Creating an order is idempotent. A second call reuses the open order and returns `200`, not `201`. | SERVER | `runCreateRazorpayOrder`, `alreadyCreated`. |
| P18 | Verifying a capture is idempotent. A second call succeeds, sets `duplicate: true`, and does **not** notify the mentor again. | SERVER | `runVerifyRazorpayPayment`, `mentorNotified`. |
| P19 | A webhook already seen is acknowledged with `200` and not reprocessed. | DATABASE + SERVER | `UNIQUE (gateway, event_id)` on `webhook_events`. |
| P20 | A capture arriving after the booking is cancelled or rejected does not revive it. The payment is marked `FAILED` with a reason and a `payment_events` row is written. | SERVER | `recoverCaptureAgainstDeadBooking()`. |
| P21 | A failed Razorpay payment is `FAILED`; a refund outcome is `REFUNDED` or `REFUND_FAILED`. | DATABASE | `payments_status_check`; `refund_status` CHECK. |
| P22 | **Refund events are consumed, never initiated.** No endpoint creates a refund. | — | No refund-initiation route exists. |
| P23 | A Razorpay order sets the **payment** to `PAYMENT_PROCESSING` and leaves the **booking** at `PAYMENT_PENDING`; a verified capture moves the booking straight to `MENTOR_PENDING`. The booking never passes through `PAYMENT_PROCESSING`. There is no human approval step. | SERVER | `razorpayService.ts` module header (explicit design note); `markBookingMentorPending()`; `attachGatewayOrder()`. |
| P24 | The mentor is notified once, with the real payment id, so the notification link resolves. | SERVER | `notifyMentorOfPaymentCaptured({ source: 'razorpay', paymentId })`. |

---

## 9. Mentor confirmation

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| M1 | A mentor may confirm only their own booking. | SERVER | `confirm_booking()` ownership check. |
| M2 | Confirmation requires an HTTPS meeting URL. | SERVER + DATABASE | zod `mentorBookingConfirm` requires a real http(s) URL; `chk_meeting_url_https` re-checks in the database. |
| M3 | Confirmation moves the booking `MENTOR_PENDING` → `CONFIRMED` and the payment to `VERIFIED` (manual path only). | SERVER | `review_payment()` / `confirm_booking()`. |
| M4 | `MENTOR_PENDING` is the mentor's action queue. It has no timer. | — | Nothing in code moves it automatically. |

---

## 10. Session access

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| T1 | The meeting link becomes readable at **T−5 minutes** and is revoked at `end_time`. | SERVER | `isInsideSessionAccessWindow()`; `get_session_access()`; `can_join_session()`. |
| T2 | The gate is evaluated against the **server clock**, never the browser clock. | SERVER | `useSessionSync` samples `offsetMs` on every revalidation and derives `serverNow`. |
| T3 | Only the two participants and an admin can access a session. | DATABASE + SERVER | `can_join_session(p_booking_id, p_user_id)`; RLS. |
| T4 | The mentor is never redacted — the mentor supplies the link. | SERVER | `redactMeetingUrlForParticipant` short-circuits for `isMentor`. |
| T5 | Admins always see the link, for operational support. | SERVER | Same short-circuit for `isAdmin`. |
| T6 | Once a session is manually ended, the link is revoked for the seeker **irrevocably**, regardless of the T−5 window. | SERVER | `if (booking.actual_ended_at) return { ...booking, meeting_url: null }`. |
| T7 | Booking projections redacted for participants everywhere, not only on the join endpoint. | SERVER | `redactMeetingUrlForParticipant` applied to the seeker booking list and detail responses. |
| T8 | Path segments used in PostgREST equality filters are shape-checked to prevent filter injection. | SERVER | `isBookingIdShape` / `isBookingCodeShape` in `sessionAccess.ts`. |
| T9 | `end_time` passing does not itself flip the row; reconciliation does. | DATABASE | `resolve_session_state` derives the projection; `complete_expired_sessions` / `reconcile_expired_sessions` write the row. |
| T10 | Reconciliation never converts a booking to `CANCELLED`. It returns `NULL` when there is nothing to do. | DATABASE | Fixed in `20260927060000_phase24b`. |

---

## 11. Session completion

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| C1 | A session is `CONFIRMED` → `COMPLETED` when it ends, by whichever of the three layers fires first. | DATABASE + SERVER | Reactive complete, cron reconcile, read-reconcile. |
| C2 | Any of mentor, seeker or admin may end a live session. | SERVER | `POST /api/sessions/:bookingId/complete`. |
| C3 | Ending writes `actual_ended_at`, `ended_by_role` and `end_reason`. | DATABASE | `bookings_ended_by_role_check`: `ended_by_role IN ('mentor','seeker','admin')`. |
| C4 | Expired `CONFIRMED` sessions complete automatically every minute. | DATABASE | `complete-expired-sessions-every-minute`. |
| C5 | The `SESSION_COMPLETED` notification is emitted at most once per user per session. | DATABASE | Partial unique `uniq_notifications_session_completed`. |
| C6 | `actual_ended_at` is backfilled as `end_time` for rows completed before the column existed. | DATABASE | Migration `20260927100000_phase24f`. |

---

## 12. Workspace

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| W1 | One workspace per booking. | DATABASE | `UNIQUE (booking_id)`. |
| W2 | Status is `PENDING` or `PUBLISHED`. | DATABASE | `CHECK (status IN ('PENDING','PUBLISHED'))`. |
| W3 | Only the mentor (or an admin) writes the workspace. | DATABASE | `session_workspaces` INSERT/UPDATE policies. |
| W4 | The seeker reads a workspace only after it is `PUBLISHED`. | DATABASE | `SELECT (seeker_id = auth.uid() AND status = 'PUBLISHED') OR mentor_id = auth.uid() OR is_admin()`. |
| W5 | Content is mentor notes, summary, takeaways, suggestions, next steps, action items, resources and an optional follow-up recommendation. | DATABASE | JSONB columns, all `NOT NULL DEFAULT`ed except `follow_up_recommendation`. |

---

## 13. Cancellation and rescheduling

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| N1 | A seeker may cancel while `start − now >= 10 minutes`. | SERVER | `NORMAL_CANCELLATION_WINDOW_MINUTES = 10`, evaluated on the server clock. **Not 24 hours.** |
| N2 | Cancellation is only available in the pre-session statuses. | SERVER | Status check before the transition. |
| N3 | Cancellation sets `bookings.cancellation_reason`. | DATABASE | The only column a client may update on `bookings`. |
| N4 | A cancelled booking releases the slot for rebooking. | DATABASE | Exclusion predicate excludes `CANCELLED` and `REJECTED`. |
| N5 | Reschedule acquires a new hold first, then moves the booking; if the new slot cannot be held, the original booking is untouched. | SERVER | `acquire_slot_hold` is called at `server.ts:2995`, before any write to the booking. |
| N6 | A reschedule that expires mid-flight leaves the original booking intact. | DATABASE | The new hold is independent of the original booking row. |
| N7 | Mentor cancellation is a distinct, emergency path with its own reason. | SERVER | Mentor booking detail actions. |

---

## 14. Notifications

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| N8 | Notifications are stored rows, addressed to one `user_id`. | DATABASE | `notifications.user_id` FK to `profiles`, `NOT NULL`. |
| N9 | A user sees only their own notifications; an admin sees all. | DATABASE | `SELECT (user_id = auth.uid() OR is_admin())`. |
| N10 | Mark-read and mark-all-read are scoped to the caller's own rows. | DATABASE | `mark_notification_as_read(p_id, p_user_id)` and `mark_all_notifications_as_read(p_user_id)` compare `user_id` to `auth.uid()`. |
| N11 | `notifications.type` is **unconstrained TEXT**. The phase4 CHECK was dropped and never restored. | DATABASE | `src/types/database.ts` `NotificationType` is stricter than the database. |
| N12 | Notifications are in-app only. No email, SMS or push is sent. | — | No provider is integrated. |
| N13 | `notifications` is **not** in the realtime publication, so freshness is polling-only. | — | Publication has 10 tables; `notifications` is not one of them. |
| N14 | Every booking-scoped notification carries `entity_type` and `entity_id` so it links to the right row for each role. | SERVER | Rewritten in `phase20`, `phase20b`, `phase24d`. |

---

## 15. Admin operations

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| G1 | Every admin route requires `requireAuth` + `requireAdmin`. | SERVER | 79 of the 131 `/api/*` registrations are admin routes. |
| G2 | Account status is one of `active`, `suspended`, `deactivated`. | DATABASE | `CHECK` on `profiles.account_status`. |
| G3 | Suspension records who, when, until when and why. | DATABASE | `suspended_at`, `suspended_until`, `suspended_reason`, `suspended_by`, `internal_note`, `deactivated_at`. |
| G4 | Mentor approval status is one of `draft`, `pending_review`, `approved`, `rejected`. | DATABASE | `CHECK` on `mentor_profiles.approval_status`. |
| G5 | `mentor_profiles.is_active` is the discovery switch, not `is_approved`. | SERVER | `mentor_is_publicly_visible()`. `is_approved` remains in the schema as a legacy column. |
| G6 | Whether a mentor self-registered or was created by an admin is recorded. | DATABASE | `created_via IN ('public_signup','admin_direct')`, backfilled from `audit_logs`. |
| G7 | Verification documents are ≤ 5 MB and belong to an application. | DATABASE | `CHECK (size_bytes > 0 AND <= 5242880)`; `UNIQUE (application_id, document_type)`. |
| G8 | An applicant may only upload or delete documents while the application is `draft` or `rejected`. | DATABASE | `mentor-verification-documents` storage policy checks application status. |
| G9 | Required document types are platform configuration. | DATABASE | `mentor_document_types`, seeded `identity_proof`, `qualification_proof`. |
| G10 | Every sensitive admin action is written to `audit_logs`. | SERVER | `auditAction()` helper across the payment, mentor, user and session routes. |
| G11 | System and audit logs are admin-readable and admin-writable only. | DATABASE | RLS on `system_logs`, `audit_logs`, `system_log_retention`. |
| G12 | Log retention is 1–365 days, default 30. | DATABASE | `CHECK` on `system_log_retention.retention_days`. |
| G13 | Segments, topics, gigs, mentor profiles, availability, platforms settings, payments and users are all admin-editable. | SERVER | `/api/admin/*` routes. |

---

## 16. Realtime and freshness

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| R1 | The `supabase_realtime` publication contains exactly 10 tables: `mentor_availability`, `mentor_availability_exceptions`, `slot_holds`, `bookings`, `gigs`, `segments`, `segment_topics`, `payments`, `payment_events`, `webhook_events`. | DATABASE | Publication membership across four migrations. |
| R2 | `notifications` is not published. Notification freshness is polling only. | — | Verified against the publication. |
| R3 | Availability and payment hooks poll as a realtime fallback, gated on tab visibility, floored at 15 s / 30 s respectively. | FRONTEND-ONLY | `useAvailabilitySync`, `usePaymentSync`. |
| R4 | `NotificationContext` polls every 30 s with **no** visibility gate. | FRONTEND-ONLY | `NotificationContext.tsx:48`. Inconsistent with R3. |
| R5 | Session countdown revalidates every 20 s and samples the server offset on every revalidation. | SERVER + FRONTEND-ONLY | `useSessionSync`, `REVALIDATE_MS = 20_000`. |
| R6 | A backgrounded tab must not drive polling traffic. | FRONTEND-ONLY | Honoured by `useAvailabilitySync` and `usePaymentSync`; **violated** by `NotificationContext`. |

---

## 17. Security hygiene

| # | Rule | Layer | Enforcement |
|---|---|---|---|
| E1 | `anon` holds no grants on `public`, `storage` or `realtime`. | DATABASE | `phase19_security_lockdown` `REVOKE ALL … FROM anon`. |
| E2 | Storage buckets are private by default. | DATABASE | `UPDATE storage.buckets SET public = FALSE`; only `segment-hero` is public. |
| E3 | Error responses never leak raw SQL, driver messages or internal paths. | SERVER | `logSanitizer.safeMessage`, `supabaseErrors`, `respondWithInternalError`. |
| E4 | Payloads and signatures are never logged. | SERVER | Webhook and verify paths log only the error code. |
| E5 | Secrets are read lazily and never prefixed with `VITE_`. | — | `razorpayConfig.ts`, `.env.example`. |
| E6 | Service-role access is server-only, via `getSupabaseAdmin()`. | SERVER | `supabaseServer.ts`. Absent → `503`, never a silent downgrade to a weaker client. |
| E7 | Log and audit payloads are sanitised before write. | SERVER | `logSanitizer` tests. |
| E8 | The client never receives the Supabase service-role key. | — | Not present in any `VITE_` variable. |
| E9 | A booking id or code reaching a PostgREST filter must pass a shape check first. | SERVER | `isSafeBookingIdentifier`. |
| E10 | `platform_config` has **no RLS enabled**; it is protected by grant scoping and the service-role client, not by policy. | DATABASE | No `ENABLE ROW LEVEL SECURITY` for it in any migration. |

---

## 18. Development

| # | Rule | Layer |
|---|---|---|
| V-A | Lint is `tsc --noEmit`. There is no ESLint configuration in this repository. | — |
| V-B | Tests are `tsx --test tests/**/*.test.ts`. | — |
| V-C | `scripts/*.mjs` operational scripts need a live Supabase project and a running server; they are not part of `npm test`. | — |
| V-D | Never reference a seed UUID in application code. | — |
| V-E | `supabase/schema.sql` is a stub; edit migrations, not that file. | — |

---

## 19. Current Known Rule Violations

Rules the current implementation does not fully honour. Full analysis in
`docs/technical-audit.md`.

| Rule | Violation | Severity |
|---|---|---|
| R4, R6 | `NotificationContext` polls every 30 s regardless of visibility, unlike every other sync hook. | Low |
| R2 | Notification freshness cannot be realtime; `notifications` is not published. | Low |
| E10 | `platform_config` is not RLS-protected. | Medium |
| P1 | The `payment-qr` bucket referenced by the admin QR upload is never created by a migration. | High |
| B1 | `src/types/database.ts` `BookingStatus` and `statusTone.ts` `BOOKING_LIFECYCLE` both omit `'PAYMENT_PROCESSING'`. Latent — no code writes it to a booking. | Low |
| A12 | Rate limiting is per-process; the effective limit multiplies with instance count. | Low |
| N11 | `notifications.type` is free TEXT; the CHECK was dropped and not restored. | Low |
| — | `mentor_application_audit.action` is unconstrained TEXT. | Low |
| — | `GET /api/admin/bookings/overdue-links` serves in-memory fixtures with no Supabase read at all. | High |

---

## 20. Definition of Done

A change is complete when:

1. `npm run lint` (`tsc --noEmit`) is clean.
2. `npm test` passes, and any new behaviour has a test in `tests/`.
3. If it changes a rule in this document, the rule and its layer tag are updated
   here and in `docs/architecture.md` in the same change.
4. If it changes schema, a new migration is added to `supabase/migrations/` and
   the data model in `docs/architecture.md` is updated.
5. If it adds or removes an API route, the API inventory is updated.
6. If it changes a timing value, **every** document that quotes a timing value is
   updated in the same change. There is exactly one authoritative value per rule.
7. Nothing in `docs/` claims a feature that the code does not implement.
