# Suggest Key — Product Requirements Document

Version: 3.2
Status: As-built / Current
Last verified: 2026-10-02

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
- Cancel or request a reschedule, subject to the 10-minute window
- Reschedule requests: the mentor accepts or rejects, and the booking only
  moves on acceptance
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

**Refunds (implemented, two shapes).** An admin no longer only *observes*
refunds: a Razorpay refund is issued through the gateway by `runCreateRazorpayRefund`
on cancellation, and a manual UPI/QR refund is completed by an admin recording
the external transfer from evidence (§15c). What an admin still cannot do is
issue a refund for a payment that is not in a refundable state, partially refund,
or run a reconciliation sweep over `refund_status='PENDING'` — see §19.

**Coupons (implemented).** Admin-authored codes with server-side application,
reservation and release (§10.5).

**Support (implemented).** An in-app ticket system available to seekers,
mentors and admins (§16.1).

---

## 4. Navigation — **Implemented**

Defined once in `src/config/navigation.ts` and rendered by
`TopNavigation.tsx` (seeker, mentor) or `AdminSidebar.tsx` (admin).

| Role | Items | Shell |
|---|---|---|
| Seeker | Home, My Bookings, Notifications, Settings (4) | top nav |
| Mentor | Home, My Bookings, Availability, Notifications, Settings (5) | top nav |
| Admin | Dashboard, Users, Mentors, Mentor Verification, Segments, Bookings, Workspaces, Payments, Coupons, Notifications, System Health, Support, Settings (13) | sidebar |

Support is **not** a seeker or mentor top-nav item. Both reach it from Settings
→ Help & Support (`/seeker/support`, `/mentor/support`), which keeps their
top-nav shape unchanged. Admin Support *is* a sidebar item, between System Health
and Settings.

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
- **Mentor lifecycle bucket** — also a *computed projection*, not a column:
  `AWAITING_PAYMENT`, `AWAITING_VERIFICATION`, `PENDING_CONFIRMATION`,
  `OVERDUE`, `CONFIRMED`, `COMPLETED`, `CANCELLED`. `OVERDUE` is the mentor-side
  label for a `MENTOR_PENDING` booking that has passed its meeting-link deadline
  without a link (§11). It is not a booking status and not a stored value.

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

The `payment-qr` bucket this writes to is created by
`20261002000000_phase27_payment_qr_bucket_and_config_audit.sql` (public, 2 MB,
png/jpeg/webp). This gap is closed; it is recorded here because the earlier
revisions of this document described it as open.

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

- Partial refunds
- An admin refund workflow for a **Razorpay** payment — a gateway refund is
  settled by the gateway's own events and is never marked complete by hand. The
  admin completion flow in §15c applies to manual UPI/QR payments only.
- Reconciling `refund_status='PENDING'` automatically. A queued manual refund
  stays pending until an admin records it.
- Payment splitting or payouts to mentors
- Any provider other than Razorpay, and no provider SDK (Razorpay is called
  over plain `fetch`)
- Saved instruments, taxes or invoices

(Discount coupons **are** implemented as of phase 39 — see §10.5.)

### 10.5 Coupons and original price — **Implemented (phase 39)**

**Original price.** A gig may carry `original_price_inr` alongside its price.
It is only shown struck-through when it is **genuinely higher** than the current
price — a zero-saving "original" is not rendered, because a struck-through
number that saves nothing is a lie. Original prices are set by mentors/admins
through the existing gig forms, never derived from a coupon, so a coupon expiring
never silently rewrites a published price. A booking snapshots the gig's
original price at hold time, so later edits never move a past booking's history.

**Coupons.** Admins create percentage or fixed-amount discount codes, optionally
targeting one segment or one mentor (or applying everywhere), with an optional
ceiling on a percentage discount, a minimum session price, and optional
per-coupon and per-seeker usage limits over an optional active window.

A seeker enters a code on the payment page. On success the booking's payable
amount drops immediately and the discount is shown in the price breakdown.

Rules that are enforced in the database, not the UI:

- A coupon reduces the amount but never to zero — the minimum payable is ₹1.
- The discount is computed from the amount snapshotted at hold time, so editing
  a gig price mid-checkout cannot move an existing booking's discount.
- One coupon per booking; applying a second code replaces the first and frees
  the first coupon's slot.
- A held slot counts against the coupon's limit while payment is pending, and is
  released automatically if the booking is cancelled, rejected, or the hold
  expires — so an abandoned checkout cannot exhaust a limited coupon.
- The reservation becomes permanent only when payment is verified.
- Once a payment has started, the amount is frozen and the code can no longer be
  applied or removed.
- Applying a code is idempotent, and a code at its limit is refused with a clear
  message rather than a generic error.

Coupons are managed by admins at **Admin → Coupons**. Every create, edit,
status change, and every apply/remove is written to the audit log.

---

## 11. Mentor Confirmation — **Implemented**

A mentor confirms a booking by supplying an HTTPS meeting link, moving the
booking `MENTOR_PENDING` → `CONFIRMED`. Ownership is re-checked server-side;
the URL scheme is validated by zod and again by a database CHECK. On the
manual path, confirmation is preceded by admin approval; on the Razorpay path
the payment is already verified and the mentor simply confirms.

The recommended deadline for supplying the link is **5 minutes before start**. It
is operational guidance: it never blocks booking, never cancels one, and never
raises a refund.

Missing it does, however, change what the mentor sees. A `MENTOR_PENDING` booking
whose deadline has passed with no link is **overdue**: it leaves *Pending
Confirmation* and appears under *Overdue / Action Required*, showing the scheduled
time, the deadline, and how late it is. It is not cancelled, the seeker has not
been notified of anything, and no refund has been raised.

- The overdue state is **derived on read**, not stored. `bookings.status` has no
  `OVERDUE` value and no deadline column exists.
- It is decided by the **server clock**. A browser clock, rewound or otherwise,
  cannot move a booking between sections, and the transition reaches the open page
  without a refresh.
- The one-tap *Add Meeting Link & Confirm* action is replaced by *Review Booking*
  on an overdue card, because past the deadline the mentor may reasonably want to
  add a link, reschedule, or cancel — and silently picking one for them is not the
  server's call. Adding the link late is still allowed and is recorded as a late
  confirmation; cancelling is an explicit action that runs the normal refund
  workflow.
- Admin and mentor views read the same bucket, so an admin and a mentor can never
  be looking at two different overdue sets for one booking.

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
- If a rescheduled booking is later cancelled, a Razorpay capture that arrives
  afterwards does not revive it; it is recorded as a failed payment.
- Mentor cancellation is a separate emergency path with its own reason.
- **Cancellation queues the refund; it does not move the money itself.** For a
  Razorpay payment the gateway refund API is called and the refund is confirmed
  by webhook. For a manual UPI/QR payment the platform cannot move the money at
  all, so the refund is queued for an admin to transfer externally, and the
  seeker is told it is **pending admin processing** — never that it was
  initiated.

### 15c. A manual refund is completed by an admin, from evidence

A manual UPI/QR payment is paid outside the platform, so the platform cannot
return it. The only honest completion is a human recording that they already did.
An admin completing a refund supplies, and the system requires:

- the **full** amount (partial refunds are not supported),
- the **rail** the money was sent on — UPI or bank transfer, nothing else,
- the **reference / UTR** of that transfer, which the application never generates
  and never defaults, and
- a **receipt image** as proof.

The refund is only marked completed if all of that is present and the payment is
still an unsettled manual refund. Recording it is atomic and happens once: a
second attempt on the same payment is refused rather than double-settled. The
receipt is stored privately, visible only to admins, and never as a public link.

The seeker is told the outcome factually. While the refund is queued the message
says it is **pending admin processing**; it is marked **completed** only once the
admin has recorded the transfer. It is never described as initiated on the
seeker-facing path, because for a manual payment nothing was initiated.

### 15b. Rescheduling is a request, not an edit

Rescheduling changed in phase 30. Previously the seeker's chosen time was
applied immediately and the booking was reset to `PAYMENT_PENDING`; the mentor
was never shown the change. Now:

- A seeker **requests** a new time. The booking is **not** modified. It keeps
  its current time, status, mentor, gig, segment and price until the mentor
  answers.
- **Only the time changes.** `mentor_id`, `segment_id` and `gig_id` are
  immutable across a reschedule. The seeker cannot move a booking to another
  mentor, another gig or another segment, and there is no code path that would
  do so. The old "New gig must belong to the same mentor and segment" rule is
  removed, because it described a decision a reschedule is not allowed to make.
- **The new time is checked against the mentor's global availability**, not
  against a per-gig calendar. A booking on any of the mentor's gigs blocks the
  same instant for this reschedule, and a free instant on their timeline is
  requestable whatever segment the booking belongs to.
- The requested slot is **protected while the mentor decides** by a temporary
  hold with a 24-hour expiry, so another seeker cannot take it. The seeker's
  original slot is *not* released on submission.
- The mentor is notified and, on the booking detail page, sees the current
  time, the requested time, the seeker, the gig and the segment, with
  **Accept** and **Reject**.
  - **Accept** moves the booking to the requested time, releases the old slot,
    marks the request `APPROVED` and notifies the seeker. Mentor, gig and
    segment are unchanged.
  - **Reject** leaves the booking completely unchanged, releases the requested
    hold, marks the request `REJECTED` and notifies the seeker with the mentor's
    reason if one was given.
- A seeker may **withdraw** their own pending request, which releases the held
  slot. A request the mentor never answers **expires** after 24 hours and the
  original time simply stands.
- Only the booking's seeker can create a request and only the booking's mentor
  can answer it. Both are enforced in the database, not the client.
- Rescheduling is available for a live pre-session booking (`MENTOR_PENDING` or
  `CONFIRMED`). Changing the time of an *unpaid* booking is a re-book, not a
  reschedule, and goes through the normal gig flow.

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
- **Freshness is mixed, and the split is deliberate for now.**
  - **Admin** notifications are realtime: `AdminNotificationsPage` consumes
    `useNotificationSync`, which subscribes to `notifications` filtered on
    `user_id = eq.<uid>`, revalidates on focus and visibility change, skips its
    interval while the tab is hidden, and removes the channel on unmount. The
    filter is the same predicate the RLS policy enforces, so a subscription
    cannot widen what a user may read.
  - **Seeker and mentor** notifications are **not** yet realtime. Their pages
    read through `NotificationContext`, whose 30-second interval is
    unconditional and not visibility-gated. Latency is therefore up to ~30 s and
    a backgrounded tab keeps polling.
  - The blocker is not the server — the table *is* in the live `supabase_realtime`
    publication and the hook is fully built. It is a two-page migration that has
    not happened. See `docs/technical-audit.md` R1.
  - One caveat that matters for a rebuild: **no migration adds `notifications`
    to the publication.** It was added out of band, so an environment created
    purely from `supabase/migrations/` would have no realtime at all. See
    `docs/technical-audit.md` R2.

---

## 16.1 Support — **Implemented (phase 41)**

An in-app ticket system, available to every role.

- **Five ticket statuses:** `OPEN`, `IN_PROGRESS`, `WAITING_FOR_USER`,
  `RESOLVED`, `CLOSED`. Transitions are a closed vocabulary in
  `src/lib/supportDomain.ts` and are enforced again in the database.
- **Four priorities:** `LOW`, `NORMAL`, `HIGH`, `URGENT`.
- **Categories are role-specific.** A seeker does not choose `SYSTEM` or
  `USER`; a mentor does not choose `BOOKING`. The set is defined per role in
  `src/lib/supportDomain.ts` and validated server-side, so a crafted request
  cannot open a ticket in a category its role may not use.
- **A human-readable code.** Every ticket gets a database-generated
  `ticket_code` matching `^SK-[0-9]{8}-[0-9]{6}$`, which is what users quote in
  correspondence. The sequence is server-side, so codes cannot collide or be
  chosen by a client.
- **Internal notes are invisible to the requester.** Replies and internal notes
  share `support_messages` with an `is_internal` flag, and every non-admin read
  filters them out. Storing both in one table means one ordering timeline
  without a second read path that could forget the filter.
- **Attachments** are PNG/JPEG/WebP/PDF up to 5 MB, in a private
  `support-attachments` bucket at `support/<ticket-uuid>/…`. The path pattern is a
  database CHECK, and a second CHECK rejects `..` and backslashes.
- **A resolution must have a body.** `chk_support_resolution_presence` refuses a
  `RESOLVED` ticket with no `resolution`, so "resolved" cannot be a bare state
  change.
- **Every state change is audited** into `support_audit_events`.
- **Access:** a requester sees only their own tickets; an admin sees all. Both
  are RLS-enforced, not filtered in the route.
- **Not implemented:** SLA timers, assignment queues beyond a single
  `assigned_admin_id`, canned responses, macros, ticket merge, escalation, and
  antivirus scanning of uploaded objects. The conversation does not live-update
  — there is no realtime support thread.

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
| Partial refunds | **Not implemented** | Refunds are full-amount only, by deliberate policy. A manual refund whose amount does not equal `amount_inr` is refused. |
| Reconciling forgotten manual refunds | **Not implemented** | No scheduled sweep over `refund_status='PENDING'`. A forgotten manual refund stays pending until an admin looks at the payment queue. |
| Reconciling unmatched Razorpay captures without an operator | **Not implemented** | The ledger is durable and two admin routes reconcile it, but there is no admin screen and no automatic sweep. An operator must act or read `audit_logs`. |
| Retiring the manual payment path | **Planned, not recommended yet** | The manual path is the working default. Do not remove it before Razorpay is enabled and verified live. |
| Mentor ratings and reviews | **Not implemented** | Columns exist; no computation, no submission flow. |
| Email / SMS / push notifications | **Not implemented** | In-app only. |
| Realtime notifications for seeker and mentor | **Not implemented** | The admin page has it. The two participant pages still poll through `NotificationContext` at an ungated 30 s. The hook already exists — see `docs/technical-audit.md` R1. |
| Calendar invites and reminders sent externally | **Not implemented** | In-app reminders only. |
| Video provider integration (auto-generated meeting links) | **Not implemented** | The mentor supplies the link. No Daily.co / Whereby / Jitsi call exists. |
| Session recording | **Not implemented** | No column, no route, no UI. |
| Multi-session packages / bundles | **Not implemented** | One booking is one session. |
| Taxes and invoices | **Not implemented** | Coupons and an original struck-through price exist (§10.5); no tax computation and no invoice document. |
| Mentor payouts | **Not implemented** | No financial outflow exists. |
| Intelligent mentor matching / recommendations | **Not implemented** | Discovery is filter + list. |
| Direct seeker ↔ mentor messaging | **Not implemented** | There is no messaging entity. Support tickets exist (§16.1) but they are a request to the platform, not a channel between the two participants. |
| Realtime support conversation | **Not implemented** | A ticket updates on load or refresh; there is no live thread. |
| Support SLA, assignment queue, canned replies, macros, merge | **Not implemented** | A ticket has one `assigned_admin_id` and nothing else. |
| Group sessions | **Not implemented** | Bookings are 1:1 by construction. |
| Mentor analytics beyond counters | **Not implemented** | `rating`, `review_count`, `session_count` are stored values. |
| Websocket notification channel for participants | **Not implemented** | See "Realtime notifications for seeker and mentor" above. |
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

**As of 2026-10-02 the two defects that previously blocked this claim are both
fixed**, and both are now pinned by regression tests:

| Previously blocking | Now |
|---|---|
| `payment-qr` bucket missing, so the admin could not upload a QR on the default payment path | Created by phase 27 and verified present in the live project. |
| `GET /api/admin/bookings/overdue-links` served fabricated mentors, bookings and meeting links | Reads real `bookings` rows through `getSupabaseAdmin()`, and now shares the canonical `resolveBookingLifecycle()` resolver with the mentor and admin ledgers. |

Three things still stand between today and a comfortable claim, none of which
block the core loop:

1. **`notifications` is in the realtime publication with no migration adding
   it** (`docs/technical-audit.md` R2). A rebuild from `supabase/migrations/`
   alone loses notification realtime. This is the same class of defect P1 was.
2. **`npm test` is red on 2 assertions** (`docs/technical-audit.md` N1). Neither
   failure is a behaviour defect, but "the suite passes" cannot currently be
   claimed, so this document does not claim it.
3. **Razorpay has never been enabled in production.** Both payment paths are
   implemented, but only the manual one has been exercised against real money.
