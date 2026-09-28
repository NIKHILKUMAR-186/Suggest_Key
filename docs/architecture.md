# Suggest Key — Architecture

Version: 2.0
Status: As-built (verified against current source)
Last verified: 2026-09-27

> This document describes the system that **actually exists in the repository today**.
> Every claim below was checked against source files, Supabase migrations, or a live
> `npm test` / `npm run lint` / `npm run build` run. Anything not verifiable in code is
> marked **Not verified in current implementation.**

---

## 1. Core Principles

- Supabase/PostgreSQL is the source of truth for business state.
- Production business data must be real database data.
- Supabase Auth handles authentication.
- RLS and server-side authorization protect private data.
- Booking, availability, payment, timing and session rules are enforced server-side
  and in the database, never in the browser.
- Mentor availability is global across all of a mentor's gigs.
- Payment is provider-abstracted behind a manual-QR implementation.
- UI is role-specific and renders real backend state.

---

## 2. Actual Runtime Topology

```text
Browser (React 19 SPA, built by Vite 8)
    |
    |  Supabase JS client  ──────────────►  Supabase Auth / Postgres / Storage / Realtime
    |  (direct queries, RLS-scoped)          (browser-side data path)
    |
    |  apiFetch() + Bearer token ────────►  Express API (server.ts, bundled → dist/server.cjs)
    |                                        |
    |                                        ├─► Supabase via service-role client
    |                                        └─► Supabase RPC / SECURITY DEFINER functions
    v
Vercel (vercel.json)
  /api/*      → /server.cjs   (serverless function)
  /*          → /index.html   (SPA fallback)
  /assets/*   → immutable cache
```

There is **no** Next.js, no SSR, and no separate backend service. One Express file
(`server.ts`, ~10,400 lines) is the entire API.

### Key files

| Concern | File |
|---|---|
| API surface (112 route registrations) | `server.ts` |
| Client route table | `src/routes/Router.tsx` |
| Auth context / role resolution | `src/context/AuthContext.tsx` |
| Server auth, role guards, service client | `src/lib/supabaseServer.ts` |
| Browser Supabase client | `src/lib/supabase.ts` |
| Booking/session rules (shared) | `src/lib/bookingEngine.ts` |
| Slot generation | `src/lib/slotEngine.ts` |
| Session access gating | `src/lib/sessionAccess.ts` |
| Browser session-state mirror | `src/lib/sessionState.ts` |
| Payment proof rules | `src/lib/paymentProof.ts` |
| Validation schemas | `src/lib/validation.ts` |
| Timing constants | `src/config/app.ts` |
| Navigation config | `src/config/navigation.ts` |
| Design tokens (CSS, live) | `src/index.css` |
| Migrations | `supabase/migrations/` (31 files) |

---

## 3. Technology Stack (as configured)

### Frontend
- React 19
- Vite 8.3.0
- TypeScript 7
- Tailwind CSS v4 via `@tailwindcss/vite`
- `motion` (animation), `lucide-react` (icons)

### Backend
- Express, bundled by esbuild to `dist/server.cjs` (`--platform=node --format=cjs`)
- `@supabase/supabase-js` for both browser and server
- Run locally with `tsx server.ts`

### Data
- Supabase Auth, PostgreSQL, Storage, Realtime
- Extensions: `uuid-ossp`, `btree_gist` (for exclusion constraints)

### Tooling
- Test runner: `tsx --test tests/**/*.test.ts` (Node's built-in `node:test`)
- Typecheck/lint: `tsc --noEmit`
- Deployment: Vercel

### Not present in this repository

These are **not** dependencies and must not be documented as part of the stack:

- Next.js
- shadcn/ui
- Framer Motion (the package is `motion`)
- Playwright
- Vitest
- Sentry
- PostHog
- Stripe, Razorpay, or any payment provider SDK

---

## 4. Scripts and Build

| Command | Action |
|---|---|
| `npm run dev` | `tsx server.ts` |
| `npm run build` | `vite build` then esbuild bundle of `server.ts` → `dist/server.cjs` |
| `npm start` | `node dist/server.cjs` |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | `tsx --test tests/**/*.test.ts` |

The `package.json` `name` field is still the scaffold default `react-example`.
This is cosmetic and does not affect the build, but it is not a product name.

### Verified build output (2026-09-27)

```text
dist/index.html            1.82 kB   (0.73 kB gzip)
dist/assets/index-*.css  135.78 kB  (21.53 kB gzip)
dist/assets/index-*.js  1,472.06 kB (351.43 kB gzip)
dist/server.cjs           487.0 kB
```

Vite emits a **chunk-size warning**: the main JS bundle exceeds the default 500 kB
limit. Code splitting is not implemented. This is a known performance gap, not a
build failure.

---

## 5. Role Shells and Navigation

Navigation is centralized in `src/config/navigation.ts` and consumed by
`AppShell` → `SeekerShell` / `MentorShell` / `AdminShell`.

```text
Authenticated User
        |
        v
    Role Check
    /     |      Seeker    Mentor    Admin
   |       |       |        |         |
Top Nav  Top Nav  Sidebar
```

### Seeker — top navigation (4 items)
- Home — `/seeker`
- My Bookings — `/seeker/bookings`
- Notifications — `/seeker/notifications`
- Settings — `/seeker/settings`

### Mentor — top navigation (5 items)
- Home — `/mentor`
- My Bookings — `/mentor/bookings`
- Availability — `/mentor/availability`
- Notifications — `/mentor/notifications`
- Settings — `/mentor/settings`

### Admin — sidebar (11 items)
- Dashboard — `/admin`
- Users — `/admin/users`
- Mentors — `/admin/mentors`
- Mentor Verification — `/admin/mentor-verification`
- Segments — `/admin/segments`
- Bookings — `/admin/bookings`
- Workspaces — `/admin/workspaces`
- Payments — `/admin/payments`
- Notifications — `/admin/notifications`
- System Health — `/admin/system-health`
- Settings — `/admin/settings`

---

## 6. Routing

Routing is a hand-written matcher in `src/routes/Router.tsx` (192 lines), not a
routing library. It compares `pathname` strings in priority order and returns
`NotFoundPage` for anything unmatched.

Route groups: public, auth, admin, public mentor directory (`/mentors/*`),
mentor, seeker.

Notable behaviours:

- `/mentors/*` is matched **before** the `/mentor` role block, because
  `startsWith('/mentor')` would otherwise capture it.
- `/admin/segments/:slug` is matched with a single-segment regex so a deeper
  path cannot reach the detail page.
- Unknown routes render a 404 page rather than silently falling back to landing.
- `ProtectedRoute` enforces: loading → not-authenticated → mentor-onboarding
  gate → role check. `admin` satisfies every `allowedRoles` check.

---

## 7. Data Model

22 tables exist across 31 migrations.

### Identity and roles
| Table | Purpose |
|---|---|
| `profiles` | Application profile; `id = auth.users.id`. Carries `account_status`, `suspended_at`, `suspended_until`, `suspension_reason`, `suspended_by`, `internal_note`, `deactivated_at`, `timezone`, `phone` |
| `user_roles` | Role membership (`seeker`, `mentor`, `admin`) |

### Catalog
| Table | Purpose |
|---|---|
| `segments` | Mentorship categories; `priority` (1 = highest), `is_active` |
| `mentor_segments` | Mentor ↔ segment membership, `is_primary` |

### Profiles and offering
| Table | Purpose |
|---|---|
| `mentor_profiles` | `approval_status` (`draft`/`pending_review`/`approved`/`rejected`), `is_approved`, `is_active`, `is_featured`, `rating`, `review_count`, `session_count`, `headline`, `about`, `years_of_experience`, `languages`, `expertise`, `created_via` |
| `seeker_profiles` | `preferred_language`, `notes` |
| `gigs` | Offering per mentor/segment: `duration_minutes` (30/45/60/90/120), `price_inr`, `is_active` |
| `mentor_availability` | Weekly recurring rules: `day_of_week` (0=Sun), `start_time`, `end_time`, `timezone` |
| `mentor_availability_exceptions` | Per-date overrides: `is_available`, custom hours, `reason` |

### Booking and payment
| Table | Purpose |
|---|---|
| `slot_holds` | 15-minute temporary reservation; `ACTIVE`/`CONVERTED`/`EXPIRED`/`RELEASED` |
| `bookings` | The booking record; `booking_code` (`BK-XXXXXXXX`); `seeker_timezone` + `mentor_timezone`; `actual_ended_at`, `ended_by_role`, `end_reason` |
| `payments` | One row per booking (`uq_payment_booking`); `proof_storage_path`, `transaction_reference`, `verified_by`, `rejection_reason` |

### Content
| Table | Purpose |
|---|---|
| `notifications` | `user_id` (NOT NULL), `type`, `event_type`, `entity_type`, `entity_id`, `link`, `read_at`, `metadata` |
| `session_workspaces` | One per booking; `status` `PENDING`/`PUBLISHED`; `summary`, `mentor_notes`, `takeaways`, `suggestions`, `next_steps`, `action_items`, `resources`, `follow_up_recommendation` |

### Mentor onboarding
| Table | Purpose |
|---|---|
| `mentor_applications` | Draft/submitted application with `years_of_experience`, `headline`, `requested_segment_ids` |
| `mentor_verification_documents` | Uploaded proof metadata; `status` |
| `mentor_document_types` | Admin-managed catalogue of required document types |
| `mentor_application_audit` | Per-application audit trail |

### Operations and security
| Table | Purpose |
|---|---|
| `system_logs` | Request/error logs by `request_id`, `category`, `level`, `status_code`, `path` |
| `audit_logs` | Actor-attributed admin actions |
| `system_log_retention` | Configurable retention window |
| `login_failure_config` | Login-failure alerting thresholds |
| `login_failure_trackers` | Per-identifier consecutive-failure counters |

> **`supabase/schema.sql` is stale.** It `\i`-includes only 10 of the 31
> migrations and omits phases 13b through 24f. It does **not** represent the
> current schema. Use `supabase/migrations/` as the source of truth.

---

## 8. Availability and Slot Generation

Availability belongs to the mentor, not the gig.

```text
Mentor
  ├─ recurring availability (mentor_availability)
  ├─ date exceptions      (mentor_availability_exceptions)
  ├─ bookings
  └─ active holds (slot_holds)
         ↓
    slot generation (server only)
```

Slots are **never** generated in the browser. `src/lib/discoveryService.ts` is the
single client entry point and it calls `GET /api/mentor-availability/slots`.

This is required, not stylistic: RLS scopes `bookings` and `slot_holds` to the
participants of a reservation, so a client query would only see the caller's own
rows and would advertise slots other seekers already own. There is **no fallback
slot list** — on failure the caller renders an error state, never invented times.

---

## 9. Concurrency and Integrity Constraints

These are enforced by the database, not by application code.

| Constraint | Definition |
|---|---|
| No overlapping active holds | `no_overlapping_active_holds EXCLUDE USING gist (mentor_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&) WHERE (status = 'ACTIVE')` |
| No overlapping active bookings | `no_overlapping_mentor_bookings EXCLUDE USING gist (mentor_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&) WHERE (status NOT IN ('CANCELLED','REJECTED'))` |
| One **active** gig per mentor/segment | `uq_active_gig_per_mentor_segment UNIQUE (mentor_id, segment_id) WHERE (is_active = TRUE)` |
| Meeting URL must be HTTPS | `chk_meeting_url_https` |
| Gig duration whitelist | `duration_minutes IN (30,45,60,90,120)` |

> The gig invariant is a **partial** unique index, not a hard
> `UNIQUE(mentor_id, segment_id)`. A mentor may hold multiple *inactive* gigs for
> the same segment; only one may be active at a time.

`create_booking_with_hold(...)` performs 12 validations inside a single
`SECURITY DEFINER` transaction, taking a pessimistic row lock on the mentor's
`profiles` row to serialize concurrent attempts for the same mentor.

---

## 10. Booking State Machine

The `bookings.status` column is constrained to exactly these values:

```text
PAYMENT_PENDING      hold created, awaiting payment
      │
      ├──► REJECTED            payment rejected
      ▼
PENDING_VERIFICATION  proof uploaded, awaiting admin
      │
      ├──► CANCELLED
      ▼
MENTOR_PENDING        payment verified, awaiting mentor confirmation
      │
      ├──► CANCELLED
      ▼
CONFIRMED             meeting link present and confirmed
      │
      ├──► CANCELLED
      ▼
COMPLETED             session ended
```

`IN_PROGRESS` is **not** a `bookings.status` value. It exists only in the
**session projection** computed by `resolve_session_state(...)`:

```text
SCHEDULED
ACCESS_OPEN      now >= start_time - 5m
IN_PROGRESS      start_time <= now < end_time
COMPLETED        now >= end_time
CANCELLED        booking was cancelled or rejected
```

`src/lib/sessionState.ts` mirrors these five values in the browser. The browser
copy is presentation only and is never authorization.

---

## 11. Payment

MVP method: **manual QR** (`MVP_PAYMENT_METHOD = 'manual_qr'` in
`src/config/app.ts`). No provider SDK is installed.

`payments.status` is constrained to:

```text
PENDING_VERIFICATION ──► VERIFIED
                    └──► REJECTED
```

Flow:

- `POST /api/bookings/hold` creates the hold and a `PAYMENT_PENDING` booking.
- Seeker uploads proof → booking becomes `PENDING_VERIFICATION`, payment row is
  `PENDING_VERIFICATION`.
- Admin approves → payment `VERIFIED`, booking `MENTOR_PENDING`. The slot stays
  blocked by the booking itself even though the hold has ended.
- Admin rejects → payment `REJECTED`, booking `REJECTED`, slot released.

### Payment proof storage

| Property | Value |
|---|---|
| Bucket | `payment-proofs` (private) |
| Max size | 5 MB |
| Bucket-allowed MIME | `image/png`, `image/jpeg`, `image/webp`, `application/pdf` |
| Client-accepted MIME | `image/png`, `image/jpeg`, `image/webp` only |
| Path convention | `<seekerId>/<bookingId>/<unique>-<sanitisedName>` |
| Transaction reference | required, `[A-Za-z0-9_-]`, 4–64 chars |

The client deliberately narrows the bucket's allowed types: `application/pdf` is
accepted by the bucket policy but rejected by `validateProofFile`. This is an
intentional product decision, not a bug. The first path segment must equal the
owner's user id, which is what the storage RLS policies key on.

Two more buckets exist: `payment-qr` (public, 2 MB, images only, path pattern
validated against a strict regex) and `mentor-verification-documents` (private,
reviewed by admins).

---

## 12. Timing Rules

All values are defined in `src/config/app.ts`.

| Constant | Value | Meaning |
|---|---|---|
| `HOLD_DURATION_MS` | 5 minutes | Slot hold lifetime (mirrors `platform_config.hold_duration_minutes`, which the SQL reads) |
| `BOOKING_CUTOFF_MS` | 5 minutes | A slot cannot be booked within 5 min of its start |
| `SESSION_ACCESS_WINDOW_MS` | 5 minutes | Meeting link hidden until T−5 |
| `MEETING_LINK_DEADLINE_MS` | 2 hours | Recommended deadline for mentor to add the link |
| `NORMAL_CANCELLATION_WINDOW_MINUTES` | 10 minutes | Normal seeker cancellation/reschedule cutoff |
| `DEFAULT_TIMEZONE` | `Asia/Kolkata` | Fallback when no timezone is set |

The 5-minute booking cutoff is a **separate** rule from the hold
lifetime. Migration `20260926030000_phase18_booking_cutoff_5min.sql` replaced an
earlier two-hour advance-booking restriction.

---

## 13. Session Access

```text
now <  start − 5m  ──► DENY  (404/403, no meeting URL leaked)
start − 5m ≤ now < end  ──► ALLOW
now ≥ end           ──► DENY
```

`GET /api/sessions/:bookingId/access` and `POST /api/sessions/:bookingId/join`
evaluate the gate against the **server clock only**. A `currentTime` field in the
body is still accepted for backwards compatibility with the local session
simulator and is deliberately ignored.

The caller must be the booking's seeker, its mentor, or an admin. Booking lookups
accept a UUID or an opaque booking code, and both are shape-validated in
`src/lib/sessionAccess.ts` before any PostgREST interpolation, so no caller input
reaches a filter as a raw clause.

Sessions are reconciled to `COMPLETED` before state is resolved, so an old
session URL is correct on first paint rather than on a later poll. This is
handled both by a database cron function and by a server-side reconcile call on
the access path.

---

## 14. Authentication and Authorization

### Authentication
- Supabase Auth (email/password, Google OAuth, email verification, password reset).
- Demo personas exist for local development only and are gated by
  `isDemoAuthEnabled()`: `NODE_ENV !== 'production'` **and**
  `ENABLE_DEMO_PERSONAS === 'true'` **and** a `DEMO_TOKEN_SECRET` of at least 32
  characters that is not a known default.
- Demo tokens are `skdemo.<base64url payload>.<HMAC-SHA256>` with a 24h TTL.
- The `admin` demo persona additionally requires an operator-set
  `ADMIN_PASSWORD` of at least 12 characters. If unset or too short, the admin
  persona is not offered at all.

### Role resolution
Roles come from the `user_roles` table on both client and server. Priority is
`admin` > `mentor` > `seeker` > `null`. There is **no** fallback to `seeker`; an
account with no role gets `activeRole = null` and is routed to the
unauthorized page.

### Server middleware
`requireAuth` → `requireAdmin` / `requireRole('seeker'|'mentor')` (both allow
`admin` bypass) → `requireActiveMentor`.

`requireActiveMentor` re-checks `mentor_profiles.approval_status`, `is_approved`,
`is_active` and `profiles.account_status` / `suspended_until` on every request.
It never trusts client state.

### Rate limiting
| Limiter | Limit | Window |
|---|---|---|
| All `/api` routes | 120 requests | 60 s |
| Expensive routes (auth, writes) | 10 requests | 60 s |

Keys are `user:<id>` when authenticated, otherwise a masked IP (IPv6 masked to
/56). The store is in-memory, so limits are **per instance** and are not shared
across Vercel serverless instances.

### Login failure alerting
Five consecutive failures for the same identifier within 15 minutes raises an
alert. The identifier is an HMAC of `email|ip`, salted from `LOGIN_ALERT_SALT`,
`SUPABASE_SERVICE_ROLE_KEY`, or `DEMO_AUTH_SECRET`.

---

## 15. RLS and Grants

- RLS is enabled on every public table.
- `20260927000000_phase19_security_lockdown.sql` revokes all privileges from
  `anon` on the `public`, `storage` and `realtime` schemas, and revokes `CREATE`
  on the schemas themselves.
- `authenticated` receives broad grants, but
  `20260927070000_phase24c_bookings_privilege_tightening.sql` then **narrows**
  `UPDATE` on `bookings` to a specific column list and revokes `DELETE` and
  `TRUNCATE` entirely. Column-level grants re-tightened by phase 24f.
- `service_role` retains full access.
- Session-mutating functions (`complete_expired_sessions`) are revoked from
  `PUBLIC`/`anon`/`authenticated` and granted only to `service_role`, so session
  state cannot be advanced by a client.
- Payment proofs are private; storage policies scope reads to the owning seeker
  or an admin.

---

## 16. Realtime and Freshness

The `supabase_realtime` publication contains exactly five tables
(`20260926020000_phase17_realtime_availability_sync.sql`), all with
`REPLICA IDENTITY FULL` so DELETE events are filterable:

```text
mentor_availability
mentor_availability_exceptions
slot_holds
bookings
gigs
```

Client channels:

| Hook | Channel | Subscribes to | In publication? |
|---|---|---|---|
| `useAvailabilitySync` | `availability:<mentorId\|all>` | the 5 published tables | yes |
| `useSessionSync` | `session:<bookingId>` | `bookings` | yes |
| `useNotificationSync` | `notifications:<userId>` | `notifications` | **no** |
| `usePaymentSync` | `seeker-payments:<seekerId>` | `payments`, `bookings` | `bookings` only |

`notifications` and `payments` are **not** in the publication, so those two
channels cannot receive events. In practice the polling fallbacks below cover
them. This is a real divergence between the intended design and the database
configuration — see the sync report.

Polling fallbacks (all paused when `document.visibilityState === 'hidden'`, except
where noted):

| Location | Interval |
|---|---|
| Availability sync | 45 s (min 15 s) |
| Notification sync | 60 s (min 30 s) |
| Payment sync | 60 s (min 30 s) |
| Session revalidation | 20 s |
| Session / payment countdown ticks | 1 s (local only, no request) |
| `NotificationContext` full refresh | 30 s — **not** visibility-gated |

---

## 17. Validation

`src/lib/validation.ts` defines a zod-style schema per mutating endpoint and the
routes mount them with `validateBody(...)`. All text fields are HTML-stripped
before length checks.

Representative limits: gig title 1–200, description ≤ 2000, price 0–10,000,000,
duration in {30,45,60,90,120}, availability rules ≤ 50 entries, availability
exceptions ≤ 200 entries, segment ids ≤ 12, notification message ≤ 2000,
rejection reason 1–500, meeting URL must be a valid HTTPS URL, log retention
1–365 days.

Booking identifiers accept either a UUID or an opaque booking code and are
shape-validated before use.

---

## 18. Testing

23 test files, run with `tsx --test`. Coverage is concentrated on the rules that
are expensive to get wrong: concurrency, availability, timezone/DST, the booking
cutoff, payment proof rules, session access, rate limiting, error/log
sanitisation, admin account control, mentor onboarding, notifications routing,
system health and system logs.

**Verified 2026-09-27:**

```text
ℹ tests    492
ℹ suites   115
ℹ pass     492
ℹ fail     0
ℹ duration_ms  2632
```

`npm run lint` (`tsc --noEmit`) is clean. `npm run build` succeeds.

Eight operational scripts exist under `scripts/`, including a live authenticated
exploit harness (`security-audit.mjs`), two end-to-end flows
(`e2e-mentor-bookings.mjs`, `e2e-payment.mjs`), a database probe
(`db-probe.mjs`), a storage RLS probe, and two verification scripts. These
require a live Supabase project and a running server; they are **not** part of
`npm test`.

---

## 19. Known Gaps and Defects

Recorded here so the architecture document does not overstate the system. Full
detail is in `docs/DOCUMENTATION-SYNC-REPORT.md`.

1. **`GET /api/admin/bookings/overdue-links` serves hard-coded demo data.**
   `server.ts:2729-2744` calls `getLocalBookingEngineContext()` — a literal
   in-memory fixture set — with no Supabase branch. Every sibling route queries
   Supabase first, or gates the fixture fallback behind "Supabase not configured".
   In a configured deployment this endpoint returns fabricated bookings to an
   authenticated admin.

2. **New mentor applications generate no admin notification.**
   `server.ts:8577` inserts a `notifications` row with `user_id: null`, but
   `notifications.user_id` is `NOT NULL`. The insert error is only
   `console.error`'d (`server.ts:8588`) and the route still returns HTTP 200. The
   correct pattern already exists in the same file
   (`insertPaymentNotifications` + `resolveActiveAdminIds`, `server.ts:266-298`)
   and the file's own doc-comment at `server.ts:257-260` states that the
   `user_id: null` pattern "is rejected by the live database".

3. **Two realtime channels subscribe to unpublished tables.**
   `notifications` and `payments` are absent from the `supabase_realtime`
   publication, so `useNotificationSync` and `usePaymentSync` receive no events.
   Polling masks the problem.

4. **`supabase/schema.sql` is incomplete** — includes 10 of 31 migrations.

5. **No code splitting.** Main JS bundle is 1,472 kB (351 kB gzip); Vite emits a
   chunk-size warning on every build.

6. **Rate limiting is per-instance.** The in-memory store does not aggregate
   across Vercel serverless instances, so the effective global limit is higher
   than the configured 120/min.

7. **`NotificationContext` polls every 30 s regardless of tab visibility.**

8. **`package.json` name is still the scaffold default** `react-example`.

---

## 20. Architecture Rule

> Business rules belong in server and database logic. The UI represents valid
> backend state.

Client-side role checks, countdowns and availability displays are UX only. If the
browser disagrees with the server, the server is correct.
