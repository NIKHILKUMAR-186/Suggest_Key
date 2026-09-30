# SUGGEST KEY — MVP PRODUCT & TECHNICAL SPECIFICATION

Version: 3.1
Status: As-built / Current
Last verified: 2026-09-29
Product: Suggest Key
Document Type: Product + Technical Specification

> This document describes the MVP **as it is implemented today**. Where a value
> changed, the previous value is marked *historical* and cross-referenced to the
> migration that replaced it. Where something is not built, it says so.
> Companions: `docs/architecture.md` (technical as-built), `docs/rules.md`
> (enforced rules), `docs/prd.md` (current vs planned), `docs/technical-audit.md`
> (open defects).

---

# 1. PRODUCT OVERVIEW

Suggest Key is a mentorship marketplace that helps a seeker who needs mentorship connect with an appropriate mentor and book a 1:1 mentorship session.

The MVP supports three roles:

- Seeker
- Mentor
- Admin

The core product loop is:

Seeker discovers a mentor
→ selects a valid time slot
→ temporarily holds the slot for **5 minutes**
→ pays
→ booking moves to mentor
→ mentor adds meeting link and confirms
→ seeker joins at the allowed time
→ session completes
→ session moves to history
→ mentor creates a session workspace with notes and suggestions

**Payment is a fork, not a single step.** The default path is manual UPI/QR:
pay externally, upload a screenshot, an admin verifies, the booking moves to
`MENTOR_PENDING`. When `RAZORPAY_ENABLED` is exactly `"true"`, the seeker can
instead pay through Razorpay Checkout, where the server verifies the capture
signature and advances the booking with **no human step**. Both paths are
implemented; the manual path is the live default. See §23–§27.

---

# 2. MVP PRINCIPLES

The following principles are mandatory.

## 2.1 Real Data Only

Production UI must never rely on fake, static, or hardcoded business data.

Examples that must come from the database:

- mentors
- seekers
- segments
- gigs
- prices
- availability
- bookings
- payment records
- notifications
- session notes
- meeting links

Seed/demo accounts may exist for development/testing, but production functionality must use real Supabase data.

---

## 2.2 Backend Is the Source of Truth

The frontend must never be trusted for:

- booking conflicts
- payment status
- hold expiry
- session timing
- meeting access
- mentor confirmation
- availability
- role authorization

Critical business rules must be enforced server-side/database-side.

---

## 2.3 Mentor Owns the Global Availability Timeline

Availability belongs to the mentor.

Availability does NOT belong to a gig.

A mentor can have multiple gigs across multiple segments, but their time is globally shared.

Example:

Rahul:

Relationship Advisor
→ Gig A

Autism Mentor
→ Gig B

If Rahul's:

Wednesday 6:00 PM slot

is booked in Relationship Advisor,

the same:

Wednesday 6:00 PM

must be unavailable in Autism Mentor.

This is a fundamental business invariant.

---

# 3. ROLES

## 3.1 SEEKER

A seeker can:

- sign in
- manage their profile
- discover segments
- select a date
- discover available mentors
- view mentor profiles
- view mentor gigs
- view pricing
- select a slot
- hold a slot
- pay using QR
- upload payment proof
- view payment status
- view booking status
- receive notifications
- view upcoming sessions
- join sessions during the allowed window
- view completed sessions
- access session workspace
- cancel eligible bookings
- reschedule eligible bookings

---

# 3.2 MENTOR

A mentor can:

- sign in
- manage profile
- manage segments they mentor
- create one gig per segment
- configure gig pricing
- configure gig duration
- manage global availability
- configure recurring weekly availability
- configure date exceptions
- view bookings
- view seeker information relevant to the booking
- see segment/gig details
- see exact booked time
- add meeting links
- confirm sessions
- receive notifications
- join sessions during allowed time
- view completed sessions
- create/edit session workspace notes
- provide takeaways
- provide suggestions
- provide next steps

A mentor must be approved/activated by Admin before becoming discoverable to seekers.

---

# 3.3 ADMIN

Admin is the operational control layer.

Admin can:

- manage seekers
- create seekers
- edit seekers
- activate/deactivate seekers
- manage mentors
- create mentors
- edit mentors
- approve mentors
- activate/deactivate mentors
- manage segments
- create segments
- edit segments
- archive/deactivate segments
- reorder segment priority
- manage gigs
- view availability
- view bookings
- view payment submissions
- approve payments
- reject payments
- cancel bookings where required
- intervene in booking issues
- view session information
- view notifications
- view session workspaces
- manage platform settings

Admin is the final authority for manual payment verification.

---

# 4. INFORMATION ARCHITECTURE

The application uses role-specific navigation.

## 4.1 SEEKER APP

The seeker application uses a clean top navigation. There is NO sidebar for seekers.

Primary navigation:

1. Home
2. My Bookings
3. Notifications
4. Settings

### Seeker navigation responsibilities

**Home**
- mentorship discovery
- active segment
- date selection
- mentor discovery
- booking flow

**My Bookings**
- upcoming bookings
- completed/history
- cancelled/rejected bookings
- booking/session details
- join session when eligible

**Notifications**
- in-app notifications

**Settings**
- profile
- personal information
- profile photo
- bio
- timezone
- security/password
- notification preferences
- account settings

There must NOT be a separate Profile sidebar/top-level navigation item.

Profile/account functionality belongs inside Settings.

---

## 4.2 MENTOR APP

The mentor application uses a clean top navigation. There is NO sidebar for mentors.

Primary navigation:

1. Home
2. My Bookings
3. Availability
4. Notifications
5. Settings

### Mentor navigation responsibilities

**Home**
- mentor operational overview
- today's/upcoming sessions
- pending confirmations
- relevant booking actions

**My Bookings**
- pending bookings
- upcoming bookings
- completed/history
- cancelled bookings
- booking/session details
- meeting-link and confirmation actions

**Availability**
- global recurring availability
- date-specific exceptions
- availability management

**Notifications**
- in-app notifications

**Settings**
- profile
- personal information
- profile photo
- bio
- timezone
- security/password
- notification preferences
- account settings
- segments
- gigs

Mentor profile, segments and gigs are managed from Settings, while Availability remains a dedicated primary navigation item because it is a core mentor workflow.

---

## 4.3 ADMIN APP

Admin uses a dedicated sidebar because the Admin application has substantially more operational content than the seeker/mentor applications.

Recommended sidebar navigation:

- Dashboard
- Users
- Mentors
- Segments
- Bookings
- Payments
- Notifications
- Settings

The admin sidebar may also contain a bottom account area for:

- Admin profile
- Logout

Admin navigation is not constrained by the seeker/mentor navigation structure.

---

## 4.4 ROLE-SPECIFIC APP SHELL

The application must render the appropriate shell based on the authenticated user's role.

```text
Authenticated User
        |
        v
    Role Check
        |
   +----+----+----+
   |         |    |
Seeker    Mentor Admin
   |         |    |
   v         v    v
Top Nav    Top Nav Sidebar
```

The navigation configuration must be centralized and role-aware.

Do NOT duplicate navigation definitions independently across every page.

Conceptually:

```text
Seeker:
Home
My Bookings
Notifications
Settings

Mentor:
Home
My Bookings
Availability
Notifications
Settings

Admin:
Dashboard
Users
Mentors
Segments
Bookings
Payments
Notifications
Settings
```

---

## 4.5 GLOBAL UI DIRECTION

The navigation change is a global application-shell decision.

### Seeker + Mentor

The user-facing applications should have:

- top navigation
- clean content canvas
- minimal visual clutter
- contextual primary actions
- responsive navigation on mobile

The sidebar pattern should NOT be used for seeker/mentor primary navigation.

### Admin

The admin application should have:

- persistent sidebar on desktop
- dense operational information architecture
- quick access to operational queues
- dashboard-oriented layouts
- responsive/collapsible sidebar behavior on smaller screens

Admin UI may be denser than seeker/mentor UI because its primary purpose is operational control.

---

## 4.6 ROLE-SPECIFIC PRODUCT JOBS

Navigation and content should reflect the primary job of each role.

### Seeker

```text
Discover
→ Select
→ Book
→ Attend
→ Review outcome
```

### Mentor

```text
Manage availability
→ Manage bookings
→ Confirm
→ Conduct session
→ Document outcome
```

### Admin

```text
Monitor
→ Verify
→ Control
→ Resolve
```

---

# 5. SEGMENTS

Segments represent mentorship categories.

Examples:

- Relationship Advisor
- Autism Mentor
- Career Mentor

These are examples only.

Admin creates and controls actual production segments.

---

## 5.1 Segment fields

Recommended fields:

- id
- name
- slug
- description
- image/icon if required by UI
- is_active
- priority
- created_at
- updated_at

---

## 5.2 Segment priority

Admin controls segment priority.

Example:

1. Relationship Advisor
2. Autism Mentor
3. Career Mentor

When a seeker enters Home, the highest-priority active segment is automatically selected.

No hardcoded default segment is allowed.

---

# 6. MENTOR SEGMENT MEMBERSHIP

A mentor can belong to multiple segments.

Example:

Rahul:

- Relationship Advisor
- Autism Mentor

A mentor only becomes discoverable for a segment if:

1. mentor is approved
2. mentor is active
3. mentor has an active gig for that segment
4. mentor has at least one valid bookable slot on the selected date

---

# 7. GIGS

A gig describes what a mentor offers inside a segment.

A mentor can have:

- one gig per segment

A mentor cannot have multiple active gigs inside the same segment.

---

## 7.1 Gig fields

Recommended:

- id
- mentor_id
- segment_id
- title
- description
- duration_minutes
- price
- currency
- is_active
- created_at
- updated_at

---

## 7.2 Database invariant

Enforce:

UNIQUE(mentor_id, segment_id)

This prevents duplicate gigs for the same mentor and segment.

---

# 8. MENTOR PROFILE

Recommended mentor profile fields:

- user_id
- display_name
- profile_photo
- short_bio
- timezone
- approval_status
- is_active
- created_at
- updated_at

Optional future fields:

- qualifications
- experience
- languages
- expertise tags
- social links
- website

These are not required for MVP unless UI requires them.

---

# 9. SEEKER PROFILE

MVP seeker profile should remain intentionally simple.

Recommended:

- user_id
- display_name
- profile_photo
- short_bio
- timezone
- created_at
- updated_at

Do not collect unnecessary personal information.

---

# 10. HOME / DISCOVERY FLOW

After login:

Seeker
→ Home

Home automatically selects the highest-priority active segment.

Example:

Segment:

Relationship Advisor

Then seeker selects:

Date:

18 March 2026

The application fetches mentors who satisfy ALL conditions:

- approved mentor
- active mentor
- belongs to selected segment
- has active gig for selected segment
- has at least one valid bookable slot on selected date

---

# 11. FIND ALL MENTORS

Home contains:

[ Find All Mentors ]

The mentor list should represent actual bookability.

A mentor with zero valid slots on the selected date should NOT appear in the available mentor results.

This avoids showing mentors who cannot actually be booked.

---

# 12. MENTOR DISCOVERY CARD

Recommended information:

- profile photo
- mentor name
- short bio
- segment
- gig title
- duration
- price
- next available slot
- availability indicator

Example:

Mentor:
Rahul Sharma

Relationship Advisor

60 min
₹999

Available today

[ View Mentor ]

---

# 13. MENTOR DETAIL PAGE

Mentor detail should show:

- mentor photo
- name
- bio
- selected segment
- gig title
- gig description
- duration
- price
- selected date
- available slots

Primary action:

[ Book Session ]

---

# 14. GLOBAL AVAILABILITY

Mentor availability is global.

It is NOT attached to a gig.

---

# 15. RECURRING AVAILABILITY

Mentors should be able to configure weekly availability.

Example:

Monday
10:00–13:00
17:00–20:00

Tuesday
09:00–12:00

Wednesday
17:00–21:00

---

# 16. DATE EXCEPTIONS

Mentors can override normal availability for specific dates.

Examples:

18 March
Unavailable

25 March
14:00–18:00

Date-specific exceptions override recurring availability.

---

# 17. SLOT GENERATION

Slots are derived from:

- mentor availability
- gig duration
- selected date
- mentor timezone
- current time
- existing bookings
- active holds
- booking status
- exceptions

Slots must be generated dynamically.

Do NOT hardcode slots.

---

# 18. BOOKING CUTOFF

A slot is bookable only while:

```text
slotStart − serverNow >= 5 minutes
```

> **Historical:** 2 hours. The old 2-hour minimum advance-booking rule **no
> longer exists**. It was replaced by a 5-minute cutoff in
> `20260926030000_phase18_booking_cutoff_5min.sql`, which enforces
> `slot_start - clock_timestamp() >= 5 min` inside `create_booking_with_hold()`.
> `APP_CONFIG.BOOKING_CUTOFF_MS` mirrors it at 5 minutes.

The cutoff is measured on **absolute instants**, so it is independent of any
display timezone.

The cutoff is **not** the same rule as the mentor meeting-link deadline (2 h,
§32) and **not** the T−5 access window (§33). Three different clocks:

| Rule | Value | Blocks what |
|---|---|---|
| Booking cutoff | 5 min before start | creating a booking |
| Meeting-link deadline | 2 h before start | nothing — mentor guidance only |
| Session access window (T−5) | 5 min before start | reading the link / joining |

---

# 19. GLOBAL SLOT CONFLICT

A mentor's timeline is globally shared. A booking or a hold on one gig blocks
that mentor's time for **all** gigs, because `mentor_availability` has no
`gig_id` and the overlap constraints key on `mentor_id` alone.

Enforced by two database constraints:

```sql
EXCLUDE USING gist (mentor_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&)
  WHERE (status NOT IN ('CANCELLED','REJECTED'));    -- bookings

EXCLUDE USING gist (mentor_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&)
  WHERE (status = 'ACTIVE');                        -- slot_holds
```

This is why slot generation subtracts both bookings and active holds from a
mentor's availability.

Conflict checking keys on `mentor_id` + the actual time interval — **not**
`mentor_id` + `gig_id`.

Example:

A booking on the Relationship Advisor gig at 6:00 PM also makes 6:00 PM
unavailable on that mentor's Autism Mentor gig.

---

# 20. BOOKING SYSTEM

Booking is a stateful process.

Core flow (manual payment path):

Seeker selects slot
→ Hold (5 min)
→ Uploads payment proof
→ Admin verification
→ Mentor pending
→ Mentor confirmation
→ Confirmed
→ Session
→ Completed
→ History

Core flow (Razorpay path, when enabled):

Seeker selects slot
→ Hold (5 min)
→ Pays via Razorpay Checkout
→ Server verifies the capture signature
→ Mentor pending
→ Mentor confirmation
→ Confirmed
→ Session
→ Completed
→ History

The only difference is the payment step. Everything after `MENTOR_PENDING` is
identical and gateway-agnostic.

---

# 21. SLOT HOLD

When seeker selects a slot:

A temporary hold is created.

Hold duration:

**5 minutes.**

Example:

10:00 PM

hold created

expires:

10:05 PM

During active hold:

The slot is unavailable to every other seeker.

> **Historical:** 15 minutes. Replaced by
> `20260928000000_phase26_hold_duration_5min.sql`, which introduced
> `platform_config.hold_duration_minutes` (default 5) and the
> `hold_duration_interval()` function so the database is authoritative.
> `APP_CONFIG.HOLD_DURATION_MS` in `src/config/app.ts` mirrors it at 5 minutes
> for display and for the server's own copy of the timeline.

Booking creation and hold creation are **one transaction**. A single RPC,
`create_booking_with_hold()`, inserts the hold, creates the booking, converts
the hold and writes the payment row together. There is no window in which a
hold exists without a booking.

---

# 22. HOLD EXPIRATION

When hold expires:

- hold status becomes `EXPIRED`
- slot becomes available
- the linked `PAYMENT_PENDING` booking is cancelled
- another seeker can book the slot

Expiration is enforced by the database, not by application code and not by a
frontend timer. `pg_cron` runs `expire_stale_holds()` every minute
(`* * * * *`); the function is `service_role`-only.

---

# 23. PAYMENT

**Current state: hybrid. Both paths are implemented. The manual path is the
default.**

| Path | Status | Gate |
|---|---|---|
| Manual UPI/QR proof | **Implemented, live default** | none — always available |
| Razorpay | **Implemented, opt-in, off by default** | `RAZORPAY_ENABLED === "true"` |

`APP_CONFIG.MVP_PAYMENT_METHOD` is `'manual_qr'`.

The payment architecture **is** provider-abstracted, and the abstraction is real
rather than aspirational:

- `src/lib/razorpayService.ts` is written against two ports —
  `RazorpayGatewayClient` (HTTP) and `RazorpayStore` (persistence).
- The implementations are `createRazorpayGatewayClient()` and
  `createSupabaseRazorpayStore(admin)`, supplied at the route boundary.
- Adding a second gateway means writing an adapter, not editing the
  orchestration. Razorpay is called over plain `fetch`; there is deliberately
  no vendor SDK.

The booking engine is **not** coupled to either gateway. Availability, slot
locking, booking, session and mentor confirmation are all gateway-agnostic.
`payments.gateway` records which path a row came from
(`CHECK (gateway IN ('manual','razorpay'))`).

### 23.1 Environment configuration

| Variable | Purpose |
|---|---|
| `RAZORPAY_ENABLED` | Exactly `"true"` enables. Anything else → every Razorpay route returns `503` and the manual flow is untouched. |
| `RAZORPAY_KEY_ID` | Public. The only Razorpay value ever sent to a browser. |
| `RAZORPAY_KEY_SECRET` | Server-only. Order authentication and signature verification. |
| `RAZORPAY_WEBHOOK_SECRET` | Server-only. Webhook HMAC. |
| `RAZORPAY_API_BASE` | Optional override; default `https://api.razorpay.com/v1`. |

None are `VITE_`-prefixed, so none can be bundled into the client.

### 23.2 Known gap

The `payment-qr` storage bucket is referenced by the admin QR upload
(`PAYMENT_QR_BUCKET` in `src/lib/paymentProof.ts`, used at `server.ts:205`,
`:8786`, `:8845`) but is **not created by any migration**. Against a database
built purely from `supabase/migrations/`, the admin cannot upload a payment QR.
Because the manual UPI/QR path is the default payment route, this blocks the
primary revenue path. See `docs/technical-audit.md` P1.

---

# 24. PAYMENT FLOW

### 24.1 Manual UPI/QR (default)

After slot hold, the payment screen shows:

- booking summary
- mentor, segment, date, time, duration, amount
- UPI id, QR code, payment instructions, account name, currency — all read from
  `platform_config` via `GET /api/platform-config`, all admin-managed, none
  hardcoded
- payment deadline (the hold countdown)
- payment proof upload

The seeker pays externally, then submits:

- a payment proof screenshot (≤ 5 MB, `image/jpeg` / `image/png` /
  `image/webp` only — `application/pdf` is allowed by the bucket but rejected by
  `validateProofFile`)
- a transaction reference matching `^[A-Za-z0-9_-]+$`, 4–64 characters

`POST /api/seeker/bookings/:id/payment-proof` moves the booking to
`PENDING_VERIFICATION` and the payment to `PENDING_VERIFICATION`.

### 24.2 Razorpay (when enabled)

1. `POST /api/seeker/bookings/:id/razorpay/order` — the server verifies
   ownership, payability, slot validity and hold validity, derives the amount
   from stored data, and creates or reuses a Razorpay order. The **payment** row
   moves to `PAYMENT_PROCESSING`; the **booking stays `PAYMENT_PENDING`**.
   Returns the order id, the key id, the amount, the currency and the payment
   id. `201` on create, `200` on reuse.
2. The browser opens Razorpay Checkout.
3. `POST /api/seeker/bookings/:id/razorpay/verify` — the server verifies the
   Razorpay signature against the key secret, then advances the payment to
   `VERIFIED` and the booking to `MENTOR_PENDING`, and notifies the mentor
   **once**.
4. `POST /api/webhooks/razorpay` handles `payment.captured`, `payment.failed`,
   `payment.authorized`, `order.paid`, `refund.created`, `refund.processed`
   and `refund.failed`.

Properties of the implemented Razorpay path:

- The amount is **server-derived**. A browser-supplied amount is never used to
  create an order or accept a capture; a mismatch is refused and audited.
- Signature verification is **server-side**. A failure is audited with the
  error *code* only — signatures are proof material and are never logged.
- The webhook verifies over the **raw body** captured by a JSON `verify` hook.
  Using `req.body` would fail the HMAC.
- Idempotent at all three entry points: an existing open order is reused, a
  repeated verify succeeds with `duplicate: true` and does not re-notify the
  mentor, and an already-seen webhook event is acknowledged with `200` without
  reprocessing (unique on `(gateway, event_id)`).
- A capture arriving after the booking was cancelled or rejected does **not**
  revive it. The payment is marked `FAILED` with a reason and a
  `payment_events` row is written.
- Order expiry is **derived** from the hold window
  (`RAZORPAY_ORDER_EXPIRY_SECONDS = HOLD_DURATION_MS / 1000` = 300), so an
  order can never outlive the hold it pays for.
- There is **no human approval step** on this path. It goes straight to
  `MENTOR_PENDING`.

---

# 25. PAYMENT STATUS

**Actual values, enforced by `payments_status_check`:**

| Status | Meaning |
|---|---|
| `PENDING_VERIFICATION` | Manual proof submitted, awaiting an admin |
| `VERIFIED` | Payment confirmed |
| `REJECTED` | Admin rejected the manual payment |
| `PAYMENT_PENDING` | Nothing paid yet |
| `PAYMENT_PROCESSING` | A Razorpay order exists; capture not yet verified. **Payment only** — the booking does not enter this state. |
| `FAILED` | Capture failed, or the booking reached a dead end |
| `REFUNDED` | A refund completed |
| `REFUND_FAILED` | A refund failed |

> **Historical:** `pending` / `approved` / `rejected`. Replaced by
> `20260927110000_phase25_payment_foundation.sql`, which dropped and re-added
> the CHECK with 8 values. `approved` became `VERIFIED`.

`payments.proof_storage_path` is **nullable**, since a gateway payment has no
uploaded proof. `payments` is `UNIQUE (booking_id)` — one payment row per
booking. The browser can never write `payments`; RLS makes UPDATE/DELETE
admin-only.

`payments.status` is a **separate vocabulary** from `bookings.status`. See §46.

---

# 26. PAYMENT APPROVAL

**Manual path only.** An admin reviews the payment proof in the Payments queue.

If approved:

Payment: `VERIFIED`

Booking: `MENTOR_PENDING`

The mentor is notified with a link to the real payment row.

**Razorpay path:** no admin approval. The server-verified capture advances the
booking directly. The admin approve/reject routes only act on
`gateway = 'manual'` rows, which is the only path that needs a human.

Hold:

released

But the booking itself continues to block the mentor's time.

The slot does NOT become available just because the temporary hold ended.

---

# 27. PAYMENT REJECTION

**Manual path only.** An admin rejects with a required reason.

Payment: `REJECTED`

Booking: `CANCELLED` *(not `REJECTED` — see §46)*

Hold: released

Slot: available again

Seeker receives an in-app notification.

The proof file is **retained** on the record; the seeker may submit a new one
from a booking that is still payable.

> **Correction to v1 of this document:** the booking does not become
> `REJECTED` on a payment rejection. `review_payment(p_approve := false)` sets
> `payments.status = 'REJECTED'` and `bookings.status = 'CANCELLED'`, and the
> notification is typed as a rejection so the seeker sees the reason.

---

# 28. MENTOR PENDING STATE

After payment is verified — by admin approval (manual) or by a server-verified
capture (Razorpay):

Mentor receives the booking.

Booking status:

`MENTOR_PENDING`

Meaning:

Payment is verified, but the mentor has not yet added the meeting link and confirmed the session.

There is no timer on this state. Nothing moves it automatically.

---

# 29. MENTOR BOOKING VIEW

The mentor must see full booking context: seeker, segment, gig, date, time,
duration, payment status, booking status, and the meeting-link action.

Illustrative layout (values below are placeholders, not seeded data):

```text
NEW SESSION

Seeker:     <name from profiles.full_name>
Segment:    <segment from segments.name>
Gig:        <gig from gigs.title>
Date:       <start_time>
Time:       <start_time – end_time>
Duration:   <gigs.duration_minutes>
Payment:    <payments.status>
Status:     <bookings.status>  →  "Pending Confirmation"
Meeting Link:  [ Add meeting link ]
               [ Confirm Session ]
```

Every field is read from the database via `GET /api/mentor/bookings` and
`GET /api/mentor/bookings/:id`. No value on this screen is hardcoded.
Pending Confirmation

Meeting Link:
[ Add meeting link ]

[ Confirm Session ]

---

# 30. MEETING LINK

The mentor supplies the meeting URL. There is **no video-provider integration**:
no Daily.co, no Whereby, no Jitsi, no auto-generated room. The mentor pastes a
link.

Any valid HTTPS meeting platform may be used (Google Meet, Zoom, Microsoft
Teams, or anything else).

Validation is doubled:

- zod (`apiSchemas.mentorBookingConfirm`) requires a real `http(s)` URL, so
  `javascript:` and other script-bearing schemes can never be stored
- `CHECK (meeting_url IS NULL OR meeting_url ~* '^https://')` in the database

---

# 31. MENTOR CONFIRMATION

The mentor must add a meeting link before confirming.

Confirmation action:

[ Confirm Session ]

Ownership is re-checked server-side: `confirm_booking(p_booking_id, p_meeting_url, p_mentor_id)`
refuses with `FORBIDDEN_NOT_BOOKING_OWNER` if the mentor does not own the
booking. A booking the mentor does not own returns `403`.

After successful confirmation:

Booking:

`CONFIRMED`

Seeker receives a notification.

The booking is now live in the seeker's upcoming list and appears in the
mentor's confirmed list.

---

# 32. MEETING LINK DEADLINE

The mentor should add the meeting link at least:

**2 hours** before session start.

Example:

Session:

4:00 PM

Recommended deadline:

2:00 PM

`MEETING_LINK_DEADLINE_MS = 2 * 60 * 60 * 1000`.

If the deadline passes:

- the booking remains active
- the link can still be added
- the missed deadline is surfaced operationally
  (`GET /api/admin/bookings/overdue-links`)

The deadline **never blocks booking**. It is mentor guidance, distinct from the
booking cutoff (§18) and from the T−5 access window (§33). Do not automatically
cancel a booking because the mentor missed it.

> **Known defect:** `GET /api/admin/bookings/overdue-links` currently serves
> hardcoded in-memory fixtures and never queries the database
> (`server.ts:3138-3152`). An admin using it during an incident sees fabricated
> mentors and times. See `docs/technical-audit.md` D1.

---

# 33. MEETING LINK VISIBILITY

The meeting link is **not** visible to the seeker immediately after
confirmation.

The link becomes available:

**5 minutes** before session start (T−5).

Example:

Session:

4:00 PM – 5:00 PM

Meeting link becomes visible:

3:55 PM

The link is revoked at `end_time`.

**Redaction has exactly one door.** `redactMeetingUrlForParticipant()`
(`src/lib/sessionAccess.ts:84`) is applied to **every** participant-facing
booking projection — the seeker's booking list and booking detail, not only the
join endpoint. An earlier implementation returned `meeting_url` verbatim from
the list, which made the T−5 gate on the join endpoint decorative.

| Viewer | Link returned when |
|---|---|
| Admin | always |
| Mentor | always (the mentor supplied it) |
| Seeker | `start − 5 min ≤ now < end`, **and** `actual_ended_at IS NULL` |

Once a session is manually ended, the link is revoked for the seeker
**irrevocably**, regardless of the T−5 window.

---

# 34. SESSION COUNTDOWN

Before the 5-minute access window:

Show countdown.

Example:

Session starts in:

5:00

4:59

4:58

...

At 4:00 minutes:

Session starts in 4 minutes

...

At 0:

[ Join Session ]

This updates dynamically.

**The countdown runs on the server clock.** `useSessionSync` revalidates every
`REVALIDATE_MS = 20_000` and samples `offsetMs = serverNow − clientNow` on every
revalidation; all countdowns derive from `serverNowFromOffset(offsetMs)`. A
local 1-second tick advances the render, never the decision. Manipulating the
device clock therefore does not open the join gate.

---

# 35. JOIN SESSION RULES

Before T−5 minutes:

Join is blocked.

At T−5 minutes:

Join becomes available.

During session:

Join is available.

After session end:

Join is disabled.

Example:

4:00–5:00 session

3:54:

blocked

3:55:

join enabled

4:30:

join enabled

5:00:

session ended

5:01:

join disabled

---

# 36. SERVER-SIDE SESSION ACCESS

Session access is validated server-side, on the **server clock**.

Pseudo-rule (`isInsideSessionAccessWindow` + `can_join_session`):

```text
if now < start_time - 5 minutes:            DENY
if start_time - 5 min <= now < end_time:    ALLOW
if now >= end_time:                         DENY
if actual_ended_at is set:                  DENY   (link revoked, revocable)
```

The frontend countdown is UX only. It is not a security mechanism, and the
client is structurally unable to change the answer: `useSessionSync` renders
from a server-sampled clock offset, and the authoritative decision is made by
the `can_join_session(p_booking_id, p_user_id)` RPC.

The same rule is applied to the **projection**, not just the action:
`redactMeetingUrlForParticipant()` removes `meeting_url` from every
participant-facing booking response outside the window. Gating only the join
endpoint would leave the link readable from the bookings list.

---

# 37. SESSION COMPLETION

After `end_time`:

Session state (computed) becomes:

`COMPLETED`

Three layers perform the actual write, in priority order:

1. **Reactive** — any of mentor, seeker or admin ends the live session via
   `POST /api/sessions/:bookingId/complete`. Writes `actual_ended_at`,
   `ended_by_role` (`CHECK IN ('mentor','seeker','admin')`) and `end_reason`.
2. **Cron** — `complete_expired_sessions()` every minute (`* * * * *`,
   `service_role`-only) completes `CONFIRMED` bookings past `end_time` and
   emits the once-only `SESSION_COMPLETED` notification.
3. **Read-reconcile** — `reconcile_expired_sessions(p_booking_id)` on read, and
   `reconcile_expired_bookings(uuid[])` for a service-role bulk sweep.
   Reconciliation returns `NULL` when there is nothing to do; it must never
   set `CANCELLED`.

The booking moves out of the active/upcoming list and appears in:

History

---

# 38. MY BOOKINGS

My Bookings should have:

## Upcoming

Future sessions that are:

- pending mentor confirmation
- confirmed
- otherwise legitimately active

## History

Completed sessions.

## Cancelled

Cancelled/rejected sessions.

---

# 39. SESSION HISTORY

Each completed booking becomes a historical session.

Example:

Relationship Advisor

Rahul Sharma

18 March 2026

4:00 PM – 5:00 PM

Completed

[ Open Workspace ]

---

# 40. SESSION WORKSPACE

Every completed session has a workspace.

The workspace is attached to that specific booking/session.

It should contain:

## Session Overview

- mentor
- seeker
- segment
- gig
- date
- time
- duration
- status

---

## Mentor Notes

Free-form notes about the session.

---

## Key Takeaways

Important things the seeker should remember.

---

## Suggestions / Recommendations

Practical recommendations from the mentor.

---

## Next Steps

Actions the seeker should take after the session.

---

## Follow-up Recommendation

Optional:

- No follow-up needed
- Follow-up recommended

If recommended:

- suggested timeframe
- reason

---

# 41. SESSION WORKSPACE VISIBILITY

Mentor:

Can create/edit workspace content.

Seeker:

Can view mentor-published workspace content.

Admin:

Can view workspace for operational/support purposes.

Do not expose private internal mentor notes unless explicitly designed as seeker-visible content.

Recommended MVP implementation:

All workspace fields are seeker-visible after mentor saves them.

If private notes are required later, introduce separate private fields.

---

# 42. CANCELLATION POLICY

Seeker cancellation:

Allowed only when:

session_start − now >= **10 minutes**

> **Historical:** 24 hours. The current value is
> `NORMAL_CANCELLATION_WINDOW_MINUTES = 10` in `src/config/app.ts`. Any document
> saying 24 hours for cancellation is wrong. The window is evaluated on the
> server clock, not the browser's.

If within 10 minutes:

cancellation is not allowed through the normal seeker flow.

Admin can intervene.

Cancellation records a reason (`bookings.cancellation_reason`, the only column
an `authenticated` client may update) and releases the slot, because the booking
overlap exclusion constraint excludes `CANCELLED`.

**No refund is issued by cancellation.** The booking is cancelled; money
movement is a manual operational step.

---

# 43. MENTOR CANCELLATION

If the mentor cancels:

Booking becomes `CANCELLED`.

Seeker receives a notification.

Admin is notified.

Because payment may be manually verified in the MVP, refund handling is an
admin-controlled operational workflow. **No refund initiation endpoint exists**
on either path — the Razorpay webhook only *consumes* refund events that
originate in the Razorpay dashboard.

---

# 44. RESCHEDULING

## 44.1 The rule

Rescheduling is a **request the mentor decides**, not an edit the seeker makes.

```
Existing CONFIRMED booking
        ↓
Seeker clicks "Request Reschedule"
        ↓
Seeker selects new date/time
        ↓
Create RESCHEDULE_PENDING request
        ↓
Notify mentor
        ↓
Mentor sees: current date/time, requested new date/time, seeker, gig, segment
        ↓
  Accept  → new time becomes confirmed
  Reject  → original booking remains unchanged
```

Reschedule is allowed at least **10 minutes** before session start
(`NORMAL_CANCELLATION_WINDOW_MINUTES` / `platform_config.reschedule_window_minutes`),
measured on the ORIGINAL slot. Past slots are never allowed, and neither is a
slot inside the 5-minute booking cutoff.

## 44.2 A reschedule changes time and nothing else

`mentor_id`, `segment_id` and `gig_id` are **immutable** across a reschedule.
The request body carries a time and nothing else, and the server reads those
three columns from the booking row rather than accepting them. There is no code
path that moves a booking to another mentor, another gig or another segment.

**Removed:** the old "New gig must belong to the same mentor and segment" rule.
It described a decision a reschedule is not allowed to make, and rejecting a
seeker for it is what made the flow feel broken.

Rescheduling applies to a live pre-session booking (`MENTOR_PENDING` or
`CONFIRMED`). Changing the time of an *unpaid* booking is a re-book, not a
reschedule, and goes through the normal gig flow.

## 44.3 Global availability

The requested interval is validated against the **mentor's global timeline**:

- the mentor's live recurring hours, or the authoritative date exception
  (unavailable, or custom hours)
- every non-cancelled booking for that mentor, across **all** of their gigs
- every unexpired active hold for that mentor, across **all** of their gigs

**No `gig_id` or `segment_id` predicate appears in the availability or conflict
decision.** A Relationship gig booking at 17:00 makes 17:00 unrequestable for
an Autism reschedule; a free 17:00 is requestable for the existing Autism
booking. The underlying architecture is unchanged — this is the existing global
per-mentor model, simply no longer filtered by a gig the seeker was never
allowed to change.

The requested duration must equal the booking's own gig duration, so the
session length is preserved. That is the only place the gig is consulted, and
only for its length.

## 44.4 Concurrency and the temporary hold

On submission the seeker's **original booking is not released**. It stays
confirmed and keeps blocking its slot. The *requested* slot is protected
separately, by a real `slot_holds` row written before the request row, expiring
at `platform_config.reschedule_request_expiry_hours` (24h default) — far longer
than the 5-minute payment hold, because a mentor may take hours to answer.

The existing `no_overlapping_active_holds` exclusion is the concurrency
control: if another seeker commits a hold for the same instant first, the insert
fails and the whole transaction rolls back, so a `PENDING` request never exists
without a reservation behind it.

Both the request and the decision take `SELECT ... FROM profiles FOR UPDATE` on
the mentor row, matching `create_booking_with_hold`, and re-run their deadline
and availability checks *after* acquiring it.

| Event | Booking | Requested slot |
|---|---|---|
| Request submitted | **unchanged** | held until the request expires |
| Mentor **accepts** | `start_time`/`end_time` become the requested ones; old hold `RELEASED` | hold `CONVERTED` |
| Mentor **rejects** | **completely unchanged** | hold `RELEASED` |
| Seeker withdraws | unchanged | hold `RELEASED` |
| Unanswered after 24h | unchanged | hold `EXPIRED`, request `EXPIRED` |

Acceptance re-checks the slot for conflicts, excluding this booking and this
request's own hold, so a mentor cannot approve into a slot that was taken while
the request sat open.

**Implementation note:** `expire_stale_holds` ends with a sweep that releases
any `ACTIVE` hold whose booking is not `PAYMENT_PENDING`. A request's hold is
attached to `reschedule_requests`, not to a payment-pending booking, so it must
be excluded from that sweep — otherwise the next cron tick releases every
pending request's reservation. `expire_stale_reschedule_requests` runs on the
same one-minute schedule and is what actually expires unanswered requests.

Statuses: `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`
(`CANCELLED` is reachable only by a seeker withdrawing their own request). At
most one open request per booking, enforced by a partial unique index.

## 44.5 Access control

- Only the booking's **seeker** can create a request.
- Only the booking's **mentor** can accept or reject one; the mentor id is taken
  from the session, never from the body.
- An admin may read any request through `get_reschedule_request_for_booking`.
- `reschedule_requests` has a `SELECT`-only RLS policy. **No client can write
  one directly** — every transition goes through a `service_role`-only
  `SECURITY DEFINER` RPC, which re-checks ownership against the row.
- Postgres grants `EXECUTE` to `PUBLIC` on a new function, so phase 30
  explicitly revokes the new RPCs from `PUBLIC`, `anon` and `authenticated` and
  carries a `has_function_privilege('anon')` post-condition. Without the revoke
  the ownership checks inside those bodies would be reachable by an anonymous
  caller.

## 44.6 Wording

The UI must not imply the change has already happened. "Reschedule to this
time" is a promise the server does not keep.

| Surface | Text |
|---|---|
| Seeker booking detail | "Request Reschedule" |
| Submit button | "Send Reschedule Request" |
| After submitting | "Reschedule request sent to mentor" |
| Mentor panel heading | "Reschedule Request" |
| Mentor panel | `Current:` 30 Sep, 2:00 PM – 3:00 PM / `Requested:` 30 Sep, 5:00 PM – 6:00 PM |
| Mentor actions | `[ Accept ]` `[ Reject ]` |
| After acceptance | "Reschedule approved" |
| After rejection | "Reschedule request declined" |

The requested slot is not labelled "That time was not available" on every
refusal. A closed change window, a booking that can no longer move, and a
request already awaiting an answer each get their own heading, because "that
time was not available" is untrue for all three.

---

# 45. PAST BOOKINGS

Past bookings must never be bookable.

The system must reject:

- past dates
- past time slots
- expired holds
- already-booked intervals

This must be enforced server-side.

---

# 46. BOOKING STATES

**Actual values, permitted by `bookings_status_check` (8 values; 7 reachable):**

```text
                     ┌─────────────────────┐
                     │   PAYMENT_PENDING   │◄── Razorpay capture holds the
                     └──────────┬──────────┘    booking HERE until money is
        manual proof submitted │                actually captured
                               ▼                (the booking is never moved
                     ┌─────────────────────┐    to PAYMENT_PROCESSING)
                     │ PENDING_VERIFICATION│                │
                     └──────┬───────┬──────┘                │
           admin approves   │       │  admin rejects        │ verified capture
                            │       │                       │
                            ▼       ▼                       │
                   ┌──────────┐ ┌──────────┐                │
                   │MENTOR_   │ │CANCELLED │                │
                   │ PENDING  │ └──────────┘                │
                   └────┬─────┘                             │
        mentor confirms (HTTPS link required)               │
                        │                                   │
                        ▼                                   ▼
                 ┌───────────┐   cron / read-reconcile  MENTOR_PENDING
                 │ CONFIRMED │──────────────────────────┐   (from PAYMENT_PENDING)
                 └─────┬─────┘                          │
                       │                                ▼
                       │ any participant or       ┌─────────────┐
                       │ admin ends the session   │  COMPLETED  │
                       │ → actual_ended_at,       └─────────────┘
                       │   ended_by_role, end_reason
                       ▼
                   COMPLETED
```

`PENDING_VERIFICATION` is **not** in the overlap exclusion's excluded set, so
those bookings still block the mentor's slot — correctly, because the
commitment is live.

> **Corrections vs v1 of this document:**
> - `IN_PROGRESS` is **not** a `bookings.status` value. It is a computed session
>   projection. Confusing the two is the single most common error in this area
>   of the system.
> - `REJECTED` is **not** reached from `PAYMENT_PENDING` in the current code. The
>   payment path to a terminal state is `payments.status = REJECTED` **and**
>   `bookings.status = CANCELLED`.
> - `PAYMENT_PROCESSING` was added to `bookings_status_check` by
>   `20260927110000_phase25_payment_foundation.sql`, but **no current code path
>   writes it to a booking.** It is a `payments.status` value. The Razorpay flow
>   deliberately leaves the booking at `PAYMENT_PENDING` until capture, because
>   `expire_stale_holds()` only cancels `PAYMENT_PENDING` bookings.

### 46.1 Three separate vocabularies

| Concept | Where | Values |
|---|---|---|
| **Booking status** | `bookings.status` (column) | the 7 reachable values above |
| **Payment status** | `payments.status` (column) | 8 values, see §25 |
| **Session state** | computed by `resolve_session_state()` / `resolveSessionLifecycle()` — **not a column** | `SCHEDULED`, `ACCESS_OPEN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` |

The session projection:

```text
CANCELLED / REJECTED booking                  → CANCELLED
non-finite or missing start/end               → COMPLETED
actual_ended_at set                           → COMPLETED
bookings.status = COMPLETED                   → COMPLETED
serverNow >= end_time                         → COMPLETED
serverNow >= start_time − 5 min               → IN_PROGRESS if serverNow >= start,
                                                else ACCESS_OPEN
otherwise                                     → SCHEDULED
```

Only `COMPLETED` and `CANCELLED` are simultaneously a projection value and a
real booking status. `SCHEDULED`, `ACCESS_OPEN` and `IN_PROGRESS` exist only as
projections. The name is **`SCHEDULED`**, not `UPCOMING` — `UPCOMING` is only a
list-tab label in the UI.

### 46.2 Who writes which transition

| Transition | Writer |
|---|---|
| → `PAYMENT_PENDING` | `create_booking_with_hold()` RPC |
| `PAYMENT_PENDING` → `PENDING_VERIFICATION` | `POST /api/seeker/bookings/:id/payment-proof` |
| `PENDING_VERIFICATION` → `MENTOR_PENDING` | `review_payment()` RPC via `PATCH /api/admin/payments/:id/approve` |
| `PENDING_VERIFICATION` → `CANCELLED` | `review_payment(p_approve := false)` via `PATCH /api/admin/payments/:id/reject` |
| `PAYMENT_PENDING` → `MENTOR_PENDING` | `markBookingMentorPending()` on a server-verified capture — from `POST .../razorpay/verify` or the `payment.captured` webhook |
| `MENTOR_PENDING` → `CONFIRMED` | `POST /api/mentor/bookings/:id/confirm` |
| `PAYMENT_PENDING` → `CANCELLED` | hold-expiry cron, or seeker cancel |
| `CONFIRMED` → `COMPLETED` | completion cron, `POST /api/sessions/:bookingId/complete`, or read-reconcile |
| → `PAYMENT_PROCESSING` | **Nobody.** Permitted by the CHECK, written by no current code path. |

A browser cannot perform any of these. `authenticated` holds `UPDATE` on
`bookings` restricted to `(cancellation_reason, updated_at)`; every state change
requires a `SECURITY DEFINER` RPC or the service-role client.

---

# 47. PAYMENT STATES

**Actual values, enforced by `payments_status_check` (8 values):**

```text
MANUAL
PAYMENT_PENDING ──submit proof──► PENDING_VERIFICATION
                                        │
                            ┌───────────┴───────────┐
                       approve                  reject
                            │                       │
                            ▼                       ▼
                        VERIFIED               REJECTED
                    (booking → MENTOR_PENDING) (booking → CANCELLED)

RAZORPAY (payment row only; the booking row is untouched until capture)
  (no payment row) ──create order──► PAYMENT_PROCESSING
                                       │
                    ┌──────────────────┼──────────────────┐
            verified capture      capture failed   booking already dead
                    │                 │                 │
                    ▼                 ▼                 ▼
                VERIFIED           FAILED             FAILED
            (booking →        (payment_events     (payment_events
             MENTOR_PENDING)     row written)       row written,
                                (booking unchanged)  refund_status PENDING)

REFUND (event-driven only; nothing initiates a refund)
VERIFIED ──refund event──► REFUNDED | REFUND_FAILED
                        (a PENDING refund records bookkeeping columns only;
                         it never advances the payment's own status)
```

> **Historical:** `PENDING` / `APPROVED` / `REJECTED`. `APPROVED` became
> `VERIFIED`; the gateway path added `PAYMENT_PROCESSING`, `FAILED`, `REFUNDED`
> and `REFUND_FAILED`.

---

# 48. HOLD STATES

`slot_holds.status`, enforced by `CHECK (status IN ('ACTIVE','CONVERTED','EXPIRED','RELEASED'))`:

```text
ACTIVE ──booking created──► CONVERTED
   │
   ├──expires_at reached──► EXPIRED
   │
   └──booking left PAYMENT_PENDING──► RELEASED
```

> **Correction to v1 of this document:** `CONVERTED` was missing. A hold that
> becomes a booking is `CONVERTED`, not `RELEASED`. `RELEASED` is for a hold
> whose booking moved past `PAYMENT_PENDING` before the hold expired.

The only `ACTIVE` holds participate in the overlap exclusion constraint, so a
`CONVERTED`, `EXPIRED` or `RELEASED` hold no longer blocks the slot.

---

# 49. IMPORTANT BOOKING INVARIANTS

These must always hold. Each names the layer that enforces it.

## Invariant 1

One mentor cannot have overlapping live bookings.
*Database: `EXCLUDE USING gist (mentor_id WITH =, tstzrange(start,end,'[)') WITH &&) WHERE status NOT IN ('CANCELLED','REJECTED')`.*

## Invariant 2

One mentor cannot have overlapping active holds.
*Database: `EXCLUDE … WHERE status = 'ACTIVE'`.*

## Invariant 3

A mentor's availability is shared across all gigs.
*Database: `mentor_availability` has no `gig_id`.*

## Invariant 4

One mentor can have only one **active** gig per segment.
*Database: partial unique index on `(mentor_id, segment_id) WHERE is_active`.
Retired gigs are kept, so this is not a hard unique.*

## Invariant 5

A mentor without an active gig for a selected segment cannot be discovered for that segment.
*Database: `mentor_is_publicly_visible()` inside the RLS SELECT policies.*

## Invariant 6

A mentor with no valid slot on the selected date **is still listed** in the
directory. Bookability is a detail-page concern, not a listing filter.
*Frontend: `discoveryService` deliberately does not require bookability.*

## Invariant 7

Past slots cannot be booked.
*Server + database: `create_booking_with_hold()` against `clock_timestamp()`.*

## Invariant 8

Slots starting in under **5 minutes** cannot be booked.
*Server + database: `BOOKING_CUTOFF_MS`, enforced in the RPC.*

## Invariant 9

Expired holds release the slot and cancel the unpaid booking.
*Database: `pg_cron` → `expire_stale_holds()`, every minute.*

## Invariant 10

Payment rejection releases the slot; payment approval does not.
*Database: rejection sets `bookings.status = 'CANCELLED'`, which the overlap
exclusion excludes. Approval sets `MENTOR_PENDING`, which it does not.*

## Invariant 11

Meeting link is hidden from the seeker until T−5 minutes, on every projection.
*Server: `redactMeetingUrlForParticipant()`.*

## Invariant 12

Session cannot be joined before T−5 minutes, evaluated on the server clock.
*Server + database: `can_join_session()` RPC.*

## Invariant 13

Session cannot be joined after `end_time`.
*Server: `isInsideSessionAccessWindow()`.*

## Invariant 14

Mentor confirmation requires a valid HTTPS meeting link.
*Server + database: zod schema plus `chk_meeting_url_https`.*

## Invariant 15

Once `actual_ended_at` is set, the meeting link is revoked for the seeker
irrevocably, regardless of the T−5 window.
*Server: `redactMeetingUrlForParticipant()`.*

## Invariant 16

Booking creation is a single transaction, not a hold followed by an insert.
*Database: `create_booking_with_hold()`.*

## Invariant 17

A browser cannot change booking state.
*Database: `GRANT UPDATE(cancellation_reason, updated_at)` only.*

## Invariant 18

The booking amount is the amount charged. It is snapshotted at creation.
*Database: `bookings.amount_inr` with `CHECK (amount_inr >= 0)`.*

## Invariant 19

The payment amount is never taken from the browser.
*Server: Razorpay order and capture amounts are derived from stored data; a
mismatch is refused and audited.*

## Invariant 20

The session-completion notification is emitted at most once per user per
session.
*Database: partial unique index `uniq_notifications_session_completed`.*

## Invariant 21

Reconciliation never sets a booking to `CANCELLED`.
*Database: `reconcile_expired_sessions()` returns `NULL` when there is nothing
to do (fixed in `20260927060000_phase24b`).*

---

# 50. NOTIFICATIONS

MVP uses **in-app notifications only**. There is no email, SMS or push
integration.

**Actual fields** on `public.notifications`:

| Column | Notes |
|---|---|
| `id` | UUID PK |
| `user_id` | NOT NULL, FK → `profiles` CASCADE |
| `title`, `message` | NOT NULL |
| `type` | **Unconstrained `TEXT`.** The phase4 CHECK was dropped in `20260921000002_phase11_notifications.sql` and never re-added. `src/types/database.ts` `NotificationType` enumerates 7 values, which is stricter than the database. |
| `link` | in-app target path |
| `event_type`, `entity_type`, `entity_id` | added in phase11; make the notification link to the right row for each role |
| `is_read`, `read_at` | `is_read` NOT NULL default `false` |
| `metadata` | JSONB default `'{}'` |
| `created_at` | NOT NULL default `now()` |

API: `GET /api/notifications`, `GET /api/notifications/unread-count`,
`PATCH /api/notifications/:id/read`, `POST /api/notifications/mark-all-read`,
`POST /api/notifications/dispatch` (admin). All are scoped to the caller's own
rows in the database via `mark_notification_as_read(p_id, p_user_id)` and
`mark_all_notifications_as_read(p_user_id)`.

**Freshness is polling-only.** `notifications` is **not** in the
`supabase_realtime` publication, so updates arrive within up to ~30 s
(`NotificationContext` polls every 30 s; `useNotificationSync` uses a
visibility-gated 60 s interval, floor 30 s). See `docs/technical-audit.md` R1.

---

# 51. NOTIFICATION EVENTS

## Seeker

- booking created
- payment submitted
- payment approved
- payment rejected
- mentor pending
- mentor confirmed
- meeting link available
- session starting soon
- mentor cancelled
- booking rescheduled
- session completed
- workspace updated

## Mentor

- payment captured / approved
- new booking pending confirmation
- meeting link deadline approaching
- meeting link overdue
- session starting soon
- seeker cancelled
- booking rescheduled
- session completed

## Admin

- payment proof submitted
- mentor link overdue
- mentor cancellation
- booking requiring intervention
- mentor application submitted / approved / rejected
- login-failure threat alert

`SESSION_COMPLETED` is emitted **at most once per user per session**, enforced
by a partial unique index on `(user_id, event_type, entity_id)`.

---

# 52. TIMEZONE MODEL

Store timestamps in UTC.

Users have a timezone.

Mentor availability should be interpreted in mentor timezone.

Seeker discovery/booking UI should clearly communicate the displayed timezone.

The actual booking interval should be stored as an unambiguous UTC instant/range.

Never perform business logic using browser-local time alone.

---

# 53. DATABASE ARCHITECTURE

`supabase/migrations/` is the schema of record: **38 files**, applied in
timestamp order. `supabase/schema.sql` is a 968-byte stub and must not be used.

**28 tables exist in `public`:**

```text
identity      profiles, user_roles
catalog       segments, segment_topics, gig_topics
profiles      mentor_profiles, mentor_segments, seeker_profiles, gigs
availability  mentor_availability, mentor_availability_exceptions
booking       slot_holds, bookings, payments, payment_events, webhook_events
content       session_workspaces
onboarding    mentor_applications, mentor_verification_documents,
              mentor_document_types, mentor_application_audit
operations    platform_config, audit_logs, system_logs, system_log_retention,
              login_failure_config, login_failure_trackers
```

> **Correction to v1 of this document:** the list above is missing
> `segment_topics`, `gig_topics`, `payment_events`, `webhook_events`,
> `mentor_document_types`, `mentor_application_audit`, `platform_config`,
> `audit_logs`, `system_logs`, `system_log_retention`, `login_failure_config`
> and `login_failure_trackers`. All of them exist.

**No slot table and no `generate_slots` RPC exist.** Slots are computed at read
time by `src/lib/slotEngine.ts` from recurring availability minus exceptions
minus bookings minus active holds minus the past minus the 5-minute cutoff.

**Three storage buckets are created by migrations:** `payment-proofs` (private),
`mentor-verification-documents` (private), `segment-hero` (public read, admin
write).

**A fourth bucket, `payment-qr`, is referenced by application code but is never
created by any migration.** It is used by the admin UPI QR upload
(`PAYMENT_QR_BUCKET` in `src/lib/paymentProof.ts`; `server.ts:205`, `:8786`,
`:8845`). Against a database built purely from `supabase/migrations/`, that
upload fails. See `docs/technical-audit.md` P1.

RLS is enabled on **27 of the 28** tables; `platform_config` is the exception
(protected by grant scoping and the service-role client). `pg_cron` runs
`expire_stale_holds()` and `complete_expired_sessions()` every minute.

---

# 54. PROFILE / ROLE MODEL

Supabase Auth remains responsible for authentication.

Application profile data lives separately.

Recommended:

profiles
    id = auth.users.id
    display_name
    profile_photo
    timezone
    ...

user_roles
    user_id
    role

Roles:

- seeker
- mentor
- admin

Do not store passwords in application tables.

---

# 55. SECURITY

RLS must be enabled.

## Seeker

Can access:

- own profile
- own bookings
- own payments
- own notifications
- own session workspaces
- public mentor information
- active segments
- bookable availability

Cannot modify:

- payment approval
- booking state
- mentor availability
- another user's data

---

## Mentor

Can access:

- own profile
- own gigs
- own availability
- own bookings
- relevant seeker booking information
- own notifications
- own session workspaces

Cannot:

- approve own payment
- alter another mentor's availability
- access unrelated seeker private information
- manipulate booking ownership

---

## Admin

Admin can access operational data required to manage the platform.

Admin actions must still be auditable where appropriate.

---

# 56. PAYMENT PROOF STORAGE

Payment screenshots should use private storage.

Recommended:

payment-proofs

Storage must not be publicly accessible.

Use authenticated/signed access for Admin review.

Do not store public permanent URLs for payment screenshots.

---

# 57. ADMIN AUDITABILITY

Important admin actions should be traceable.

Recommended audit events:

- mentor approved
- mentor deactivated
- segment created
- segment edited
- segment priority changed
- payment approved
- payment rejected
- booking cancelled
- booking manually changed
- user created
- user role changed

---

# 58. ADMIN DASHBOARD

Dashboard should provide operational visibility.

Recommended metrics:

- total seekers
- total mentors
- pending mentor approvals
- pending payments
- mentor-pending bookings
- upcoming sessions
- completed sessions
- cancelled sessions

Do not fabricate numbers.

Every number must come from real database queries.

---

# 59. SETTINGS

Settings is the central account-management area.

## Seeker

- profile
- personal information
- profile photo
- bio
- timezone
- security/password
- notification preferences
- account settings

## Mentor

Everything above plus:

- segments
- gigs
- availability

---

# 60. AUTHENTICATION

Authentication uses **Supabase Auth**, email + password, with email-OTP
verification (`/auth/verify`, `/auth/callback`) and password reset by email.

No custom password storage. No OAuth provider is wired.

Authorization is role-based. Roles live in `user_roles`
(`CHECK (role IN ('seeker','mentor','admin'))`) and are re-read from the
database on every request — never trusted from client state.

After login:

```text
seeker → /seeker        mentor → /mentor        admin → /admin
```

A user may hold more than one role; `UNIQUE (user_id, role)` permits that.

Users must not reach another role's protected routes by manipulating the URL.
`ProtectedRoute` handles the UX, and every route is **independently authorized
server-side** — the client guard is not the control.

### 60.1 Demo personas

`POST /api/auth/demo-login` exists for local development and is fail-closed. It
requires all of:

- `ENABLE_DEMO_PERSONAS` exactly `"true"`
- `DEMO_TOKEN_SECRET` set, ≥ 32 characters, and not a known default
- `NODE_ENV !== 'production'`

The admin persona additionally requires `ADMIN_PASSWORD` ≥ 12 characters. The
client refuses demo login outright under `import.meta.env.PROD`.

---

# 61. ERROR HANDLING

Every important operation has a loading, empty, error and success state. Shared
components exist: `LoadingState`, `EmptyState`, `ErrorState`, `SuccessState`.

Server errors are structured:

```json
{ "success": false, "error": { "code": "...", "message": "...", "details": {} } }
```

Error responses never leak raw SQL, driver messages or internal paths — every
message passes through `logSanitizer` / `supabaseErrors` /
`respondWithInternalError`. Payloads and signatures are never logged; a failed
payment signature audit records the error **code** only.

A missing Supabase admin client returns `503`, never a silent downgrade to a
weaker client. Razorpay disabled returns `503` with the manual flow untouched.

---

# 62. CONCURRENCY / DOUBLE BOOKING

This is a high-priority engineering requirement and it is met.

Two seekers may attempt to book the same mentor and slot simultaneously. The
database guarantees only one succeeds. This does **not** depend on frontend
disabled buttons, React state, localStorage or client-side checks.

The guarantee is structural, at three levels:

1. **`EXCLUDE USING gist`** — no two `ACTIVE` holds overlap for a mentor, and
   no two live bookings overlap for a mentor.
2. **A partial unique index** on `(mentor_id, segment_id) WHERE is_active` for
   gigs.
3. **One atomic RPC** — `create_booking_with_hold()` performs hold creation,
   booking creation, hold conversion and payment-row creation inside a single
   transaction, and re-validates live availability at that moment rather than
   trusting the earlier read.

When the RPC refuses, it returns a `code: <REASON>, <text>` error string that
`server.ts` parses into a stable client-facing code.

---

# 63. BOOKING TRANSACTION

The transaction below is what `create_booking_with_hold()` actually performs.
Steps 1–11 are validation inside the function; steps 12–14 are the writes.

```text
 1. validate the seeker exists and is authenticated
 2. validate the mentor exists
 3. validate the gig exists, is active, and belongs to that mentor
 4. validate the segment and the mentor's membership of it
 5. validate the requested interval is well-formed (start < end)
 6. convert the requested time to an absolute instant
 7. reject past times
 8. reject times inside the 5-minute booking cutoff
 9. re-check live recurring availability for the mentor
10. re-check date exceptions
11. re-check conflicting bookings and ACTIVE holds
12. insert the slot_hold row (5-minute expiry, from platform_config)
13. insert the booking row (status = PAYMENT_PENDING)
14. insert the payments row and commit atomically
```

If any step fails, **no partial booking is created** — the whole transaction
rolls back. The Razorpay path additionally re-validates the hold
(`assertHoldStillValid`) immediately before creating an order, because the hold
may have expired since selection.

---

# 64. REAL-TIME / FRESHNESS

Booking availability should be refreshed frequently enough to avoid stale slots.

When a user opens a mentor/date:

fetch fresh availability.

After booking/hold:

refresh availability.

After hold expiry:

availability must become bookable again.

If realtime is used, it can improve UX, but server validation remains authoritative.

---

# 65. GLOBAL NAVIGATION IMPLEMENTATION RULES

The navigation architecture is part of the global UI system and must not be implemented as page-specific ad hoc navigation.

## 65.1 Navigation Components

Recommended shared structure:

```text
AppShell
├── SeekerShell
│   ├── TopNavigation
│   └── MainContent
│
├── MentorShell
│   ├── TopNavigation
│   └── MainContent
│
└── AdminShell
    ├── Sidebar
    └── MainContent
```

---

## 65.2 Navigation Configuration

Navigation should be driven from a centralized role-aware configuration.

Do not hardcode different navigation menus independently inside every page.

The authenticated role determines the shell and navigation configuration.

---

## 65.3 Responsive Behavior

### Seeker

Desktop:
- horizontal top navigation

Mobile:
- compact header
- navigation may collapse into a menu/sheet

### Mentor

Desktop:
- horizontal top navigation

Mobile:
- compact header
- navigation may collapse into a menu/sheet

### Admin

Desktop:
- persistent sidebar

Mobile:
- collapsible sidebar/drawer

---

## 65.4 Authorization

Changing the navigation UI must NOT be treated as authorization.

A user must not gain access to another role's protected routes by changing URLs or manipulating the client.

Role authorization must remain enforced server-side/database-side through the existing authentication and RLS architecture.

---

# 100. UI/UX PRINCIPLES

The UI should feel like a modern premium mentorship platform.

Avoid:

- generic SaaS dashboard appearance
- excessive repeated cards
- unnecessary tables for user-facing flows
- hardcoded demo data
- fake charts
- fake availability
- fake notifications
- confusing multi-step navigation

Prioritize:

- clear hierarchy
- strong mentor discovery
- obvious booking CTA
- clean slot selection
- transparent payment flow
- clear status communication
- countdown-driven session experience
- useful session history
- polished empty/loading/error states

The live design system is `docs/SUGGEST-KEY-UI-DESIGN-SYSTEM.md`. Product logic
and the role-specific navigation architecture come from this document.

---

# 101. PRIMARY SEEKER FLOW

## Manual payment path (the default)

```text
Login
 ↓
Home
 ↓
Segment (auto-selected, or chosen)
 ↓
Select Date
 ↓
Find All Mentors
 ↓
Mentor List
 ↓
Mentor Detail
 ↓
Select Slot
 ↓
5-minute Hold
 ↓
Payment screen (UPI id, QR, instructions from platform_config)
 ↓
Upload Payment Proof  →  PENDING_VERIFICATION
 ↓
Admin Approves
 ↓
MENTOR_PENDING
 ↓
Mentor Adds Meeting Link
 ↓
Mentor Confirms
 ↓
CONFIRMED
 ↓
T−5 Countdown
 ↓
Join Session
 ↓
Session Ends  →  COMPLETED
 ↓
History
 ↓
Session Workspace (once the mentor publishes it)
```

## Razorpay path (when `RAZORPAY_ENABLED === "true"`)

```text
…
Select Slot
 ↓
5-minute Hold
 ↓
Razorpay Checkout
 ↓
Server verifies the capture signature  →  MENTOR_PENDING
 ↓
Mentor Adds Meeting Link
 ↓
…identical from here
```

> **Correction to v1 of this document:** the hold is **5 minutes**, not 15.
> The flow is also no longer strictly linear — the Razorpay path skips the
> proof upload and the admin approval, so "Upload Payment Proof → Admin
> Approves" is a branch, not a mandatory stage.

## Primary mentor flow

```text
Signup / application
 ↓
Submit application + documents
 ↓
Admin verification
 ↓
Approved
 ↓
Gigs, segments, availability
 ↓
MENTOR_PENDING booking
 ↓
Add meeting link → Confirm
 ↓
Run session → End session
 ↓
Write and publish the workspace
```
