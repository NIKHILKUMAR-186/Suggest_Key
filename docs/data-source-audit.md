# Suggest Key — Data Source Audit

Version: 3.2
Status: As-built / Current
Last verified: 2026-10-02

Classification of every hardcoded, fixture or fallback data source found in the
repository, with the current verified status. The v1 audit of this file
described a codebase that no longer exists: it listed
`SeekerDashboardPage.tsx`, `MentorDashboardPage.tsx`,
`20260924000001_phase13_seed_data.sql` and a `reviews` table — none of which
exist. That content is replaced below.

## Classification scheme

| Class | Meaning |
|---|---|
| **1 — Intentional dev/test data** | Exists on purpose, gated so it cannot reach production |
| **2 — Harmless UI copy** | Strings, labels, empty states; not business data |
| **3 — Production business-data fallback** | Business data that can reach a real user response. **The only class that matters.** |
| **4 — Obsolete / dead code** | Unreferenced, or retained behind an unreachable guard |
| **5 — Bug / risk** | A defect. Documented, not fixed, in this task. |

---

## 1. Summary

**The headline result: there are now zero Class-3 findings.** The single one this
audit existed to document — the fixture-backed admin overdue-links route — has
been fixed. Every hardcoded value in the repository is now either a gated
development fixture, a UI string, or genuinely dead code.

| Class | Count | Risk |
|---|---|---|
| 1 — Intentional dev/test data | 4 | None |
| 2 — Harmless UI copy | 4 | None |
| 3 — Production business-data fallback | **0** | **None. Was 1; F1 is fixed.** |
| 4 — Obsolete / dead code | 3 | Low |
| 5 — Bug / risk | 2 | See §7. Both are Medium/Low, neither is a data-integrity leak. |

**Bottom line (2026-10-02):** no hardcoded business data can reach a real user
response. The residual risks are unearned ratings (**F3**) and two dead files
(**F4**, **O1**) — quality issues, not correctness ones.

---

## 2. The Former Class-3 Finding — now fixed

### ✅ F1 — `GET /api/admin/bookings/overdue-links` served in-memory fixtures — **FIXED**

- **Class:** was 3 — production business-data fallback. **Now none.**
- **Was located at:** the former synchronous handler, which never called
  `getSupabaseAdmin()` and always returned
  `getOverdueBookings(getLocalBookingEngineContext())`
- **Now at:** `server.ts:4201`, `async`

What it was serving, for the record — the fixture context in
`src/lib/bookingService.ts` contains hardcoded mentors (`Aman Kumar`,
`Rahul Sharma`, `Ananya Patel`, `Dr. Vikram Joshi`), hardcoded prices
(999/1200/1299/1500), and demo notification copy such as
`"Mentor Rahul Sharma has not provided meeting URL for BK-9022 starting in 75 minutes."`

**Why it was the only one.** `server.ts` imports `getLocalBookingEngineContext`
and calls it at many sites, but every other site sits behind a real-database
branch that returns first:

```ts
const admin = getSupabaseAdmin();
if (admin) {
  /* real Supabase read */
  return res.json(...);
}
const db = getLocalBookingEngineContext();   // unreachable in production
```

In a correctly configured production deployment the service-role client always
exists, so that fallback branch is dead. F1 was the only site where the fixture
path was the *only* path — and it was the one that reached an admin screen.

**What the fix changed beyond adding a database read.** The route now calls the
shared `resolveBookingLifecycle()` instead of carrying its own deadline
predicate. Its previous local test was `deadlineMs <= now`, which disagreed with
the canonical strict `>` at the exact boundary instant — so an admin tool and the
mentor's own tab could classify the same booking differently inside one
millisecond. That second defect was only visible because the route was rewritten
rather than patched.

**Residual:** the fixture context still exists in `src/lib/bookingService.ts` for
local development. It is no longer reachable from any route, and
`tests/booking_overdue_lifecycle.test.ts` now asserts this route agrees with the
canonical resolver at the boundary. What is still missing is a test that asserts
*no* protected route can serve fixtures at all — see `docs/technical-audit.md`
**N2**.

---

## 3. Class 1 — Intentional Development / Test Data

These exist on purpose and are gated so they cannot reach a production
response. They are **not** defects.

### D1 — Demo personas

- **Location:** `server.ts` (`demoAccounts`), `POST /api/auth/demo-login`
- **Content:** `Aman Kumar` (seeker), `Rahul Sharma` (mentor),
  `admin@suggestkey.local` (admin)
- **Gate:** `isDemoAuthEnabled()` requires `ENABLE_DEMO_PERSONAS === 'true'`
  **and** `DEMO_TOKEN_SECRET` ≥ 32 chars and not a known default **and**
  `NODE_ENV !== 'production'`. The admin persona additionally needs
  `ADMIN_PASSWORD` ≥ 12 chars. Client side, `AuthContext.requestDemoLogin`
  returns `'Demo login is unavailable in production.'` under
  `import.meta.env.PROD`.
- **Class:** 1. The names are personas, not a business-data fallback — no
  other endpoint reads them.
- **Note:** `tests/helpers/demoAuthEnv.ts` sets the env for tests.

### D2 — Migration seed rows

Inserted by migrations, therefore present in any database built from
`supabase/migrations/`. All are idempotent (`ON CONFLICT`, guarded
`DELETE`/`INSERT`).

| Seed | Migration | Content |
|---|---|---|
| Discovery triad | `20260920000002_phase5_seed_discovery.sql` | 5 `auth.users` with **placeholder** password hashes, 3 segments (`relationship-advisor`, `autism-mentor`, `career-mentor`), 3 mentors with gigs (₹999 60 min, ₹1299 45 min, ₹1200 45 min, ₹1500 60 min) and Mon–Sat availability, 1 seeker, 1 admin |
| Notification demos | `20260921000002_phase11_notifications.sql` | 19 rows with fake entity ids such as `bk-9021` |
| Document types | `20260924000000_phase12_mentor_onboarding.sql` | `identity_proof`, `qualification_proof` |
| Segment topics | `20261001000001_seeker_experience_rebuild_segment_topics.sql` | 27 rows, 9 per segment |
| Gig↔topic links | `20261001000002_seeker_experience_rebuild_seed_topics.sql` | 9 rows |
| Experience config | `20261001000003_seeker_experience_rebuild_seed_config.sql` | 3 JSONB `segments.experience_config` payloads |
| Platform defaults | `phase13`, `phase19`, `phase26` | `system_log_retention (30)`, `login_failure_config (5, 15)`, `platform_config.hold_duration_minutes (5)` |

- **Class:** 1.
- **Assessment:** the phase5 password hashes are placeholders, not working
  credentials, and the header comments label the fixtures. The seed helper
  `sk_apply_seeded_experience_config()` is `DROP FUNCTION`ed within its own
  migration, so it does not persist.
- **Risk note, not a finding:** this data ships into production if migrations
  are applied there. The subject matter (autism, relationship, career segments)
  is real product content, not test scaffolding. If a production deployment
  should start with no mentors, the phase5 seed must be made
  environment-conditional. **Not verified** whether that is intended, because
  deployment configuration is outside this repository.

### D3 — Test harness data

`tests/helpers/razorpayHarness.ts`, `tests/helpers/demoAuthEnv.ts`, and the
inline fixtures in the 68 `tests/*.test.ts` files. Never bundled.

### D4 — `VITE_SUPABASE_*` config in `.env.example`

Placeholder values (`https://your-project.supabase.co`,
`your-anon-key`). Correctly non-functional.

---

## 4. Class 2 — Harmless UI Copy

Not business data. Listed so the audit is complete.

| Item | Location | Why it is harmless |
|---|---|---|
| `'999px'`, `'9999px'` in `radius` | `src/config/design-tokens.ts` | Pixel values, not prices. A grep for `999` for pricing hits these; they are false positives. |
| `z.int().min(0).max(9999)` for segment priority | `src/lib/validation.ts` | A validation bound, not a price. |
| `00000000-0000-0000-0000-000000000000` | `src/lib/sessionAccess.ts` | Appears in a **comment** explaining the filter-injection attack it defends against. Not data. |
| Marketing and empty-state copy across `src/pages/**` and `src/components/**` | many | Strings. |
| `SK-` ticket-code prefix in support UI examples | `src/lib/supportDomain.ts` | A format string. Real codes are minted by a database sequence; see `docs/rules.md` K6. |

---

## 5. Class 4 — Obsolete / Dead Code

Real, but unreachable or retained deliberately. Not defects, but candidates for
removal.

| # | Item | Evidence |
|---|---|---|
| O1 | `src/lib/logger.ts.tmp` | A ~15 KB temporary file sitting next to the ~20 KB `logger.ts`. Not imported by anything. Almost certainly a leftover editor swap file. |
| O2 | `src/lib/mentorTopics.ts` — `fetchMentorTopics` has no importer; only `topicsForSegment` is imported, and only by `tests/seeker_experience_topics.test.ts`. The parallel live module is `src/lib/segmentTopics.ts`, consumed by `useSegmentTopics`, `useSegmentMentorsByTopic` and test files. | Verified by cross-repo reference search: `fetchMentorTopics` appears only in its own definition. |
| O3 | `mentor_profiles.is_approved` is a **live** column, not a legacy mirror. It co-exists with `approval_status`/`is_active` and both are checked. | `discoveryService` filters `.eq('is_approved', true)`; `server.ts` requires `is_approved && is_active && approval_status === 'approved'`; `bookingEngine` refuses a booking when `!mentorProfile.is_approved`; the approve/reject handlers set it; `requireActiveMentor` reads it. Two parallel approval flags is mild redundancy, not dead code. |

### Dead code NOT found

The v1 audit of this file listed these as pending. They are **done** and there
is nothing left to migrate:

- Mentor discovery → `src/lib/discoveryService.ts` (26,641 bytes) reads Supabase.
- Segment catalog → active segments come from the database.
- Mentor↔segment mapping → `mentor_segments` joins, not literals.
- Availability → `mentor_availability` / `mentor_availability_exceptions` via
  `src/lib/slotEngine.ts`.
- Slot holds → `POST /api/bookings/hold` → `create_booking_with_hold()`.
- Bookings → real queries throughout.
- Payments → `payments` table via `src/lib/paymentService.ts` and
  `src/lib/razorpayService.ts`.
- Notifications → `notifications` table via `src/lib/notificationService.ts`.
- Session workspaces → `session_workspaces` via
  `src/lib/workspaceService.ts`. **No `meeting_url` column on this table** — the
  v1 claim that it had `meeting_url`, `whiteboard_state` and `recording_url` was
  wrong.
- Gigs → `gigs` table with real price and duration.
- Demo meeting URLs (`https://meet.suggestkey.com/demo-session-*`) → **do not
  exist anywhere in the repository.**
- Fake UUIDs in code → **none.** The only nil-UUID reference is a comment.
- Reviews → **no `reviews` table and no review feature exists.** See §7 F3.
- localStorage business-state fallbacks → **none.** See §6.

---

## 6. localStorage Audit

Every `localStorage` read/write in the repository, verified:

| Key | File | Purpose | Classification |
|---|---|---|---|
| `suggestkey_demo_auth` | `AuthContext.tsx:85`, `:92`, `:96`, `:108`; `apiClient.ts:31` | Caches the demo-auth session so a demo persona survives a refresh. Cleared on sign-out and on any real session. | Class 1 — gated by `isDemoAuthEnabled()`. |
| `suggestkey_demo_auth_user` (`LEGACY_DEMO_AUTH_STORAGE_KEY`) | `AuthContext.tsx:258` | Reads and migrates the old key. | Class 1 — migration shim. |
| `sk-theme-mode` | `ThemeContext.tsx:13`, `:97` | Light/dark preference. | Class 2 — a preference, not business data. |

**No localStorage key caches bookings, payments, notifications, mentors,
segments, availability or any other business state.** There is no
"read from cache, fall back to defaults" pattern anywhere in `src/`.

`apiClient.ts:17` carries a comment explaining that it does **not** prefer a
stale cached value over a live server value.

---

## 7. Class 5 — Bugs / Risks

| # | Item | Class | Severity | Status |
|---|---|---|---|---|
| F1 | Overdue-links route served fixtures | was 3 | was High | **Fixed.** The route now reads real `bookings` through `getSupabaseAdmin()`. See §2. |
| F2 | `payment-qr` storage bucket never created by any migration | 5 | was High | **Fixed** by `20261002000000_phase27_payment_qr_bucket_and_config_audit.sql`. Verified present in the live project: public, 2 MB, png/jpeg/webp. The admin QR upload — on the **default** payment path — works. |
| F3 | `mentor_profiles.rating` and `review_count` are stored columns with `CHECK` bounds but **no computation behind them**. No `reviews` table, no review entity in any migration, no review feature in the UI. | 5 | Medium | **Open.** A mentor's rating of 5.00 with 0 reviews is the schema default for every mentor. Any UI that presents a rating is presenting an unearned number. Either implement reviews or stop displaying the value. |
| F4 | `src/lib/logger.ts.tmp` | 4 | Low | See §5 O1. Still present as of 2026-10-02. |
| F5 | `notifications` is in the live `supabase_realtime` publication but **no migration adds it** | 5 | Medium | **Open.** Not a hardcoded-data problem, but the same class as F2: the code depends on a database object that no migration creates. An environment built purely from `supabase/migrations/` would have no notification realtime. See `docs/technical-audit.md` R2. |

---

## 8. Data Source Per Entity — Current Verified State

| Entity | Authoritative source | Hardcoded fallback? |
|---|---|---|
| Identity | `profiles` ← `auth.users` | No |
| Roles | `user_roles` | No |
| Segments | `segments` | No |
| Segment topics | `segment_topics` | No |
| Gig topics | `gig_topics` | No |
| Segment experience CMS | `segments.experience_config` JSONB | No |
| Segment hero image | `segment-hero` bucket, public | No |
| Mentors | `mentor_profiles` via `mentor_is_publicly_visible()` | No |
| Mentor rating / review count | `mentor_profiles.rating` / `review_count` | No — but see **F3**: no computation exists |
| Mentor↔segment | `mentor_segments` | No |
| Gigs and prices | `gigs.price_inr` | No — plus `original_price_inr` for the struck-through display |
| Seeker profile | `seeker_profiles` | No |
| Recurring availability | `mentor_availability` | No |
| Availability exceptions | `mentor_availability_exceptions` | No |
| Generated slots | Computed server-side in `slotEngine.ts` from the four rows above | No — no slot table, no slot RPC |
| Slot holds | `slot_holds` | No |
| Bookings | `bookings` | No |
| Reschedule requests | `reschedule_requests` | No |
| Booking price | `bookings.base_amount_inr` / `discount_amount_inr` / `amount_inr` / `original_amount_inr`, snapshotted at hold creation | No — the browser is never authoritative for the payable amount |
| Coupons | `coupons`, `coupon_usage` | No — admin-only tables; seekers learn the outcome from the booking snapshot they already own |
| Payments | `payments`, `payment_events`, `webhook_events` | No |
| Unmatched gateway captures | `razorpay_unmatched_captures` | No — durable before the webhook returns non-2xx, reconciled by admin |
| Manual proof files | `payment-proofs` bucket | No |
| UPI / QR / instructions | `platform_config` | No — admin-managed; reaches the browser through `GET /api/platform-config` |
| Notifications | `notifications` | No (rows only; realtime for admin, polling for participants — see **F5** and `technical-audit.md` R1) |
| Session workspaces | `session_workspaces` | No |
| Mentor applications / documents | `mentor_applications`, `mentor_verification_documents` | No |
| Support tickets / messages / attachments | `support_tickets`, `support_messages`, `support_attachments`, `support_audit_events` | No — internal notes filtered out of every non-admin read |
| Mentor applications audit | `mentor_application_audit` | No |
| Platform config | `platform_config` | No |
| Audit / system logs | `audit_logs`, `system_logs` | No |
| Hold duration | `platform_config.hold_duration_minutes` (DB) mirrored by `APP_CONFIG.HOLD_DURATION_MS` (TS) | No — intentionally mirrored, both 5 min |

---

## 9. RLS Coverage Checklist — Current State

**All 36 tables in `public` have RLS enabled.** This was verified directly
against `pg_class.relrowsecurity` on 2026-10-02, not inferred from migrations.

`platform_config` was the last holdout and is now admin-only:
`20261009000000_phase35_platform_config_rls.sql` enables RLS with one `FOR ALL`
policy `USING (is_admin()) WITH CHECK (is_admin())`. That is deliberately
**stricter** than a public-read policy would be — the UPI id and QR reach the
browser through `GET /api/platform-config`, which reads with the service role,
so no public RLS grant was needed.

| Table | RLS | Note |
|---|---|---|
| `profiles` | yes | Own + admin; self-update blocked while suspended |
| `user_roles` | yes | Read own/admin; write admin only |
| `segments` | yes | Active-only public read |
| `segment_topics` | yes | Active + parent segment active |
| `gig_topics` | yes | All three parents active |
| `mentor_profiles` | yes | `mentor_is_publicly_visible()` |
| `mentor_segments` | yes | Visibility predicate |
| `seeker_profiles` | yes | Own |
| `gigs` | yes | Active + visible mentor |
| `mentor_availability` | yes | Visibility predicate |
| `mentor_availability_exceptions` | yes | Visibility predicate |
| `slot_holds` | yes | Participants + admin |
| `bookings` | yes | Participants + admin; `authenticated` UPDATE column-reduced to `cancellation_reason`, `updated_at` |
| `reschedule_requests` | yes | Participants + admin |
| `payments` | yes | Browser write **disabled**; admin only |
| `payment_events` | yes | Read own payment or admin |
| `webhook_events` | yes | Admin only |
| `razorpay_unmatched_captures` | yes | Admin only |
| `coupons` | yes | Admin only |
| `coupon_usage` | yes | Admin only — no seeker can read or forge usage |
| `notifications` | yes | Own + admin |
| `session_workspaces` | yes | Mentor always; seeker only when `PUBLISHED`; delete admin only |
| `support_tickets` | yes | Own + admin; client write grants revoked |
| `support_messages` | yes | Own ticket + admin, **excluding `is_internal`** for non-admins |
| `support_attachments` | yes | Own ticket + admin |
| `support_audit_events` | yes | Admin only |
| `mentor_applications` | yes | Own + admin |
| `mentor_verification_documents` | yes | Own draft docs + admin |
| `mentor_application_audit` | yes | Own application + admin |
| `mentor_document_types` | yes | Active public read; admin write |
| `system_logs` | yes | Admin only |
| `audit_logs` | yes | Admin only |
| `system_log_retention` | yes | Admin only |
| `login_failure_config` | yes | Admin only |
| `login_failure_trackers` | yes | Admin read; writes via RPC |
| `platform_config` | yes | **Admin only.** `technical-audit.md` S1, fixed by phase 35. |

### Storage buckets — 5

| Bucket | Public | Limit | Mimes |
|---|---|---|---|
| `payment-proofs` | no | 5 MB | jpeg/png/webp/pdf |
| `mentor-verification-documents` | no | 5 MB | jpeg/png/webp/pdf |
| `support-attachments` | no | 5 MB | png/jpeg/webp/pdf |
| `payment-qr` | **yes** | 2 MB | png/jpeg/webp |
| `segment-hero` | **yes** | 5 MB | png/jpeg/webp/gif |

Two are public by intent: `segment-hero` is CMS media, and `payment-qr` must
render on the checkout page. Both were verified directly against
`storage.buckets` on 2026-10-02.
