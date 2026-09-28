# SUGGEST KEY — COMPREHENSIVE TECHNICAL AUDIT

**Date:** 2026-09-27
**Scope:** Full-stack inspection (read-only — no code was modified)
**Codebase:** `S:\suggest-key\Suggest_key`
**Method:** Manual trace of every import, function call, API call, database query and state transition. Every finding below cites a file and line.

---

## TABLE OF CONTENTS

1. [Tech Stack](#1-tech-stack)
2. [Project Structure](#2-project-structure)
3. [Authentication](#3-authentication)
4. [Roles & Authorization](#4-roles--authorization)
5. [Segment System](#5-segment-system)
6. [Mentor & Gig Architecture](#6-mentor--gig-architecture)
7. [Availability Engine](#7-availability-engine)
8. [Booking Engine](#8-booking-engine)
9. [Payment Engine (Manual QR)](#9-payment-engine-manual-qr)
10. [Notifications](#10-notifications)
11. [Session Access & Meeting URL](#11-session-access--meeting-url)
12. [Database Architecture](#12-database-architecture)
13. [API Surface](#13-api-surface)
14. [Frontend Architecture](#14-frontend-architecture)
15. [Design System](#15-design-system)
16. [Hardcoded Data Inventory](#16-hardcoded-data-inventory)
17. [Realtime](#17-realtime)
18. [Deployment & Operations](#18-deployment--operations)
19. [Testing](#19-testing)
20. [Razorpay Migration — Impact Assessment](#20-razorpay-migration--impact-assessment)
21. [Hold 15 → 5 min: Change Plan](#21-hold-15--5-min-change-plan)
22. [Adding PAYMENT_PROCESSING](#22-adding-payment_processing)
23. [Risk Register](#23-risk-register)
24. [Recommended Migration Order](#24-recommended-migration-order)
25. [What Is Already Excellent](#25-what-is-already-excellent-preserve-these)
26. [Open Questions](#26-open-questions)
27. [Immediate Next Actions](#27-immediate-next-actions)

---

## 1. TECH STACK

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Runtime | Node.js | `22.x` (pinned in `engines`) | Vercel serverless + local dev |
| Frontend | React | `^19.0.1` | SPA, no SSR |
| Bundler | Vite | `^8.3.0` | Dev uses Vite in middleware mode |
| Styling | Tailwind CSS | `^4.3.3` | CSS-first config via `@layer` in `src/index.css` |
| Backend | Express | `^4.21.2` | Single 10,435-line `server.ts` |
| Database | Supabase (Postgres) | `@supabase/supabase-js ^2.116.0` | Auth + Postgres + Storage + Realtime + pg_cron |
| Validation | Zod | `^4.6.5` | `apiSchemas.*` in `src/lib/validation.ts` |
| Rate limiting | `express-rate-limit` | `^8.7.0` | IP + per-user buckets |
| Animation | `motion` | `^12.23.24` | Landing page |
| Icons | `lucide-react` | `^0.546.0` | |
| Class merging | `clsx` + `tailwind-merge` | `^2.1.1` / `^3.7.0` | |
| Tests | `node:test` via `tsx --test` | — | 25 test files |
| AI | `@google/genai` | `^2.4.0` | **Declared but not used in any server route** (dead dependency) |

**Deployment:** Vercel. `vercel.json` routes `/api/(.*)` → `/server.cjs` (esbuild bundle of `server.ts`), everything else → `/index.html`. When `VERCEL === '1'`, `module.exports = app`; otherwise `app.listen(PORT)`.

**Commands** (per `AGENTS.md`):
- Lint/Typecheck: `tsc --noEmit` (`npm run lint`)
- Test: `tsx --test tests/**/*.test.ts` (`npm test`)
- ESLint is **not** configured in this project.

---

## 2. PROJECT STRUCTURE

```
server.ts                     ← ALL backend logic (10,435 lines)
src/
  config/app.ts               ← single source of truth for business constants
  context/AuthContext.tsx     ← session + role state
  routes/Router.tsx           ← role-gated route table
  components/
    ui/         (10)          Button, Card, Badge, Dialog, Modal, Input, Textarea,
                               PasswordInput, Skeleton, ThemeToggle
    shared/     (5)           EmptyState, ErrorState, LoadingState, SuccessState, ShortId
    admin/ auth/ landing/ layout/ mentor/ navigation/ notifications/ seeker/
  hooks/                      4 cross-cutting + 6 admin/mentor + index
  lib/          (38 files)    engines, services, clients, validation
  pages/        admin/ auth/ mentor/ public/ seeker/
supabase/migrations/  (30 SQL files, 2026-09-20 → 2026-09-27)
tests/           (25 files)
```

**Concentration risk:** `server.ts` is a single 10.4k-line file containing ~120 route handlers plus 20+ shared helpers. There is no `src/server/` directory. Every backend change touches one file.

### Full API endpoint map (as registered in `server.ts`)

| # | Method | Path | Line | Guards |
|---|---|---|---|---|
| 1 | GET | `/api/health` | 1324 | — |
| 2 | POST | `/api/auth/demo-login` | 1341 | `expensiveRouteLimiter`, Zod |
| 3 | POST | `/api/auth/login-failure` | 1410 | `expensiveRouteLimiter` |
| 4 | POST | `/api/auth/login-success` | 1453 | `expensiveRouteLimiter` |
| 5 | POST | `/api/bookings/hold` | 1475 | `auth`, `role:seeker`, `expensive`, Zod |
| 6 | GET | `/api/mentor/bookings` | 1729 | `auth`, `role:mentor` |
| 7 | GET | `/api/mentor/bookings/:id` | 1788 | `auth`, `role:mentor` |
| 8 | GET | `/api/seeker/bookings/:id` | 1881 | `auth`, `role:seeker` |
| 9 | GET | `/api/seeker/bookings` | 1988 | `auth`, `role:seeker` |
| 10 | POST | `/api/seeker/bookings/:id/payment-proof` | 2077 | `auth`, `role:seeker`, `expensive` |
| 11 | GET | `/api/seeker/bookings/:id/payment-proof` | 2316 | `auth`, `role:seeker` |
| 12 | POST | `/api/seeker/bookings/:id/cancel` | 2358 | `auth`, `role:seeker`, Zod |
| 13 | POST | `/api/seeker/bookings/:id/reschedule` | 2475 | `auth`, `role:seeker`, Zod |
| 14 | POST | `/api/mentor/bookings/:id/confirm` | 2673 | `auth`, `role:mentor`, Zod |
| 15 | GET | `/api/admin/bookings/overdue-links` | 2730 | `auth`, `admin` |
| 16 | GET | `/api/admin/bookings` | 2747 | `auth`, `admin` |
| 17 | GET | `/api/mentor/segments` | 2831 | `auth`, `role:mentor` |
| 18 | GET | `/api/mentor/gigs` | 2885 | `auth`, `role:mentor` |
| 19 | POST | `/api/mentor/gigs` | 2925 | `auth`, `role:mentor`, `activeMentor`, Zod |
| 20 | PATCH | `/api/mentor/gigs/:id` | 2982 | `auth`, `role:mentor`, `activeMentor`, Zod |
| 21 | DELETE | `/api/mentor/gigs/:id` | 3036 | `auth`, `role:mentor`, `activeMentor` |
| 22 | GET | `/api/mentor/available-segments` | 3076 | `auth`, `role:mentor` |
| 23 | POST | `/api/mentor/segments/apply` | 3126 | `auth`, `role:mentor`, `activeMentor`, Zod |
| 24 | GET | `/api/mentor/availability` | 3194 | `auth`, `role:mentor` |
| 25 | PUT | `/api/mentor/availability` | 3232 | `auth`, `role:mentor`, `activeMentor`, Zod |
| 26 | PUT | `/api/mentor/availability/exceptions` | 3289 | `auth`, `role:mentor`, `activeMentor`, Zod |
| 27 | GET | `/api/mentor-availability/slots` | 3359 | `auth` |
| 28 | GET | `/api/admin/mentors` | 3485 | `auth`, `admin` |
| 29 | PATCH | `/api/admin/mentors/:id/approve` | 3640 | `auth`, `admin` |
| 30 | PATCH | `/api/admin/mentors/:id/reject` | 3670 | `auth`, `admin` |
| 31 | PATCH | `/api/admin/mentors/:id/toggle-active` | 3706 | `auth`, `admin` |
| 32 | PATCH | `/api/admin/mentors/:id/status` | 3786 | `auth`, `admin`, Zod |
| 33 | GET | `/api/admin/mentors/eligible` | 3976 | `auth`, `admin` ⚠️ **must precede #34** |
| 34 | GET | `/api/admin/mentors/:id` | 4016 | `auth`, `admin` |
| 35 | GET | `/api/admin/mentors/:id/bookings` | 4247 | `auth`, `admin` |
| 36 | PATCH | `/api/admin/mentors/:id/profile` | 4332 | `auth`, `admin`, Zod |
| 37 | POST | `/api/admin/mentors/:id/gigs` | 4479 | `auth`, `admin`, Zod |
| 38 | PATCH | `/api/admin/mentors/gigs/:gigId` | 4556 | `auth`, `admin`, Zod |
| 39 | PATCH | `/api/admin/mentors/gigs/:gigId/archive` | 4614 | `auth`, `admin` |
| 40 | PUT | `/api/admin/mentors/:id/availability` | 4663 | `auth`, `admin`, Zod |
| 41 | PUT | `/api/admin/mentors/:id/availability/exceptions` | 4723 | `auth`, `admin`, Zod |
| 42 | GET | `/api/admin/mentors/:id/audit` | 4789 | `auth`, `admin` |
| 43 | PUT | `/api/admin/mentors/:id/segments` | 4869 | `auth`, `admin`, Zod |
| 44 | GET | `/api/admin/segments` | 4970 | `auth`, `admin` |
| 45 | GET | `/api/admin/segments/:segment` | 5075 | `auth`, `admin` |
| 46 | POST | `/api/admin/segments` | 5112 | `auth`, `admin`, Zod |
| 47 | PATCH | `/api/admin/segments/:id` | 5168 | `auth`, `admin`, Zod |
| 48 | PATCH | `/api/admin/segments/:id/toggle-active` | 5244 | `auth`, `admin`, Zod |
| 49 | POST | `/api/admin/segments/:id/priority` | 5277 | `auth`, `admin`, Zod |
| 50 | POST | `/api/admin/segments/:id/mentors` | 5353 | `auth`, `admin`, Zod |
| 51 | DELETE | `/api/admin/segments/:id/mentors/:mentorId` | 5432 | `auth`, `admin` |
| 52 | POST | `/api/admin/segments/:id/gigs` | 5490 | `auth`, `admin`, Zod |
| 53 | PATCH | `/api/admin/gigs/:id` | 5578 | `auth`, `admin`, Zod |
| 54 | PATCH | `/api/admin/gigs/:id/toggle-active` | 5644 | `auth`, `admin`, Zod |
| 55 | GET | `/api/admin/segments/:segment/mentors` | 5705 | `auth`, `admin` |
| 56 | GET | `/api/admin/segments/:segment/gigs` | 5734 | `auth`, `admin` |
| 57 | GET | `/api/admin/mentors/:id/slots` | 5769 | `auth`, `admin` |
| 58 | GET | `/api/admin/users` | 5833 | `auth`, `admin` |
| 59 | GET | `/api/admin/users/:id` | 5904 | `auth`, `admin` |
| 60 | PATCH | `/api/admin/users/:id` | 6065 | `auth`, `admin`, Zod |
| 61 | PATCH | `/api/admin/users/:id/status` | 6145 | `auth`, `admin`, Zod |
| 62 | GET | `/api/admin/users/:id/bookings` | 6256 | `auth`, `admin` |
| 63 | GET | `/api/admin/users/:id/payments` | 6331 | `auth`, `admin` |
| 64 | GET | `/api/admin/users/:id/workspaces` | 6413 | `auth`, `admin` |
| 65 | GET | `/api/admin/users/:id/notifications` | 6456 | `auth`, `admin` |
| 66 | POST | `/api/admin/users/:id/notifications` | 6486 | `auth`, `admin`, Zod |
| 67 | GET | `/api/admin/users/:id/audit` | 6544 | `auth`, `admin` |
| 68 | POST | `/api/admin/users/:id/password-reset` | 6617 | `auth`, `admin` |
| 69 | GET | `/api/admin/dashboard/overview` | 6692 | `auth`, `admin` |
| 70 | GET | `/api/admin/payments` | 6717 | `auth`, `admin` |
| 71 | PATCH | `/api/admin/payments/:id/approve` | 6808 | `auth`, `admin` |
| 72 | PATCH | `/api/admin/payments/:id/reject` | 6849 | `auth`, `admin`, Zod |
| 73 | GET | `/api/admin/platform-config` | 6910 | `auth`, `admin` |
| 74 | GET | `/api/platform-config` | 6966 | `auth` |
| 75 | PATCH | `/api/admin/platform-config` | 7010 | `auth`, `admin` |
| 76 | POST | `/api/admin/platform-config/qr-upload-url` | 7139 | `auth`, `admin` |
| 77 | DELETE | `/api/admin/platform-config/qr` | 7208 | `auth`, `admin` |
| 78 | GET | `/api/notifications` | 7269 | `auth` |
| 79 | GET | `/api/notifications/unread-count` | 7347 | `auth` |
| 80 | PATCH | `/api/notifications/:id/read` | 7378 | `auth`, Zod |
| 81 | POST | `/api/notifications/mark-all-read` | 7436 | `auth`, Zod |
| 82 | POST | `/api/notifications/dispatch` | 7483 | `auth`, **`admin`**, Zod |
| 83 | GET | `/api/sessions/:bookingId/access` | 7604 | `auth` |
| 84 | POST | `/api/sessions/:bookingId/join` | 7721 | `auth`, Zod |
| 85 | POST | `/api/sessions/:bookingId/complete` | 7860 | `auth` |
| 86 | GET | `/api/workspaces/booking/:bookingId` | 8027 | `auth` |
| 87 | POST | `/api/workspaces` | 8119 | `auth`, Zod |
| 88 | GET | `/api/admin/workspaces` | 8247 | `auth`, `admin` |
| 89 | GET | `/api/mentor/onboarding-status` | 8302 | `auth`, `role:mentor` |
| 90 | POST | `/api/mentor/application/draft` | 8372 | `auth`, `role:mentor`, Zod |
| 91 | POST | `/api/mentor/application/submit` | 8479 | `auth`, `role:mentor` |
| 92 | POST | `/api/mentor/document` | 8597 | `auth`, `role:mentor`, Zod |
| 93 | DELETE | `/api/mentor/document/:id` | 8684 | `auth`, `role:mentor` |
| 94 | GET | `/api/admin/mentor-applications` | 8714 | `auth`, `admin` |
| 95 | GET | `/api/admin/mentor-applications/:id` | 8842 | `auth`, `admin` |
| 96 | POST | `/api/admin/mentor-applications/:id/approve` | 8921 | `auth`, `admin` |
| 97 | POST | `/api/admin/mentor-applications/:id/reject` | 9065 | `auth`, `admin`, Zod |
| 98 | PATCH | `/api/admin/mentor-documents/:id/review` | 9148 | `auth`, `admin`, Zod |
| 99 | POST | `/api/admin/users/direct-create` | 9224 | `auth`, `admin` |
| 100 | POST | `/api/admin/users/:id/resend-invite` | 9906 | `auth`, `admin` |
| 101 | GET | `/api/mentor/document/upload-url` | 9997 | `auth`, `role:mentor` |
| 102 | GET | `/api/admin/system-health/dashboard` | 10112 | `auth`, `admin` |
| 103 | GET | `/api/admin/system-health/metrics` | 10201 | `auth`, `admin` |
| 104 | GET | `/api/admin/system-health/logs` | 10211 | `auth`, `admin` |
| 105 | GET | `/api/admin/system-health/errors` | 10234 | `auth`, `admin` |
| 106 | GET | `/api/admin/system-health/auth-logs` | 10258 | `auth`, `admin` |
| 107 | GET | `/api/admin/system-health/audit-logs` | 10278 | `auth`, `admin` |
| 108 | GET | `/api/admin/system-health/logs/:requestId` | 10298 | `auth`, `admin` |
| 109 | GET | `/api/admin/system-health/retention` | 10318 | `auth`, `admin` |
| 110 | POST | `/api/admin/system-health/retention` | 10337 | `auth`, `admin`, Zod |
| 111 | POST | `/api/admin/system-health/prune` | 10364 | `auth`, `admin` |

---

## 3. AUTHENTICATION

**Primary path:** Supabase Auth (email/password) → `AuthContext` holds session, resolves `user_roles` from `profiles`, exposes `activeRole`.

**Middleware chain** (`server.ts:1319+`):
1. `express.json({ limit: '256kb' })` — deliberately small (payment proofs bypass it by design, see §9)
2. Request-ID + response-capture logging middleware (`server.ts:1247-1312`)
3. `apiRateLimiter` on `/api` (`server.ts:1319`)
4. Per-route: `requireAuth` → `requireRole(x)` / `requireAdmin` / `requireActiveMentor` → `expensiveRouteLimiter` → `validateBody(schema)`

**Demo auth — `POST /api/auth/demo-login` (`server.ts:1341`):**
- Gated by `isDemoAuthEnabled()`: requires `ENABLE_DEMO_PERSONAS=true`, non-production `NODE_ENV`, and a strong `DEMO_TOKEN_SECRET`
- Three personas (`server.ts:1161-1190`): `seeker`, `mentor` (one-click), `admin` (**password required**)
- `buildDemoAccounts()` (`server.ts:1203`) **removes the admin persona entirely** if `ADMIN_PASSWORD` is unset or < 12 chars — fail-closed
- `passwordsMatch` (`server.ts:1212`) uses `crypto.timingSafeEqual` with a length pre-check
- Rate limited by `expensiveRouteLimiter` on IP
- Failure path calls `recordLoginFailure` and logs via `logger.auth` (`server.ts:1378-1397`)

**Brute-force telemetry:** `POST /api/auth/login-failure`, `/login-success` → `login_failure_trackers` table + `list_active_login_threats` RPC + `prune_login_failure_trackers` cron.

**Weakness (R9):** Demo tokens are HMAC-signed but the seeker/mentor personas are still one-click. If `ENABLE_DEMO_PERSONAS=true` ever reaches production, any visitor becomes a seeker. The `NODE_ENV` guard is the only thing preventing it.

---

## 4. ROLES & AUTHORIZATION

**Model:** `user_roles(user_id, role)` with `UNIQUE(user_id, role)`. Roles: `seeker`, `mentor`, `admin`. A user can hold several — `server.ts:3843` explicitly notes "A mentor may ALSO hold the admin role".

**Server enforcement:**
- `requireAuth` resolves roles from the verified JWT, never from body/query
- `requireRole(x)` — exact role check
- `requireAdmin` — admin role
- `requireActiveMentor` — `deriveMentorAccountState(...).canPerformOperationalActions`
- Ownership is always `req.auth.user.id`; **no route trusts a client-supplied `mentorId`/`seekerId`/`userId`**. The comment at `server.ts:3122-3125` documents the old `POST /api/mentor/segments/apply` hole that was closed.

**Account status overlay** (`profiles.account_status`, `suspended_until`) blocks operational actions independently of role:
- `deriveAccountState` / `deriveMentorAccountState` in `src/lib/adminAccountControl.ts`
- `POST /api/bookings/hold` re-checks **both** seeker state (`server.ts:1488-1510`) and mentor state (`server.ts:1515-1558`) server-side before calling the RPC
- `assertAdminAccountSafety` (`server.ts:3855`, `server.ts:6183`) blocks self-status-change and last-active-admin lockout
- `countActiveAdminAccounts` used at both write sites

**Client enforcement:** `ProtectedRoute.tsx` + role checks in `Router.tsx`. UI-level only — the server is the real gate.

**Route-ordering hazard (R6):** `GET /api/admin/mentors/eligible` must stay registered **above** `GET /api/admin/mentors/:id` (`server.ts:3967-3971`), or Express's `:id` captures the literal string and 400s. Fragile — no test guards it.

---

## 5. SEGMENT SYSTEM

**Tables:** `segments(id, name, slug UNIQUE, description, priority, is_active)`, `mentor_segments(mentor_id, segment_id, is_primary)`.

- Slug is the public URL key; UUID is the internal PK. `resolveAdminSegmentBySlugOrId` (`server.ts:464`) resolves either shape using `UUID_SHAPE_PATTERN` — a slug can never collide with a UUID shape
- `mentor_segments` has `uq_mentor_segment` → one row per pair
- Public application: `POST /api/mentor/segments/apply` (`server.ts:3126`) inserts a `mentor_segments` row **immediately** — there is no pending state on the row itself; approval is tracked via `mentor_profiles.approval_status` plus the admin segment-management endpoints
- Display helpers in `src/lib/segmentNaming.ts` — pluralisation and heading builders, no hardcoded segment names
- Admin detail endpoint returns segment + mentors + gigs in **one** response to avoid a three-request waterfall (`server.ts:5088`)
- Removing a mentor from a segment is blocked if active gigs or future bookings exist (`server.ts:5441-5465`)

---

## 6. MENTOR & GIG ARCHITECTURE

**Mentor identity is split across three tables:**

| Table | Holds |
|---|---|
| `profiles` | `full_name`, `email`, `phone`, `avatar_url`, `timezone`, `account_status`, `suspended_*`, `internal_note` |
| `user_roles` | role membership |
| `mentor_profiles` | `headline`, `about`, `experience_years`, `languages`, `expertise`, `rating`, `review_count`, `session_count`, `is_approved`, `approval_status`, `is_active`, `is_featured`, `created_via` |

> ⚠️ The `mentor_profiles` column list above is the **documented** set from `server.ts:4143-4161`. See risk **R2** — `server.ts:8436-8444` writes `bio`, `years_experience` and `timezone`, which are not in that list.

**Gigs:** `gigs(id, mentor_id, segment_id, title, description, duration_minutes, price_inr, is_active)`. One active gig per (mentor, segment) — enforced by unique constraint and explicitly checked in `POST /api/admin/segments/:id/gigs` (`server.ts:5534`) and `PATCH /api/admin/gigs/:id` (`server.ts:5588`).

**Archival, not deletion:** `DELETE /api/mentor/gigs/:id` (`server.ts:3036`) is a **real DELETE**. Because `bookings.gig_id` is `ON DELETE RESTRICT` (phase4:195), it will fail with an FK violation if bookings exist, but succeeds when none do. All admin paths use archive (`is_active=false`) instead (`server.ts:4614`).

**Creation source tracking:** `mentor_profiles.created_via` (`public_signup` | `admin_direct`) + `audit_logs` `MENTOR_CREATED_BY_ADMIN` + presence of a `mentor_applications` row → `resolveMentorCreationSource` (`server.ts:4112`). Prevents the "No mentor application exists" false error for admin-created mentors.

**Admin-created mentors are pre-approved** (`server.ts:9636-9651`): `is_approved=true`, `approval_status='approved'`, `is_active=true`, `account_status='active'`, `created_via='admin_direct'`. The Admin's creation action **is** the approval; no document workflow.

**Cascading rollback:** `POST /api/admin/users/direct-create` deletes the just-created auth user if any downstream write fails (`server.ts:9517-9530`, invoked at `9888`/`9894`), so no partial account survives.

---

## 7. AVAILABILITY ENGINE

**Storage:**
- `mentor_availability(mentor_id, day_of_week 0-6, start_time, end_time, timezone, is_enabled)` — recurring weekly windows
- `mentor_availability_exceptions(mentor_id, exception_date, is_available, start_time, end_time, reason)` — date overrides

**Single authoritative engine:** `generateMentorSlots()` in `src/lib/slotEngine.ts` — the only slot-generation implementation in the project.

**Inputs loaded server-side** in `computeMentorSlotsForDate` (`server.ts:622-747`):

| Input | Source |
|---|---|
| mentor timezone | `profiles.timezone` (falls back to `APP_CONFIG.DEFAULT_TIMEZONE`) |
| duration | **`gigs.duration_minutes` of the ACTIVE gig** — never a constant |
| schedule | `mentor_availability` where `is_enabled = true` |
| exceptions | `mentor_availability_exceptions` for the requested date |
| reservations | `bookings` not in `(CANCELLED, REJECTED)`, overlapping the window |
| holds | `slot_holds` ACTIVE and `expires_at > now` |
| clock | `now` — the server clock, so a started slot is never reported bookable |

**Why server-side (documented at `server.ts:586-602`):** RLS on `bookings`/`slot_holds` is participant-scoped, so a browser reading them directly would only see its own reservations and could offer an already-taken slot. Must be called with the service-role client.

**Endpoints:**
- `GET /api/mentor-availability/slots` (`server.ts:3359`) — the single seeker-facing slot source. `?mentorId=` or `?segmentId=` (mutually exclusive), `?date=YYYY-MM-DD`
- `GET /api/admin/mentors/:id/slots` (`server.ts:5769`) — delegates to the same helper

**Targeted revalidation:** the response carries `next_hold_expires_at` and `next_slot_start_at` (`server.ts:616-619`) so the client can schedule a precise timer instead of polling blindly.

**Write semantics:** PUT endpoints use replace-all (delete-then-insert, `server.ts:3260-3267`). **Not transactional** — a crash between delete and insert loses availability (R11). Acceptable for operational config, but worth noting.

---

## 8. BOOKING ENGINE

### Atomic hold flow

1. `POST /api/bookings/hold` (`server.ts:1475`) — `requireAuth` + `requireRole('seeker')` + `expensiveRouteLimiter` + Zod
2. Server re-checks: seeker account state (`1495-1510`), mentor approval/active/account state (`1538-1558`), booking cutoff on absolute instants (`1569-1590`)
3. `admin.rpc('create_booking_with_hold', ...)` (`server.ts:1592`) — takes a **mentor row lock**, writes hold + booking in one transaction
4. RPC errors are parsed from a `code: X, <reason>` message prefix (`1606-1609`) and mapped to HTTP status (`1611-1629`)
5. Returns the **canonical booking record** (`server.ts:1660-1680`) — never the hold id, never a payment id

### Database-level guarantees

- `no_overlapping_mentor_bookings` — `EXCLUDE USING gist (mentor_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&) WHERE (status NOT IN ('CANCELLED','REJECTED'))` (phase4:219-222) — **the real double-booking guard**
- `chk_booking_time CHECK (start_time < end_time)` (phase4:216)
- `chk_meeting_url_https CHECK (meeting_url IS NULL OR meeting_url ~* '^https://')` (phase4:217)
- RPCs: `acquire_slot_hold`, `convert_hold_to_booking`, `create_booking_with_hold`, `expire_stale_holds`
- `expire_stale_holds` driven by pg_cron (`20260927020000_phase21_hold_expiry_cron.sql`)

### Status machine

`bookings.status` CHECK (`phase4:203-211`):
```
PAYMENT_PENDING → PENDING_VERIFICATION → MENTOR_PENDING → CONFIRMED → COMPLETED
                                                       ↘ CANCELLED / REJECTED
```

### Cancellation — `POST /api/seeker/bookings/:id/cancel` (`server.ts:2358`)

- Cancellable from `PAYMENT_PENDING | PENDING_VERIFICATION | MENTOR_PENDING | CONFIRMED` (`2387`)
- Requires ≥ `NORMAL_CANCELLATION_WINDOW_MINUTES` (10) before start (`2400`)
- Releases the hold when `PAYMENT_PENDING` (`2411-2417`)
- Notifies both parties (`2434-2457`)

### 🔴 BUG R1 — Reschedule calls `acquire_slot_hold` twice

`server.ts:2578-2593`:
```js
// The RPC will fail if slot is not available; if it succeeds, we have a new hold
const { data: holdResult, error: holdErr } = await admin.rpc('acquire_slot_hold', { ... });

// ── IDENTICAL CALL, executed immediately above, result discarded ──
const { data: holdResult, error: holdErr } = await admin.rpc('acquire_slot_hold', { ... });
```

The first call's result **and** its error are both discarded. This doubles hold writes and silently loses the first call's failure. Fix: delete the first call.

### 🔴 BUG R8 — Reschedule is three non-atomic operations

`server.ts:2566-2624`: release old hold → acquire new hold → `UPDATE bookings`. A failure between steps leaves a released hold plus an orphaned new hold, with the booking still pointing at the old slot. The `create_booking_with_hold` RPC (used by the initial booking) is atomic; reschedule is not.

---

## 9. PAYMENT ENGINE (MANUAL QR — to be replaced)

### Flow

1. Seeker books → `PAYMENT_PENDING`, hold active for `HOLD_DURATION_MS` (5 min)
2. `GET /api/platform-config` (`server.ts:6966`) returns UPI id, signed QR URL, instructions from `platform_config` (single row, `id = 1`)
3. Seeker pays offline, uploads screenshot **directly to the private bucket** — deliberately not through the server. Documented rationale at `server.ts:1236-1242` and `2086-2092`: base64 is ~33% larger than the file and previously caused 413s
4. `POST /api/seeker/bookings/:id/payment-proof` (`server.ts:2077`):
   - `normaliseTransactionReference` validates the UTR
   - `validateProofFile` validates mime + size
   - `storagePath.startsWith('{callerId}/{bookingId}/')` — path ownership check (`2137`)
   - `storage.list()` confirms the object actually exists (`2174-2186`)
   - real byte count checked via `metadata.size` (`2188-2194`); oversized object is deleted
   - `payments` upsert on `booking_id` (`2216-2220`)
   - booking advanced `PAYMENT_PENDING → PENDING_VERIFICATION` (`2235-2247`)
5. Notifications: seeker + all active admins via `resolveActiveAdminIds` (`2264-2293`)
6. `PATCH /api/admin/payments/:id/approve|reject` (`server.ts:6808`, `6849`) → `review_payment` RPC → `MENTOR_PENDING` + `notifyPaymentReviewed`

**Server-authority discipline (good):** amount, seeker, booking and storage key are all derived server-side. `server.ts:2076`: *"a client cannot pay ₹1 for a ₹499 session."*

### `payments` table (`phase4:234-248`)

| Column | Constraint |
|---|---|
| `booking_id` | `UNIQUE` (`uq_payment_booking`) |
| `status` | `CHECK IN ('PENDING_VERIFICATION','VERIFIED','REJECTED')` |
| `proof_storage_path` | **`TEXT NOT NULL`** ⚠️ |
| `transaction_reference` | nullable `TEXT` |
| `verified_by` / `verified_at` / `rejection_reason` | nullable |

> ⚠️ **`proof_storage_path NOT NULL` is the hard blocker for Razorpay.** A gateway-initiated capture has no screenshot. This column must become nullable.

### Payment sync

`src/hooks/usePaymentSync.ts` exists, but **`payments` is not in the realtime publication** (see §17). Verify whether it polls or whether the publication was extended outside migrations.

---

## 10. NOTIFICATIONS

**Table:** `notifications(id, user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, read_at, metadata, created_at)`.
`user_id` is `NOT NULL REFERENCES profiles(id) ON DELETE CASCADE` (`phase4:259`).
`type` CHECK: `('BOOKING','PAYMENT','SESSION','WORKSPACE','SYSTEM')` (`phase4:262`).

**Read paths:** `GET /api/notifications` (`server.ts:7269`), `/unread-count` (`7347`), `PATCH /:id/read` (`7378`, scoped by `user_id` so IDOR is impossible), `POST /mark-all-read` (`7436`).

### 🔴 BUG R3 — Admin notification on mentor application submit always fails

`server.ts:8576-8586`:
```js
const { error: notifErr } = await admin.from('notifications').insert({
  user_id: null,                       // ← NOT NULL column
  title: 'New Mentor Verification Submitted',
  ...
});
if (notifErr) console.error('Failed to create admin notification:', notifErr.message);
```

`notifications.user_id` is `NOT NULL`. **This insert always fails**, and the error is only logged. The intended admin notification for new mentor applications is therefore **never delivered**. Fix: use `resolveActiveAdminIds`, the pattern already used at `server.ts:2278`.

### 🔴 Finding — `type` CHECK drift

`phase4:262` constrains `type` to `SYSTEM`, but two routes insert `type: 'ADMIN'`:
- `POST /api/notifications/dispatch` (`server.ts:7542`)
- `POST /api/admin/users/:id/notifications` (`server.ts:6514`)

A later migration must have widened the constraint, or these inserts fail. **Verify.** (`server.ts:7483` did correctly add `requireAdmin` to the dispatch route, closing a real function-level authorization hole.)

### 🟡 Finding R7 — ~15 notification inserts ignore their error

Fire-and-forget with no check: `server.ts:2434`, `2447`, `2634`, `2647`, `7979`, `8222`, `8576`, `9032`, `9116`.

**Dedup (good):** `server.ts:2254` computes `isNewReviewRequest = !existingPayment || existingPayment.status === 'REJECTED'` — repeat clicks don't spam, but a re-submission after rejection does notify.

**Realtime:** `useNotificationSync.ts` subscribes to `notifications:${userId}`.

---

## 11. SESSION ACCESS & MEETING URL

**This is the most carefully-built part of the codebase.**

- `src/lib/sessionAccess.ts` — `validateSessionAccess`, `joinSessionAuthoritative`, shape validators (`isBookingIdShape`, `isSafeBookingIdentifier`)
- Server loads the **real booking** from Supabase via `loadAuthoritativeSessionBooking` (`server.ts:793`), reads caller roles from `user_roles`, builds a minimal engine context via `buildSessionEngineContext` (`server.ts:854`)
- **Server clock only.** `currentTime` in query/body is accepted for back-compat and deliberately ignored (`server.ts:7608`, `7725`) — documented as "a client-supplied timestamp is a T-5 bypass and a post-end join"
- **Resource concealment:** non-participant ≡ non-existent, both returning an identical 404 carrying no participant data (`server.ts:7694`, `7812`, `7903`)
- **T-5 gate:** `SESSION_ACCESS_WINDOW_MS` = 5 min; join is 403 `TOO_EARLY` before that
- **Meeting URL redaction:** `redactMeetingUrlForParticipant` strips it from seeker list/detail payloads; only the join endpoint releases it, only inside the window

### Triple-layer session-completion reconciliation

| Layer | Mechanism | Where |
|---|---|---|
| 1. Cron | `complete_expired_sessions()` every minute | `phase21` |
| 2. Per-row read path | `reconcileBookingSessionState()` → `reconcile_expired_sessions(uuid)` RPC, **before the request is answered** | `server.ts:970` |
| 3. Batched list path | `reconcileAndAnnotateBookingRows()` → `reconcile_expired_bookings(uuid[])` RPC — avoids N round trips | `server.ts:1020` |

`actual_ended_at` is set to the booking's **own `end_time`**, not `now` (`server.ts:894-899`), so the recorded instant is identical regardless of which path wins the race. `annotateSessionState` (`server.ts:1093`) is the read-only **fail-closed** fallback derived from the server clock — an unparseable window is treated as elapsed.

**Notification ownership is deliberate:** the cron and the reconcile RPCs own completion notifications; the list path explicitly does not emit them (`server.ts:1014-1018`).

**Manual end** — `POST /api/sessions/:bookingId/complete` (`server.ts:7860`):
- Mentor, seeker, **or** admin may end
- Requires `CONFIRMED` + `start_time <= now` (`7924-7944`)
- Conditional `UPDATE ... WHERE status='CONFIRMED'` prevents double-apply (`7947-7959`)
- Records `actual_ended_at`, `ended_by_role`, `end_reason` — meeting URL is **irrevocably revoked** from seekers immediately
- Notifies only the counterparty (`7975-7990`)

---

## 12. DATABASE ARCHITECTURE

**30 migrations**, 2026-09-20 → 2026-09-27. Naming: `phase<N>_<slug>.sql`, timestamp-prefixed for ordering.

**Core tables:** `profiles`, `user_roles`, `segments`, `mentor_profiles`, `seeker_profiles`, `mentor_segments`, `gigs`, `mentor_availability`, `mentor_availability_exceptions`, `slot_holds`, `bookings`, `payments`, `session_workspaces`, `notifications`, `mentor_applications`, `mentor_verification_documents`, `mentor_document_types`, `mentor_application_audit`, `audit_logs`, `system_logs`, `system_log_retention`, `platform_config`, `login_failure_trackers`.

**48 RPCs**, including the security primitives:
`is_admin`, `has_role`, `is_mentor`, `is_account_suspended`, `is_current_user_suspended`, `is_mentor_discoverable`, `mentor_is_publicly_visible`, `can_join_session`, `resolve_session_state`, `get_session_access`, `get_user_roles`.

**Hardening progression is visible in the migration filenames:**
- `phase16_role_integrity_backfill`
- `phase17_stale_slot_hold_guard`
- `phase19_security_lockdown`
- `phase24c_bookings_privilege_tightening`
- `phase24e_scoped_bulk_reconcile_and_service_role`

**Data-integrity choices (good):**
- `bookings.gig_id`, `bookings.segment_id` → `ON DELETE RESTRICT` (phase4:195-196)
- `payments.seeker_id`, `bookings.mentor_id/seeker_id` → `profiles` `ON DELETE RESTRICT`
- `bookings.hold_id` → `slot_holds` `ON DELETE SET NULL`
- `notifications.user_id` → `profiles` `ON DELETE CASCADE`
- `set_updated_at` trigger

**Cron jobs:** `expire_stale_holds`, `complete_expired_sessions`, `prune_system_logs`, `prune_login_failure_trackers`.

---

## 13. API SURFACE

**111 endpoints** — full table in §2.

| Group | Count | Auth |
|---|---|---|
| `/api/health` | 1 | none |
| `/api/auth/*` | 3 | none / rate-limited |
| `/api/bookings/hold` | 1 | seeker |
| `/api/mentor/*` | 17 | mentor (+`requireActiveMentor` on writes) |
| `/api/seeker/*` | 6 | seeker |
| `/api/mentor-availability/slots` | 1 | any authenticated |
| `/api/sessions/*` | 3 | participant or admin |
| `/api/workspaces*` | 3 | participant / mentor+admin |
| `/api/notifications/*` | 5 | own rows only |
| `/api/platform-config` | 1 | any authenticated |
| `/api/admin/*` | 71 | admin |

**Conventions (consistent across the codebase):**
- `validateBody(apiSchemas.x)` with Zod — strips markup from free text, bounds lengths, normalises
- Errors: `{ success: false, error: { code, message, field? } }` with meaningful `code` enums
- `auditAction(req.auth, ACTION, { entityType, entityId, requestId, metadata })` on all admin mutations
- `X-Request-ID` header on every response; `logApiRequest` on every `/api/` response finish (`server.ts:1271-1309`)
- Rate limiting: `apiRateLimiter` (all `/api`), `expensiveRouteLimiter` (hold, demo-login, login-failure, payment-proof, mentor gig writes)

---

## 14. FRONTEND ARCHITECTURE

**Routing:** `Router.tsx` with `ProtectedRoute` wrapping role-scoped trees. ~40 routes.

**State:**
- `AuthContext` — session, profile, roles, `activeRole`
- Server data via direct `apiClient` calls inside `useEffect` — **no React Query/SWR**
- Hand-rolled hooks: `useMentorAvailability`, `useMentorBookings`, `useMentorProfile`, `useMentorNotifications`, `useAdminDashboard`, `useSegmentMentors`
- Realtime: `useAvailabilitySync`, `useNotificationSync`, `useSessionSync`, `usePaymentSync`

**Principle (correctly applied):** server-side authorisation is never duplicated on the client. The client only *hides* UI; every route re-derives from the token.

**Implication for a redesign:** no data-fetching layer to migrate, but also no cache invalidation layer — every page owns its own loading/error/empty states via the 5 `shared/` components.

---

## 15. DESIGN SYSTEM

`src/index.css` is a single hand-authored token file. Structure:

**Fonts** — `--font-untitled-sans` (Inter), `--font-aeonikpro` (Space Grotesk), `--font-dotdigital` (JetBrains Mono), plus three legacy aliases (`--font-sans`, `--font-heading`, `--font-mono`) kept for back-compat.

**Shell tokens** — `--color-shell-{bg,surface,text,border,primary,accent,success,warning,error,info}` with `-hover` / `-soft` variants.

**Semantic aliases** (shadcn-compatible) — `--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--accent`, `--destructive`, `--ring`, all pointing at shell tokens.

**Extended status tokens** — `--status-{success,warning,error,info}-{strong,soft,border}`.

**Gradients / glass** — `--gradient-hero-text`, `--glass-card-bg`, `--hero-card-shadow`, `--landing-aurora-1/2`, `--landing-spotlight`.

**Dark mode** — mirrored under `.dark` with `color-scheme: dark`. `ThemeToggle.tsx` already exists, so dark mode is a supported axis.

**Key brand values:** primary violet `#663af3`, accent blue `#2563eb`, light bg `#f4f7fc`, light surface `#ffffff`, dark bg `#05060f`, dark surface `#0b0d1a`.

### 🟡 Finding R10 — Three overlapping token namespaces

There are effectively **three** token sets with overlapping responsibility:
1. `--color-shell-*` (canonical)
2. Semantic aliases (thin, derived)
3. `--mentor-*` — a **second parallel token set** that duplicates shell values (e.g. `--mentor-accent: #663af3` === `--color-shell-primary`)

Plus `--brand-*` and `--status-*` as a fourth and fifth partial set. This is the main obstacle to a clean segment-theme system.

### Segment-specific themes: **do not exist today**

`segmentNaming.ts` handles names only (pluralisation, heading builders, count labels) — no theming. A redesign would need either:
- **(a)** a `segments.theme_key` column + CSS custom-property switching, or
- **(b)** a `[data-segment="..."]` attribute on a root wrapper with per-segment token blocks.

The existing `--mentor-*` block is proof the pattern is already half-established.

**Components:** 10 thin, token-driven `ui/` primitives — good. 5 `shared/` state components (Empty/Error/Loading/Success/ShortId) are the pattern to reuse during a redesign.

---

## 16. HARDCODED DATA INVENTORY

### Config — intentional and correct (`src/config/app.ts`)

| Constant | Value | Line |
|---|---|---|
| `HOLD_DURATION_MS` | 5 min | 2 |
| `SESSION_ACCESS_WINDOW_MS` | 5 min | 3 |
| `BOOKING_CUTOFF_MS` | 5 min | 8 |
| `MEETING_LINK_DEADLINE_MS` | 2 h | 12 |
| `NORMAL_CANCELLATION_WINDOW_MINUTES` | 10 | 13 |
| `MVP_PAYMENT_METHOD` | `'manual_qr'` | 14 |
| `DEFAULT_TIMEZONE` | `'Asia/Kolkata'` | 15 |

Served to admin via `GET /api/admin/platform-config` under `rules` (`server.ts:6939-6947`) so the UI cannot drift. The frontend holds **no copy** of these numbers.

### Database-driven — correct

`platform_config` (UPI/QR/instructions), `mentor_document_types` (required docs), `segments`, `system_log_retention`. Required document types are read from the DB at `server.ts:8351` and `8903`, not hardcoded.

### Hardcoded — acceptable

| Value | Where | Why it's fine |
|---|---|---|
| `MIN_MENTOR_BIO_LENGTH` | `server.ts:8524` | genuine product rule |
| `PAYMENT_PROOF_MAX_BYTES` (5 MB) | validation | storage constraint |
| `PAYMENT_QR_MAX_BYTES`, `PAYMENT_QR_MIME_TYPES` | `server.ts:7156-7163` | storage constraint |
| `ADMIN_DEMO_PASSWORD_MIN_LENGTH` = 12 | `server.ts:1202` | security policy |
| `MENTOR_APPLICATION_SEARCH_MATCH_LIMIT` | `server.ts:8733` | perf guard |
| `ROW_CAP = 20000` | `server.ts:10138` | perf guard, surfaces `truncated` flag |
| `QR_PATH_PATTERN` | `server.ts:7021` | security contract — prevents arbitrary object keys |
| `SIGNED_PROOF_TTL_SECONDS` = 300 | `server.ts:6762` | security policy |
| Document URL TTL = 300s | `server.ts:4078`, `5934`, `8894` | security policy |

### 🟡 Hardcoded — needs attention

| Finding | Where |
|---|---|
| **R14** — `2 * 60 * 60 * 1000` duplicates `APP_CONFIG.MEETING_LINK_DEADLINE_MS` | `server.ts:2794` |
| **R15** — `'Asia/Kolkata'` inline instead of `APP_CONFIG.DEFAULT_TIMEZONE` | `server.ts:1226`, `8424`, `8426`, `8442`, `9639` |
| **R2** 🔴 — `mentor_profiles` upsert writes `bio`, `years_experience`, `timezone` | `server.ts:8436-8444` |
| **R12** — `@google/genai` declared, never imported by any route | `package.json:14` |
| **R13** — `src/lib/logger.ts.tmp` committed | file listing |
| **R16** — `"This website is buid by Nikhil Kumar "` (typo) in the production startup banner | `server.ts:10425` |

---

## 17. REALTIME

**Publication** (`20260926020000_phase17_realtime_availability_sync.sql`): `supabase_realtime` with 5 tables —

```
public.mentor_availability
public.mentor_availability_exceptions
public.slot_holds
public.bookings
public.gigs
```

All five set to `REPLICA IDENTITY FULL`.

**Client consumers:**

| Hook | Channel | Subscribes to | Purpose |
|---|---|---|---|
| `useAvailabilitySync.ts` | per-mentor/date topic | the 5 tables | refetch slots on any change |
| `useNotificationSync.ts` | `notifications:${userId}` | `notifications` | badge + toast |
| `useSessionSync.ts` | `session:${bookingId}` | `bookings` | countdown / join state |
| `usePaymentSync.ts` | — | `payments`? | payment status |

### 🟡 Finding R17 — `payments` is not in the publication

`usePaymentSync.ts` exists, but `payments` is **not** in the `phase17` publication list. Either the publication was extended outside migrations, or the hook polls. **Verify.**

**Note for Razorpay:** after the migration, `payments` **and** the new `payment_events` table should both be added to the publication, otherwise a seeker will not see their payment state change without a manual refresh.

---

## 18. DEPLOYMENT & OPERATIONS

- **Vercel** serverless. `vercel.json`: `/api/(.*)` → `/server.cjs`, `/(.*)` → `/index.html`, immutable cache on `/assets/*`
- **Build:** `vite build` + `esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs`
- **Dev:** Vite in middleware mode; HMR rides the Express `httpServer` (avoids the port-24678 collision — `server.ts:10395-10398`)
- **`trust proxy = 1`** (`server.ts:1128`) — required for correct `req.ip` behind the Vercel edge. Without it every visitor shares one rate-limit bucket
- **Required env:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `APP_URL`, `ENABLE_DEMO_PERSONAS`, `DEMO_TOKEN_SECRET`, `ADMIN_PASSWORD`
- **Observability:** `system_logs` (categories `api_request` / `api_error` / `auth` / `db`), `audit_logs`, request-ID correlation, `GET /api/admin/system-health/logs/:requestId` for a single correlated trace, `POST /api/admin/system-health/prune` → `prune_system_logs` RPC

### 🔴 Finding R4 — Silent fixture fallback in production

Most routes fall back to `getLocalBookingEngineContext()` (an in-memory fixture) when `getSupabaseAdmin()` is null. Deliberate for the "no backend" local preview, but it means a **production misconfiguration silently serves fabricated data** on:

| Route | Line |
|---|---|
| `GET /api/mentor/bookings` | 1769-1781 |
| `GET /api/seeker/bookings` | 2050-2055 |
| `GET /api/notifications` | 7313-7340 |
| `POST /api/bookings/hold` | 1683-1710 |
| `GET /api/sessions/:id/access` | 7629 |

The `notifications` case is particularly dangerous: fabricated notifications would mask real payment decisions. **Recommended:** gate the fallback on an explicit `ALLOW_FIXTURE_FALLBACK=true`, and return 503 otherwise.

---

## 19. TESTING

**25 test files, `node:test` + `tsx --test`.** `npm test` = `tsx --test tests/**/*.test.ts`.

### Coverage map

| Area | Tests |
|---|---|
| Slot / availability engine | `availability`, `availability_sync`, `bookingCutoff`, `booking_concurrency`, `seeker_discovery_dates` |
| Session access | `session_access` |
| Booking engine | `mentor_confirmation` |
| Payment | `payment_proof` |
| Validation | `api_validation` |
| Admin control | `admin_account_control`, `admin_create_user`, `admin_mentor_control`, `admin_dashboard`, `mentor_creation_source`, `mentor_applications`, `admin_notification_routing` |
| Auth | `auth_flow`, `rate_limit` |
| Logging | `audit_logger`, `system_logs`, `system_health`, `system_health_dashboard`, `logSanitizer`, `error_sanitisation` |

Coverage is strong on the **engines and security logic**.

### Gaps

- 🔴 **No integration/route tests.** `server.ts`'s 10,435 lines have zero route-level coverage. Every handler guard is untested at the HTTP boundary (R5)
- **No component or page tests.** Nothing renders a React component
- **No E2E.** No Playwright/Cypress config
- The `eligible`-before-`:id` route-ordering hazard has no regression test (R6)
- No CI workflow, no coverage config, no `test:watch` script (R18)

---

## 20. RAZORPAY MIGRATION — IMPACT ASSESSMENT

### 20.1 Database changes required

| # | Change | Location | Why |
|---|---|---|---|
| 1 | **Add `PAYMENT_PROCESSING` to `bookings.status` CHECK** | `phase4_mvp_schema.sql:203-211` | Gateway order created, capture pending. Currently impossible to represent. Requires `DROP CONSTRAINT` + `ADD CONSTRAINT`. |
| 2 | **Make `payments.proof_storage_path` NULLABLE** | `phase4:240` | `NOT NULL` today. A Razorpay capture has no screenshot. **Hard blocker.** |
| 3 | **Add `'CREATED'` to `payments.status` CHECK** | `phase4:239` | Currently `('PENDING_VERIFICATION','VERIFIED','REJECTED')`. Order-placed-not-captured has no representation. |
| 4 | **New `payments` columns** | new migration | `razorpay_order_id` (unique), `razorpay_payment_id` (unique), `razorpay_signature`, `captured_at`, `refund_id`, `refund_status`, `failure_reason`, `gateway`, `gateway_payload jsonb` |
| 5 | **New `payment_events` table** | new migration | Append-only audit of every gateway webhook. Required for dispute/refund reconciliation. |
| 6 | **New `webhook_events` table** | new migration | Idempotency: unique on `(gateway, event_id)`. Prevents double-processing on Vercel retries. |
| 7 | **Hold expiry coupling** | `phase6` | The 15-min hold must now cover *gateway capture*, not manual UTR entry. See §21. |
| 8 | **Retire `platform_config` UPI/QR columns** | `phase4` | `upi_id`, `qr_image_storage_path`, `payment_instructions`, `payment_account_name` become dead. Keep the row (`id=1`). |
| 9 | **Add `RAZORPAY_*` secrets to env, not the DB** | — | The webhook secret must never live in a queryable table. |
| 10 | **Consider partial unique index for retries** | new migration | `UNIQUE(booking_id)` blocks a legitimate second payment attempt after a failure. See §20.3. |

### 20.2 Code that must change

| File / lines | What |
|---|---|
| `src/config/app.ts:14` | `MVP_PAYMENT_METHOD: 'manual_qr'` → `'razorpay'` |
| `server.ts:2077-2310` | `POST /api/seeker/bookings/:id/payment-proof` — **replace entirely** with order creation |
| `server.ts:2316-2349` | `GET .../payment-proof` — return gateway state, not proof state |
| `server.ts:6808-6891` | `PATCH /api/admin/payments/:id/approve\|reject` — **delete**; webhook becomes the sole writer |
| `server.ts:6910-6998` | `GET /api/admin/platform-config` + `GET /api/platform-config` — QR fields out, gateway config in |
| `server.ts:7010-7260` | `PATCH` / `qr-upload-url` / `DELETE /qr` — replaced by key management |
| `server.ts:1` (imports) | `PAYMENT_PROOF_BUCKET`, `PAYMENT_QR_*`, `signQrImageUrl` — retire |
| `server.ts:1236-1242` | Body-limit rationale comment becomes obsolete |
| `src/lib/paymentProof.ts` | `normaliseTransactionReference`, `validateProofFile` — no longer on the write path |
| `src/lib/platformConfig.ts` | UPI/QR types → gateway types |
| `src/pages/seeker/SeekerPaymentPage.tsx` | **Full rewrite** — QR display → Razorpay checkout |
| `src/pages/admin/AdminPaymentsPage.tsx` | **Delete approve/reject UI** → read-only ledger |
| `src/lib/paymentService.ts` | Rewrite |
| `src/hooks/usePaymentSync.ts` | Re-point to `payments` + `payment_events` |
| `tests/payment_proof.test.ts` | Rewrite |
| `src/index.css` | Remove QR-scan affordance styles if any |

### 20.3 Behavioural deltas

| Concern | Today | After Razorpay |
|---|---|---|
| **Money custody** | Platform never holds money; admin verifies a UTR | Platform **holds funds** until payout. Needs payout reconciliation, refunds, and chargeback handling — a genuinely new operational surface. |
| **Confirmation trigger** | Human admin action | Gateway webhook. **Admin approval must be fully removed** — it is a security liability once the gateway is the source of truth. |
| **Failure modes** | Rejection is a clean 409 + `rejection_reason` | Gateway failures are async, out-of-band, delivered by webhook. Need a visible "payment failed, retry" path and a terminal-state UI. |
| **Hold duration** | 15 min covers manual UTR + screenshot + admin verification | With automated capture, 15 min is excessive. **5 min is correct** — it matches `BOOKING_CUTOFF_MS` and removes a long "money locked, nothing happening" window. This is the one place the two requested changes interact. |
| **Double-payment risk** | `UNIQUE(booking_id)` — one attempt per booking | Needs an *attempt* model, or a new `payments` row per retry with a partial unique index on `(booking_id) WHERE status IN ('CREATED','CAPTURED')`. The current constraint would block a legitimate retry. |
| **Webhook security** | N/A | HMAC signature verification on `RAZORPAY_WEBHOOK_SECRET`. Must be a **raw-body** route — the global `express.json()` will break signature verification. Plan an `express.raw()` route mounted **before** the JSON parser. |
| **Webhook idempotency** | N/A | Vercel retries on non-2xx. Dedupe on `webhook_events (gateway, event_id)`; return 200 on duplicate. |
| **Currency** | `PATCH /api/admin/platform-config` hard-rejects anything but `INR` (`server.ts:7059`) | Razorpay is INR-first. **Keep the constraint — it is correct.** |

---

## 21. HOLD 15 → 5 MIN: CHANGE PLAN

**Single source of truth (TS):** `src/config/app.ts:2` — `HOLD_DURATION_MS: 15 * 60 * 1000` → `5 * 60 * 1000`. `HOLDOUT_MINUTES` (`app.ts:20`) derives automatically.

### 🔴 The SQL is the real authority — verify this first

The hold duration is very likely duplicated inside `create_booking_with_hold` / `acquire_slot_hold` in `phase6_atomic_booking.sql` and possibly `expire_stale_holds` in `phase21_hold_expiry_cron.sql`.

**The server's early return at `server.ts:1581` only checks `BOOKING_CUTOFF_MS`, not the hold.** So if the SQL still mints 15-minute holds, **changing the TS constant alone does nothing.**

This is the single most important thing to verify in this change.

### Recommended approach

**Parameterise first, then reduce.** Add `platform_config.hold_duration_minutes`; have the SQL functions read it; default to the current 15. Then roll down 15 → 10 → 5 with the admin config page exposing the value. Rollback becomes a single-row update rather than a redeploy.

### Ripple effects

| Consumer | Why |
|---|---|
| `useMentorAvailability` / `useAvailabilitySync` | countdown copy, revalidation timers |
| `SeekerPaymentPage` | hold-expiry countdown, "slot released" handling |
| Any UI showing "you have N minutes to pay" | via `HOLDOUT_MINUTES` |
| `expire_stale_holds` cron interval | may need to be shorter than the hold for timely release |
| `tests/booking_concurrency.test.ts` | may assert 15 min |

---

## 22. ADDING `PAYMENT_PROCESSING`

### Proposed state machine

```
PAYMENT_PENDING ──create order──> PAYMENT_PROCESSING ──webhook captured──> PENDING_VERIFICATION
                                        │                                        │
                                   webhook failed                        review_payment (or auto-advance)
                                        ↓                                        ↓
                                    PAYMENT_PENDING  (retry)              MENTOR_PENDING
```

### Decision needed: does `PAYMENT_PROCESSING` need a human step at all?

- **Option A (recommended):** `PAYMENT_PROCESSING → MENTOR_PENDING` automatically on capture. Removes the admin queue entirely, matches the "remove admin manual approval" goal, and is the correct Razorpay model. `PENDING_VERIFICATION` survives only for legacy in-flight bookings.
- **Option B:** keep a verification step. Adds a delay users will read as friction, and creates a window where Razorpay says paid but the booking says unverified. **Not recommended.**

### Files touched

| Area | Location |
|---|---|
| `bookings.status` CHECK | `phase4:203` — migration with `DROP CONSTRAINT` / `ADD CONSTRAINT` |
| `BookingStatus` union | `src/types/database.ts` |
| Cancel allowlist | `server.ts:2387` |
| Reschedule allowlist | `server.ts:2504` |
| Payable-status check | `server.ts:2141` → `isPayableBookingStatus` in `src/lib/paymentProof.ts` |
| Admin counters | `server.ts:5967` |
| Session annotation | `annotateSessionState` `server.ts:1093` — `PAYMENT_PROCESSING` must not be treated as joinable or upcoming |
| Overlap exclusion predicate | `phase4:222` — `PAYMENT_PROCESSING` is **not** in the excluded set, so it correctly still blocks overlap. **Verify.** |
| Status badge mapping | `src/components/seeker/*`, mentor booking list filters |
| Tests | `tests/booking_concurrency.test.ts`, `tests/bookingCutoff.test.ts` |

---

## 23. RISK REGISTER

| # | Risk | Severity | Evidence |
|---|---|---|---|
| **R1** | **Reschedule calls `acquire_slot_hold` twice**, discarding the first call's result and error | **High** | `server.ts:2578-2593` |
| **R2** | **`mentor_profiles` upsert writes non-existent columns** (`bio`, `years_experience`, `timezone`) | **High** | `server.ts:8436-8444` vs `4143-4161` |
| **R3** | **Admin notification on mentor application submit always fails** — `user_id: null` into a `NOT NULL` column, error swallowed | **High** | `server.ts:8576-8586` vs `phase4:259` |
| **R4** | **Production misconfiguration silently serves in-memory fixture data** on bookings + notifications | **High** | `server.ts:1769`, `2050`, `7313` |
| **R5** | **`server.ts` is 10,435 lines** with zero route-level tests | **High** | file size; no integration tests |
| R6 | Route-order dependency (`eligible` before `:id`) with no regression test | Medium | `server.ts:3967-3971` |
| R7 | **~15 notification inserts ignore their error** | Medium | `server.ts:2434`, `2447`, `2634`, `2647`, `7979`, `8222`, `8576`, `9032`, `9116` |
| R8 | Reschedule is 3 non-atomic operations | Medium | `server.ts:2566-2624` |
| R9 | Demo personas are one-click; only `NODE_ENV` prevents production enablement | Medium | `server.ts:1341` |
| R10 | **Three overlapping token namespaces** block clean segment theming | Medium | `src/index.css` |
| R11 | Availability PUT is delete-then-insert, not transactional | Medium | `server.ts:3260-3267` |
| R12 | `notifications.type` CHECK drift — two routes write `'ADMIN'`, phase4 allows only `SYSTEM` | Medium | `server.ts:7542`, `6514` vs `phase4:262` |
| R13 | `@google/genai` declared but unused | Low | `package.json:14` |
| R14 | `2 * 60 * 60 * 1000` duplicated instead of `MEETING_LINK_DEADLINE_MS` | Low | `server.ts:2794` |
| R15 | `'Asia/Kolkata'` hardcoded in 5+ places instead of `APP_CONFIG.DEFAULT_TIMEZONE` | Low | `server.ts:1226`, `8424`, `8426`, `8442`, `9639` |
| R16 | Typo in production startup banner | Low | `server.ts:10425` |
| R17 | `payments` not in the realtime publication, yet `usePaymentSync` exists | Low | `phase17` vs `src/hooks/` |
| R18 | No CI workflow, no coverage config, no `test:watch` | Medium | `package.json` |
| R19 | `src/lib/logger.ts.tmp` committed | Low | file listing |

---

## 24. RECOMMENDED MIGRATION ORDER

> **Ordering principle:** schema before code, code before UI, and every step independently revertible. Do not start the Razorpay work until R1/R2/R3 are fixed — they will surface as confusing failures the moment the payment path changes.

### Phase 0 — Fix what's already broken (no behaviour change)

1. **R1** — delete the duplicate `acquire_slot_hold` call (`server.ts:2578-2584`). Add a test.
2. **R2** — verify the `mentor_profiles` column set in `phase4`/`phase12`; correct the upsert at `server.ts:8436`. Add a draft-save test.
3. **R3** — replace the `user_id: null` insert with `resolveActiveAdminIds`, matching the pattern at `server.ts:2278`.
4. **R6** — add a route-registration test asserting `/api/admin/mentors/eligible` resolves.
5. **R7** — wrap the 9 unchecked notification inserts; log failures, do not swallow.
6. **R12** — verify the `notifications.type` CHECK; add `'ADMIN'` if missing.
7. **R13/R14/R15/R16/R19** — delete the dead dependency and `.tmp` file; replace the two duplicated constants; fix the banner.

### Phase 1 — Add test coverage before touching anything

8. Integration test harness for `server.ts` (supertest-style over the exported `app`).
9. Cover: every `requireAuth`/`requireRole`/`requireAdmin` route; hold conflict → 409; payment-proof ownership → 403; session concealment → 404; reschedule state transitions.
10. Gate the fixture fallback behind `ALLOW_FIXTURE_FALLBACK=true` (**R4**); return 503 otherwise.

### Phase 2 — Introduce the new states (schema only, unused)

11. Migration: add `'PAYMENT_PROCESSING'` to `bookings.status` CHECK; add `'CREATED'` to `payments.status` CHECK; **make `payments.proof_storage_path` NULLABLE**.
12. Migration: add gateway columns to `payments`; create `payment_events` and `webhook_events`.
13. Migration: add `payments` + `payment_events` to the `supabase_realtime` publication.
14. Migration: `platform_config` gains a hold-duration column (default 15) — the parameterisation prerequisite for §21.
15. Verify: no application code references the new values yet. Deploy.

### Phase 3 — Gateway plumbing behind a flag

16. `src/lib/razorpay.ts` — order creation, signature verification, idempotent webhook store.
17. `server.ts` — `POST /api/bookings/orders` (`requireRole('seeker')`, derives amount from `bookings.amount_inr` server-side — **never from the client**).
18. `server.ts` — `POST /api/webhooks/razorpay`, mounted with `express.raw()` **before** the global `express.json()`. Signature verify → dedupe on `(gateway, event_id)` → apply state transition → return 200.
19. `server.ts` — `review_payment` RPC gains a gateway caller that skips human approval. Add a `reviewed_by_kind` column (`human` | `gateway`).
20. Feature flag `PAYMENT_PROVIDER: 'manual_qr' | 'razorpay'` in `app.ts`, mirroring the existing `MVP_PAYMENT_METHOD`.

### Phase 4 — Move the hold window (only after Phase 3 is stable)

21. SQL functions read `platform_config.hold_duration_minutes`; default 15.
22. Roll down 15 → 10 → 5, with the admin config page exposing the value.
23. Update `HOLDOUT_MINUTES` consumers and tests.

### Phase 5 — Switch the seeker UI

24. Rewrite `SeekerPaymentPage` for Razorpay Checkout. **Keep the manual path available behind the flag** until Razorpay is proven in production.
25. Delete the UTR input, screenshot upload, and QR display.
26. Add a payment-failed / retry state — a real UX requirement the manual flow never had.

### Phase 6 — Retire the manual path

27. Delete `AdminPaymentsPage` approve/reject **UI** first (keep the read-only ledger).
28. Delete `POST` / `GET /api/seeker/bookings/:id/payment-proof`.
29. Delete `POST /api/admin/platform-config/qr-upload-url` and `DELETE .../qr`.
30. Drop `upi_id`, `qr_image_storage_path`, `payment_instructions`, `payment_account_name` from `platform_config`.
31. Delete the UTR validators from `src/lib/paymentProof.ts`; keep the storage-path guard if any upload path survives.
32. Rewrite `tests/payment_proof.test.ts` → `tests/razorpay_webhook.test.ts` (signature, idempotency, replay, out-of-order).

### Phase 7 — Redesign (independent; can run in parallel with Phases 3-6)

33. Collapse the three token namespaces into one (`--sk-*` semantic scale + `--status-*`), delete the duplicated `--mentor-*` block, keep dark mode.
34. Add `segments.theme_key` + a `[data-segment]` root attribute; ship 2-3 themes as proof before committing to N.
35. Redesign against the existing `ui/` + `shared/` primitives so the token change is the only visual delta.

### Estimated effort

| Phase | Duration |
|---|---|
| Phase 0 (bug fixes) | ~2 hours |
| Phase 1 (test harness) | ~1 day |
| Phase 2 (schema) | ~1 day |
| Phases 3-5 (Razorpay) | ~1.5 weeks |
| Phase 6 (retire manual) | ~2 days |
| Phase 7 (redesign) | ~1 week tokens + theming |

**Total to Razorpay-ready: roughly 3-4 weeks**, of which the Razorpay-specific portion is ~1.5 weeks.

---

## 25. WHAT IS ALREADY EXCELLENT (preserve these)

A redesign or a Razorpay migration is exactly the kind of work that destroys good foundations. State these explicitly:

- **One slot engine.** `generateMentorSlots` is the only implementation; both the seeker and admin surfaces delegate to `computeMentorSlotsForDate`. No duplicated availability logic.
- **Duration always from the gig.** Never a constant. A gig edit cannot retroactively rewrite history — `enrichMentorBookingProjection` derives duration from the booking's own window.
- **Server clock everywhere.** Client-supplied `currentTime` is accepted and ignored, with the reason documented in place.
- **Resource concealment.** Non-participant ≡ non-existent, with no distinguishing data in the response body.
- **Session-completion reconciliation** is three-layered (cron + per-row RPC + batched list RPC), idempotent, and records `actual_ended_at = end_time` so the value cannot depend on which path won a race.
- **Server-derived payment values.** Amount, seeker, booking, and storage key are all derived server-side.
- **Fail-closed demo auth.** The admin persona is removed from the registry unless a strong `ADMIN_PASSWORD` is configured.
- **Shape validation on all identifiers**, with the `.or()` injection risk documented and avoided by using separate equality filters.
- **No client-supplied identity anywhere.** Every handler derives the actor from the verified token.
- **`bookingEngine` unit tests** cover concurrency and cutoff rules that would otherwise be very hard to reason about.
- **Config served from the server, never duplicated in the browser.** `GET /api/admin/platform-config` returns `rules` from the same `APP_CONFIG` the engine and DB functions enforce.

---

## 26. OPEN QUESTIONS

1. 🔴 **Does `mentor_profiles` actually have `bio`, `years_experience`, and `timezone` columns?** (R2) — grep the migrations. If not, `POST /api/mentor/application/draft` is broken today and this is a **P0 independent of Razorpay**.
2. 🔴 **What hold duration do `create_booking_with_hold` and `acquire_slot_hold` use?** Must be confirmed before any 15→5 work.
3. **Is `payments` in the `supabase_realtime` publication?** `usePaymentSync` implies yes; migration `phase17` says no. (R17)
4. **Which `notifications.type` values are legal now?** `phase4` says `SYSTEM`; two routes write `ADMIN`. (R12)
5. **Does Razorpay capture require `PAYMENT_PROCESSING` at all**, or can capture go straight to `PENDING_VERIFICATION`? If the former is optional, the schema change can be deferred.
6. **Should the `eligible`-before-`:id` ordering be made robust** rather than documented — e.g. constrain the `:id` route with a UUID regex so a literal `eligible` cannot match? (R6)

---

## 27. IMMEDIATE NEXT ACTIONS

| Priority | Action | Est. |
|---|---|---|
| **P0** | Verify + fix the `mentor_profiles` upsert (R2) | 30 min |
| **P0** | Fix the admin notification `user_id: null` insert (R3) | 15 min |
| **P0** | Remove the duplicate `acquire_slot_hold` call (R1) | 10 min |
| **P1** | Confirm SQL hold duration, then parameterise it | 1 h |
| **P1** | Add integration test harness for `server.ts` | 3-4 h |
| **P1** | Add `PAYMENT_PROCESSING` + nullable `proof_storage_path` migration (unused) | 1 h |
| **P2** | Build `src/lib/razorpay.ts` + webhook route behind a flag | 1 day |
| **P2** | Collapse the token namespaces | 1 day |
| **P3** | Segment theming | 2-3 days |

---

*End of audit. Generated by manual inspection; no code was modified in producing this document.*
