# Suggest Key — Data Source Audit

Version: 3.1
Status: As-built / Current
Last verified: 2026-09-29

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

| Class | Count | Risk |
|---|---|---|
| 1 — Intentional dev/test data | 4 | None |
| 2 — Harmless UI copy | 3 | None |
| 3 — Production business-data fallback | **1** | **High** |
| 4 — Obsolete / dead code | 3 | Low |
| 5 — Bug / risk | 3 | See §7 |

**Bottom line:** exactly one item in the repository is a production
business-data fallback, and it is a single admin-only route. Every other
hardcoded value is either a development fixture that is properly gated, a
string, or unreachable code.

---

## 2. The One Class-3 Finding

### 🔴 F1 — `GET /api/admin/bookings/overdue-links` serves in-memory fixtures

- **Class:** 3 — production business-data fallback
- **Severity:** High
- **Location:** `server.ts:3138-3152`
- **Source of the data:** `getLocalBookingEngineContext()`,
  `src/lib/bookingService.ts:134-943`

```ts
app.get('/api/admin/bookings/overdue-links', requireAuth, requireAdmin, (req, res) => {
  try {
    const db = getLocalBookingEngineContext();
    const overdue = getOverdueBookings(db);
    const enriched = overdue.map((b) => enrichBooking(b, db));
    return res.json({ success: true, count: overdue.length, bookings: enriched });
  } catch (err) { ... }
});
```

The handler is synchronous, never calls `getSupabaseAdmin()`, and therefore has
no database read and no `503` path. The context it serves contains:

| Fixture | Location |
|---|---|
| `Aman Kumar` | `bookingService.ts:141` |
| `Rahul Sharma` | `bookingService.ts:159`, `:168` |
| `Ananya Patel` | `bookingService.ts:177` |
| `Dr. Vikram Joshi` | `bookingService.ts:186` |
| `price_inr: 999` | `bookingService.ts:307`, `:401`, `:445`, `:468`, `:491`, `:514`, `:537`, `:554`, `:600` |
| `price_inr: 1299` | `bookingService.ts:319`, `:423`, `:577` |
| Demo notification copy, e.g. `"Mentor Rahul Sharma has not provided meeting URL for BK-9022 starting in 75 minutes."` | `bookingService.ts:626`, `:639`, `:678`, `:704`, `:769`, `:797`, `:890`, `:903`, `:916` |

**Why this one and not the others:** `server.ts` imports
`getLocalBookingEngineContext` at `server.ts:25` and **calls it 16 times**
(verified: `server.ts` lines 923, 1816, 1903, 1976, 2092, 2184, 3100, 3140,
8919, 8970, 9013, 9058, 9170, 9235, 9348 — plus the import itself). Fifteen of
those call sites are inside the pattern:

```ts
const admin = getSupabaseAdmin();
if (admin) {
  /* real Supabase read */
  return res.json(...);
}
const db = getLocalBookingEngineContext();   // unreachable in production
```

In a correctly configured production deployment the service-role client always
exists, so the fallback branch is dead. F1 has no such guard — it is the only
site where the fixture path is the *only* path.

**Impact.** This is the operational endpoint for chasing mentors who have not
added a meeting link. An admin using it during an incident sees fabricated
mentors, fabricated bookings and fabricated times. It is also the only route
where hardcoded business data reaches an authenticated response.

**Fix (not applied — documentation-only task).** Make the handler `async`,
resolve `getSupabaseAdmin()`, `503` if absent, and query
`bookings WHERE status = 'CONFIRMED' AND meeting_url IS NULL AND start_time > now()`.

---

## 3. Class 1 — Intentional Development / Test Data

These exist on purpose and are gated so they cannot reach a production
response. They are **not** defects.

### D1 — Demo personas

- **Location:** `server.ts:1283+` (`demoAccounts`), `POST /api/auth/demo-login`
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
inline fixtures in the 43 `tests/*.test.ts` files. Never bundled.

### D4 — `VITE_SUPABASE_*` config in `.env.example`

Placeholder values (`https://your-project.supabase.co`,
`your-anon-key`). Correctly non-functional.

---

## 4. Class 2 — Harmless UI Copy

Not business data. Listed so the audit is complete.

| Item | Location | Why it is harmless |
|---|---|---|
| `'999px'`, `'9999px'` in `radius` | `src/config/design-tokens.ts:100-110` | Pixel values, not prices. A grep for `999` for pricing hits these; they are false positives. |
| `z.int().min(0).max(9999)` for segment priority | `src/lib/validation.ts:739` | A validation bound, not a price. |
| `00000000-0000-0000-0000-000000000000` | `src/lib/sessionAccess.ts:21` | Appears in a **comment** explaining the filter-injection attack it defends against. Not data. |
| Marketing and empty-state copy across `src/pages/**` and `src/components/**` | many | Strings. |

---

## 5. Class 4 — Obsolete / Dead Code

Real, but unreachable or retained deliberately. Not defects, but candidates for
removal.

| # | Item | Evidence |
|---|---|---|
| O1 | `src/lib/logger.ts.tmp` | A 15,475-byte temporary file sitting next to the 20,547-byte `logger.ts`. Not imported by anything. Almost certainly a leftover editor swap file. |
| O2 | `src/lib/mentorTopics.ts` — `fetchMentorTopics` (line 25) has no importer; only `topicsForSegment` is imported, and only by `tests/seeker_experience_topics.test.ts`. The parallel live module is `src/lib/segmentTopics.ts`, consumed by `useSegmentTopics`, `useSegmentMentorsByTopic` and three test files. | Verified by cross-repo reference search: `fetchMentorTopics` appears only in its own definition. |
| O3 | `mentor_profiles.is_approved` is a **live** column, not a legacy mirror. It co-exists with `approval_status`/`is_active` and both are checked. | Verified: `discoveryService.ts:264`, `:584`, `:721` filter `.eq('is_approved', true)`; `server.ts:6542` requires `is_approved && is_active && approval_status === 'approved'`; `bookingEngine.ts:134` refuses a booking when `!mentorProfile.is_approved`; `server.ts:4268`/`:4298` set it on approve/reject; `supabaseServer.ts:417` reads it in `requireActiveMentor`. Two parallel approval flags is mild redundancy, not dead code. |

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
| F1 | Overdue-links route serves fixtures | 3 | High | Open. See §2. |
| F2 | `payment-qr` storage bucket never created by any migration, yet `PAYMENT_QR_BUCKET` is used at `server.ts:205`, `:8786`, `:8845` and by `POST /api/admin/platform-config/qr-upload-url` and `DELETE /api/admin/platform-config/qr` | 5 | High | Open. The admin cannot upload a payment QR against a database built purely from `supabase/migrations/`. Since manual UPI/QR is the **default** payment path, this breaks the primary revenue route. |
| F3 | `mentor_profiles.rating` and `review_count` are stored columns with `CHECK` bounds but **no computation behind them**. There is no `reviews` table, no review entity in any migration, and no review feature in the UI. | 5 | Medium | Open. A mentor's rating of 5.00 with 0 reviews is the schema default for every mentor. Any UI that presents a rating is presenting an unearned number. Either implement reviews or stop displaying the value. |
| F4 | `src/lib/logger.ts.tmp` | 4 | Low | See §5 O1. |

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
| Gigs and prices | `gigs.price_inr` | No |
| Seeker profile | `seeker_profiles` | No |
| Recurring availability | `mentor_availability` | No |
| Availability exceptions | `mentor_availability_exceptions` | No |
| Generated slots | Computed server-side in `slotEngine.ts` from the four rows above | No — no slot table, no slot RPC |
| Slot holds | `slot_holds` | No |
| Bookings | `bookings` | No — except **F1** |
| Payments | `payments`, `payment_events`, `webhook_events` | No |
| Manual proof files | `payment-proofs` bucket | No |
| UPI / QR / instructions | `platform_config` | No — all nullable, admin-managed |
| Notifications | `notifications` | No (rows only; the channel is polling — see `technical-audit.md` R1) |
| Session workspaces | `session_workspaces` | No |
| Mentor applications / documents | `mentor_applications`, `mentor_verification_documents` | No |
| Platform config | `platform_config` | No |
| Audit / system logs | `audit_logs`, `system_logs` | No |
| Hold duration | `platform_config.hold_duration_minutes` (DB) mirrored by `APP_CONFIG.HOLD_DURATION_MS` (TS) | No — intentionally mirrored, both 5 min |

---

## 9. RLS Coverage Checklist — Current State

Every table is RLS-enabled except `platform_config`, which is protected by grant
scoping instead. See `docs/rules.md` §15 and `docs/architecture.md` §15 for the
full per-table policy list.

| Table | RLS | Note |
|---|---|---|
| `profiles` | yes | Own + admin; self-update blocked while suspended |
| `user_roles` | yes | Read own/admin; write admin only |
| `segments` | yes | Active-only public read |
| `segment_topics` | yes | Active + parent segment active |
| `gig_topics` | yes | All three parents active |
| `mentor_profiles` | yes | `mentor_is_publicly_visible()` |
| `mentor_segments` | yes | Visibility predicate |
| `gigs` | yes | Active + visible mentor |
| `mentor_availability` | yes | Visibility predicate |
| `mentor_availability_exceptions` | yes | Visibility predicate |
| `slot_holds` | yes | Participants + admin |
| `bookings` | yes | Participants + admin; `authenticated` UPDATE column-reduced to `cancellation_reason`, `updated_at` |
| `payments` | yes | Browser write **disabled**; admin only |
| `payment_events` | yes | Read own payment or admin |
| `webhook_events` | yes | Admin only |
| `notifications` | yes | Own + admin |
| `session_workspaces` | yes | Seeker only when `PUBLISHED` |
| `mentor_applications` | yes | Own + admin |
| `mentor_verification_documents` | yes | Own draft docs + admin |
| `mentor_application_audit` | yes | Own application + admin |
| `mentor_document_types` | yes | Active public read; admin write |
| `system_logs` | yes | Admin only |
| `audit_logs` | yes | Admin only |
| `system_log_retention` | yes | Admin only |
| `login_failure_config` | yes | Admin only |
| `login_failure_trackers` | yes | Admin read; writes via RPC |
| **`platform_config`** | **no** | `technical-audit.md` **S1** |

Storage buckets: `payment-proofs` (private), `mentor-verification-documents`
(private), `segment-hero` (**public**), and `payment-qr` — **referenced by code
but never created by a migration** (**F2**).
