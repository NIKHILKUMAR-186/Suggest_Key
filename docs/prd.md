# Suggest Key — Product Requirements Document

Version: 3.1
Status: As-built / Current
Last verified: 2026-09-29

Describes the product as it exists today. Current MVP and planned work are kept
strictly separate, and every capability carries an explicit status label.

Status labels used below:

| Label | Meaning |
|---|---|
| **Implemented** | Present in the code and reachable by a real user |
| **Partially implemented** | Present, but incomplete or inconsistent |
| **Planned** | Not in the code. Intent exists, no implementation |
| **Not implemented** | Deliberately out of scope for the MVP |
| **Deprecated** | Was implemented; removed or replaced |

---

## 1. Product

Suggest Key is an India-focused 1:1 mentorship marketplace. A seeker discovers
an approved mentor in a domain, books one of that mentor's published time
slots, pays, attends, and reads a mentor-authored post-session workspace.

**Positioning:** curated, mentor-authored, one-to-one. Not a directory of
chatbots, not a course platform, not a group-class product.

**Currency:** INR throughout. Amounts are integers; no paise are stored.
**Default timezone:** `Asia/Kolkata`, overridable per user, per mentor
availability row, and snapshotted per booking.

---

## 2. Core MVP Loop

```text
Discover mentor  →  Pick slot  →  Hold (5 min)  →  Pay  →  Mentor confirm
                                                                  │
      Read workspace  ←  Complete  ←  Join (T−5)  ←────────────────┘
```

Payment is a **fork** in this loop, not a single step:

```text
Pay ─┬─ manual UPI/QR  → submit proof → admin verifies → MENTOR_PENDING
     └─ Razorpay       → checkout      → server verifies capture ──┘
```

The manual branch requires a human. The Razorpay branch does not.

---

## 3. Roles

Three roles, held in `user_roles` with `CHECK (role IN ('seeker','mentor','admin'))`.
A user may hold more than one.

| Role | Product job |
|---|---|
| **Seeker** | Find a mentor, book, pay, attend, read takeaways |
| **Mentor** | Publish gigs and availability, accept, conduct, document |
| **Admin** | Verify, moderate, operate, and see everything |

### 3.1 Seeker — **Implemented**

- Landing page, mentor directory, mentor list, mentor detail
- Segment experience pages (CMS-driven content per domain)
- Slot selection by date
- Booking creation with a 5-minute hold
- Payment: manual UPI/QR proof, or Razorpay when enabled
- Booking list (upcoming / history / cancelled) and booking detail
- Cancel and reschedule, subject to the 10-minute window
- Session page with countdown, T−5 join, and manual end
- Notifications list, unread count, mark-read, mark-all-read
- Settings: profile, timezone, password

### 3.2 Mentor — **Implemented**

- Onboarding: application draft → submit → document upload
- Verification page (public route, gated by the API)
- Home with attention queue and metrics
- Gig CRUD, including topic tagging
- Segment membership request
- Recurring weekly availability and date exceptions
- Booking list and booking detail
- Confirm a booking with an HTTPS meeting link
- Run the session; end it manually
- Author and publish a session workspace
- Notifications and settings

### 3.3 Admin — **Implemented**

- Operations dashboard
- User management: list, detail, create, suspend, deactivate, password reset,
  resend invite
- Mentor management: list, detail, approve, reject, toggle active, profile,
  gigs, availability, segments, audit trail
- Mentor verification queue: application review and per-document review
- Segment CMS: CRUD, priority, active toggle, mentor and gig assignment, hero
  image upload, topic CRUD, experience-config editor with live preview
- Bookings ledger and overdue-meeting-link view
- Payment queue: approve / reject manual payments
- Workspace oversight
- Notification dispatch
- Platform settings: UPI id, QR image, instructions, account name, currency,
  hold duration
- System health: metrics, logs, errors, auth logs, audit logs, retention
  policy, prune

**Not implemented for admin:** refunds. Admin can observe refund outcomes
arriving from the Razorpay webhook, but nothing in the product initiates one.

---

## 4. Navigation — **Implemented**

Defined once in `src/config/navigation.ts` and rendered by
`TopNavigation.tsx` (seeker, mentor) or `AdminSidebar.tsx` (admin).

| Role | Items | Shell |
|---|---|---|
| Seeker | Home, My Bookings, Notifications, Settings (4) | top nav |
| Mentor | Home, My Bookings, Availability, Notifications, Settings (5) | top nav |
| Admin | Dashboard, Users, Mentors, Mentor Verification, Segments, Bookings, Workspaces, Payments, Notifications, System Health, Settings (11) | sidebar |

Routable but not in the nav config: `/mentor/gigs`, `/mentor/segments`
(mentor, reached in-page), `/admin/users/create`, `/admin/system-health/logs`
(admin, reached in-page).

`src/config/navigation.ts` carries a comment naming
`SUGGEST-KEY-MVP-UPDATED.md` §4 as its source of truth. That section is kept in
sync with this table.

---

## 5. Discovery — **Implemented**

- A mentor appears in discovery only when **approved and active and not
  suspended/deactivated and in at least one active segment and holding at least
  one active gig**, enforced by the database function
  `mentor_is_publicly_visible()` inside the RLS policies.
- The directory does **not** require bookability today. A mentor with no free
  slot is still listed; availability is a detail-page concern.
- Slots are generated on the server only, from recurring availability minus
  exceptions minus bookings minus active holds minus the past minus the
  5-minute cutoff. The browser never invents a time.

### 5.1 Ratings — **Partially implemented**

`mentor_profiles.rating` (default 5.00) and `review_count` (default 0) exist
as stored columns. **There is no reviews table, no review submission flow and
no review computation anywhere in the product.** Every new mentor therefore
displays an unearned 5.00. Either reviews get built or the rating stops being
displayed. Tracked in `docs/data-source-audit.md` F3.

---

## 6. Segments, Topics and the Segment Experience — **Implemented**

- `segments`: unique name and slug, `priority`, `is_active`
- `segment_topics`: per-segment topic taxonomy, unique slug per segment,
  validated name/slug/description lengths
- `gig_topics`: links a gig to a topic; a trigger forbids linking a topic from
  a different segment than the gig's
- `segments.experience_config`: a JSONB CMS payload (hero, quickHelp,
  journeySteps, benefits, faq, cta) that drives a distinct seeker-facing
  experience per domain, with its own theme, colours and iconography
- `segment-hero` storage bucket: public read, admin write

Admin authors the experience in
`AdminSegmentExperienceEditor.tsx` with a live preview in
`AdminExperiencePreview.tsx`. The seeker renders it through
`SegmentExperienceRenderer.tsx` under `SegmentExperienceContext` and
`SegmentThemeContext`, and it updates live via
`useSegmentExperienceRealtime`.

---

## 7. Gigs — **Implemented**

- One active gig per mentor per segment (partial unique index; retired gigs are
  kept, not deleted)
- Duration is one of 30 / 45 / 60 / 90 / 120 minutes
- Price is a non-negative integer INR
- A gig carries a title, description, and optional topic tags
- CRUD is available to the owning mentor (gated on being an active mentor) and
  to an admin

---

## 8. Availability — **Implemented**

- **Recurring weekly windows**, per mentor, `day_of_week` 0–6, `start_time <
  end_time`, an IANA timezone per row, with a uniqueness constraint on
  `(mentor, day, start, end)`.
- **Date exceptions**, one per mentor per date. An available exception must
  carry both times; an unavailable one must not.
- Availability is **global to the mentor**, not per gig. A mentor's weekly
  windows gate every gig they sell.
- The mentor owns the timeline. There is no admin override of a mentor's
  availability beyond the admin editor, which writes the same rows.

---

## 9. Booking and Holds — **Implemented**

| Rule | Value | Enforced by |
|---|---|---|
| Hold duration | **5 minutes** | `platform_config.hold_duration_minutes` via `hold_duration_interval()` |
| Booking cutoff | **5 minutes** before start | `create_booking_with_hold()` against `clock_timestamp()` |
| Overlap, holds | forbidden per mentor | `EXCLUDE … WHERE status = 'ACTIVE'` |
| Overlap, bookings | forbidden per mentor | `EXCLUDE … WHERE status NOT IN ('CANCELLED','REJECTED')` |
| Booking creation | one transaction | `create_booking_with_hold()` RPC |

- Booking creation is a **single RPC** that inserts the hold, creates the
  booking, converts the hold and writes the payment row together. There is no
  window in which a hold exists without a booking.
- An expiring hold frees the slot and cancels the linked unpaid booking, every
  minute, via `pg_cron`.
- Booking codes are unique and short; booking ids are UUIDs. Both are
  shape-checked before reaching a PostgREST filter.

**Deprecated:** a 15-minute hold and a 2-hour minimum advance-booking notice.
Both were replaced; neither exists in code.

### 9.1 Booking states — **Implemented**

Eight values permitted by `bookings_status_check`; **seven are reachable in the
current code**.

| Value | Meaning | Reached by |
|---|---|---|
| `PAYMENT_PENDING` | Booked, slot held, nothing paid | `create_booking_with_hold()` |
| `PENDING_VERIFICATION` | Manual proof submitted, awaiting an admin | Manual proof submission |
| `MENTOR_PENDING` | Paid and verified; waiting for the mentor | Razorpay capture, or admin approval |
| `CONFIRMED` | Mentor confirmed with a meeting link | Mentor confirmation |
| `COMPLETED` | Session happened or was ended | Cron, manual end, read-reconcile |
| `CANCELLED` | Cancelled by the seeker, admin, or hold expiry | Several |
| `REJECTED` | Payment rejected by an admin | Admin rejection |
| `PAYMENT_PROCESSING` | **Permitted by the CHECK, written by no current code path** | *(unreachable)* |

The Razorpay flow deliberately does **not** use `PAYMENT_PROCESSING` on the
booking: the booking stays `PAYMENT_PENDING` until money is captured, because
`expire_stale_holds()` only cancels `PAYMENT_PENDING` bookings. `PAYMENT_PROCESSING`
is a **`payments.status`** value, not a booking status. `src/types/database.ts`
also omits it from `BookingStatus` — see `docs/technical-audit.md` T1.

Three separate concepts, often conflated:

- **Booking status** — the column above.
- **Payment status** — `payments.status`: `PENDING_VERIFICATION`, `VERIFIED`,
  `REJECTED`, `PAYMENT_PENDING`, `PAYMENT_PROCESSING`, `FAILED`, `REFUNDED`,
  `REFUND_FAILED`.
- **Session state** — a *computed projection*, not a column:
  `SCHEDULED`, `ACCESS_OPEN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`. Only
  `COMPLETED` and `CANCELLED` are also real booking statuses.

---

## 10. Payment — **Hybrid. Both paths implemented. Manual is the default.**

`APP_CONFIG.MVP_PAYMENT_METHOD` is `'manual_qr'`. Razorpay is gated on
`RAZORPAY_ENABLED`, which defaults to `"false"`.

### 10.1 Manual UPI/QR — **Implemented, and the live default**

1. The seeker's checkout page reads UPI id, QR image, payment instructions,
   account name and currency from `platform_config` via
   `GET /api/platform-config`. All are admin-managed; nothing is hardcoded.
2. The seeker pays externally, then uploads a screenshot to the private
   `payment-proofs` bucket (≤ 5 MB, jpeg/png/webp/pdf) and enters a
   transaction reference (4–64 chars, `[A-Za-z0-9_-]`).
3. `POST /api/seeker/bookings/:id/payment-proof` moves the booking to
   `PENDING_VERIFICATION`.
4. An admin approves or rejects in the Payments queue. Approval moves the
   booking to `MENTOR_PENDING` and notifies the mentor. Rejection requires a
   reason and cancels the booking; the proof is retained so the seeker can
   resubmit.

**Known gap:** the `payment-qr` storage bucket that the admin QR upload writes
to is not created by any migration. Against a database built purely from
`supabase/migrations/`, the admin cannot upload a QR. See
`docs/technical-audit.md` P1.

### 10.2 Razorpay — **Implemented, opt-in, off by default**

Gated on `RAZORPAY_ENABLED === 'true'`. When off, every Razorpay endpoint
returns `503` and the manual flow is completely unaffected.

When on:

1. `POST /api/seeker/bookings/:id/razorpay/order` creates a Razorpay order, or
   reuses an open one. The amount is **derived on the server**; the browser's
   amount is never used. The **payment** moves to `PAYMENT_PROCESSING`; the
   **booking stays `PAYMENT_PENDING`**.
2. The browser opens Razorpay Checkout using the returned key id.
3. `POST /api/seeker/bookings/:id/razorpay/verify` verifies the **Razorpay
   signature server-side** against the key secret, then advances the payment to
   `VERIFIED` and the booking to `MENTOR_PENDING`, and notifies the mentor.
4. `POST /api/webhooks/razorpay` handles `payment.captured`, `payment.failed`,
   `payment.authorized`, `order.paid` and the three refund events. It is
   authorised only by its HMAC signature over the raw body, and is idempotent
   on `(gateway, event_id)`.

Properties that are true of this implementation:

- The key secret, webhook secret and service-role key never reach a client.
- Verification is idempotent: a repeated call succeeds, is flagged
  `duplicate: true`, and does not notify the mentor twice.
- A capture arriving after the booking was cancelled does not revive it; the
  payment is marked `FAILED` with a reason and logged to `payment_events`.
- The order expiry is derived from the hold window (300 s), so an order can
  never outlive the hold it pays for.
- **There is no human approval step on this path.** It goes to `MENTOR_PENDING`
  directly. The admin queue exists only for manual payments.

### 10.3 Payment states — **Implemented**

```text
MANUAL (bookings + payments):
  PAYMENT_PENDING ─submit proof→ PENDING_VERIFICATION
                                     ├─approve→ VERIFIED  (booking → MENTOR_PENDING)
                                     └─reject → REJECTED   (booking → CANCELLED)

RAZORPAY (payment row only, until capture):
  payment: (none) ─create order→ PAYMENT_PROCESSING
                            ├─verified capture→ VERIFIED  (booking → MENTOR_PENDING)
                            ├─failed           → FAILED
                            ├─dead-end booking → FAILED + refund_status PENDING
                            └─retry of FAILED  → PAYMENT_PROCESSING (same row re-armed)
           VERIFIED ──refund event→ REFUNDED | REFUND_FAILED | (pending, no status change)

  The BOOKING row is untouched by order creation. It stays PAYMENT_PENDING and
  jumps straight to MENTOR_PENDING on a verified capture.
```

### 10.4 Not implemented in payment

- Refund initiation — the webhook consumes refund events, nothing creates them
- Partial refunds
- Payment splitting or payouts to mentors
- Any provider other than Razorpay, and no provider SDK (Razorpay is called
  over plain `fetch`)
- Saved instruments, coupons, discounts, taxes or invoices

---

## 11. Mentor Confirmation — **Implemented**

A mentor confirms a booking by supplying an HTTPS meeting link, moving the
booking `MENTOR_PENDING` → `CONFIRMED`. Ownership is re-checked server-side;
the URL scheme is validated by zod and again by a database CHECK. On the
manual path, confirmation is preceded by admin approval; on the Razorpay path
the payment is already verified and the mentor simply confirms.

The recommended deadline for supplying the link is 2 hours before start. It is
operational guidance and does not block booking.

---

## 12. Session Access — **Implemented**

- The meeting link becomes readable at **T−5 minutes** and is revoked at
  `end_time`.
- The gate is evaluated on the **server clock**. The client samples the server
  offset on every revalidation and renders from it; it never decides.
- The link is redacted on **every** participant-facing booking projection, not
  only at the join endpoint, so the list and detail views do not leak it.
- The mentor always sees the link (they supplied it). An admin always sees it,
  for operational support.
- Only the two participants and an admin can access a session.
- Booking ids and codes are shape-checked before any database filter, closing a
  PostgREST filter-injection path.

---

## 13. Session Completion and Manual Ending — **Implemented**

Any of mentor, seeker or admin can end a live session. Ending records
`actual_ended_at`, `ended_by_role` (`mentor` / `seeker` / `admin`, enforced by a
CHECK) and `end_reason`, and moves the booking to `COMPLETED`. Once a session
is manually ended, the meeting link is revoked for the seeker **irrevocably**,
regardless of the T−5 window.

Three layers complete sessions, in priority order:

1. Reactive — a participant or admin ends it.
2. Cron — `complete_expired_sessions()` every minute for `CONFIRMED` bookings
   past `end_time`.
3. Read-reconcile — `reconcile_expired_sessions` on read, for a single booking
   or a service-role bulk sweep.

The `SESSION_COMPLETED` notification is emitted at most once per user per
session, enforced by a partial unique index rather than by application logic.

---

## 14. Session Workspace — **Implemented**

- One workspace per booking.
- Content: overview/summary, mentor notes, key takeaways, suggestions,
  next steps, action items, resources, and an optional follow-up
  recommendation.
- Status is `PENDING` or `PUBLISHED`. The mentor writes and publishes; the
  seeker **cannot read it until `PUBLISHED`** — enforced by an RLS policy, not
  by the UI.

---

## 15. Cancellation and Rescheduling — **Implemented**

- A seeker may cancel or reschedule while the session starts in **≥ 10
  minutes**. The window is evaluated on the server clock. It is not 24 hours.
- Cancellation records a reason and releases the slot, because the booking
  exclusion constraint excludes `CANCELLED`.
- Reschedule acquires a hold on the new slot **before** touching the original
  booking, so a failed hold leaves the booking exactly as it was.
- If a rescheduled booking is later cancelled, a Razorpay capture that arrives
  afterwards does not revive it; it is recorded as a failed payment.
- Mentor cancellation is a separate emergency path with its own reason.
- **No refund is issued by cancellation.** The booking is cancelled; money
  movement, if any, is manual.

---

## 16. Notifications — **Implemented (in-app only)**

- Stored rows in `notifications`, addressed to one user, with
  `event_type` / `entity_type` / `entity_id` so each role's notification links
  to the right screen.
- Unread count, mark-read and mark-all-read are all scoped to the caller's own
  rows in the database.
- Admin can dispatch a notification to a user.
- Events cover booking creation, payment submitted/approved/rejected, mentor
  confirmation, meeting link, reminders, cancellation, rescheduling, session
  completion, workspace publication, mentor application submitted/approved/
  rejected, and login-threat alerts.
- **In-app only.** No email, SMS or push integration exists.
- **Partially implemented freshness:** `notifications` is not in the realtime
  publication, so updates arrive by polling (up to ~30 s). See
  `docs/technical-audit.md` R1.

---

## 17. UX Expectations — **Implemented**

- Loading, empty, error and success states exist as shared components
  (`LoadingState`, `EmptyState`, `ErrorState`, `SuccessState`) and are used
  across list and detail views.
- Hold countdowns render live via `HoldCountdown`.
- Session countdowns render live and revalidate against the server clock.
- Forms validate inline and surface a structured server error.
- Light and dark themes are available and persist in `localStorage`.
- Every role has a distinct shell and visual direction. See
  `docs/SUGGEST-KEY-UI-DESIGN-SYSTEM.md`.

---

## 18. Authentication and Authorization — **Implemented**

- Supabase Auth, email and password, with email-OTP verification.
- Password reset by email.
- Roles from `user_roles`, re-checked on every request server-side.
- Route protection in the browser; **independent** enforcement on the server
  and in the database.
- Account suspension and deactivation, with who / when / until / why recorded.
- Login-failure tracking: 5 consecutive failures for one identifier within
  15 minutes raises an admin alert.
- Demo personas exist for local development and are fail-closed: they require
  an explicit env flag, a ≥ 32-character secret, and are impossible in
  production.

---

## 19. Planned / Not Implemented

Nothing in this section exists in the code. It is listed so the boundary is
explicit.

| Capability | Status | Note |
|---|---|---|
| Razorpay enabled in production | **Planned** | Code complete and tested; `RAZORPAY_ENABLED` is unset. Enabling it is a configuration decision plus a live credential check. |
| Automated refunds | **Not implemented** | Events are consumed; no endpoint initiates a refund. |
| Retiring the manual payment path | **Planned, not recommended yet** | The manual path is the working default. Do not remove it before Razorpay is enabled and verified live. |
| Mentor ratings and reviews | **Not implemented** | Columns exist; no computation, no submission flow. |
| Email / SMS / push notifications | **Not implemented** | In-app only. |
| Calendar invites and reminders sent externally | **Not implemented** | In-app reminders only. |
| Video provider integration (auto-generated meeting links) | **Not implemented** | The mentor supplies the link. No Daily.co / Whereby / Jitsi call exists. |
| Session recording | **Not implemented** | No column, no route, no UI. |
| Multi-session packages / bundles | **Not implemented** | One booking is one session. |
| Coupons, discounts, taxes, invoices | **Not implemented** | — |
| Mentor payouts | **Not implemented** | No financial outflow exists. |
| Intelligent mentor matching / recommendations | **Not implemented** | Discovery is filter + list. |
| In-app chat or messaging | **Not implemented** | No messaging entity exists. |
| Group sessions | **Not implemented** | Bookings are 1:1 by construction. |
| Mentor analytics beyond counters | **Not implemented** | `rating`, `review_count`, `session_count` are stored values. |
| Push or websocket notification channel | **Not implemented** | `notifications` is not published to realtime. |
| Code splitting / route-level lazy loading | **Not implemented** | Single bundle today. |

---

## 20. Deprecated / Historical Behaviour

Recorded so they are not reintroduced by mistake. **None of these exist in the
current code.**

| Historical behaviour | Replaced by | Migration |
|---|---|---|
| 15-minute slot hold | 5-minute hold | `20260928000000_phase26_hold_duration_5min.sql` |
| 2-hour minimum advance-booking notice | 5-minute booking cutoff | `20260926030000_phase18_booking_cutoff_5min.sql` |
| Manual-only payment | Hybrid: manual default + opt-in Razorpay | `20260927110000_phase25_payment_foundation.sql` |
| Payment capture required admin approval | Razorpay capture goes straight to `MENTOR_PENDING` | `razorpayService.ts` |
| `payments.proof_storage_path` NOT NULL | Nullable, for gateway payments | `20260927110000` |
| Meeting link readable from the bookings list at any hour | Redacted on every participant projection outside T−5 | `src/lib/sessionAccess.ts` |
| Session reconciliation could set `CANCELLED` | Returns `NULL` when there is nothing to do | `20260927060000_phase24b` |
| `client` UPDATE on `bookings` | Revoked; only `cancellation_reason`, `updated_at` | `20260927070000_phase24c` |
| 24-hour cancellation window | 10 minutes | `NORMAL_CANCELLATION_WINDOW_MINUTES` |

---

## 21. Success Criteria for the MVP

The MVP is functionally complete when a seeker can discover a mentor, book a
slot, pay, attend, and read a workspace — on the manual path and on the
Razorpay path — with every rule in `docs/rules.md` enforced by the server or
the database rather than by the interface.

Two defects currently block that claim in a fresh environment: the missing
`payment-qr` bucket (blocks admin QR upload on the default payment path) and
the fixture-backed overdue-links route (gives admins fabricated operational
data). Both are documented in `docs/technical-audit.md`. Neither is fixed,
because this documentation task does not modify application code.
