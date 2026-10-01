# Suggest Key — Architecture

Version: 3.1
Status: As-built / Current
Last verified: 2026-09-29

Authoritative technical description of the repository as it exists today.
Source of truth, in order:

1. `server.ts` and `src/`
2. `supabase/migrations/` (38 files, applied in timestamp order)
3. `tests/` (43 test files)
4. `package.json`, `vercel.json`, `.env.example`
5. Everything else in `docs/`

Where a statement here cannot be traced to one of the above, it says so
explicitly. Nothing in this document is aspirational.

---

## 1. Core Principles

| # | Principle | How it is enforced |
|---|---|---|
| 1 | Real data only | Every list/detail view reads Supabase through `/api/*`. The in-memory fixtures in `src/lib/bookingService.ts` exist only as a local-development `BookingEngineContext` (see §19). |
| 2 | The backend is the source of truth | The browser never computes bookability, cost, payment state or session state authoritatively. It calls `/api/*`. |
| 3 | The database is the final arbiter | Concurrency, overlap, state legality and hold expiry are enforced by constraints, exclusion constraints, RPCs and `pg_cron`, not by application code. |
| 4 | The server clock is authoritative | Time gates are evaluated with the server's clock. The browser is told the offset and renders from that, but never decides. |
| 5 | Secrets never reach the client | Razorpay key secret, webhook secret, Supabase service-role key are read lazily in server-only modules and are never sent in a response. |
| 6 | Fail closed | Unknown route → `NotFoundPage`. Missing role → `ProtectedRoute` blocks. Missing Supabase admin client → `503`. Unverifiable payment → refused, never assumed. |

---

## 2. Runtime Topology

```text
                      ┌──────────────────────────────┐
   Browser  ────────► │  Vercel edge                 │
                      │  rewrites                    │
                      │   /api/(.*)  → /server.cjs   │
                      │   /(.*)      → /index.html   │
                      └───────┬──────────────┬───────┘
                              │              │
                    static assets        Express 4 API
                    (immutable, 1y)      (dist/server.cjs)
                                             │
                        ┌────────────────────┼────────────────────┐
                        ▼                    ▼                    ▼
                Supabase Auth        Supabase Postgres      Supabase Storage
                (JWT)                (PostgREST + RPCs)     (3 buckets)
                                          │
                                          ▼
                                   Supabase Realtime
                                   (publication, 10 tables)
```

Local development is a different topology: `npm run dev` runs `tsx server.ts`
and Vite separately; the dev server proxies `/api` to the Express process.

### Key files

| File | Role |
|---|---|
| `server.ts` | 12,042-line Express app. 131 `/api/*` routes + 1 SPA catch-all. Owns auth middleware, validation, booking/payment/session orchestration, logging. |
| `src/main.tsx` | React entry. |
| `src/App.tsx` | Provider composition (Theme, Auth, Navigation, PageMeta, Toast, Notification, SegmentTheme, SegmentExperience). |
| `src/routes/Router.tsx` | Hand-rolled path matcher. No React Router. |
| `src/lib/bookingEngine.ts` | Server-side booking rules: session access, join authority, mentor confirmation, completion reconciliation. |
| `src/lib/bookingService.ts` | Browser-side booking client + the local development `BookingEngineContext`. |
| `src/lib/slotEngine.ts` | Slot generation from recurring availability + exceptions. |
| `src/lib/razorpayService.ts` | Razorpay order/verify/webhook orchestration. Gateway-agnostic via a `RazorpayGatewayClient` interface. |
| `src/lib/razorpayStore.ts` | Supabase adapter satisfying the `RazorpayStore` persistence port. |
| `src/lib/paymentProof.ts` | Manual UPI/QR proof validation, status constants, storage paths. |
| `src/lib/validation.ts` | Zod schemas for every validated request body. |
| `src/lib/supabaseServer.ts` | Service-role client factory, role resolution, `requireAuth`/`requireAdmin`/`requireRole`/`requireActiveMentor`. |
| `supabase/migrations/` | 38 SQL files. The schema of record. |
| `supabase/schema.sql` | **Stub.** 968 bytes, `\i`-includes only a subset of migrations. Not the source of truth. Do not use. |

---

## 3. Technology Stack (as configured in `package.json`)

### Frontend

| Package | Version |
|---|---|
| `react` / `react-dom` | ^19.0.1 |
| `vite` | ^8.3.0 |
| `typescript` | ^7.0.2 |
| `tailwindcss` + `@tailwindcss/vite` | ^4.3.3 |
| `lucide-react` | ^0.546.0 |
| `motion` | ^12.23.24 |
| `clsx`, `tailwind-merge` | ^2.1.1 / ^3.7.0 |
| `@supabase/supabase-js` | ^2.116.0 |
| `@google/genai` | ^2.4.0 |

### Backend

| Package | Version |
|---|---|
| `express` | ^4.21.2 |
| `express-rate-limit` | ^8.7.0 |
| `zod` | ^4.6.5 |
| `dotenv` | ^17.2.3 |
| `esbuild` (dev) | ^0.28.0 |

### Data

Supabase: Auth (email/password, email OTP verification), Postgres, PostgREST,
Storage, Realtime, `pg_cron`, `pgcrypto`/`uuid-ossp` for ids.

### Tooling

| Command | Definition |
|---|---|
| `npm run dev` | `tsx server.ts` |
| `npm run build` | `vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs` |
| `npm start` | `node dist/server.cjs` |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | `tsx --test tests/**/*.test.ts` |

Node engine: `22.x`.

### Not present in this repository

Next.js, shadcn/ui, Framer Motion, Playwright, Vitest, Jest, Sentry, PostHog,
Redux/Zustand, a form library, a table component, any payment-provider SDK.
Razorpay is integrated over plain `fetch` — there is deliberately no vendor SDK.

---

## 4. Scripts and Build

`vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "installCommand": "npm install",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/server.cjs" },
    { "source": "/(.*)",      "destination": "/index.html"   }
  ],
  "headers": [
    { "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control",
                    "value": "public, max-age=31536000, immutable" }] }
  ]
}
```

The rewrite is order-sensitive: `/api/(.*)` must precede `/(.*)`.

There is no `vercel-build` step, no `prisma migrate`, and no migration runner
in the deploy pipeline. Migrations are applied out of band via the Supabase CLI
or SQL editor.

---

## 5. Role Shells and Navigation

Defined in `src/config/navigation.ts` (`ROLE_NAVIGATION`), consumed by
`src/components/navigation/TopNavigation.tsx` (seeker, mentor) and
`AdminSidebar.tsx` (admin).

### Seeker — top navigation (4 items)

| id | Label | Href |
|---|---|---|
| `seeker-home` | Home | `/seeker` |
| `seeker-bookings` | My Bookings | `/seeker/bookings` |
| `seeker-notifications` | Notifications | `/seeker/notifications` |
| `seeker-settings` | Settings | `/seeker/settings` |

### Mentor — top navigation (5 items)

| id | Label | Href |
|---|---|---|
| `mentor-home` | Home | `/mentor` |
| `mentor-bookings` | My Bookings | `/mentor/bookings` |
| `mentor-availability` | Availability | `/mentor/availability` |
| `mentor-notifications` | Notifications | `/mentor/notifications` |
| `mentor-settings` | Settings | `/mentor/settings` |

`MentorGigsPage` and `MentorSegmentsPage` are routable at `/mentor/gigs` and
`/mentor/segments` but are **not** in `ROLE_NAVIGATION`. They are reached by
in-page links, not by the top nav.

### Admin — sidebar (11 items)

| id | Label | Href |
|---|---|---|
| `admin-dashboard` | Dashboard | `/admin` |
| `admin-users` | Users | `/admin/users` |
| `admin-mentors` | Mentors | `/admin/mentors` |
| `admin-mentor-verification` | Mentor Verification | `/admin/mentor-verification` |
| `admin-segments` | Segments | `/admin/segments` |
| `admin-bookings` | Bookings | `/admin/bookings` |
| `admin-workspaces` | Workspaces | `/admin/workspaces` |
| `admin-payments` | Payments | `/admin/payments` |
| `admin-notifications` | Notifications | `/admin/notifications` |
| `admin-system-health` | System Health | `/admin/system-health` |
| `admin-settings` | Settings | `/admin/settings` |

`/admin/users/create` and `/admin/system-health/logs` are routable but not
separate nav entries.

---

## 6. Routing

`src/routes/Router.tsx` is a sequential `if` chain over
`useNavigation().currentPath`, not a router library. Order matters and the
file documents the two ordering hazards (`/mentors` before `/mentor`).

### Public

| Path | Component |
|---|---|
| `/` | `LandingPage` |
| `/auth/login`, `/login` | `LoginPage` |
| `/auth/signup`, `/signup` | `SignUpPage` |
| `/auth/forgot-password` | `ForgotPasswordPage` |
| `/auth/reset-password` | `ResetPasswordPage` |
| `/auth/verify` | `VerifyPage` |
| `/auth/callback` | `AuthCallback` |
| `/auth/unauthorized`, `/403` | `UnauthorizedPage` |
| `/mentor/signup` | `MentorSignupPage` |
| `/mentor/verification` | `MentorVerificationPage` |
| anything else | `NotFoundPage` |

`/mentor/verification` is **not** wrapped in `ProtectedRoute`.

### Seeker + admin (allowedRoles `['seeker','admin']`)

`/seeker` · `/seeker/mentors` · `/seeker/mentor-profile` ·
`/seeker/mentor-detail` · `/seeker/payment` and `/seeker/checkout` ·
`/seeker/bookings` · `/seeker/booking-detail` · `/seeker/session` ·
`/seeker/workspace` · `/seeker/notifications` · `/seeker/settings`

`/seeker/mentor-profile` (`SeekerMentorProfilePage`) is the **read-only**
public mentor profile, and `/seeker/mentor-detail`
(`SeekerMentorDetailPage`) is the **transactional** slot-selection and
booking page. They are separate routes on purpose: the profile never creates a
hold and never reaches Razorpay. The profile's "Back" is the shared
`mentorDetailBackPath()` helper, so both pages return to the same contextual
landing page.

`/mentors` and `/mentors/*` → `MentorDirectoryPage`, allowedRoles
`['seeker','admin']`.

#### Public read API behind these two routes

| Method | Route | Auth | Role | Purpose |
|---|---|---|---|---|
| `GET` | `/api/seeker/segments/:slug/mentors` | none | — | Discovery list for one segment, optionally topic- and date-filtered |
| `GET` | `/api/seeker/mentors/:id/profile` | none | — | One mentor's public profile and **all** of their active offers |

Both are read-only and unauthenticated, and both apply the same eligibility
rule in TypeScript, not in SQL: a `profiles` row with a real `full_name`, an
`approved` + `approved` + `is_active` `mentor_profiles` row,
`deriveAccountState(...).canPerformOperationalActions` (so a suspended or
deactivated account is excluded), and at least one segment membership. RLS
already hides most of these under the anon key, but the predicate is repeated
because both handlers read through the service-role client, which bypasses RLS.

A mentor who is unapproved, deactivated, suspended or a member of no segment is
`404` from `/api/seeker/mentors/:id/profile` rather than an empty profile, so
the endpoint cannot be used to confirm that such a mentor exists.

`/api/seeker/mentors/:id/profile` uses the service role, because `profiles` RLS
is own-row-or-admin and a seeker is therefore unable to read another mentor's
profile row with the anon key. It compensates with an **explicit** column
list — `SELECT *` is never used — and returns only:

- from `mentor_profiles`: `id`, `headline`, `about`, `experience_years`,
  `languages`, `expertise`, `is_approved`, `is_featured`, `is_active`,
  `approval_status`
- from `profiles`: `id`, `full_name`, `avatar_url`, `timezone`,
  `account_status`, `suspended_until` — of which the last two are read **only**
  as part of the eligibility gate and are never echoed to the client

It never exposes contact details, notes, verification documents, or any
transactional table (bookings, slots, holds, payments). The profile page itself
creates no hold and calls no payment API; it links to `/seeker/mentor-detail`
with an explicit `gigId` so that booking context is named rather than inferred.

### Mentor + admin (allowedRoles `['mentor','admin']`)

`/mentor` · `/mentor/availability` · `/mentor/bookings` ·
`/mentor/booking-detail` · `/mentor/workspace` · `/mentor/gigs` ·
`/mentor/segments` · `/mentor/notifications` · `/mentor/settings`

### Admin only (allowedRoles `['admin']`)

`/admin` · `/admin/users` · `/admin/users/create` · `/admin/users/:id` ·
`/admin/mentor-verification` · `/admin/mentor-verification/:id` ·
`/admin/mentors` · `/admin/mentors/:id` · `/admin/segments` ·
`/admin/segments/:slug` · `/admin/bookings` · `/admin/workspaces` ·
`/admin/payments` · `/admin/notifications` · `/admin/system-health` and
`/admin/system-health/logs[/:requestId]` · `/admin/settings`

Segment detail uses the strict regex `^/admin/segments/[^/]+$` so a deeper path
cannot be misread as a segment slug.

`/admin/segments/:id/...` and `/admin/segments/:segment/...` are **client-side
sub-routes** handled inside `AdminSegmentDetailPage`; they are not separate
`Router.tsx` branches.

---

## 7. Data Model

28 tables in `public` after all 38 migrations. Reconstruction below is from
`supabase/migrations/`, cross-checked against `src/types/database.ts`.

### Identity and roles

| Table | Key columns | Constraints |
|---|---|---|
| `profiles` | `id` (PK, FK→`auth.users` CASCADE), `email`, `full_name`, `timezone` NOT NULL default `'Asia/Kolkata'`, `avatar_url`, `phone`, `account_status` NOT NULL default `'active'`, `suspended_at`, `suspended_until`, `suspension_reason`, `suspended_by`, `internal_note`, `deactivated_at`, `created_at`, `updated_at` | `CHECK (account_status IN ('active','suspended','deactivated'))` |
| `user_roles` | `user_id` FK→`auth.users` CASCADE, `role`, `created_at` | `CHECK (role IN ('seeker','mentor','admin'))`; `UNIQUE (user_id, role)` |

`mentor_profiles.id` is also a FK to `profiles(id)` ON DELETE CASCADE, so
deleting the auth user cascades identity, mentor profile, segments, gigs and
availability in one go.

### Catalog

| Table | Key columns | Constraints |
|---|---|---|
| `segments` | `name` NOT NULL UNIQUE, `slug` UNIQUE, `description`, `priority` NOT NULL default 0, `is_active` NOT NULL default true, `experience_config` JSONB NOT NULL default `'{}'`, `created_at`, `updated_at` | — |
| `segment_topics` | `segment_id` FK→`segments` CASCADE, `name`, `slug`, `description`, `priority`, `is_active`, `created_at`, `updated_at` | `CHECK (length(btrim(name)) BETWEEN 1 AND 80)`; `CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')`; `CHECK (description IS NULL OR length(description) <= 200)`; `UNIQUE (segment_id, slug)` |
| `gig_topics` | `gig_id` FK→`gigs` CASCADE, `topic_id` FK→`segment_topics` CASCADE, `created_at` | `UNIQUE (gig_id, topic_id)`; trigger `enforce_gig_topic_segment_ownership` forbids linking a topic from a different segment than the gig's |

### Profiles and offering

| Table | Key columns | Constraints |
|---|---|---|
| `mentor_profiles` | `id` PK→`profiles` CASCADE, `headline` NOT NULL default `''`, `about`, `experience_years` NOT NULL default 0, `languages` text[] NOT NULL default `['English','Hindi']`, `expertise` text[], `rating` NUMERIC(3,2) NOT NULL default 5.00, `review_count` NOT NULL default 0, `session_count` NOT NULL default 0, `is_approved` NOT NULL default true, `is_featured` NOT NULL default false, `approval_status` NOT NULL default `'draft'`, `is_active` NOT NULL default false, `created_via`, `created_at`, `updated_at` | `CHECK (experience_years >= 0)`; `CHECK (rating >= 0 AND rating <= 5.00)`; `CHECK (review_count >= 0)`; `CHECK (session_count >= 0)`; `CHECK (approval_status IN ('draft','pending_review','approved','rejected'))`; `CHECK (created_via IS NULL OR created_via IN ('public_signup','admin_direct'))` |
| `mentor_segments` | `mentor_id` FK→`profiles` CASCADE, `segment_id` FK→`segments` CASCADE, `is_primary` default false | `UNIQUE (mentor_id, segment_id)` |
| `seeker_profiles` | `id` PK→`profiles` CASCADE, `preferred_language` NOT NULL default `'English'`, `notes` | — |
| `gigs` | `mentor_id` FK→`profiles` CASCADE, `segment_id` FK→`segments` RESTRICT, `title`, `description`, `duration_minutes`, `price_inr`, `is_active` default true | `CHECK (duration_minutes IN (30,45,60,90,120))`; `CHECK (price_inr >= 0)`; **partial unique** on `(mentor_id, segment_id) WHERE is_active` |
| `mentor_availability` | `mentor_id` FK→`profiles` CASCADE, `day_of_week` SMALLINT, `start_time` TIME, `end_time` TIME, `timezone` NOT NULL default `'Asia/Kolkata'`, `is_enabled` default true | `CHECK (day_of_week BETWEEN 0 AND 6)`; `CHECK (start_time < end_time)`; `UNIQUE (mentor_id, day_of_week, start_time, end_time)` |
| `mentor_availability_exceptions` | `mentor_id` FK→`profiles` CASCADE, `exception_date` DATE, `is_available` default false, `start_time` TIME, `end_time` TIME, `reason` | `CHECK (is_available = FALSE OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time))`; `UNIQUE (mentor_id, exception_date)` |

`mentor_availability` is **global to the mentor**, not per gig. A mentor's
weekly windows gate every gig they sell.

### Booking and payment

See §10 and §11.

### Content

| Table | Purpose |
|---|---|
| `session_workspaces` | Post-session artifact. `booking_id` (1:1, `UNIQUE`), `mentor_id`/`seeker_id`, `status` NOT NULL default `'PENDING'` `CHECK (status IN ('PENDING','PUBLISHED'))`, `mentor_notes`, `summary`, `takeaways` JSONB, `suggestions` JSONB, `next_steps` JSONB, `action_items` JSONB, `resources` JSONB, `follow_up_recommendation` JSONB, `published_at`. |

`segments.experience_config` JSONB is the seeker-facing CMS payload (hero,
quickHelp, journeySteps, benefits, faq, cta) rendered by
`SegmentExperienceRenderer.tsx`.

### Mentor onboarding

| Table | Purpose |
|---|---|
| `mentor_applications` | One per user. `status` `CHECK IN ('draft','pending_review','approved','rejected')`, `full_name`, `headline`, `bio`, `years_of_experience` `CHECK (IS NULL OR BETWEEN 0 AND 80)`, `timezone`, `requested_segment_ids` UUID[], `submitted_at`, `reviewed_at`, `reviewed_by` FK→`profiles` SET NULL, `rejection_reason`. `UNIQUE (user_id)`. |
| `mentor_verification_documents` | `application_id` FK CASCADE, `document_type` FK→`mentor_document_types(code)` RESTRICT, `storage_path`, `original_filename`, `mime_type`, `size_bytes` `CHECK (> 0 AND <= 5242880)`, `status` `CHECK IN ('pending','approved','rejected')`, `admin_note`, `uploaded_at`, `reviewed_at`, `reviewed_by`. `UNIQUE (application_id, document_type)`. |
| `mentor_document_types` | Config table. Seeded with `identity_proof` and `qualification_proof`. |
| `mentor_application_audit` | Append-only. `application_id` FK CASCADE, `action` (**unconstrained TEXT** — the phase12 CHECK was not carried forward), `admin_user_id` FK→`profiles` SET NULL, `rejection_reason`, `metadata`. |

### Operations and security

| Table | Purpose |
|---|---|
| `platform_config` | Single-row (`id = 1`). `upi_id`, `qr_image_storage_path`, `payment_instructions`, `currency`, `payment_account_name`, `hold_duration_minutes` NOT NULL default 5. **No CHECK constraints and no RLS enabled** — reads go through `hold_duration_interval()`; writes go through the service-role client in `server.ts`. |
| `audit_logs` | `actor_user_id`, `actor_role`, `action`, `entity_type`, `entity_id`, `request_id`, `metadata`. No CHECKs. |
| `system_logs` | `request_id`, `level` `CHECK IN ('debug','info','warn','error')`, `category` `CHECK IN ('api_request','api_error','auth','db','business','system')`, `method`, `path`, `status_code`, `duration_ms`, `user_id`, `role`, `error_code`, `message`, `metadata`. |
| `system_log_retention` | Single row. `CHECK (id = 1)`, `retention_days` `CHECK BETWEEN 1 AND 365`, default 30. |
| `login_failure_config` | Single row. `failure_threshold` `CHECK BETWEEN 2 AND 100` default 5, `window_minutes` `CHECK BETWEEN 1 AND 1440` default 15. |
| `login_failure_trackers` | `identifier_key` PK, `consecutive_failures`, `first_failed_at`, `last_failed_at`, `last_failure_reason`, `alerted_at`, `alert_count`. |

`login_failure_trackers` is **not** an auth table: it is telemetry read by
admins in System Health.

---

## 8. Availability and Slot Generation

There is **no** database slot table and **no** `generate_slots` RPC. Slots are
computed at read time by `src/lib/slotEngine.ts` from:

1. `mentor_availability` (recurring weekly windows, mentor timezone)
2. `minus mentor_availability_exceptions` for the queried date
3. `minus` overlapping non-cancelled `bookings` for that mentor
4. `minus` `ACTIVE` `slot_holds` for that mentor
5. `minus` the past and the booking cutoff

`GET /api/mentor-availability/slots` (`server.ts:3977`) is the single read path;
`GET /api/admin/mentors/:id/slots` (`server.ts:7375`) is the admin equivalent.
The browser never invents a time.

Timezone: availability is stored with an IANA `timezone` and interpreted in the
mentor's zone; bookings additionally snapshot `seeker_timezone` and
`mentor_timezone` at creation. All timestamps are `TIMESTAMPTZ` (UTC on the
wire).

---

## 9. Concurrency and Integrity Constraints

These are the load-bearing guarantees. They are enforced by the database, not by
application code.

```sql
-- No two ACTIVE holds may overlap for one mentor.
EXCLUDE USING gist (
  mentor_id WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (status = 'ACTIVE');                                      -- no_overlapping_active_holds

-- No two live bookings may overlap for one mentor.
EXCLUDE USING gist (
  mentor_id WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (status NOT IN ('CANCELLED','REJECTED'));                 -- no_overlapping_mentor_bookings
```

Because the booking exclusion predicate is `status NOT IN ('CANCELLED','REJECTED')`,
`PENDING_VERIFICATION` bookings **do** block the slot. That is correct: the
commitment is live. (`PAYMENT_PROCESSING` would block it too, but is never
written — §10.)

Supporting constraints:

| Constraint | Expression |
|---|---|
| `bookings_status_check` | `status IN ('PAYMENT_PENDING','PAYMENT_PROCESSING','PENDING_VERIFICATION','MENTOR_PENDING','CONFIRMED','COMPLETED','CANCELLED','REJECTED')` |
| `chk_booking_time` | `start_time < end_time` |
| `chk_meeting_url_https` | `meeting_url IS NULL OR meeting_url ~* '^https://'` |
| `bookings_ended_by_role_check` | `ended_by_role IS NULL OR ended_by_role IN ('mentor','seeker','admin')` |
| `payments_status_check` | `status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED','PAYMENT_PENDING','PAYMENT_PROCESSING','FAILED','REFUNDED','REFUND_FAILED')` |
| `payments.gateway` | `gateway IN ('manual','razorpay')` |
| `uq_payment_booking` | `UNIQUE (booking_id)` — one payment row per booking |
| `chk_hold_time` / `chk_hold_expiry` | `start_time < end_time`; `expires_at > created_at` |
| `uq_webhook_gateway_event` | `UNIQUE (gateway, event_id)` — webhook idempotency |

Additionally, migration `20260927070000_phase24c` **revoked** `UPDATE`/`DELETE`/
`TRUNCATE` on `bookings` from `authenticated` and re-granted only
`UPDATE (cancellation_reason, updated_at)`. Booking state can therefore only be
changed by a `SECURITY DEFINER` RPC or the service-role client.

### Atomic booking

`POST /api/bookings/hold` does not call `acquire_slot_hold` then insert. It calls
a single RPC, `create_booking_with_hold(seeker, mentor, segment, gig, start, end)`,
which inserts the hold, creates the booking, converts the hold and writes a
`payments` row inside one transaction, then returns a `code: <REASON>, <text>`
error string on refusal. The server parses that prefix. This is why the booking
transaction is atomic by construction.

`acquire_slot_hold` is now called from exactly one place — the reschedule route
(`server.ts:2995`).

### Hold expiry

`expire_stale_holds()` is `service_role`-only and is scheduled by `pg_cron`:

| Job | Schedule | Action |
|---|---|---|
| `expire-stale-holds-every-minute` | `* * * * *` | `SELECT public.expire_stale_holds()` |
| `complete-expired-sessions-every-minute` | `* * * * *` | `SELECT public.complete_expired_sessions()` |

`expire_stale_holds()` flips `ACTIVE` holds whose `expires_at <= now()` to
`EXPIRED`, cancels the linked `PAYMENT_PENDING` booking, and releases holds whose
booking has left `PAYMENT_PENDING`.

---

## 10. Booking State Machine

`bookings.status` — 8 legal values permitted by `bookings_status_check`, of which
**7 are reachable in the current code.** `PAYMENT_PROCESSING` is permitted but
never written (see §11.2).

```text
                 create_booking_with_hold()
                              │
                              ▼
                    ┌─────────────────────┐
                    │   PAYMENT_PENDING   │◄──── Razorpay capture holds the
                    └──────────┬──────────┘        booking HERE until money
        manual proof           │                 is actually captured
        submitted              │                 (never PAYMENT_PROCESSING)
                    ┌──────────┴──────────┐              │
                    │                     │              │
       ┌────────────┴──────────┐          │              │
       │ PENDING_VERIFICATION   │          │              │
       └───┬──────────────┬─────┘          │              │
 admin    │              │  admin         │              │
 approve  │              │  reject        │              │
       ┌───▼──────┐  ┌────▼──────────────▼────┐  ┌───────▼────────┐
       │ VERIFIED │  │      CANCELLED         │  │  MENTOR_PENDING│
       │(payment) │  │   / REJECTED (booking) │  │   (booking)    │
       └──────────┘  └────────────────────────┘  └───────┬────────┘
                                                          │ mentor confirms
       Razorpay capture failure or booking dead-end       │ (HTTPS link req.)
       → payment FAILED / refund_status PENDING           ▼
       (payments row only; booking is untouched)    ┌───────────┐
                          cron / read-reconcile    │ CONFIRMED │──┐
                                                    └─────┬─────┘  │
                                    any participant or        │      │
                                    admin ends the session    │      ▼
                                    → actual_ended_at,        │  ┌─────────────┐
                                      ended_by_role,           ▼  │  COMPLETED  │
                                      end_reason)                 └─────────────┘
```

### Who writes which transition

| Transition | Writer |
|---|---|
| → `PAYMENT_PENDING` | `create_booking_with_hold()` RPC |
| `PAYMENT_PENDING` → `PENDING_VERIFICATION` | `POST /api/seeker/bookings/:id/payment-proof` |
| `PENDING_VERIFICATION` → `MENTOR_PENDING` | `review_payment()` RPC via `PATCH /api/admin/payments/:id/approve` |
| `PENDING_VERIFICATION` → `CANCELLED` | `review_payment(p_approve := false)` via `PATCH /api/admin/payments/:id/reject` |
| `PAYMENT_PENDING` → `MENTOR_PENDING` | `applyCapturedPayment()` via `markBookingMentorPending()` on a server-verified Razorpay capture (`razorpayService.ts`), reached from either `POST .../razorpay/verify` or the `payment.captured` webhook |
| `MENTOR_PENDING` → `CONFIRMED` | `POST /api/mentor/bookings/:id/confirm` |
| `PAYMENT_PENDING` → `CANCELLED` | `expire_stale_holds()` cron, or `POST /api/seeker/bookings/:id/cancel` |
| `CONFIRMED` → `COMPLETED` | `complete_expired_sessions()` cron, `POST /api/sessions/:bookingId/complete`, or `reconcile_expired_sessions` |
| → `PAYMENT_PROCESSING` | **Nobody.** Permitted by the CHECK, written by no current code path. |

### Three distinct concepts — do not conflate

| Concept | Where it lives | Values |
|---|---|---|
| **Booking status** | `bookings.status` (column) | the 8 above |
| **Payment status** | `payments.status` (column) | `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`, `PAYMENT_PENDING`, `PAYMENT_PROCESSING`, `FAILED`, `REFUNDED`, `REFUND_FAILED` |
| **Session projection** | computed by `resolve_session_state()` / `resolveSessionLifecycle()` — **not a column** | `SCHEDULED`, `ACCESS_OPEN`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` |

`IN_PROGRESS` is not a `bookings.status` value. `FAILED`, `REFUNDED` and
`REFUND_FAILED` are `payments.status` values, not booking states.

### Type drift (open)

`src/types/database.ts:135` `BookingStatus` omits `'PAYMENT_PROCESSING'`, which
the database constraint permits. This is currently **latent rather than
reachable**: no code path writes `PAYMENT_PROCESSING` to a booking (§11.2), so
the backend never surfaces the value. The same omission is why
`src/components/booking/statusTone.ts` `BOOKING_LIFECYCLE` lists only 5 statuses
and would degrade an unknown status to "no position known". See
`docs/technical-audit.md` T1.

---

## 11. Payment Architecture

**Current state: hybrid, with the manual UPI/QR path as the default and
Razorpay fully implemented but feature-flagged off.**

`APP_CONFIG.MVP_PAYMENT_METHOD` is still `'manual_qr'`.
`RAZORPAY_ENABLED` defaults to `"false"`.

### 11.1 Manual UPI/QR (default, always live)

```text
Seeker                     Admin
  │  GET /api/platform-config ──► upi_id, qr_image_storage_path,
  │                               payment_instructions, currency,
  │                               payment_account_name
  │  uploads screenshot (≤5 MB, jpeg/png/webp) to
  │  bucket `payment-proofs` at <seekerId>/<bookingId>/<unique>-<file>
  │  POST /api/seeker/bookings/:id/payment-proof
  │      { transactionReference, storagePath, fileName, mimeType, fileSize }
  │        └─► payments.status  = PENDING_VERIFICATION
  │        └─► bookings.status  = PENDING_VERIFICATION
  │                                 │
  │                            PATCH /api/admin/payments/:id/approve
  │                                 └─► payments.status = VERIFIED
  │                                 └─► bookings.status = MENTOR_PENDING
  │                                 └─► mentor notified
  │                            PATCH /api/admin/payments/:id/reject
  │                                 └─► payments.status = REJECTED
  │                                 └─► bookings.status = CANCELLED
```

Payable booking statuses: `PAYMENT_PENDING`, `PENDING_VERIFICATION`
(`PAYABLE_BOOKING_STATUSES` in `src/lib/paymentProof.ts`).

Validation, both client and server. The `payment-proofs` **bucket** allows
`image/jpeg`, `image/png`, `image/webp` and `application/pdf`; the **application**
accepts only the three image types — `validateProofFile()` deliberately excludes
`application/pdf`, because an admin must read a UTR off a screenshot. Also
enforced: transaction reference `^[A-Za-z0-9_-]+$`, 4–64 chars; UPI id
format-checked; QR file ≤ 2 MB and png/jpeg/webp only.

Proof files are never removed on rejection — a rejected proof stays on the
record and the seeker may submit a new one.

### 11.2 Razorpay (implemented, off by default)

Three environment gates, all read lazily in `src/lib/razorpayConfig.ts`:

| Variable | Purpose |
|---|---|
| `RAZORPAY_ENABLED` | Exactly `"true"` enables. Anything else → every Razorpay route answers `503`. |
| `RAZORPAY_KEY_ID` | Public. The only Razorpay value ever sent to a browser. |
| `RAZORPAY_KEY_SECRET` | Server-only. Order auth + signature verification. |
| `RAZORPAY_WEBHOOK_SECRET` | Server-only. Webhook HMAC. |
| `RAZORPAY_API_BASE` | Optional override, default `https://api.razorpay.com/v1`. |

None are `VITE_`-prefixed, so none can be bundled into the client.

Architecture: `razorpayService.ts` is written against two ports —
`RazorpayGatewayClient` (HTTP) and `RazorpayStore` (persistence) — supplied by
`createRazorpayGatewayClient()` and `createSupabaseRazorpayStore(admin)`. The
service is gateway-agnostic and has no Razorpay types in its control flow
beyond the port.

```text
Seeker                     Server                        Razorpay
  │ POST .../razorpay/order ──► runCreateRazorpayOrder
  │                            ├─ assertRazorpayUsable
  │                            ├─ ownership + payability + slot + hold checks
  │                            ├─ SERVER-DERIVED amount (gigs.price_inr)
  │                            ├─ idempotent: reuses an existing open order
  │                            └─ POST /v1/orders ──────────────►
  │  ◄── { razorpayOrderId,        payments.status = PAYMENT_PROCESSING
  │        razorpayKeyId,          bookings.status UNCHANGED (stays PAYMENT_PENDING)
  │        amountInr, currency,
  │        paymentId }
  │ opens Razorpay checkout modal (201/200)
  │ POST .../razorpay/verify  ──► runVerifyRazorpayPayment
  │   { razorpayOrderId,             ├─ HMAC signature verified SERVER-SIDE
  │     razorpayPaymentId,           ├─ browser amount NOT trusted
  │     razorpaySignature }          ├─ applyCapturedPayment
  │                                 │    payments.status = VERIFIED
  │                                 │    bookings.status = MENTOR_PENDING
  │                                 └─ mentor notified (once)
  │
  │                          Razorpay ──► POST /api/webhooks/razorpay
  │                                    ├─ raw-body HMAC verification
  │                                    ├─ webhook_events INSERT … ON CONFLICT
  │                                    │   DO NOTHING  (uq_webhook_gateway_event)
  │                                    ├─ duplicate → 200, no reprocessing
  │                                    └─ handles payment.captured / payment.failed /
  │                                       order.paid / payment.authorized /
  │                                       refund.created|processed|failed
```

Key properties, all verified in code:

- **The booking never enters `PAYMENT_PROCESSING`.** `bookings_status_check`
  permits the value, but **nothing in the current code writes it.** The Razorpay
  service header states the rule explicitly (`razorpayService.ts:38-43`): the
  booking stays `PAYMENT_PENDING` until money is actually captured, because
  `expire_stale_holds()` only cancels `PAYMENT_PENDING` bookings — parking an
  unpaid order in `PAYMENT_PROCESSING` would strand a booking whose hold had
  elapsed. `markBookingMentorPending()` still *tolerates* `PAYMENT_PROCESSING`
  as a source state (defensive), but only the `payments` row carries it.
- **Server-derived amount.** `toPaise(amountInr)` converts the amount read from
  the stored booking/gig. A browser-supplied amount is never used to create an
  order, and a mismatch is refused and audited.
- **Signature verified server-side** using the key secret. A failure is audited
  as `razorpay_payment_verification_failed` with only the error *code* recorded
  — never the signature.
- **Idempotent create.** If an open `PAYMENT_PROCESSING` order already exists it
  is reused and `200` is returned instead of `201` (`alreadyCreated`).
- **Idempotent verify.** A second verify call sees the payment already
  `VERIFIED`, returns success with `duplicate: true`, and does **not** notify
  the mentor twice.
- **Webhook idempotency.** `(gateway, event_id)` is unique. Already-seen events
  return `200` so Razorpay stops retrying.
- **Webhook signature uses the raw body**, captured by a JSON `verify` hook.
  `req.body` is never used for verification, because it would fail the HMAC.
- **Dead-end recovery.** `recoverCaptureAgainstDeadBooking()` (`razorpayService.ts:643`)
  handles a capture that lands after the booking was cancelled or rejected: it
  marks the payment `FAILED` with a reason and records a `payment_events` row,
  rather than reviving the booking.
- **Retry.** `runCreateRazorpayOrder` will mint a new order when the previous one
  is `FAILED` with no refund in flight.
- **Refunds.** Refund *events* are consumed by the webhook
  (`refund.created`/`processed`/`failed` → `REFUNDED` / `FAILED` /
  `REFUND_FAILED`). **There is no refund-initiation endpoint.** Nothing in this
  repository calls Razorpay's refund API.
- **Order expiry.** `RAZORPAY_ORDER_EXPIRY_SECONDS` is derived from
  `APP_CONFIG.HOLD_DURATION_MS / 1000` = 300, so an order can never outlive the
  hold it pays for. It is a derived value, not a second literal.

### 11.3 Payment-related API

| Method | Route | Auth | Role | Purpose |
|---|---|---|---|---|
| `GET` | `/api/platform-config` | yes | any | Public UPI/QR/instructions for the checkout page |
| `POST` | `/api/seeker/bookings/:id/payment-proof` | yes | seeker | Submit manual proof |
| `GET` | `/api/seeker/bookings/:id/payment-proof` | yes | seeker | Read proof metadata + signed proof URL |
| `POST` | `/api/seeker/bookings/:id/razorpay/order` | yes | seeker | Create or reuse order |
| `POST` | `/api/seeker/bookings/:id/razorpay/verify` | yes | seeker | Verify capture, advance booking |
| `POST` | `/api/webhooks/razorpay` | **none** | — | Gateway callback; authorised by HMAC only |
| `GET` | `/api/payments/razorpay/config` | yes | any | Non-secret availability probe (`{enabled, currency, razorpayKeyId}`) |
| `GET` | `/api/admin/payments` | yes | admin | Payment queue |
| `PATCH` | `/api/admin/payments/:id/approve` | yes | admin | Manual path only |
| `PATCH` | `/api/admin/payments/:id/reject` | yes | admin | Manual path only, `reason` required |
| `GET` | `/api/admin/users/:id/payments` | yes | admin | Per-user payment history |

The four `PATCH`/admin approve-reject routes remain live and are correct: they
only act on `gateway = 'manual'` rows, which is the only path that needs a human.

### 11.4 Payment events and webhook events

- `payment_events` — append-only lifecycle log. `payment_id`, `status`,
  `event_type`, `gateway`, `gateway_payment_id`, `amount_inr`, `reason`,
  `created_by`, `created_at`.
- `webhook_events` — `gateway`, `event_id`, `event_type`, `payload` JSONB,
  `processed`, `processed_at`, `created_at`. `UNIQUE (gateway, event_id)` is
  the idempotency key. Admin-only RLS; there is no browser read path.

---

## 12. Timing Rules

Authoritative source: `src/config/app.ts` for the server copy and display, and
`platform_config.hold_duration_minutes` (default 5) for the database.

| Constant | Value | Meaning |
|---|---|---|
| `HOLD_DURATION_MS` | **5 min** | How long a slot is reserved during checkout. DB-enforced via `hold_duration_interval()`. |
| `BOOKING_CUTOFF_MS` | **5 min** | A slot stays bookable while `slotStart − now >= 5 min`, on absolute instants. Replaces the old 2-hour advance rule, which no longer exists. DB-enforced in `create_booking_with_hold()` via `clock_timestamp()`. |
| `SESSION_ACCESS_WINDOW_MS` | **5 min (T−5)** | Meeting link becomes readable at `start − 5 min`. |
| `MEETING_LINK_DEADLINE_MS` | **5 min** | Submission deadline for the *mentor* to add the link: `start − 5 min`. Audit/overdue only; it never blocks booking and never cancels one. |
| `NORMAL_CANCELLATION_WINDOW_MINUTES` | **10 min** | Seeker may cancel/reschedule while `start − now >= 10 min`. |
| `DEFAULT_TIMEZONE` | `Asia/Kolkata` | Default on `profiles.timezone`, `bookings.*_timezone`, `mentor_availability.timezone`. |

These four were historically `15 min` hold and `2 h` minimum advance notice.
Both are **deprecated**; the current values are in the table above. The
deprecation is recorded in `20260928000000_phase26_hold_duration_5min.sql` and
`20260926030000_phase18_booking_cutoff_5min.sql`.

Cancellation is 10 minutes, not 24 hours. Any document saying 24 h is wrong.

---

## 13. Session Architecture

### 13.1 State resolution

`resolve_session_state(p_status, p_start_time, p_end_time, p_actual_ended_at, p_now)`
in Postgres and `resolveSessionLifecycle()` in TypeScript implement the same
rule. The TS side (`src/lib/sessionState.ts:71`) is:

```ts
if (status === 'CANCELLED' || status === 'REJECTED') return 'CANCELLED';
if (!finite(start) || !finite(end))                 return 'COMPLETED';
if (actual_ended_at)                               return 'COMPLETED';
if (status === 'COMPLETED')                        return 'COMPLETED';
if (serverNow >= end)                              return 'COMPLETED';
if (serverNow >= start - 5min)                     return serverNow >= start ? 'IN_PROGRESS' : 'ACCESS_OPEN';
return 'SCHEDULED';
```

Projection values: `SCHEDULED`, `ACCESS_OPEN`, `IN_PROGRESS`, `COMPLETED`,
`CANCELLED`. Only `COMPLETED` and `CANCELLED` are also real `bookings.status`
values. `SCHEDULED`, `ACCESS_OPEN` and `IN_PROGRESS` are derived only.

> The derived "not yet started" state is named **`SCHEDULED`**, not `UPCOMING`.
> `UPCOMING` appears in the UI only as a *list tab label*
> (`SeekerBookingsPage`, `MentorBookingsPage`) and as a grouping predicate
> (`booking_is_upcoming(end_time, status)` in SQL), never as a projection value.

### 13.2 Server-clock authority

`useSessionSync` revalidates every `REVALIDATE_MS = 20_000` and samples
`offsetMs = serverNow − clientNow` on every revalidation. All countdowns derive
from `serverNowFromOffset(offsetMs)`. A local `TICK_MS = 1_000` interval only
advances the render, never the decision.

### 13.3 Meeting-link visibility

`redactMeetingUrlForParticipant()` (`src/lib/sessionAccess.ts:84`) is applied
to every booking projection returned to a participant:

| Viewer | Link returned when |
|---|---|
| Admin | always |
| Mentor | always (the mentor supplies it) |
| Seeker | `start − 5 min ≤ now < end`, **and** `actual_ended_at IS NULL` |
| Anyone, after manual end | never — `actual_ended_at` revokes it irrevocably |

This exists because `meeting_url` used to be returned verbatim by
`GET /api/seeker/bookings` and `GET /api/seeker/bookings/:id`, which made the
T−5 gate on `POST /api/sessions/:bookingId/join` decorative.

Path segments reaching PostgREST equality filters must be shape-checked
(`isBookingIdShape` / `isBookingCodeShape`) so a crafted id cannot inject a
second clause into an `.or()` group.

### 13.4 Join authorisation

`POST /api/sessions/:bookingId/join` → `joinSessionAuthoritative()` in
`src/lib/bookingEngine.ts`, backed by the `can_join_session(p_booking_id, p_user_id)`
RPC. The DB function is the authority; the join endpoint returns the meeting URL
only when the RPC says yes.

`GET /api/sessions/:bookingId/access` → `get_session_access(p_booking_id)` RPC.

### 13.5 Session completion

Three layers, in priority order:

1. **Reactive** — `POST /api/sessions/:bookingId/complete`. Any of mentor,
   seeker or admin may end a live session. Writes `actual_ended_at`,
   `ended_by_role` (`CHECK IN ('mentor','seeker','admin')`), `end_reason`,
   `status = 'COMPLETED'`.
2. **Cron** — `complete_expired_sessions()` every minute, `service_role`-only.
   Completes `CONFIRMED` bookings past `end_time` and emits the once-only
   `SESSION_COMPLETED` notification, guarded by the partial unique index
   `uniq_notifications_session_completed (user_id, event_type, entity_id)
   WHERE event_type = 'SESSION_COMPLETED' AND entity_id IS NOT NULL`.
3. **Read-reconcile** — `reconcile_expired_sessions(p_booking_id)` for a single
   booking, and `reconcile_expired_bookings(uuid[])` (service-role only) for a
   bulk sweep. Reconciliation returns `NULL`, never `CANCELLED`, when there is
   nothing to do — that was a bug fixed in `20260927060000_phase24b`.

`bookings.actual_ended_at` was backfilled for pre-existing `COMPLETED` rows in
`20260927100000_phase24f`.

---

## 14. Authentication and Authorization

### 14.1 Authentication

Supabase Auth, email + password, with email-OTP verification
(`/auth/verify`, `/auth/callback`). No OAuth provider is wired.

Password reset: `ForgotPasswordPage` → Supabase `resetPasswordForEmail` →
`/auth/reset-password` updates the user.

### 14.2 Demo personas (development only, fail-closed)

`POST /api/auth/demo-login` exists and is gated by
`isDemoAuthEnabled()`, which requires **all** of:

- `ENABLE_DEMO_PERSONAS` exactly `"true"`
- `DEMO_TOKEN_SECRET` set and ≥ 32 characters, and not one of the known defaults
- `NODE_ENV !== 'production'`

The admin persona additionally requires `ADMIN_PASSWORD` ≥ 12 characters.
Client side, `requestDemoLogin` in `AuthContext.tsx` returns
`'Demo login is unavailable in production.'` when `import.meta.env.PROD`.

The demo accounts in `server.ts:1283+` (`Aman Kumar` / `Rahul Sharma`) are
demo-auth personas. They are not a business-data fallback; see
`docs/data-source-audit.md`.

### 14.3 Server middleware chain

```text
requireAuth  →  requireAdmin | requireRole('seeker'|'mentor') | requireActiveMentor
             →  expensiveRouteLimiter (where present)
             →  validateBody(apiSchemas.<name>)   (zod)
             →  handler
```

All 131 routes except `/api/health` and `/api/webhooks/razorpay` sit behind
`requireAuth`. The webhook is unauthenticated by necessity; it is authorised
solely by its HMAC signature.

`requireActiveMentor` additionally checks `mentor_profiles.is_active` and
`approval_status`, so a draft or rejected mentor cannot create gigs, apply to
segments or write availability.

### 14.4 Rate limiting

`express-rate-limit`, in-memory, per process instance. Applied to
`expensiveRouteLimiter` on the demo-login, login-failure, login-success, hold,
payment-proof, Razorpay order and Razorpay verify routes.

Per-instance, not global: on serverless or multi-instance deployment the
effective limit is multiplied by the instance count. This is a known limitation,
documented in `docs/technical-audit.md`.

### 14.5 Login failure alerting

`POST /api/auth/login-failure` records via `record_login_failure()`; five
consecutive failures for the same identifier within 15 minutes sets `alerted_at`
and raises an admin notification. `POST /api/auth/login-success` clears the
tracker. Admins read active threats through
`GET /api/admin/system-health/auth-logs`.

### 14.6 Frontend authorization

`src/components/auth/ProtectedRoute.tsx` wraps every non-public route and
redirects to `/auth/login` when unauthenticated, `/auth/unauthorized` on role
mismatch, and shows a loading state while the session is resolving. It is a UX
gate only; every route is independently authorized server-side.

---

## 15. RLS and Grants

RLS is enabled on every table **except `platform_config`**.

Posture: participants read their own rows; admins have full access via
`public.is_admin()`; discovery predicates are centralised in
`public.mentor_is_publicly_visible(p_mentor_id)`.

| Table | SELECT | Write |
|---|---|---|
| `profiles` | `id = auth.uid() OR is_admin()` | own, and only if not suspended; admin all |
| `user_roles` | own or admin | admin only |
| `segments` | `is_active OR is_admin()` | admin only |
| `segment_topics` | active and parent segment active | admin only |
| `gig_topics` | all three parents active | admin only |
| `mentor_profiles` | `mentor_is_publicly_visible(id) OR id = auth.uid() OR is_admin()` | own or admin; delete admin only |
| `mentor_segments` | visible or own or admin | own or admin |
| `gigs` | active and mentor visible, or own, or admin | own or admin |
| `mentor_availability` | visible or own or admin | own or admin |
| `mentor_availability_exceptions` | visible or own or admin | own or admin |
| `slot_holds` | participant or admin | seeker of the hold or admin |
| `bookings` | participant or admin | INSERT seeker or admin; **UPDATE revoked for `authenticated`** — only `cancellation_reason`, `updated_at` are grantable |
| `payments` | own seeker or admin | admin only (browser never writes) |
| `payment_events` | own payment or admin | admin only |
| `webhook_events` | admin only | admin only |
| `notifications` | `user_id = auth.uid() OR is_admin()` | own or admin |
| `session_workspaces` | mentor always; seeker only when `status = 'PUBLISHED'`; admin | mentor or admin; delete admin only |
| `mentor_applications` | own or admin | own (draft/rejected only); admin all |
| `mentor_verification_documents` | via application ownership | own draft docs; admin all |
| `mentor_application_audit` | via application ownership | admin all |
| `mentor_document_types` | active or admin | admin all |
| `system_logs`, `audit_logs`, `system_log_retention`, `login_failure_config` | admin only | admin only |
| `login_failure_trackers` | admin only | via RPC |
| `platform_config` | **RLS not enabled** | service-role client only |

Migration `20260927000000_phase19_security_lockdown.sql` revoked `ALL` from
`anon` on `public`, `storage` and `realtime` schemas, set
`storage.buckets.public = FALSE`, and re-granted `authenticated`/`service_role`.

### Storage

| Bucket | Public | Limit | Mimes | Policies |
|---|---|---|---|---|
| `payment-proofs` | no | 5 MB | jpeg/png/webp/pdf | folder `[1] = auth.uid()::text` or admin; admin all |
| `mentor-verification-documents` | no | 5 MB | jpeg/png/webp/pdf | path `<user_id>/<application_id>/…`; applicant may write only while the application is `draft` or `rejected`; admin all |
| `segment-hero` | **yes** | 5 MB | png/jpeg/webp/gif | public SELECT; admin all |

A fourth bucket, `payment-qr` (`PAYMENT_QR_BUCKET` in
`src/lib/paymentProof.ts`, used by `server.ts:205`, `:8786`, `:8845` for the
admin UPI QR upload), is referenced by code but is **not created by any
migration**. See `docs/technical-audit.md`.

---

## 16. Realtime and Freshness

### 16.1 Publication

`supabase_realtime` contains exactly these 10 tables:

| Table | Added by |
|---|---|
| `mentor_availability` | `20260926020000_phase17_realtime_availability_sync.sql` |
| `mentor_availability_exceptions` | same |
| `slot_holds` | same |
| `bookings` | same |
| `gigs` | same |
| `segments` | `20261001000000_phase8a_segments_realtime.sql` |
| `segment_topics` | `20261001000001_seeker_experience_rebuild_segment_topics.sql` |
| `payments` | `20260927110000_phase25_payment_foundation.sql` |
| `payment_events` | same |
| `webhook_events` | same |

`REPLICA IDENTITY FULL` is set on `mentor_availability`,
`mentor_availability_exceptions`, `slot_holds`, `bookings`, `gigs`, `segments`.
It is **not** set on `payments`, `payment_events`, `webhook_events` or
`segment_topics`, so those deliver key-only updates.

**`notifications` is not published.** Notification freshness is polling-only.

### 16.2 Hooks

| Hook | Watched | Realtime | Polling fallback |
|---|---|---|---|
| `useAvailabilitySync` | `mentor_availability`, `mentor_availability_exceptions`, `slot_holds`, `bookings`, `gigs` | yes, per mentor | `DEFAULT_INTERVAL_MS = 45_000`, floor `MIN_INTERVAL_MS = 15_000`, **visibility-gated** |
| `useSegmentExperienceRealtime` | `segments`, `segment_topics` | yes | none |
| `useSessionSync` | `bookings` | lifecycle-event driven | `REVALIDATE_MS = 20_000`, plus `TICK_MS = 1_000` render-only tick |
| `usePaymentSync` | `payments`, `bookings` | yes | `DEFAULT_INTERVAL_MS = 60_000`, floor 30_000, visibility-gated |
| `useNotificationSync` | none | **no** | `DEFAULT_INTERVAL_MS = 60_000`, floor 30_000, visibility-gated |
| `NotificationContext` | none | **no** | hard-coded `setInterval(refreshNotifications, 30000)`, **not** visibility-gated |

`useAvailabilitySync` and `usePaymentSync` skip their interval when
`document.visibilityState !== 'visible'`, so a backgrounded tab costs nothing.
`NotificationContext` does not — see `docs/technical-audit.md`.

The last four browser-side sync paths in the table above coexist with the
published `payments` table: the hook has both a realtime channel and a polling
fallback, and exactly one of each per hook instance.

---

## 17. Validation

`src/lib/validation.ts` (37 KB) holds a zod schema per validated body, exposed
as `apiSchemas.*` and applied by the `validateBody` middleware. Failures return
a structured `{ success: false, error: { code, message, details } }`.

Beyond zod, the codebase performs:

- **Filter-injection shape checks** — `isBookingIdShape`, `isBookingCodeShape`
  before any PostgREST `.or()` interpolation.
- **File validation** — mime, size and filename sanitisation
  (`sanitiseProofFileName`, `buildProofStoragePath`, `validateQrFile`,
  `validateUpiId`, `normaliseTransactionReference`).
- **Payment amount derivation** — the browser's amount is never used to create
  an order or accept a capture.
- **Error sanitisation** — `src/lib/logSanitizer.ts` and
  `src/lib/supabaseErrors.ts` map driver and PostgREST errors to safe codes so
  raw SQL never reaches a client.
- **Admin colour and segment settings** — validated by
  `apiSchemas.adminColorControls`-style schemas before write.

---

## 18. Testing

43 test files under `tests/`, run with the Node test runner via
`tsx --test tests/**/*.test.ts` (`npm test`). Helpers live in `tests/helpers/`
(`razorpayHarness.ts`, `demoAuthEnv.ts`).

Coverage clusters:

| Cluster | Files |
|---|---|
| Payment / Razorpay | `razorpay_backend`, `razorpay_client`, `razorpay_signature`, `razorpay_state_machine`, `razorpay_store`, `razorpay_webhook_idempotency`, `razorpay_payment_safety`, `razorpay_frontend_review`, `payment_proof` |
| Booking / availability | `booking_concurrency`, `bookingCutoff`, `holdDuration`, `availability`, `availability_sync`, `booking_ui_invariants`, `booking_status_tone`, `mentor_confirmation` |
| Session | `session_access` |
| Auth | `auth_flow`, `rate_limit` |
| Admin control | `admin_account_control`, `admin_create_user`, `admin_dashboard`, `admin_mentor_control`, `mentor_applications`, `mentor_creation_source`, `admin_notification_routing` |
| Segment experience | `segment_experience`, `segment_experience_normalization`, `segment_experience_renderer`, `segment_dynamic_content`, `segment_hero_upload`, `seeker_experience_topics`, `seeker_experience_rebuild` |
| Observability | `system_health`, `system_health_dashboard`, `system_logs`, `audit_logger` |
| Sanitisation | `logSanitizer`, `error_sanitisation`, `api_validation` |
| Discovery / navigation | `seeker_discovery_dates`, `seeker_header_navigation` |

`npm run lint` (`tsc --noEmit`) is clean as of 2026-09-29.

Eight operational scripts in `scripts/` (`db-probe`, `e2e-mentor-bookings`,
`e2e-payment`, `probe-storage-rls`, `purge-e2e`, `security-audit`,
`verify-live-mentor-bookings`, `verify-system-health`) require a live Supabase
project and a running server. They are **not** part of `npm test`.

---

## 19. Known Gaps and Defects

Verified open as of 2026-09-29. Full detail, severity and evidence in
`docs/technical-audit.md`.

1. **`payment-qr` storage bucket is never created.** Code references
   `PAYMENT_QR_BUCKET` (`server.ts:205`, `:8786`, `:8845`); no migration creates
   it. The admin UPI QR upload cannot succeed against a database built purely
   from `supabase/migrations/`.
2. **`GET /api/admin/bookings/overdue-links` serves hardcoded fixtures
   unconditionally.** `server.ts:3138-3152` is a synchronous handler that never
   calls `getSupabaseAdmin()`. It always returns
   `getOverdueBookings(getLocalBookingEngineContext())`, i.e. the in-memory
   fixture set built in `src/lib/bookingService.ts:134-943` with hardcoded
   mentors (`Rahul Sharma`, `Ananya Patel`, `Dr. Vikram Joshi`, `Aman Kumar`),
   gig prices (999/1200/1299/1500) and demo notification copy. The other 15
   `getLocalBookingEngineContext()` call sites in `server.ts` sit behind a
   real-database branch that returns first, and are therefore unreachable in a
   correctly configured production deployment; this one is not.
3. **`bookings.status` type drift.** `src/types/database.ts:135` `BookingStatus`
   and `src/components/booking/statusTone.ts:43` `BOOKING_LIFECYCLE` both omit
   `'PAYMENT_PROCESSING'`, which `bookings_status_check` permits. Currently
   latent — no code path writes the value (§10).
4. **`notifications.type` has no CHECK.** The phase4 constraint was dropped in
   `phase11` and never re-added, so the column is free `TEXT` while
   `NotificationType` in TypeScript enumerates 7 values.
5. **`platform_config` has no RLS.** Reads are mediated by
   `hold_duration_interval()`, but the table itself is unprotected from direct
   PostgREST access by any role holding a grant.
6. **Rate limiting is per-process**, so limits multiply with instance count on
   serverless.
7. **`NotificationContext` polls every 30 s regardless of tab visibility**,
   unlike the other sync hooks.
8. **`mentor_application_audit.action` is unconstrained** `TEXT`; the phase12
   CHECK was not carried into the phase13 table definition.
9. **No refund initiation endpoint.** Refund events are consumed, never raised.
10. **No code splitting.** The main JS bundle is a single large chunk; Vite
    emits a chunk-size warning on build.

---

## 20. Architecture Rule

When this document and any other document disagree with the code, the code
wins and the document is wrong. When this document and the code disagree with a
migration, the migration wins for schema questions and the code wins for
behaviour questions. Documentation is a derived artifact and is expected to be
corrected the moment it drifts.
