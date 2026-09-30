# Production / migration drift

Security-relevant state that exists in the live Supabase project but was **not**
reproducible from `supabase/migrations/`. A database built purely from migration
history would ship without these.

Discovered during the RLS audit on 2026-09-30. Items 1–4 are now reconciled by
forward migrations; **item 5 remains open** and is the underlying cause of all
of them.

---

## 1. ~~`profiles` column-privilege tightening is production-only~~ — RECONCILED

**Severity: HIGH** — privilege escalation. **Fixed** by
`20261010000000_phase36_profile_column_boundaries.sql`.

Production had these column grants, but no migration issued them, so a
history-built database shipped the wide table-level grant from
`permissions_authenticated_anon`:

| Column | authenticated privileges |
|---|---|
| `full_name`, `avatar_url`, `timezone`, `phone` | INSERT, SELECT, UPDATE |
| `account_status`, `internal_note`, `suspended_until`, `suspended_at`, `deactivated_at`, `suspended_by`, `suspension_reason`, `email`, `created_at`, `updated_at` | INSERT, SELECT |

Also production-only, now recorded: the policies `Users can update own own
editable columns` (the doubled "own" is in the live policy — reproduced
verbatim so the migration is a true no-op), `Admins can update any profile`,
`Mentors can update own editable profile fields` and
`Admins can update any mentor profile`.

**Confirmed exploitable before the fix**, as `authenticated` with a forged JWT
inside a forced-rollback transaction:

```
internal_note_after: "SELF-ESCALATION PROBE"
account_status_after: "active"
rows_updated: 1
```

Post-fix, the identical probe is blocked, while a legitimate
`full_name`/`phone`/`timezone` update by the same user still succeeds. Verified
unchanged afterwards: `full_name="Savera Raj"`, `internal_note=NULL`.

`INSERT` was deliberately left table-level: `upsertUserProfile`
(`src/lib/supabase.ts:102`, called from `AuthContext.tsx:161` on first sign-in)
writes `id`, `email` and `created_at` under a `WITH CHECK (auth.uid() = id)`
policy. Narrowing it would break new sign-ups.

---

## 2. ~~`mentor_profiles` column-privilege tightening is production-only~~ — RECONCILED

**Severity: HIGH** — mentor verification bypass. **Fixed** by the same
phase36 migration.

`authenticated` holds UPDATE only on `headline`, `about`,
`experience_years`, `expertise`, `languages`; the approval fields
(`is_approved`, `approval_status`, `is_active`, `is_featured`, `rating`,
`review_count`, `session_count`) are INSERT/SELECT only.

**Confirmed exploitable before the fix:**

```
SELF-APPROVAL PROBE target=a8222dcd-... rows=1 is_featured f->t
```

Because the public SELECT policy keys on `mentor_is_publicly_visible()`, a
self-approved mentor becomes publicly bookable without review. Post-fix the
identical probe is blocked; legitimate `headline`/`about`/`experience_years`
updates still succeed, and `is_featured` is still `false`.

---

## 4. ~~`reschedule_requests` has a table-level TRUNCATE grant~~ — RECONCILED

**Severity: LOW–MEDIUM** — data destruction, not covered by RLS. **Fixed** by
phase36, which revoked `TRUNCATE` on `reschedule_requests`, `profiles` and
`mentor_profiles` from `authenticated` and `anon`.

No application path uses TRUNCATE (verified across `src/`, `server.ts` and
`scripts/`), and maintenance tooling connects with the service-role key, which
keeps its own grants. Same reasoning as the `bookings` correction in phase24c.

## 3. ~~`platform_config` RLS and policy are production-only~~ — RECONCILED

**Severity: MEDIUM** — payment redirection. **Fixed** by
`20261009000000_phase35_platform_config_rls.sql`.

Production had RLS enabled and the policy `Admins can manage platform config`
(`FOR ALL`, `is_admin()` both ways), but **no migration recorded either**. The
table is created in `20260927110000_phase25_payment_foundation.sql:27` without
them, while `20260914000018_permissions_authenticated_anon` already grants
`authenticated` full table-level privileges. A history-built database therefore
shipped with no row-level protection at all.

**Confirmed exploitable on a simulated history-built database**, with RLS
disabled and a forged non-admin JWT, inside a forced-rollback transaction:

```
UNPROTECTED DB => non-admin read upi_id=raj.savera111@oksbi,
                  rewrote it (rows=1), hold_duration->0
```

Any signed-in user could rewrite `upi_id` and `qr_image_storage_path`,
redirecting subsequent payments, and set `hold_duration_minutes = 0` to collapse
the booking slot-hold window. Post-fix verification: a non-admin read returns no
rows, an admin read returns the UPI id, and the row is unchanged
(`upi_id=raj.savera111@oksbi`, `hold_duration_minutes=5`).

The two `knownDrift` allow-lists for this table were removed from
`tests/rls_coverage_regression.test.ts` as part of the fix, so the gap can no
longer be reintroduced silently.

---

## 4. `reschedule_requests` has a table-level TRUNCATE grant

**Severity: LOW–MEDIUM** — data destruction, not covered by RLS

Created by `20261005000000_phase30_reschedule_requests.sql`. RLS is enabled and
the only policy is SELECT-scoped, so INSERT/UPDATE/DELETE are correctly denied
to `authenticated` by default-deny.

However `authenticated` holds a **table-level `TRUNCATE` grant**, and TRUNCATE
is one of the few statements RLS does not cover. Same reasoning as the
`bookings` correction in phase24c.

Not fixed — outside the scope agreed for the workflow tightening.

---

## 5. The applied migration lineage is not the repository's — STILL OPEN

**Severity: HIGH** — systemic, and the underlying cause of items 1–4

Production's `supabase_migrations` history contains **44 applied rows** whose
versions are all `20260914…`–`20260930…`. The repository's
`supabase/migrations/` contains **43 files**, and **42 of them have no matching
applied row** — including every file in the `phase10`…`phase31` range.

Production was therefore built from a different set of migration files than the
ones checked in. The gap is not cosmetic; it is a live, shipped defect:

`20260921000001_phase10_session_workspace.sql` declares the columns
`mentor_notes`, `suggestions`, `next_steps` and `follow_up_recommendation` on
`session_workspaces`. It never ran. The application writes all four. So every
`POST /api/workspaces` save and publish failed with PostgREST `PGRST204`
("Could not find the 'follow_up_recommendation' column … in the schema cache"),
surfacing to the mentor as a 500. Reconciled by
`20261007000000_phase33_session_workspaces_column_alignment.sql`.

The other 41 unapplied files are **not** all missing in production — most of
their effects exist because production was built by other means. But none of
them can be trusted to be reproducible from history, and any of them could be
carrying the same class of drift. Recommended follow-up: for each unapplied file,
either record the production state as a forward migration or formally retire it,
so the repository stops implying an order that was never applied.

---

## 6. One booking's gig and segment disagree — **OPEN, enforcement added**

**Severity: MEDIUM** — incorrect booking identity, no data loss.

Reported as a workspace inconsistency: a mentor publishing
`#BK-2609262151-7763` (Relationship Advisor) appeared to have published a
workspace a seeker saw as still "Awaiting Mentor Notes" on
`#BK-2609300533-099b` (Autism Mentor).

**The two screenshots are two different bookings** — `78675ba2-…` and
`e366ed96-…`, different seekers, different segments, four days apart. The
publish landed on the row for the booking the mentor actually opened, and the
seeker was correctly shown a booking that has no workspace row. No corruption.

What made the pair *look* contradictory is a real inconsistency on the seeker's
booking: `e366ed96` carries `segment_id = 000…002` (Autism) while its
`gig_id = 09596d02` belongs to `000…001` (Relationship). The same gig title
therefore renders under two different segment names on two bookings.

| check | result |
|---|---|
| bookings | 8 |
| `gigs.segment_id IS DISTINCT FROM bookings.segment_id` | **1** (`BK-2609300533-099b`) |
| `gigs.mentor_id IS DISTINCT FROM bookings.mentor_id` | 0 |
| `session_workspaces` participant drift | 0 |

Phase 31 closed the write path inside `create_booking_with_hold`, and that
function is live in production with the segment predicate. `e366ed96` predates
it, and phase 31 says nothing about rows that already exist.

**Not repaired, deliberately.** Phase 31's posture is that a gig and a segment
which disagree mean stale caller context; rewriting either column would destroy
the evidence. Operator decision.

`20261011000000_phase37_workspace_identity_invariant.sql` closes the class
rather than the instance: a BEFORE INSERT/UPDATE trigger refuses any booking
whose gig belongs to a different mentor or segment, and any
`session_workspaces` row whose denormalised `mentor_id`/`seeker_id` are not its
booking's — the two columns the seeker SELECT policy actually reads. The legacy
row is listed by `public.inconsistent_bookings`.

---

## 7. `session_workspaces` participants were unconstrained from their booking — **CLOSED**

**Severity: HIGH** — cross-session disclosure of published mentor notes.

`session_workspaces.booking_id` had a foreign key and a unique index from the
start. `mentor_id` and `seeker_id` had neither — they are free-standing
`REFERENCES public.profiles(id)` columns, and they are the columns RLS reads:

```sql
(seeker_id = auth.uid() AND status = 'PUBLISHED') OR mentor_id = auth.uid() OR is_admin()
```

Visibility therefore followed the ROW, never `bookings.seeker_id`. A row whose
`seeker_id` had drifted was simultaneously invisible to the seeker who booked
the session — who is shown "Awaiting Mentor Notes" for ever — and readable by
whoever the drifted value named, while the mentor still saw PUBLISHED. Nothing
in the stack could produce that pair, so nothing in the stack could detect it.

`authorizeExistingWorkspace` checked `mentor_id` drift and never `seeker_id`,
and `planWorkspaceWrite` repaired neither. Fixed by phase37 (trigger) plus
`authorizeExistingWorkspace` now returning `PARTICIPANT_MISMATCH`, which the
route answers with **409** rather than 403 — the caller *is* the booking's
mentor, so "forbidden" would be false and unactionable.

**No RLS was weakened, and no policy was touched.** The point of the trigger is
to make the data the existing policies read trustworthy, so no policy has to be
relaxed to compensate.

---

Items 1–4 are reconciled and no longer allow-listed anywhere; each has a
standing guard that fails if the boundary is reopened. Item 5 is the remaining
open item.

`tests/rls_coverage_regression.test.ts`:

- `profiles UPDATE is narrowed to the four display columns`
- `mentor_profiles UPDATE is narrowed to the five content columns`
- `the profile UPDATE policies that production runs are recorded`
- `client roles hold no TRUNCATE on user or workflow tables`
- `platform_config is closed to non-admins by migration, not only in production`

`tests/workspace_publish_regression.test.ts` covers item 5 for
`session_workspaces`: it pins the write-path column set against the migration
files, so the next payload/table skew fails the suite rather than production.

`tests/workspace_identity_regression.test.ts` covers items 6 and 7:

- `A.` publishing A yields one PUBLISHED row and A's seeker reads it
- `B.` a seeker for B cannot read A's row; the foreign-row check precedes status
- `C.` publishing A leaves B byte-identical and notifies only A's seeker
- `D.` every workspace read is `.eq('booking_id', …)`; no other scoping
- `E.` mentor + segment + gig must agree, and an unjoined gig is unverified
- `F.` no `bookings[0]`, no `.order()` on a per-booking read, no latest-row
- `G.` PENDING withholds content, PUBLISHED releases it, to the right seeker

Each guard was verified by injection — reintroducing the defect makes the suite
fail, so none of them pass vacuously:

| Injected regression | Tests that fail |
|---|---|
| `GRANT UPDATE (status)` on `session_workspaces` | 2 |
| `mentor_notes` no longer declared in migrations | 1 |
| `USING (true)` instead of `is_admin()` on `platform_config` | 2 |
| `phase35` migration removed | 4 |
| `account_status` re-granted on `profiles` | 2 |
| `is_featured` re-granted on `mentor_profiles` | 2 |
| `phase36` migration removed | 4 |
| `seeker_id` dropped from `authorizeExistingWorkspace` | 3 |
| `data.bookings[0]` first-match fallback restored | 2 |
| identity binding removed from either workspace page | 2 |

---

## Verified end state

Applied and confirmed against production on 2026-09-30:

| Migration | Closes |
|---|---|
| `20261007000000_phase33_session_workspaces_column_alignment.sql` | 5 (the PGRST204 outage) |
| `20261008000000_phase34_restore_narrow_workspace_content_grant.sql` | keeps 5 from widening the client grant |
| `20261009000000_phase35_platform_config_rls.sql` | 3 |
| `20261010000000_phase36_profile_column_boundaries.sql` | 1, 2, 4 |
| `20261011000000_phase37_workspace_identity_invariant.sql` | 7, and the class of 6 |

`phase37` is **not yet applied to production.** It installs two triggers and two
reporting views and touches no grant, no policy and no existing row. Once
applied, `public.inconsistent_bookings` lists any legacy row for an operator
decision — it will surface `BK-2609300533-099b` (item 6).

Every probe used a forced-rollback block, and each table was re-read afterwards
to confirm no probe data survived.