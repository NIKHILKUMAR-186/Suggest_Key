# Suggest Key — Rules

Version: 2.0
Status: As-built
Last verified: 2026-09-27

> Non-negotiable rules. Every value below is verified against source or a
> migration. Where a rule exists only in a comment, it is labelled as such.

---

## Data

1. No fake production business data.
2. Business data comes from Supabase.
3. Seed/demo data is only for development and testing.
4. The backend and database are authoritative.

---

## Authorization

1. Supabase Auth handles authentication. No custom password storage.
2. Roles are `seeker`, `mentor`, `admin`, read from `user_roles`.
3. RLS is enabled on every public table.
4. Client-side role checks are never security.
5. A user cannot reach another role's protected routes by changing a URL.
6. Ownership and role permissions are enforced server-side and in RLS.
7. `admin` satisfies every role check; there is no implicit `seeker` fallback, so
   an account with no role gets `null` and is routed to the unauthorized page.
8. Session-mutating database functions are revoked from `authenticated` and
   granted only to `service_role`.

---

## Navigation

1. Seeker: top navigation.
2. Mentor: top navigation.
3. Admin: sidebar.
4. Navigation is centralized and role-aware in `src/config/navigation.ts`.
5. Changing navigation UI is not authorization.

---

## Mentor

1. A mentor must be approved **and** active before appearing in discovery.
2. A suspended or deactivated mentor is removed from discovery immediately.
3. A mentor may belong to multiple segments.
4. At most one **active** gig per mentor per segment (partial unique index).
5. Availability is global across all of a mentor's gigs.

---

## Availability

1. Never hardcode or generate slots in the browser.
2. Interpret availability in the mentor's IANA timezone.
3. Store actual timestamps in UTC.
4. Date exceptions override recurring availability.
5. Past slots are never bookable.
6. Bookings and active holds must be included in conflict checks.
7. On a slot-request failure, render an error state — never a fallback list.

---

## Booking

1. Booking is a state machine over `PAYMENT_PENDING`, `PENDING_VERIFICATION`,
   `MENTOR_PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `REJECTED`.
2. Critical transitions are server-side.
3. No overlapping non-cancelled bookings for a mentor (PostgreSQL exclusion
   constraint, not application logic).
4. No overlapping active holds for a mentor (exclusion constraint).
5. Booking creation is atomic and pessimistically locked on the mentor row.
6. A failed validation creates no partial booking.
7. A slot cannot be booked within 5 minutes of its start.
8. A meeting URL, when present, must be HTTPS (check constraint).

---

## Hold

1. Duration: 5 minutes (`platform_config.hold_duration_minutes`).
2. States: `ACTIVE` → `CONVERTED` / `EXPIRED` / `RELEASED`.
3. Expiry is enforced server-side by a database cron function, which also
   cancels the linked `PAYMENT_PENDING` booking.
4. An expired hold releases the slot.

---

## Payment

1. MVP method is manual QR (`MVP_PAYMENT_METHOD = 'manual_qr'`). No provider SDK
   is installed.
2. States are `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`.
3. Admin is the sole payment verifier.
4. Payment proof storage is private, 5 MB max, PNG/JPEG/WebP only.
5. Proof paths are scoped under the owning seeker's user id, which is what the
   storage RLS policies key on.
6. A transaction reference is required.
7. Payment approval keeps the mentor's time blocked; only the hold ends.
8. Payment rejection releases the slot.
9. The payment layer must stay replaceable by a future provider.

---

## Confirmation

1. The mentor must add a valid HTTPS meeting link before confirming.
2. Recommended deadline: 2 hours before session start.
3. Missing the deadline does not automatically cancel the booking.

---

## Session

1. The link is hidden until T−5.
2. Join is denied before T−5.
3. Join is allowed from T−5 through end.
4. Join is denied at and after end.
5. The **server clock** is the only clock. Any client-supplied `currentTime` is
   accepted for compatibility and ignored.
6. Only the booking's seeker, its mentor, or an admin may query or join.
7. Non-participants and unknown bookings receive one sanitized 404 revealing
   nothing about existence, participants or code.
8. Booking identifiers are shape-validated before any database interpolation.
9. `IN_PROGRESS` is a computed session state, not a `bookings.status` value.

---

## Cancellation and Reschedule

1. Normal seeker cancellation and rescheduling require at least **10 minutes**
   before session start (`NORMAL_CANCELLATION_WINDOW_MINUTES`).
2. A reschedule must pass the same availability and conflict rules as a new
   booking.
3. Past slots are never rescheduled into.
4. Mentor cancellation notifies the seeker and admin.
5. Admin may intervene on any booking.

---

## UI

1. The UI reflects real backend state.
2. Important operations have loading, empty, error and success states.
3. No fake charts, metrics, availability or notifications.
4. Seeker and mentor surfaces stay clean; admin may be dense.
5. Avoid unnecessary navigation.
6. Consume semantic CSS tokens rather than hardcoded colors.
7. Validate every reusable component in both light and dark themes.

---

## Time

1. Store timestamps in UTC.
2. Store the user's timezone.
3. Interpret mentor availability in the mentor's timezone.
4. Browser-local time is never the business source of truth; countdowns are UX
   only.

---

## Security Hygiene

1. Payment proofs, mentor verification documents and session-workspace drafts are
   never publicly readable.
2. Rate limit all `/api` routes (120/min) and expensive auth/write routes
   (10/min). Note: the store is in-memory, so limits are per instance.
3. `anon` has no privileges on `public`, `storage` or `realtime`.
4. Demo personas require non-production, an explicit enable flag, and a strong
   signing secret; the admin persona additionally requires a 12+ character
   `ADMIN_PASSWORD`.
5. Login failure alerts fire after 5 consecutive failures in 15 minutes, keyed on
   an HMAC of `email|ip` rather than the raw value.
6. Every text input is HTML-stripped before validation.

---

## Development

1. Do not rewrite unrelated modules.
2. Do not bypass business rules.
3. Reuse shared UI components.
4. Keep business logic out of presentation where practical.
5. Test critical time, state and booking logic.
6. Prefer incremental vertical slices.
7. `supabase/migrations/` is the schema source of truth. `supabase/schema.sql` is
   incomplete (10 of 31 migrations) and must not be used to reason about the
   current schema.

---

## Definition of Done

A feature is done only when real data, authorization, server-side rules, states,
edge cases and relevant tests work.

---

## Current Known Violations

These are recorded in the code and should be fixed. They are listed here so they
are not mistaken for intended behaviour.

1. **`GET /api/admin/bookings/overdue-links` returns hard-coded demo bookings**
   (`server.ts:2729-2744`). It queries the in-memory fixture context with no
   Supabase branch, in a deployment where Supabase is fully configured. Every
   other route either queries Supabase first or explicitly gates the fixture
   behind "Supabase not configured".
2. **Mentor application submission writes no admin notification**
   (`server.ts:8577-8588`). The insert sets `user_id: null` against a `NOT NULL`
   column, the error is only logged, and the route still returns 200. The correct
   per-admin pattern is already implemented at `server.ts:266-298`.
3. **Two realtime channels cannot receive events.** `notifications` and
   `payments` are absent from the `supabase_realtime` publication, so
   `useNotificationSync` and `usePaymentSync` are polling-only in practice.
