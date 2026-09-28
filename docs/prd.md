# Suggest Key — Product Requirements Document

Version: 2.0
Status: As-built
Last verified: 2026-09-27

> Describes shipped behaviour. Where a requirement is not implemented, it is
> marked **Not currently implemented** rather than described aspirationally.

---

## 1. Product

Suggest Key is a mentorship marketplace that connects seekers with mentors for
booked 1:1 sessions, in India, priced in INR.

Three roles: **Seeker**, **Mentor**, **Admin**.

---

## 2. Core MVP Loop

```text
Discover mentor
  → Select slot
  → 15-minute hold
  → Manual QR payment
  → Upload proof
  → Admin verification
  → Mentor confirmation
  → Join at T−5
  → Session completes
  → Session workspace
```

---

## 3. Roles

### Seeker
- Sign in (email/password, Google OAuth)
- Manage profile, timezone, avatar, bio
- Browse segments and mentors
- Open a mentor directory with search, language, experience and segment filters
- Select a date and see server-generated slots
- Hold a slot and pay by manual QR
- Upload payment proof with a transaction reference
- Track payment and booking status
- Cancel and reschedule within the eligible window
- Join sessions during the allowed window
- Read published mentor workspaces
- Receive in-app notifications

### Mentor
- Sign in
- Apply for mentor verification and upload supporting documents
- Manage profile, segments and gigs
- Set gig duration and price
- Configure global recurring weekly availability and date exceptions
- View own bookings only
- Add an HTTPS meeting link and confirm the session
- Run and publish the session workspace
- Receive in-app notifications

A mentor must be approved **and** active before appearing in seeker discovery.

### Admin
- Manage users: create, edit, activate/deactivate, suspend/reactivate
- Manage mentors: approve, reject, activate/deactivate, suspend, edit profile
- Review mentor verification applications and documents
- Manage segments: create, edit, activate, reorder priority
- Manage gigs across mentors and segments
- Inspect availability and slots for any mentor
- View the full booking ledger and per-user booking history
- Approve or reject payments
- Inspect session workspaces
- Send a direct notification to a user
- Trigger a password reset or resend an invite
- Review system health, logs and audit trail; set log retention
- Manage public platform payment configuration (UPI ID, QR, instructions)

Admin is the final authority for manual payment verification.

---

## 4. Navigation

Centralized in `src/config/navigation.ts`.

### Seeker — top nav
Home · My Bookings · Notifications · Settings

### Mentor — top nav
Home · My Bookings · Availability · Notifications · Settings

### Admin — sidebar (11 items)
Dashboard · Users · Mentors · Mentor Verification · Segments · Bookings ·
Workspaces · Payments · Notifications · System Health · Settings

---

## 5. Discovery

Two distinct listings, deliberately not the same query:

**Available mentors** (seeker Home) — a mentor appears only if **all** hold:

1. `mentor_profiles.is_approved = true`
2. `mentor_profiles.is_active = true`
3. `profiles.account_status` is not `suspended` or `deactivated`
4. a `mentor_segments` row exists for the selected segment
5. an active `gigs` row exists for that segment
6. the readable `profiles` row yields a real `full_name`
7. at least one bookable slot exists on the selected date

A mentor with zero valid slots is omitted, because they cannot be booked.

**All mentors** (directory) — gated on approved + active + not suspended +
deactivated only. Bookability is *not* required; a mentor with no slots must
still be listed so the page can say so and offer "choose another date".

Eligibility is computed through the same shared `deriveAccountState` used by the
server and the Admin Control Center, so discovery, booking validation and the
admin UI cannot disagree about whether a suspension is still in force. A
time-boxed suspension that has already elapsed no longer hides the mentor.

Mentors are never rendered with a fabricated fallback name. If the `profiles` row
is unreadable the mentor is skipped with a console warning.

---

## 6. Segments

Segments are admin-managed categories with `priority` (lower number = higher
priority) and an `is_active` flag. Home auto-selects the highest-priority active
segment. There is no hardcoded default segment.

---

## 7. Gigs

A gig is a mentor's offering inside one segment: title, description, duration
(30/45/60/90/120 minutes) and price in INR.

**Invariant: at most one *active* gig per mentor per segment**, enforced by a
partial unique index. A mentor may retain inactive gigs for the same segment.

---

## 8. Availability

- Owned by the mentor, not the gig — a mentor's time is globally shared across
  all gigs and segments.
- Weekly recurring rules, stored with the mentor's IANA timezone.
- Date exceptions override recurring rules entirely; an exception may mark a
  date unavailable or define custom hours.
- Slots are generated **on the server only**, from recurring rules, exceptions,
  the gig duration, the selected date, the mentor timezone, current time,
  bookings and active holds, with DST stabilisation.
- Past slots are never bookable.
- There is no client-side fallback slot list. A failed request produces an error
  state, never invented times.

---

## 9. Booking and Holds

- A hold lasts **15 minutes** and blocks the slot for every other seeker.
- Booking is atomic: `create_booking_with_hold` runs 12 validations in one
  transaction and takes a pessimistic row lock on the mentor.
- A slot cannot be booked within **5 minutes** of its start
  (`BOOKING_CUTOFF_MS`).
- Hold expiry is enforced server-side by a database cron function that also
  cancels the linked `PAYMENT_PENDING` booking.
- A failed validation creates no partial booking.

### Booking states

```text
PAYMENT_PENDING → PENDING_VERIFICATION → MENTOR_PENDING → CONFIRMED → COMPLETED
   │                    │                     │              │
   └── REJECTED         └── CANCELLED        └── CANCELLED  └── CANCELLED
```

`IN_PROGRESS` is not a booking status; it is a computed session state.

---

## 10. Payment

Manual QR only. No payment provider SDK is installed. `MVP_PAYMENT_METHOD` is
`manual_qr`.

Payment states: `PENDING_VERIFICATION` → `VERIFIED` or `REJECTED`.

The payment screen shows booking summary, mentor, segment, date/time, duration,
amount, the admin-configured QR, instructions, the deadline, and the proof
upload control. Public payment configuration (UPI ID, QR image, instructions) is
nullable and admin-managed; nothing is hardcoded or invented client-side.

Proof upload rules: private bucket, 5 MB max, PNG/JPEG/WebP only, transaction
reference required, filename sanitised, path scoped under the seeker's own id.

**On approval:** payment becomes `VERIFIED`, booking becomes `MENTOR_PENDING`.
The slot stays blocked by the booking even though the hold has ended.

**On rejection:** payment becomes `REJECTED`, booking becomes `REJECTED`, and the
slot is released.

---

## 11. Mentor Confirmation

After payment approval the booking is `MENTOR_PENDING`. The mentor adds a valid
HTTPS meeting URL and confirms; the booking becomes `CONFIRMED` and the seeker is
notified. A meeting link is required before confirmation.

Recommended deadline for adding the link is 2 hours before start. Missing the
deadline does **not** automatically cancel the booking.

---

## 12. Session Access

```text
now <  start − 5m   ──► denied
start − 5m ≤ now < end ──► allowed
now ≥ end           ──► denied
```

- The meeting link is hidden from seekers until T−5.
- The gate is evaluated on the **server clock**; any client-supplied timestamp is
  accepted for compatibility and ignored.
- Only the booking's seeker, its mentor, or an admin may query or join.
- Non-participants and unknown bookings receive one sanitized 404 that reveals
  nothing about existence, participants or code.
- Sessions are reconciled to `COMPLETED` before state is resolved, so a stale URL
  is correct on first paint.
- Completion requires a real `CONFIRMED` booking whose start time has passed, and
  writes with a conditional atomic update so concurrent completion cannot
  double-apply.

---

## 13. Session Workspace

One workspace per booking, created blank at booking conversion and filled in by
the mentor.

Sections: overview (mentor, seeker, segment, gig, date, time, duration, status),
mentor notes, key takeaways, suggestions, next steps, and an optional
follow-up recommendation.

Visibility: a seeker can read a workspace only once it is `PUBLISHED`. A mentor
can create and edit. An admin can read for operational support.

---

## 14. Cancellation and Reschedule

**Normal seeker cancellation and rescheduling require at least 10 minutes before
session start** (`NORMAL_CANCELLATION_WINDOW_MINUTES = 10`).

> This is not a 24-hour rule. The 10-minute window is the implemented and tested
> behaviour; documentation elsewhere in this repository that says 24 hours is
> wrong.

A reschedule must target a genuinely available slot and pass the same conflict
checks as a new booking. Past slots are never allowed.

A mentor cancellation notifies the seeker and admin. Admin can intervene on any
booking. Refund handling is an admin-operated workflow because payments are
manually verified.

---

## 15. Notifications

In-app only. There is no email, SMS or push channel.

Events implemented: booking created, payment submitted, payment approved, payment
rejected, mentor pending, mentor confirmed, cancellation, rescheduling, session
completed, workspace published, mentor application submitted/approved/rejected,
and system alerts.

Notification links are **role-aware**: the destination is resolved from the
event's subject per role rather than trusting the stored string, so an admin
clicking "Review Payment" always lands on an admin route with that payment's
id, never on a participant page.

> **Gap:** new mentor applications do not currently notify admins. The insert
> uses `user_id: null` against a `NOT NULL` column and fails silently. Admins
> find new applications only by polling the verification list. See the sync
> report.

---

## 16. UX Expectations

- Real data only. No fabricated metrics, charts, notification counts or
  availability anywhere.
- Explicit loading, empty, error and success states for every meaningful
  operation.
- Seeker and mentor surfaces stay uncluttered; admin is allowed to be denser and
  operational.
- Both light and dark themes are supported via CSS custom properties.
- Countdowns are UX only and never a security control.

---

## 17. Not Currently Implemented

The following are **not** part of the shipped product and must not be documented
as features:

- Automated payment processing or any payment provider integration
  (Razorpay, Stripe, etc.)
- Email, SMS or push notification delivery
- Ratings submission and review authoring by users — `rating` and `review_count`
  exist on `mentor_profiles` and are displayed, but there is no seeker-facing
  review flow in the current code
- In-app video/voice; sessions link out to an external meeting URL
- Multi-session packages, subscriptions or wallet/ledger
- Seeker-side rescheduling by a mentor, or any mentor-initiated cancellation
  endpoint
- Intelligent mentor matching
- Structured outcome analytics beyond the session workspace fields
