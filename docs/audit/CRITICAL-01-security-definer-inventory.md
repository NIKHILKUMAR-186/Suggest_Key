# CRITICAL-01 — SECURITY DEFINER function inventory (pre-containment)

Captured: 2026-09-29 (UTC) against the live Supabase project
Project ref: `ojbxycchsajqpwhwdkll`
Scope: every `SECURITY DEFINER` function in schema `public`

> **This file is a historical record of a pre-containment database state. It is
> not a description of the current system.** The database it describes had 80
> `SECURITY DEFINER` functions, 78 of them executable by `anon`. That condition
> was contained on the same day. The current state is re-verified in
> "Re-verification (2026-10-02)" at the end of this file, and the finding is
> **CONTAINED**.
>
> Read the historical sections for the *reasoning* and the *evidence*; read the
> re-verification section for the current numbers.

## Method

Inventory taken from `pg_proc` (`prosecdef = true`, `pronamespace = 'public'`) joined to
role privileges via `has_function_privilege`. Current ACL of every function is
non-default and identical in shape:

```
{=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```

`=X/postgres` is the implicit **PUBLIC** grant. `anon` holds no explicit grant on any
function and inherits EXECUTE purely from `PUBLIC`. This is the root cause of CRITICAL-01:
Postgres grants `EXECUTE` to `PUBLIC` on new functions by default, and no migration ever
revoked it.

## Totals

| Metric | Count |
|---|---|
| SECURITY DEFINER functions in `public` | 80 |
| Executable by `anon` (pre-containment) | 78 |
| Executable by `PUBLIC` | 78 |
| Owned by `postgres` | 80 |
| `set search_path` pinned | 78 |
| Missing `set search_path` | 2 (`create_booking_with_hold`, `get_user_role`) |
| Trigger functions | 1 (`handle_new_user`, on `auth.users`) |

## Dependency analysis

Callers were established by exhaustive repo-wide symbol search over `src/`, `server.ts`,
`tests/`, `supabase/migrations/`, `scripts/`, plus `pg_trigger` and `pg_policies`.

| Caller type | Functions |
|---|---|
| Client via PostgREST (`authenticated`) | **none** — the 4 `src/` hits are all comments or service-role calls (see below) |
| Client via service-role key | `insert_audit_log`, `insert_system_log` (`src/lib/logger.ts` → `getAdminClient()`), `record_login_failure`, `reset_login_failures` (`src/lib/loginFailureTracker.ts` → `getSupabaseAdmin()`) |
| `server.ts` via service-role | `acquire_slot_hold`, `approve_mentor_application`, `complete_expired_sessions`, `confirm_booking`, `create_booking_with_hold`, `prune_system_logs`, `reconcile_expired_bookings`, `reconcile_expired_sessions`, `review_payment`, `is_admin` |
| Required by RLS policies | `is_admin`, `has_role`, `is_account_suspended`, `mentor_is_publicly_visible` |
| Required by triggers | `handle_new_user` (fired by `supabase_auth_admin` on `auth.users`) |
| **No caller anywhere** | remaining ~62 functions (legacy + superseded phases) |

### Notable non-callers (verified comment-only, NOT application calls)

- `create_booking_with_hold` — `src/lib/bookingService.ts:80` is a doc comment that
  explicitly states calling the RPC directly "would let the browser assert `p_seeker_id`".
- `expire_stale_holds` — `src/lib/razorpayService.ts:826` is a doc comment.
- `mentor_is_publicly_visible` — `src/lib/discoveryService.ts:367` is a doc comment.
- `is_admin` — `src/lib/supabase.ts:77` is a doc comment.

## Functions that were exploitable by an unauthenticated caller

All `SECURITY DEFINER`, all anon-executable, none validating the caller:

| Function | Worst-case impact |
|---|---|
| `admin_upsert_profile` | writes `user_roles` with caller-supplied role → **self-service admin escalation** |
| `admin_delete_profile_by_email` | deletes a user + `user_roles`/`seeker_profiles`/`mentor_profiles` by email |
| `mentor_accept_booking_atomic` / `mentor_decline_booking_atomic` | acts as any mentor (caller supplies `p_mentor_id`) |
| `mark_all_notifications_as_read` | IDOR on any `p_user_id` |
| `mark_notification_as_read` | IDOR on any notification id |
| `can_join_session` | caller supplies `p_user_id` |
| `convert_hold_to_booking` | caller supplies `p_seeker_id` |
| `create_booking_with_hold` | caller supplies `p_seeker_id` |
| `create_slot_hold` / `create_payment_booking` / `create_qr_payment` | caller-supplied actor ids, no auth check |
| `confirm_booking` / `set_meeting_link` / `mentor_confirm_booking` / `mentor_cancel_booking` / `seeker_cancel_booking` / `reschedule_booking` | booking state changes with caller-supplied identity |
| `review_payment` / `admin_approve_payment` / `admin_reject_payment` | payment verification with caller-supplied `p_admin_id` |
| `insert_audit_log` / `insert_system_log` | audit/system log forgery |
| `list_active_login_threats` | exfiltration of security-threat records |
| `get_user_roles` / `get_user_role` / `has_role` / `is_account_suspended` / `get_subscription_summary` / `get_user_sessions` | role/status/subscription disclosure for any user id |
| `list_all_payments` / `list_pending_payments` / `get_admin_session_view` | these DO call `is_admin()` internally, so they were safe from anon, but were anon-*reachable* |

## Minimum safe grants applied

| Role | Scope |
|---|---|
| `anon` | **none** |
| `authenticated` | `is_admin()`, `has_role(uuid,text)`, `is_account_suspended(uuid)`, `mentor_is_publicly_visible(uuid)` — required for RLS predicate evaluation only |
| `service_role` | all functions in `public` (server is the trusted backend) |
| `supabase_auth_admin` | `handle_new_user()` only (trigger) |
| `PUBLIC` | revoked everywhere |

## Evidence of execution (pre-containment)

```
POST .../rest/v1/rpc/get_user_role
  {"user_uuid":"00000000-0000-0000-0000-000000000001"}
  -> 200 OK, body: null                       (function executed as anon)

POST .../rest/v1/rpc/admin_upsert_profile
  {"p_id":null, ... "p_role":"admin" ...}
  -> 400 {"code":"42703","message":"column \"onboarded\" of relation \"profiles\" does not exist"}
```

The `42703` is a column error raised **from inside the function body**, proving `anon`
passed the EXECUTE permission gate (a permission failure returns `42501 permission denied
for function`). `admin_upsert_profile` was blocked only by a reference to the dropped
column `profiles.onboarded` — an accidental blocker, explicitly not treated as a control.

---

# Post-containment verification

Verified: 2026-09-29 (UTC), after migration `20260929202846`
(`phase29_security_definer_execute_containment`) was applied to the live project.
The section above is retained unmodified as the pre-containment record.

## Status

**CRITICAL-01: CONTAINED.** The escalation path is closed at the database layer, and the
closure is confirmed both in the catalog and over the wire against the live PostgREST API.

## Applied change

| Item | Value |
|---|---|
| Migration applied in production | `20260929202846` — `phase29_security_definer_execute_containment` |
| Repo file for the same change | `supabase/migrations/20261004000000_phase29_security_definer_execute_containment.sql` — **not present in the applied history** |
| Objects dropped | none |
| Tables, policies, RLS settings changed | none |

The two revisions describe the same change under different version stamps, so this is a
**migration-drift** condition, not a missing fix. See "Open items".

## Catalog state after containment

| Metric | Pre-containment | Post-containment |
|---|---|---|
| `SECURITY DEFINER` functions in `public` | 80 | **81** |
| Executable by `anon` | 78 | **0** |
| Executable by `authenticated` | 78 | **4** (RLS predicates only) |
| Executable by `service_role` | — | **81** |
| Missing `set search_path` | 2 | **0** |
| `anon` table-level grants in `public` | 0 | 0 |

Resulting ACL shape — `PUBLIC` (`=X/postgres`) absent from every `SECURITY DEFINER`
function:

```
{postgres=X/postgres,service_role=X/postgres}                                          -- default
{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}                 -- the 4 RLS predicates
{postgres=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres}           -- handle_new_user
```

The four functions granted to `authenticated` are `is_admin()`, `has_role(uuid,text)`,
`is_account_suspended(uuid)` and `mentor_is_publicly_visible(uuid)`. An exhaustive scan of
`pg_policy` confirms this set is **exactly** the set of `SECURITY DEFINER` functions
referenced by any RLS `USING` or `WITH CHECK` expression — nothing is left un-granted that
a policy needs to evaluate. No column `DEFAULT` and no `CHECK` constraint references any
`SECURITY DEFINER` function, so no other privilege-evaluation surface is affected.

## Runtime verification (live PostgREST, anonymous key)

Control calls prove the harness genuinely reaches and executes anon-callable functions, so
the denials below are real grant denials rather than schema-cache artifacts:

| Probe | Expected | Result |
|---|---|---|
| `POST /rest/v1/rpc/resolve_session_state` | reachable (invoker) | `200` → `"IN_PROGRESS"` |
| `POST /rest/v1/rpc/booking_is_upcoming` | reachable (invoker) | `200` → `true` |
| `POST /rest/v1/rpc/is_admin` | denied | `401` `42501 permission denied for function` |
| `POST /rest/v1/rpc/get_user_role` | denied | `401` `42501` |
| `POST /rest/v1/rpc/get_user_roles` | denied | `401` `42501` |
| `POST /rest/v1/rpc/get_subscription_summary` | denied | `401` `42501` |
| `POST /rest/v1/rpc/insert_audit_log` | denied | `401` `42501` |
| `POST /rest/v1/rpc/list_active_login_threats` | denied | `401` `42501` |
| `POST /rest/v1/rpc/mark_all_notifications_as_read` | denied | `401` `42501` |
| `GET /rest/v1/segments?select=id&limit=1` | denied | `401` `42501 permission denied for table` |

All probes were read-only or use throwaway zero UUIDs. No state-changing function was
invoked at any point.

## Caller model confirmed

- Browser client (`src/lib/supabase.ts:43`, `VITE_SUPABASE_ANON_KEY`) issues **no `.rpc()`
  calls at all**; it only performs RLS-governed table reads as `authenticated`.
- All privileged RPC traffic originates server-side with the service-role key
  (`src/lib/supabaseServer.ts:138`, `src/lib/logger.ts:22`), which retains EXECUTE on all 81.
- Therefore revoking `anon` and `authenticated` broke no application path.

## Residual, not part of CRITICAL-01

- 201 `SECURITY INVOKER` functions in `public` remain executable by `anon` through the
  `PUBLIC` default grant. They execute with the caller's own rights, so they cannot bypass
  RLS and are not an escalation vector. Revoking them wholesale would break trigger bodies
  (`set_updated_at`, `check_availability_overlap`, `enforce_gig_topic_segment_ownership`)
  that fire on writes made by `authenticated`, so it was deliberately not done.
- ~180 of those are `btree_gist` extension support functions (`gbt_*`, `*_dist`,
  `gbtreekey*`) living in the exposed `public` schema and owned by `supabase_admin`. This is
  schema hygiene, not a vulnerability; consider relocating the extension.

## Open items

1. **Migration drift.** The applied revision (`20260929202846`) is absent from
   `supabase/migrations/`, while the repo copy (`20261004000000_...`) is unapplied. A fresh
   `supabase db push` from a clean environment would replay containment, and the applied
   revision is unreproducible from the repo. Reconcile so the repo is the source of truth.
2. **Count discrepancy.** Pre-containment capture recorded 80 `SECURITY DEFINER` functions;
   the current catalog reports 81. Cause not established — possibly a function added
   concurrently, or a counting difference. Worth reconciling so the audit totals are exact.
3. **Authenticated-path runtime test not performed.** The `authenticated` grants and the
   service-role paths were verified in the catalog only. End-to-end confirmation needs a
   real signed-in session and was deliberately not fabricated.

---

# Re-verification (2026-10-02)

Run directly against the live catalog. This supersedes the counts above for
current-state purposes; the historical sections are left intact.

## Finding status

**CRITICAL-01: still CONTAINED.** Nothing has regressed.

| Metric | Pre-containment (2026-09-29) | Containment (2026-09-29) | Re-verified (2026-10-02) |
|---|---|---|---|
| `SECURITY DEFINER` functions in `public` | 80 | 81 | **100** |
| Executable by `anon` | 78 | **0** | **0** |
| Executable by `authenticated` | 78 | 4 (RLS predicates only) | **5** — see below |
| Executable by `service_role` | — | all | **all 100** |

The function count grew from 81 to 100 because phases 30–41 added roughly twenty
functions: reschedule-request handling, the coupon RPCs, manual refund
completion, and the support-centre RPCs. Each of those revoked `EXECUTE` from
`PUBLIC`, `anon` and `authenticated` in its own migration — the phase 29
containment was **not** a one-time event that later work silently undid, and
`anon`-executable count is still **0**.

## The fifth `authenticated` grant

Post-containment, the audit claimed the `authenticated` grants were "**exactly**
the set of `SECURITY DEFINER` functions referenced by any RLS `USING` or
`WITH CHECK` expression". That claim is **no longer exact**. There are now five:

| Function | Why it is granted to `authenticated` |
|---|---|
| `is_admin()` | RLS predicate |
| `has_role(uuid, text)` | RLS predicate |
| `is_account_suspended(uuid)` | RLS predicate |
| `mentor_is_publicly_visible(uuid)` | RLS predicate |
| `create_booking_with_hold(...)` | **Deliberate, not an RLS predicate.** Granted by `20260920000003_phase6_atomic_booking.sql` and re-granted by phase 31 and phase 39. |

`create_booking_with_hold` is callable by a signed-in client **by design**. It is
the atomic booking RPC, and it performs the full server-side validation itself —
ownership, role, mentor approval, segment and gig activity, duration match, past
slot, recurring availability, date exceptions, existing bookings and active
holds. Moving that logic into the database is precisely what makes the booking
atomic and makes the validation unbypassable; hiding the function would not add
security, it would only make the same rules unreachable.

Note that this contradicts an adjacent claim in the same post-containment
section: "the browser client issues **no** `.rpc()` calls at all". The browser
still issues none today — all booking traffic goes through `POST
/api/bookings/hold` with the service-role key. The grant is defensive depth for
the database contract, not a description of current traffic.
