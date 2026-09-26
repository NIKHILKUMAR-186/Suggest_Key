# Security Audit — Suggest Key

**Target:** `S:\suggest-key\Suggest_key` (Express + Supabase + React SPA, TypeScript)
**Roles in scope:** `seeker`, `mentor`, `admin`
**Method:** manual source review of the API surface, database/RLS/storage policies, and authentication path, followed by automated authenticated exploit runs against a real Supabase project.
**Status:** all findings below were reproduced, fixed, and re-verified. One hardening item remains open (see *Residual risk*).

---

## 1. How the audit was verified

Findings were not accepted on inspection alone. Every one was reproduced with a working exploit, then re-tested after the fix.

- **Exploit harness:** `scripts/security-audit.mjs` creates five throwaway identities (`seekerA`, `seekerB`, `mentorA`, `mentorB`, `admin`) plus a real `CONFIRMED` booking, then exercises the attack surface with each identity's genuine Supabase-issued access token. Fixtures are tagged `@audit.local` and purged afterwards, including purging leftovers from interrupted runs.
- **Result:** 84 / 84 checks pass. The pre-fix baseline was 62 / 70.
- **Unit + integration suite:** `npm test` — 399 / 399 pass.
- **Typecheck:** `npm run lint` (`tsc --noEmit`) — clean.
- **Build:** `npm run build` — succeeds.

Harness self-checks worth noting: seeding failures abort the run instead of silently no-opping, every seed write is verified to have landed, and each run asserts that rejected mass-assignment attempts wrote no row.

---

## 2. Findings

### F1 — Client-supplied clock defeated the session access window (High, fixed)

`GET /api/sessions/:bookingId/access` and `POST /api/sessions/:bookingId/join` accepted a `currentTime` field from the caller and used it for the T-5 gate. Any authenticated user could send a timestamp inside the access window for a booking that had not started, and receive the meeting link.

- Meeting URLs are the session's real secret: possession of the link is the authorisation to join the call.
- The caller's identity was irrelevant, because the window check short-circuited before any ownership check.

**Fix:** `server.ts` now ignores any client-supplied timestamp and evaluates the window against the server clock. The response still accepts `currentTime` so the local session simulator keeps working; it simply has no effect on the decision.

**Verified:** `POST join` with a `currentTime` inside the window, and with a far-future `currentTime`, both return no meeting URL; a participant cannot join their own booking 24 hours early.

---

### F2 — Session authorisation was served from in-memory fixtures, not the database (High, fixed)

The session routes called `getLocalBookingEngineContext()`, which returns hard-coded demo bookings. Two consequences:

1. Authorisation was decided against fixture data rather than the booking actually being accessed.
2. `POST /api/sessions/:bookingId/complete` only mutated that in-memory object, so it could not change real booking state and applied no state or timing validation.

**Fix:** the session routes now read the booking from Supabase and authorise on trusted data — the caller must be the booking's seeker, its mentor, or an admin. Non-participants and unknown bookings get one sanitised 404 that reveals nothing about the booking's existence, participants, or code. Completion requires a real `CONFIRMED` booking whose start time has passed, and writes with a conditional atomic update so a concurrent completion cannot double-apply.

Booking lookups accept either a UUID or an opaque booking code, and both are shape-validated (`src/lib/sessionAccess.ts`) before use, so no caller input reaches a filter as a raw clause.

**Verified:** a non-participant is refused on both `join` and `complete`; an injection-shaped booking id is refused without a 500; a participant and an admin both fail to complete a session that has not started; the booking's `status` is unchanged after the rejected attempts.

---

### F3 — Demo admin account could be reached with an empty password (Medium, fixed)

The demo account list defaulted `admin` to an empty password, and `POST /api/auth/demo-login` accepted `{ "persona": "admin" }` with no credential, minting a privileged token.

**Fix:** a privileged persona now requires an operator-configured `ADMIN_PASSWORD` of at least 12 characters. If it is unset or too short, the admin persona is not offered at all. Passwordless login is rejected for the privileged persona, including an empty string.

**Verified:** `persona=admin` with no password, with an empty password, and with a wrong password are all refused; the correct operator password still works, and the unprivileged `seeker` persona remains one-click so local development is unaffected.

---

### F4 — Demo auth was reachable by default and weakly keyed (Medium, fixed)

Demo authentication activated on the mere presence of a signing secret, and a short or well-known value was accepted. Any deployment that set a weak secret, or that simply had one set in a shared environment, exposed privileged tokens.

**Fix** (`src/lib/supabaseServer.ts`): demo auth is now opt-in via `ENABLE_DEMO_PERSONAS=true` and requires a `DEMO_TOKEN_SECRET` (or legacy `DEMO_AUTH_SECRET`) of at least 32 characters, rejecting known default values. It fails closed: an absent, short, or default secret disables the feature and reports why. Production remains disabled unconditionally regardless of configuration.

**Verified:** `tsc` clean; `tests/auth_flow.test.ts` covers unset, `"false"`, `"0"`, `"no"`, and a short secret, plus `"TRUE "` being accepted as a true value. Forged, unsigned, garbage, and guessable-key-signed tokens are all rejected with 401.

---

### F5 — Any authenticated user could dispatch platform notifications (Medium, fixed)

`POST /api/notifications/dispatch` was authenticated but not role-restricted, letting any seeker or mentor push notifications to arbitrary users.

**Fix:** the route now requires an admin role.

**Verified:** seeker and mentor are refused with 403; a seeker targeting another user is refused.

---

### F6 — Meeting URL disclosed to seekers before the access window (Medium, fixed)

`GET /api/seeker/bookings/:id` and `GET /api/seeker/bookings` returned `meeting_url` on every booking, so a seeker could read a session's link hours or days before the T-5 window, defeating the gate that F1/F2 also undermined.

**Fix:** the projection is redacted per booking via `redactMeetingUrlForParticipant` — the field is stripped for seekers outside the window and after the end time, preserved for the mentor and for admins, and stripped when the timestamps cannot be parsed (fails closed).

**Verified:** both the detail and list responses omit `meeting_url` for a seeker outside the window; unit tests cover the T-5 boundary to the millisecond, the end-time boundary, the in-window case, mentor/admin exemptions, and unparseable timestamps.

---

### F7 — Malformed identifiers produced 500 responses (Low, hardened)

Supabase-shaped path and query values reached PostgREST unvalidated, so a malformed value surfaced as a server error rather than a client error. Notably, the upstream project sits behind a WAF that rejects SQL-shaped path segments outright, which arrives as an unattributable upstream error.

**Fix and limitation:** the error layer already maps attributable caller faults (`22P02`, `23505`, `23503`, `23502`, `23514`) to the correct 4xx status while unknown failures stay 500, and nothing internal is ever disclosed. Shape validation is now in place for the session and booking identifier paths via `src/lib/sessionAccess.ts`.

**Verified:** the SQL-shaped booking id returns no data, and its response body contains no Postgres, PostgREST, SQLSTATE, stack-frame, or `node_modules` detail. Applying parameter-shape validation across the remaining identifier routes is listed in *Residual risk*.

---

### F8 — Body-parser failures returned 500 (Low, fixed)

An oversized body or malformed JSON produced an internal-error response.

**Fix:** `entity.too.large` maps to 413, JSON parse failures to 400, and unsupported content encoding to 415.

**Verified:** `tests/error_sanitisation.test.ts` covers oversized bodies, malformed JSON, unknown errors staying 500, and sanitisation holding in development as well as production.

---

### F9 — Payment-proof upload was not rate limited (Low, fixed)

`POST` on the payment-proof path sat outside the expensive-route limiter while its siblings were inside it.

**Fix:** the route now uses the same expensive-route limiter.

---

## 3. Controls verified as sound

These were attacked and held; no change was needed.

- **Anonymous access** — 15 protected routes all answer 401.
- **Horizontal privilege escalation (BOLA/IDOR)** — cross-tenant reads and writes refused for bookings, workspaces, notifications, and payment proofs.
- **Vertical privilege escalation** — 11 admin routes refused for seeker and mentor, including a request carrying role-spoofing headers.
- **Role from request body or query string** — a `role=admin` body and `?role=admin` query are both ignored; a clean body from a seeker is refused with 403; no row is written.
- **Notification ownership** — reads and writes are owner-scoped; an admin marking another user's notification read gets 404.
- **Mentor booking isolation** — lists return only the caller's own bookings and a `?mentorId=` override is ignored.
- **Booking creation rules** — mentors cannot create bookings, a body `seekerId` cannot redirect a booking, and slots inside the 5-minute cutoff or in the past are rejected.
- **Token forgery** — unsigned, malformed, and wrongly-signed tokens are all rejected.
- **Storage** — `payment-proofs` and mentor verification buckets are private, with owner/admin read-write policies and no public objects.
- **Rate limiting** — the global limiter returns 429 under sustained load.
- **Information disclosure** — no booking response or health endpoint exposes service-role key material or configuration.
- **RLS** — anonymous table privileges are revoked and policies are defence-in-depth behind the API.
- **Secrets** — no committed `.env` and no tracked service-role or JWT-like material. One historical hardcoded development default exists only as a rejected value; it is documented rather than used.

---

## 4. Residual risk

- **Identifier shape validation is partial.** The session and booking identifier paths are shape-validated, and attributable malformed values map to 4xx. Because the upstream project is behind a WAF that blocks SQL-shaped path segments, such a value arrives as an unattributable upstream error and is reported as a sanitised 500. It leaks nothing and returns no data, but the correct status is 400. Recommended follow-up: apply the existing parameter-shape validation consistently to every route with an `:id` or identifier query parameter.
- **The shared Supabase project is exposed to internet traffic.** It is a staging/development project with real data and an active WAF. It should not be treated as a production data store.
- **`DEMO_TOKEN_SECRET` is in this repository's ignored `.env`.** Demo auth is opt-in and off unless explicitly enabled, but any environment that enables it should use a distinct, high-entropy secret rather than a development value.
- **No dependency or supply-chain audit was performed.** `npm audit` was not run and the lockfile was not reviewed for known advisories.
- **Strix was not run.** See below.

---

## 5. Tooling limitation: Strix

The request to use Strix could not be completed in this environment, and it is not claimed as done.

- Strix 1.6.2 (the correct package — "Open-source AI Hackers for your apps") **is installed** under Python 3.13 and its CLI runs.
- It cannot execute a scan here. Two independent blockers:
  - **No LLM provider key.** Strix drives its agents with an LLM; the only key in the environment is a `GEMINI_API_KEY` placeholder, and no other provider credential is available.
  - **No container runtime.** Strix runs its agents inside a sandboxed container. This machine has only the Docker CLI client (29.7.2): Docker Desktop is not installed, there is no `com.docker.service`, and no daemon is reachable. Installing a runtime and its virtualisation backend is a machine-level change that was not made here.
- The findings in this report therefore come from manual source review plus the `scripts/security-audit.mjs` harness, not from Strix. They are independently reproducible, but a Strix pass remains outstanding and should be run in an environment with a provider key and a working container runtime.

---

## 6. Reproducing this audit

```powershell
# typecheck and unit tests
npm run lint
npm test

# exploit harness: needs a reachable API and Supabase credentials in .env
$env:PORT = "3111"
$env:ENABLE_DEMO_PERSONAS = "true"
$env:DEMO_TOKEN_SECRET = "<32+ character secret>"
$env:ADMIN_PASSWORD = "<12+ character password>"
npx tsx server.ts

# in a second shell
node scripts/security-audit.mjs http://localhost:3111
```

The harness creates and removes its own identities. It only ever writes rows tagged `@audit.local`.

---

## 7. Files touched

**Security fixes**
- `server.ts` — session authorisation, clock handling, demo accounts, notification dispatch, meeting URL redaction, payment-proof rate limit
- `src/lib/supabaseServer.ts` — demo auth opt-in, secret strength, fail-closed configuration
- `src/lib/sessionAccess.ts` *(new)* — identifier shape validation and meeting URL redaction
- `src/lib/supabaseErrors.ts` — caller-fault status mapping, body-parser status mapping

**Tests**
- `tests/session_access.test.ts` *(new)* — T-5 window boundaries, participant checks, booking states, redaction, identifier validation
- `tests/auth_flow.test.ts` — demo auth fail-closed behaviour
- `tests/error_sanitisation.test.ts` — error status and disclosure behaviour
- `tests/helpers/demoAuthEnv.ts` *(new)* — explicit test-only demo auth configuration

**Harness**
- `scripts/security-audit.mjs` — authenticated exploit and retest harness with verified seeding and cleanup

**Documentation**
- `.env.example` — documents `ENABLE_DEMO_PERSONAS`, `DEMO_TOKEN_SECRET`, and the `ADMIN_PASSWORD` requirement
