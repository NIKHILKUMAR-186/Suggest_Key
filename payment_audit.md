# Suggest Key — Complete Payment System Forensic Audit

**Audit date:** 2026-09-29
**Audit type:** Read-only forensic review. No code, schema, configuration or data was modified.
**Scope:** Manual UPI/QR path, Razorpay path, payment state machines, hold interaction, storage, RLS, money integrity, concurrency, notifications, realtime, admin/seeker UI, tests, migrations, deployment posture.

## Evidence Basis and Confidence Legend

| Label | Meaning |
|---|---|
| **IMPLEMENTED** | Code exists and was read in full. |
| **VERIFIED** | Behaviour additionally confirmed by a passing test, a live query, or a build artefact. |
| **VERIFIED AGAINST LIVE DB** | Confirmed by read-only query against the connected Supabase project. |
| **PARTIALLY IMPLEMENTED** | Code exists but a required part is missing. |
| **DOCUMENTED ONLY** | Claimed in `docs/` with no corresponding implementation. |
| **MISSING** | Required for correctness and absent. |
| **NOT VERIFIED AGAINST LIVE DATABASE** | Could not be confirmed against the running project. |
| **NOT VERIFIED AGAINST RAZORPAY GATEWAY** | Could not be confirmed against the real gateway (no credentials — see §3). |

### Sources inspected

**Live Supabase** (`ojbxycchsajqpwhwdkll.supabase.co`, read-only, service-role, PostgREST + Storage API):
`platform_config`, `payments`, `payment_events`, `webhook_events`, `bookings`, bucket listing for `payment-qr` / `payment-proofs` / `segment-hero`.

**Code:** `server.ts` (12,042 lines), `src/lib/razorpayConfig.ts`, `razorpaySignature.ts`, `razorpayService.ts`, `razorpayStore.ts`, `razorpayClient.ts`, `src/lib/paymentProof.ts`, `src/config/app.ts`, `src/pages/seeker/SeekerPaymentPage.tsx`, `src/components/seeker/RazorpayCheckoutCard.tsx`, `src/pages/admin/AdminPaymentsPage.tsx`.

**Migrations:** all 38 files in `supabase/migrations/`, in particular `phase4_mvp_schema`, `phase20_mentor_booking_notification_link`, `phase21_hold_expiry_cron`, `phase25_payment_foundation`, `phase26_hold_duration_5min`, `phase7b_segment_hero_storage`, `phase19_security_lockdown`.

**Config:** `.env`, `.env.example`, `package.json`, `vercel.json`.

**Tests:** the 9 payment test files plus `tests/helpers/razorpayHarness.ts`.

**Validation run:** `npx tsc --noEmit` (clean), `npm run build` (succeeds), 185 payment tests (all pass). `npm test` (full suite) did not complete within the execution window — reported in §25.

---

# 1. Executive Summary

Suggest Key has **two complete, independent payment implementations sharing one `payments` table**. Only one of them is live.

| | Manual UPI/QR | Razorpay |
|---|---|---|
| Implementation | **COMPLETE** | **COMPLETE** |
| Enabled at runtime | **YES** (the only live path) | **NO** — `RAZORPAY_ENABLED=false` |
| Credentials present | n/a | **NO** — all 3 secrets empty |
| Exercised in production | **YES** — 2 verified payments | **NO** — 0 rows in `payment_events` / `webhook_events` |
| Can it work end-to-end today? | **Yes**, with one caveat (P1-1 below) | **No** — untestable, and one structural gap (P0-1) |

### The seven things that matter most

1. **P0-1 — A captured payment can be silently discarded.** If Razorpay captures money for an order whose `payments` row cannot be resolved, `handleCaptured` returns `handled: 'unmatched'`, writes **nothing**, and the webhook route still returns `200`. Razorpay stops retrying. The seeker has paid and the platform has no record of it. This is the only path in the entire payment system where money can vanish without a trace. Latent today (Razorpay off) but it is a production blocker for enabling it.

2. **P1-1 — The `payment-qr` bucket is never created by any migration.** Code references `PAYMENT_QR_BUCKET` in three places. A search of all 38 migrations for `payment-qr` returns **zero** bucket-creation statements. The bucket *does* exist in the live project (verified — it holds the configured QR at `platform/payment-qr-1790505624226-f2bd8d.png`), so it was created by hand in the Supabase console. **A fresh database built purely from `supabase/migrations/` cannot accept a QR upload.** This is the single most important operational fact in this report.

3. **P1-2 — There is no refund initiation, anywhere.** Not an admin button, not an automatic path, not a Razorpay API call. The gateway HTTP client implements exactly two methods: `createOrder` and `fetchPayment`. Refund *events* are consumed; refunds are never *issued*. A seeker who is captured against a cancelled booking lands in a `FAILED` + `refund_status='PENDING'` state that only a human with Razorpay dashboard access can resolve. The code comments this honestly.

4. **The Razorpay state machine is genuinely well built.** Conditional updates, `(gateway, event_id)` idempotency with a `new`/`duplicate`/`resume` distinction, HMAC over the raw body, server-derived amounts, retry re-arm of the same row, and dead-end refund-owed recovery. 185 payment tests pass, they import the real production functions, and one exercises the real Express route. This is not a sketch — it is finished, reviewed code that simply cannot be switched on yet.

5. **Money integrity on the Razorpay path is sound.** The amount is *always* read from `bookings.amount_inr`; no browser-supplied amount reaches order creation or capture. Paise conversion is `Math.round(amountInr * 100)`. Amount is re-checked against the gateway on **both** the browser-verify path and the webhook path, and a mismatch is recorded and refused rather than confirmed. **No path was found where a user pays ₹X and the system records ₹Y.**

6. **The manual path has a real human-in-the-loop design and one structural gap.** Amount and ownership are server-derived; the proof path is prefix-validated; a proof is confirmed to exist in storage before the row is written; the admin decision runs through a `SECURITY DEFINER` RPC with `FOR UPDATE` row locks and a `PAYMENT_ALREADY_PROCESSED` guard. The gap: **there is no time limit on `PENDING_VERIFICATION`.** A proof submitted inside the 5-minute hold survives indefinitely — `expire_stale_holds()` only cancels `PAYMENT_PENDING` bookings, and no cron or job ages out a proof awaiting review.

7. **`payment-qr` drift and a documentation conflict.** The live `platform_config` has an `updated_by` column that **no migration creates** — the table was altered outside version control. Separately, `docs/SUGGEST-KEY-MVP-UPDATED.md` claims admin rejection sets `bookings.status = 'CANCELLED'`; the actual `review_payment` RPC sets **`'REJECTED'`** (`phase20`, line 79). The docs are wrong; the code is right.

### Bottom line

The manual path is **close to production-ready** and needs one migration (the QR bucket) plus one policy decision (proof expiry). The Razorpay path is **architecturally complete but not deployable** — it needs one money-safety fix (P0-1), refund capability, and real credentials before any live traffic.

---

# 2. Current Payment Architecture

```text
                          SEEKER (browser)
                                 │
                    POST /api/bookings/hold
                                 ▼
                  create_booking_with_hold()  ←── DB RPC, one transaction,
                                 │                 mentor row lock, 5-min hold
                                 ▼
                      bookings.status = PAYMENT_PENDING
                                 │
              ┌──────────────────┴───────────────────┐
              │                                      │
   MANUAL (live default)                 RAZORPAY (flag off)
              │                                      │
   GET /api/platform-config                GET /api/payments/razorpay/config
     → upi_id, qr path, instructions          → { enabled, currency, keyId }
              │                                      │
   Seeker pays to UPI externally             POST .../razorpay/order
   outside the system                              │
              │                            runCreateRazorpayOrder()
   Browser uploads screenshot                       │
     → payment-proofs bucket                  payments.status = PAYMENT_PROCESSING
     <seekerId>/<bookingId>/<rand>-<name>    bookings.status UNCHANGED
              │                                      │
   POST /api/seeker/bookings/:id/             POST .../razorpay/verify
     payment-proof                            runVerifyRazorpayPayment()
   { transactionReference, storagePath,        HMAC verified server-side
     fileName, mimeType, fileSize }                    │
              │                             payments.status = VERIFIED
              ▼                             bookings.status = MENTOR_PENDING
   payments.status = PENDING_VERIFICATION            │
   bookings.status = PENDING_VERIFICATION            │
              │                                      │
              │      ┌───────────────────────────────┘
              ▼      ▼
        ADMIN REVIEWS (human)          Razorpay → POST /api/webhooks/razorpay
        review_payment() RPC            HMAC over RAW body; webhook_events claim
              │                          │
     ┌────────┴────────┐                 └─→ same capture path as verify
     ▼                 ▼
  approve            reject
  payments:          payments:
  VERIFIED           REJECTED
  bookings:          bookings:
  MENTOR_PENDING     REJECTED
     │                 │
     │            hold RELEASED
     ▼
  MENTOR CONFIRMS (HTTPS meeting link)
     │
     ▼
  CONFIRMED → (session) → COMPLETED

   payment_events  ← append-only lifecycle log (Razorpay path only)
   webhook_events  ← (gateway, event_id) idempotency (Razorpay path only)
```

**Note the asymmetry:** the manual path produces **no** `payment_events` and **no** `webhook_events` rows. Those two tables are Razorpay-only. There is no unified payment audit trail across both providers.

### Storage buckets

| Bucket | Created by migration? | Exists live? | Public? |
|---|---|---|---|
| `payment-proofs` | **YES** — `phase4_mvp_schema.sql:546` | **VERIFIED** (holds seeker folders) | No (private) |
| `segment-hero` | **YES** — `phase7b_segment_hero_storage.sql:8` | **NOT VERIFIED AGAINST LIVE DATABASE** | Yes |
| `payment-qr` | **NO — MISSING** | **VERIFIED** (holds `platform/`) | No |

### Environment (values redacted; presence only)

| Variable | State | Notes |
|---|---|---|
| `RAZORPAY_ENABLED` | `"false"` | Exactly `"true"` required to enable |
| `RAZORPAY_KEY_ID` | empty | Public by design when set |
| `RAZORPAY_KEY_SECRET` | empty | Server-only |
| `RAZORPAY_WEBHOOK_SECRET` | empty | Server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | present (219 chars) | Server-only; **not in client bundle (VERIFIED)** |
| `VITE_SUPABASE_ANON_KEY` | present | Public by design; in bundle as expected |

---

# 3. Manual Payment Audit (UPI/QR)

**Verdict: COMPLETE AND VERIFIED IN PRODUCTION.** Two real payments exist in the live database, both `VERIFIED` with `gateway='manual'`, real UTRs, and real proof paths.

### Configuration — all live and server-managed

`platform_config` (VERIFIED AGAINST LIVE DB), single row `id=1`:

| Column | Live value | Notes |
|---|---|---|
| `upi_id` | configured (real bank handle) | Recorded only as evidence of configuration |
| `qr_image_storage_path` | `platform/payment-qr-1790505624226-f2bd8d.png` | Confirms the `payment-qr` bucket exists and holds the real QR |
| `currency` | `INR` | |
| `payment_account_name` | configured | |
| `payment_instructions` | `null` | **Empty** — the seeker page shows no custom instructions (P3-1) |
| `hold_duration_minutes` | `5` | Matches `APP_CONFIG.HOLD_DURATION_MS` |
| `updated_by` | present (uuid) | **No migration creates this column — drift (P2-2)** |

Read by the seeker through `GET /api/platform-config` (any authenticated user) and written by admins through `PATCH /api/admin/platform-config`, which assigns values from an explicit field list rather than spreading the request body.

### Transition-by-transition verification

| # | Transition | Writer | Verified how |
|---|---|---|---|
| 1 | `→ PAYMENT_PENDING` | `create_booking_with_hold()` RPC | One transaction, hold + booking together |
| 2 | `PAYMENT_PENDING` → `PENDING_VERIFICATION` | `POST /api/seeker/bookings/:id/payment-proof` | Conditional update `.eq('status','PAYMENT_PENDING')` — a second submit cannot double-advance |
| 3 | `PENDING_VERIFICATION` → `MENTOR_PENDING` | `review_payment(p_approve := true)` | `SECURITY DEFINER`, `FOR UPDATE` on both rows |
| 4 | `PENDING_VERIFICATION` → **`REJECTED`** | `review_payment(p_approve := false)` | See doc conflict below |

> **DOC/CONFLICT:** `docs/SUGGEST-KEY-MVP-UPDATED.md:1110-1111` states rejection sets `bookings.status = 'CANCELLED'`. The RPC at `supabase/migrations/20260927010000_phase20_mentor_booking_notification_link.sql:79` sets **`'REJECTED'`**. **Code is authoritative.** `docs/architecture.md` and `docs/prd.md` propagate the same error. Functionally the difference matters: `REJECTED` *is* in the overlap exclusion's excluded set (`status NOT IN ('CANCELLED','REJECTED')`), so the slot is correctly freed either way.

### Security questions, answered

| Question | Answer | Evidence |
|---|---|---|
| Where is the amount calculated? | `create_booking_with_hold()` snapshots the gig price into `bookings.amount_inr` | DB RPC |
| Is the amount authoritative? | **Yes.** Re-read from the booking row on every payment write | `server.ts:2338` |
| Can the seeker modify the amount? | **No.** The proof endpoint accepts no amount parameter; it is a field on the server-built row | `server.ts:2334-2347` |
| Where is proof stored? | Private bucket `payment-proofs` | `PAYMENT_PROOF_BUCKET` |
| Who can upload? | `authenticated` with `foldername(name)[1] = auth.uid()` | `phase4:560` |
| Who can read? | Own folder **or** `is_admin()` | `phase4:570, 582` |
| Who can delete? | Admins only (`FOR ALL` + `is_admin()`). Seekers have **no DELETE policy** | `phase4:582` |
| File type validation? | Client + server: `image/png`, `image/jpeg`, `image/webp` only | `paymentProof.ts:32` |
| File size validation? | ≤ 5 MB, checked **twice** — from the client-declared size and re-read from storage `metadata.size` | `server.ts:2236, 2322` |
| Can a seeker upload arbitrary files? | **No.** MIME allowlist, size cap, and the bucket enforces the same types | 3 layers |
| Can a seeker submit another person's proof? | **No.** Path must start with `<callerId>/<bookingId>/` | `server.ts:2270` |
| Multiple active proofs per booking? | **No.** `payments` is `UNIQUE(booking_id)`; the route upserts on that key | `phase4:247` |
| Same proof submitted twice? | Yes, harmless — idempotent upsert, notifications gated on `isNewReviewRequest` | `server.ts:2387` |
| After rejection? | Booking → `REJECTED`, hold → `RELEASED`, proof object **retained** (deliberate: audit trail), seeker notified with the reason | `phase20:74-94` |
| Can the seeker retry after rejection? | **No.** `REJECTED` is terminal and not in `PAYABLE_BOOKING_STATUSES` | `paymentProof.ts:132` |
| Approve an already-rejected payment? | **No.** `review_payment` raises `PAYMENT_ALREADY_PROCESSED` | `phase20:50-53` |
| Approve after booking expiry? | **See P2-1** — no time limit on `PENDING_VERIFICATION`. |
| Double mentor notification on approval? | **No.** Notifications are written *inside* the RPC after `FOR UPDATE` locks, and the RPC raises on any second call. | `phase20:44-47, 60-72` |

### The strongest property of the manual path

The admin decision is **not** implemented in TypeScript. It is a `SECURITY DEFINER` Postgres function that takes `p_admin_id` and re-verifies `has_role(p_admin_id,'admin')` *and* that `auth.uid()` matches when a session exists. Even a compromised service-role call cannot approve a payment without naming a genuine admin id. The Express handler only wires parameters and notifies the seeker.

### Weaknesses found

- **P2-1 — No expiry on `PENDING_VERIFICATION`.** The `expire_stale_holds()` cron (every minute) only cancels bookings still at `PAYMENT_PENDING`. A proof submitted at 4:59 on the hold leaves the booking at `PENDING_VERIFICATION` indefinitely, still blocking the mentor's slot via the overlap constraint. An unattended admin queue is therefore also a slot-blocking queue. No test covers this.
- **P3-1 — `payment_instructions` is `null` in production.** The seeker payment page renders an empty instruction block.
- **P2-2 — `updated_by` column drift** (see §21).

---

# 4. Razorpay Audit

**Verdict: ARCHITECTURALLY COMPLETE, RUNTIME-DISABLED, AND UNTESTABLE IN THIS ENVIRONMENT.**

### 4.1 Feature flag

| Question | Answer |
|---|---|
| Where read | `isRazorpayEnabled()` → `process.env.RAZORPAY_ENABLED` |
| Actual default | `"false"` (`.env.example` and live `.env`) |
| Actual runtime value | **`"false"`** (read from `.env`) |
| Where enforced | `assertRazorpayUsable()` — the first call in `runCreateRazorpayOrder`, `runVerifyRazorpayPayment` and `runRazorpayWebhook` |
| Enforcement strength | Exact string match on `"true"` after trim/lowercase. Anything else → `503 RAZORPAY_DISABLED`. Fails closed. |

The two conditions are reported distinctly — `RAZORPAY_DISABLED` (an expected state during the manual-only period) vs `RAZORPAY_NOT_CONFIGURED` (a deployment mistake). That separation is deliberate and correct.

### 4.2 Secrets

| Variable | Read at | Used for | Frontend access | In client bundle | In logs | In DB |
|---|---|---|---|---|---|---|
| `RAZORPAY_KEY_ID` | `razorpayConfig.ts:19` | Order auth + `GET /api/payments/razorpay/config` | **Yes, by design** | Name only, no value | No | No |
| `RAZORPAY_KEY_SECRET` | `razorpayConfig.ts:25` | Basic auth, `computeRazorpaySignature` | **No** | **VERIFIED absent** | No | No |
| `RAZORPAY_WEBHOOK_SECRET` | `razorpayConfig.ts:30` | Webhook HMAC | **No** | **VERIFIED absent** | No | No |

**Bundle verification (VERIFIED):** I built the project and grepped `dist/assets/index-*.js`. The literals `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and `RAZORPAY_ENABLED` are all **absent**. The live service-role key **value** is **absent**. The string `SUPABASE_SERVICE_ROLE_KEY` is **absent**. Only `checkout.js.razorpay` (the public SDK URL) and the anon key appear, both by design.

None of the four variables are `VITE_`-prefixed, so Vite cannot inline them. This is correct.

**Signature values are never logged.** The failure audit records only the error *code* (`razorpay_payment_verification_failed` + `{ code }`), with the comment *"Only the code is recorded - never the signature, which is proof material."* The gateway client also refuses to surface raw transport errors because the request URL embeds the key id (`reason: 'gateway_unreachable'`).

### 4.3 Why the Razorpay path cannot be exercised here

All three secrets are **empty** and `RAZORPAY_ENABLED=false`. Any Razorpay call returns `503 RAZORPAY_NOT_CONFIGURED` before any network call. Therefore:

> **NOT VERIFIED AGAINST RAZORPAY GATEWAY.** No order was created, no payment was captured, no webhook was delivered to a live Razorpay account. All Razorpay behaviour in this report is established from source code plus a test suite that substitutes a fake gateway client.

Corroborating evidence that it has never run in production: **`payment_events` and `webhook_events` both contain 0 rows** (VERIFIED AGAINST LIVE DB). Every payment in the live database has `gateway='manual'`.

---

# 5. Razorpay Order Creation

**Endpoint:** `POST /api/seeker/bookings/:id/razorpay/order`
**Handler:** `server.ts:2518-2575` → `runCreateRazorpayOrder()` (`razorpayService.ts:425`)

| Check | Implementation | Result |
|---|---|---|
| Authentication | `requireAuth` | 401 without a session |
| Role | `requireRole('seeker')` | 403 otherwise |
| Rate limit | `expensiveRouteLimiter` (after auth, so per-user) | Yes |
| Supabase admin available | `getSupabaseAdmin()`, else `503` | Fails closed |
| Booking exists | `getBooking()` → `404 BOOKING_NOT_FOUND` | Existence checked **before** ownership, so a bogus id is indistinguishable from someone else's booking |
| Ownership | `booking.seeker_id !== callerId` → `403` | Yes |
| Payability | `isPayableBookingStatus()` → `409` | `PAYMENT_PENDING`, `PENDING_VERIFICATION` only |
| Session not started | `start_time <= now` → `409 SLOT_ALREADY_STARTED` | Yes |
| Hold validity | `assertHoldStillValid()` → `409 HOLD_EXPIRED` | Accepts `ACTIVE` **or** `CONVERTED`; rejects elapsed `expires_at` |
| Amount derivation | `toPaise(booking.amount_inr)` | **Database only** |
| Currency | `RAZORPAY_CURRENCY = 'INR'`, a compile-time constant | Not client-influenced |
| Positive amount | `isPositiveAmount()` → `409 AMOUNT_UNAVAILABLE` | Guards a ₹0 booking |

### Amount source: **B — DATABASE-AUTHORITATIVE**

The request body is **never read** on this route. `booking.amount_inr` is loaded from the database and converted with `Math.round(amountInr * 100)`. No code path lets a browser influence the order amount. **Not CRITICAL.**

### Duplicate and retry handling

| Situation | Behaviour | Verdict |
|---|---|---|
| No existing payment row | `attachGatewayOrder()` — a plain `INSERT` | Correct |
| Manual proof already on the booking | `409 PAYMENT_ALREADY_IN_PROGRESS` — the gateway will not race the admin queue | Correct |
| Existing Razorpay order in flight | **Reused**, `alreadyCreated: true`, HTTP `200` not `201` | Idempotent — a double-tap cannot mint two orders |
| Existing payment `VERIFIED` | `409 PAYMENT_ALREADY_COMPLETED` | Correct |
| Existing Razorpay `FAILED`, `refund_status IS NULL` | **Re-armed in place** via `rearmFailedGatewayPayment()` | Correct — see §8 |
| Existing Razorpay `FAILED` **with** `refund_status='PENDING'` | Refused, `409` | Correct — never erase a refund-owed marker |
| Unique violation on insert (`23505`) | `409`; the orphaned Razorpay order is left to expire | Deliberately *not* resolved by overwrite, so a concurrent manual proof is never destroyed |

`attachGatewayOrder` is intentionally **not** an upsert. `payments` is `UNIQUE(booking_id)`, so an upsert would silently overwrite a manual proof, its UTR and its admin review state. Data loss on the manual flow is not an acceptable outcome of a race.

### Persistence and logging

- `razorpay_order_id` persisted on the `payments` row.
- `proof_storage_path` and `transaction_reference` set to `null` (a gateway payment has no screenshot).
- `payment_events` row written with `event_type = 'GATEWAY_ORDER_CREATED'`, or `'GATEWAY_ORDER_RETRIED'` for a re-arm — so the audit trail distinguishes a first attempt from a retry.

**Order expiry is derived, not literal:** `RAZORPAY_ORDER_EXPIRY_SECONDS = APP_CONFIG.HOLD_DURATION_MS / 1000` = **300 s**. An order can never outlive the hold it pays for.

---

# 6. Payment Verification

**Endpoint:** `POST /api/seeker/bookings/:id/razorpay/verify`
**Handler:** `server.ts:2588-2667` → `runVerifyRazorpayPayment()` (`razorpayService.ts:801`)

Validation order (cheap and unambiguous first):

1. `assertRazorpayUsable()` → 503 if disabled/unconfigured
2. All three of order id / payment id / signature non-empty → `400`
3. Booking exists → `404`; ownership → `403`
4. Payment exists → `404`; `payment.gateway === 'razorpay'` → `409`
5. **`payment.razorpay_order_id === orderId`** → `409 RAZORPAY_ORDER_MISMATCH`
6. **HMAC verified against the key secret** → `400 RAZORPAY_SIGNATURE_INVALID`
7. Best-effort gateway cross-check → `409 RAZORPAY_AMOUNT_MISMATCH` / `409 PAYMENT_NOT_CAPTURED`

**Step 5 is the anti-replay control:** *"This is what stops a signature harvested from a cheap booking being replayed onto an expensive one."* The order claimed must be the order actually stored for this booking.

**Step 6 is mandatory and occurs before any write.** A browser saying "the payment succeeded" is not evidence that money moved.

**Step 7 is best-effort by design** — the signature already proved the payment id belongs to the order, so a gateway hiccup must not fail an otherwise-valid payment. When the call *does* succeed, the amount is compared against the server-derived paise value, never the client's.

### Browser-verify vs webhook race

Both converge on `applyCapturedPayment()` → `markPaymentCaptured()`, a conditional update scoped to `.eq('status','PAYMENT_PROCESSING')`. Only one caller wins, and only the winner is told `mentorNotified: true`.

| Race | Outcome |
|---|---|
| Verify wins, webhook later | Webhook's update matches 0 rows → `markPaymentAlreadyCaptured()` fills only the missing gateway id, or returns `captured_duplicate`. Mentor notified **once**. |
| Webhook wins, verify later | Verify's update matches 0 rows; returns `duplicate: true`, `mentorNotified: false`. Verify still returns **HTTP 200 success**. |
| Both simultaneously | Row-level locking serialises them; one wins, one sees 0 rows. |
| Valid signature replayed onto a different booking | Blocked at step 5. |

**Verified by test:** *"reaches the same end state when the webhook arrives before the browser"*, *"notifies the mentor exactly once across repeated verifications"*, *"does not transition on a signature that does not verify"*.

---

# 7. Webhook Audit

**Endpoint:** `POST /api/webhooks/razorpay` (`server.ts:2678-2747`)
**Auth:** none — authorised **solely** by HMAC signature. Correct; the caller is Razorpay, not a signed-in user.

### 7.1 Raw body handling — correct

`express.json()` at `server.ts:1369` installs a `verify` hook that captures the **raw Buffer** into `req.rawBody`. The webhook route reads `req.rawBody?.toString('utf8')` and **never** `req.body`. Using the parsed object would silently fail the HMAC, because Razorpay signs the bytes it sent, not the semantic value inside them. An empty body is rejected with `400 RAZORPAY_WEBHOOK_EMPTY` **before** verification.

### 7.2 Signature verification

`verifyWebhookSignature()` computes `HMAC-SHA256(webhookSecret, rawBody)` and compares with `timingSafeEqual`. Length mismatch short-circuits first. The signature comes from `x-razorpay-signature` (case-insensitive).

**Verified by test against the real Express route** (`tests/razorpay_signature.test.ts`): correctly signed → accepted; body re-serialised after signing → rejected; no signature header → rejected; foreign secret → rejected *and nothing written*; empty body → rejected.

### 7.3 Idempotency — the most carefully built part

`webhook_events` has `UNIQUE (gateway, event_id)` (`phase25:151`). `claimWebhookEvent()` returns three distinct outcomes:

| Outcome | Condition | Meaning |
|---|---|---|
| `new` | INSERT succeeded | First delivery; process it |
| `duplicate` | `23505` and existing row has `processed = true` | Already applied; acknowledge and skip |
| `resume` | `23505` and `processed = false` | A previous attempt failed part-way — **re-apply** |

The `resume` case is the subtle one. The code explicitly rejects collapsing it into `duplicate`: *"Collapsing these two cases would silently discard a real captured payment."*

Event id prefers the `x-razorpay-event-id` header, else falls back to a deterministic composite `"{eventType}:{paymentId|refundId|orderId}"`, because the header is not present on every delivery.

There are **two independent** idempotency layers, and this is the key design property:
1. **Event idempotency** — the same delivery twice is applied once.
2. **Business idempotency** — two *different* event ids describing the *same* capture are still applied once, because every business write is a conditional update. This is the layer that protects money if Razorpay ever re-signs a replay.

### 7.4 Scenario matrix

| Scenario | Exact outcome | Verdict |
|---|---|---|
| **Duplicate webhook** (same event id) | `duplicate` → `200 { handled:'duplicate', duplicate:true }`; no state change, no notification | Correct |
| **Same capture, different event id** | First wins the conditional update; second matches 0 rows → `captured_duplicate`. One notification. | Correct — **the property that matters** |
| **Concurrent webhooks** | INSERT races; one gets `23505` → `duplicate`/`resume`; plus conditional updates | Correct |
| **Out-of-order: `payment.failed` after `payment.captured`** | `handleFailed` scopes to `in('status',['PAYMENT_PROCESSING','PAYMENT_PENDING'])`; a `VERIFIED` row matches nothing | Correct — a late failure cannot undo a capture. *Tested: "never lets a late failure undo a captured payment".* |
| **Out-of-order: `refund.created` for an uncaptured payment** | `recordRefund('PENDING')` writes bookkeeping only and **never** advances status. Only `REFUNDED`/`FAILED` are scoped to `.eq('status','VERIFIED')` | Correct — a refund event cannot confirm a payment no money was received for |
| **Webhook before browser verify** | Webhook wins; the later verify returns `200` with `duplicate: true` | Correct |
| **Webhook after browser verify** | `markPaymentAlreadyCaptured` fills the gap, or `captured_duplicate` | Correct |
| **Webhook after booking cancelled** | `refund_pending` — booking NOT advanced, mentor NOT notified | Correct *in outcome*; see **P0-1**, **P1-2** |
| **Webhook after hold expired** | Capture lands in `refund_pending` | Correct *in outcome*; manual recovery required |
| **Webhook for an unknown order** | `handled:'unmatched'`, **nothing written**, `200` | **P0-1** |
| **Webhook with an unattributable capture** | `handled:'unattributable'`, nothing applied | Correct — `payment.captured` always carries a payment id |
| **Webhook amount ≠ booking amount** | `PAYMENT_AMOUNT_MISMATCH` recorded, `handled:'amount_mismatch'`, **refused** | Correct |
| **Unknown event type** | `handled:'ignored'`, marked processed, `200` | Correct |
| **Processing throws** | Route returns 5xx, event left `processed=false` → Razorpay retries → `resume` | Correct — no payment loss |

### 7.5 P0-1 — The unmatched-capture money-loss path

```ts
const payment = await resolveWebhookPayment(input.store, event);
if (!payment) {
  // Not one of ours (or the booking was purged). Acknowledged so Razorpay
  // stops retrying, but nothing is written.
  return { handled: 'unmatched', bookingId: null, paymentId: null, mentorNotified: false };
}
```

The route then returns `200 { success: true, handled: 'unmatched', duplicate: false }`. Razorpay treats `200` as delivered and stops retrying.

**The money is captured. Nothing is recorded anywhere.** No `payment_events` row, no retained payload, no alert, no notification, and no reconciliation job that scans for captures with no local record.

`resolveWebhookPayment` looks up by `razorpay_payment_id`, then `razorpay_order_id`. It returns `null` when the row is absent — **or when a retry re-armed the row and cleared the old ids**, which `rearmFailedGatewayPayment` deliberately does ("so a late webhook or a stale browser verify for the old attempt cannot be attributed to the new attempt"). That is correct for the *new* attempt, but the *old* capture becomes unroutable and is silently dropped.

Reachable via: an attempt that failed server-side while the gateway actually captured; a re-arm whose old capture lands afterwards; a booking purged between capture and delivery; or a first-ever capture racing a payment row the server never wrote.

**Impact:** direct financial loss with no detection path. **Required action:** persist unmatched captures, return a non-2xx so Razorpay retries, and add a reconciliation query. Must be fixed before Razorpay receives real traffic.

---

# 8. Payment State Machine

**Authoritative constraint** (`phase25:101-111`): `payments_status_check` permits 8 values — `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`, `PAYMENT_PENDING`, `PAYMENT_PROCESSING`, `FAILED`, `REFUNDED`, `REFUND_FAILED`.

```text
                  MANUAL                      RAZORPAY
            (no payments row)
                  │
      submit proof│          create order
                  ▼          ▼
      PENDING_VERIFICATION  PAYMENT_PROCESSING
              │                   │
      ┌───────┴───────┐     ┌─────┴─────┬──────────────┐
      ▼               ▼     ▼           ▼              ▼
  VERIFIED        REJECTED VERIFIED    FAILED    FAILED + refund_status
      │               │     │           │         ='PENDING' (dead booking)
      │               │     │           │                │
      │               │     │           │       (no booking change)
      ▼               ▼     ▼           │                │
 bookings:       bookings: bookings:    ▼                ▼
MENTOR_PENDING   REJECTED MENTOR_PENDING  │           REFUNDED
                                   retry │           REFUND_FAILED
                                   re-arm          (from VERIFIED only)
                                   (same row)
```

### Transition validity table

| From | To | Writer | Validity |
|---|---|---|---|
| *(none)* | `PENDING_VERIFICATION` | manual proof POST | **VALID** |
| *(none)* | `PAYMENT_PROCESSING` | `attachGatewayOrder` INSERT | **VALID** |
| `PENDING_VERIFICATION` | `VERIFIED` | `review_payment(approve=true)` | **VALID** |
| `PENDING_VERIFICATION` | `REJECTED` | `review_payment(approve=false)` | **VALID** |
| `PAYMENT_PENDING` | `PENDING_VERIFICATION` | `review_payment(p_approve := true)` | **VALID** — the RPC allows both source states |
| `PAYMENT_PROCESSING` | `VERIFIED` | `markPaymentCaptured` | **VALID** |
| `PAYMENT_PROCESSING` | `FAILED` | `markPaymentFailed` | **VALID** |
| `PAYMENT_PENDING` | `FAILED` | `markPaymentFailed` | **VALID** (scoped to both in-flight states) |
| `FAILED` | `PAYMENT_PROCESSING` | `rearmFailedGatewayPayment` | **VALID** — retry reuses the row |
| `FAILED` + `refund_status=PENDING` | `PAYMENT_PROCESSING` | — | **INVALID — correctly refused** |
| `PAYMENT_PROCESSING` | `PENDING_VERIFICATION` | — | **INVALID** — no code path; gateway captures skip human review |
| `VERIFIED` | anything else | — | **INVALID** — terminal, except a scoped refund |
| `REJECTED` | anything | — | **INVALID** — terminal; seeker cannot retry (§3) |
| `VERIFIED` | `REFUNDED` | `recordRefund('REFUNDED')` | **VALID**, scoped to `.eq('status','VERIFIED')` |
| `VERIFIED` | `REFUND_FAILED` | `recordRefund('FAILED')` | **VALID**, same scope |
| `VERIFIED` | refund `PENDING` | `recordRefund('PENDING')` | **Bookkeeping only** — status deliberately unchanged |
| `PAYMENT_PROCESSING` | `REFUNDED` | — | **INVALID — correctly prevented** ("a refund must NEVER advance the payment's own status into a confirmed one") |

**`REFUND_REQUESTED` and `REFUND_PROCESSED` do not exist** in this schema. The real values are `refund_status IN ('PENDING','REFUNDED','FAILED')` — a *separate column* from `payments.status`. Conflating them is a documentation error to avoid.

---

# 9. Booking State Machine Interaction

`bookings_status_check` (`phase25:82-92`) permits 8 values. **7 are reachable** — `PAYMENT_PROCESSING` is permitted but written by no current code path (`razorpayService.ts:38-43` states the rule: the booking stays `PAYMENT_PENDING` until capture, because `expire_stale_holds()` only cancels `PAYMENT_PENDING`).

| Combination | Reachable? | Behaviour | Dangerous? |
|---|---|---|---|
| Payment pending + booking `PAYMENT_PENDING` | Yes — the normal start | Both created in one transaction | No |
| Payment processing + booking `PAYMENT_PENDING` | Yes — Razorpay in flight | Intentional; keeps the booking cancellable by the cron | No |
| Payment verified + booking `PENDING_VERIFICATION` | **No** | Atomic inside the RPC; a partial write cannot persist | No |
| Payment verified + booking `MENTOR_PENDING` | Yes | Both paths converge here | No |
| Payment failed + booking `PAYMENT_PENDING` | Yes | Booking stays payable; seeker may retry | No |
| Payment failed + booking `CANCELLED` | Yes | Hold expiry after a failed attempt | No |
| Payment captured + booking `CANCELLED` | Yes | → `refund_pending`; booking untouched, mentor not notified | **Yes — P1-2** |
| Payment captured + booking `REJECTED` | Yes | Same dead-end logic; `isBookingPaymentDeadEnd` covers both | **Yes — P1-2** |
| Payment captured + booking `MENTOR_PENDING`/`CONFIRMED`/`COMPLETED` | Yes | **Treated as a duplicate capture**, not a dead end. Deliberately excluded from `isBookingPaymentDeadEnd` | No — correct |
| Refund pending + booking `CANCELLED` | Yes | Terminal; recoverable only by an operator | **Yes — P1-2** |

**The exclusion from the dead-end set is a genuinely good decision.** `MENTOR_PENDING`/`CONFIRMED`/`COMPLETED` are *not* dead ends: a capture arriving there is a duplicate of one already applied, and routing it to `refund_pending` would refund a legitimately paid session. `isBookingPaymentDeadEnd` is deliberately narrow — only `CANCELLED`, `REJECTED`, or a missing row.

**Booking-state writers (all `SECURITY DEFINER` or service-role only):**

| Transition | Writer |
|---|---|
| → `PAYMENT_PENDING` | `create_booking_with_hold()` |
| `PAYMENT_PENDING` → `PENDING_VERIFICATION` | proof POST (conditional `.eq`) |
| `PENDING_VERIFICATION`/`PAYMENT_PENDING` → `MENTOR_PENDING` | `review_payment(true)` **or** `markBookingMentorPending` |
| `PENDING_VERIFICATION` → `REJECTED` | `review_payment(false)` |
| `PAYMENT_PENDING` → `CANCELLED` | `expire_stale_holds()` cron, or seeker cancel |
| `MENTOR_PENDING` → `CONFIRMED` | mentor confirm (HTTPS link required) |
| `CONFIRMED` → `COMPLETED` | completion cron, complete endpoint, read-reconcile |

`authenticated` may `UPDATE` only `cancellation_reason` and `updated_at` on `bookings` (`phase24` §8 REVOKE). A browser physically cannot forge a payment or session state.

---

# 10. Hold Expiry

**Duration: 5 minutes. VERIFIED from three independent sources that agree:**
- `APP_CONFIG.HOLD_DURATION_MS = 5 * 60 * 1000` (`src/config/app.ts:5`)
- `platform_config.hold_duration_minutes = 5` (VERIFIED AGAINST LIVE DB)
- `public.hold_duration_interval()` reads that column; `create_booking_with_hold` and `acquire_slot_hold` call it instead of carrying a literal (`phase26`)

There is **no `15 minutes` literal** left in any hold function — the phase26 migration's own verification query greps for exactly that.

### The chain

```text
create_booking_with_hold()  →  slot_holds(expires_at = now() + 5 min, ACTIVE)
        + booking(PAYMENT_PENDING, hold_id)  in ONE transaction
        ↓
seeker pays (5 min window, countdown in the UI)
        ↓
expire_stale_holds()  [pg_cron, every minute, service_role only]
   1. ACTIVE holds with expires_at <= now()  → EXPIRED
   2. bookings at PAYMENT_PENDING whose hold is EXPIRED → CANCELLED
   3. ACTIVE holds whose booking is no longer PAYMENT_PENDING → RELEASED
        ↓
slot_holds.status is no longer ACTIVE
        ↓
the EXCLUDE no_overlapping_active_holds constraint no longer applies
        ↓
the mentor's slot becomes bookable again
```

Step 3 is what frees the slot once a proof is submitted: the booking has left `PAYMENT_PENDING`, so its hold is released rather than expired.

### The timing questions

| Question | Exact answer | Verdict |
|---|---|---|
| Capture at the same instant as expiry | `markPaymentCaptured` and the cron write different tables. If the cron wins, the booking is `CANCELLED` and the capture lands in `refund_pending`. If the capture wins, `MENTOR_PENDING` is set and the cron no longer matches (it only targets `PAYMENT_PENDING`). Either way **no double-booking** — the `EXCLUDE` constraint is the final arbiter. | Safe, but the loser needs a human |
| Webhook arrives after hold expiry | Booking already `CANCELLED` → `refund_pending`. Payment records the gateway payment id + `failure_reason`, `refund_status='PENDING'`, `captured_at` deliberately unset. Event `CAPTURE_AFTER_BOOKING_CLOSED` written. | Correct; **manual recovery required** |
| Browser verify after hold expiry | `runVerifyRazorpayPayment` does **not** re-check the hold. It verifies, then `applyCapturedPayment` → `isBookingPaymentDeadEnd('CANCELLED')` → `409 BOOKING_CLOSED_REFUND_PENDING` with *"your payment is being refunded"*. | Correct — the seeker is told honestly |
| Payment succeeds after cancellation | As above: `refund_pending`. **Never** revives the booking. | Correct |
| Payment fails after expiry | `markPaymentFailed` scoped to `in('status',['PAYMENT_PROCESSING','PAYMENT_PENDING'])`; the booking is `CANCELLED` so no booking write is attempted. | Correct |
| Razorpay order creation after expiry | `assertHoldStillValid` → `409 HOLD_EXPIRED` with *"Please book the slot again."* | Correct |

**The design intent is coherent:** holding the booking at `PAYMENT_PENDING` (not `PAYMENT_PROCESSING`) is precisely what lets the cron cancel an unpaid Razorpay booking at 5 minutes. The trade-off is that a capture landing after that cancellation requires manual recovery — the direct consequence of P1-2.

---

# 11. Retry Behaviour

### Manual payment retry

| Scenario | Result |
|---|---|
| Proof rejected, seeker resubmits | **Impossible on the same booking.** The booking is `REJECTED` (terminal) and not payable. The seeker must create a **new booking**; the rejection notification says exactly this. |
| Booking cancelled before submitting proof | `CANCELLED` is not payable → `409 BOOKING_NOT_PAYABLE`. New booking required. |
| Fresh booking | New hold, new payment row, full 5-minute window. |
| Same proof resubmitted while `PENDING_VERIFICATION` | Idempotent upsert. **No** duplicate admin notification (`isNewReviewRequest` is false). |
| Proof resubmitted after a rejection | Not reachable — see above. |

### Razorpay retry

| Scenario | New payment row? | New Razorpay order? | Payment row |
|---|---|---|---|
| Checkout modal closed | No | No | Unchanged (`PAYMENT_PROCESSING`); a later order call **reuses** the same order |
| Payment failed at the gateway | No | **Yes** | `FAILED` → re-armed to `PAYMENT_PROCESSING` |
| Network failure before the response | Possibly orphaned | Yes | See **P2-3** |
| Double click / refresh | No | **No** — the open order is reused, `200` not `201` | Unchanged |
| Stale order id in the browser | No | No | `409 RAZORPAY_ORDER_MISMATCH` |
| Old payment id / late webhook after a re-arm | No | No | Unroutable → **P0-1** |
| Webhook delayed past the hold | No | No | `refund_pending` |

**`rearmFailedGatewayPayment` is the correct retry design.** Because `payments` is `UNIQUE(booking_id)`, a retry must reuse the row. The re-arm is scoped to `.eq('status','FAILED').eq('gateway','razorpay')`, so it can never hijack a manual payment or an in-flight attempt, and it **clears** the previous ids rather than mixing two attempts into one row. The old attempt survives in `payment_events`.

### Can a seeker be charged twice?

**No path was found.** One `payments` row per booking; order creation is idempotent; verification is scoped to the stored order id; a re-arm clears the old ids; and the capture is a conditional single-row update. The residual risk is not double-charging but **a wrong amount being recorded as valid** — and that is covered, because the amount is re-checked against the gateway on both the verify and webhook paths.

---

# 12. Refund Audit

**Verdict: REFUNDS ARE TRACKED BUT NEVER ISSUED. The most significant functional gap in the payment system.**

| Capability | Status | Evidence |
|---|---|---|
| Refund initiation | **MISSING** | No endpoint, no service function, no UI control |
| Automatic refund | **MISSING** | No code path calls a refund |
| Admin-initiated refund | **MISSING** | `AdminPaymentsPage` offers only Verify and Reject |
| Razorpay refund API called | **NO** | `RazorpayGatewayClient` implements exactly two methods: `createOrder`, `fetchPayment` |
| Refund *webhooks* handled | **YES** | `refund.created` / `refund.processed` / `refund.failed` → `recordRefund()` |
| Refund *state* persisted | **YES** | `refund_id` + `refund_status`, `CHECK IN ('PENDING','FAILED','REFUNDED')` |

### The dead-end recovery path

`recoverCaptureAgainstDeadBooking()` runs when a capture is real but the booking is `CANCELLED`, `REJECTED`, or gone. It:

1. Calls `markPaymentRefundPending()` — conditional on `in('status',['PAYMENT_PROCESSING','PAYMENT_PENDING'])`, so it can never overwrite a confirmed or already-refunded payment.
2. Sets `status='FAILED'`, `refund_status='PENDING'`, records `razorpay_payment_id` (so the money is traceable), truncates `failure_reason` to 500 chars.
3. Deliberately leaves `captured_at` **unset** — *"this payment was never confirmed for a booking"*. The true capture time lives on the `payment_events` row.
4. Writes a `CAPTURE_AFTER_BOOKING_CLOSED` event.
5. Browser verify returns `409 BOOKING_CLOSED_REFUND_PENDING` — the seeker is told their payment is being refunded. The webhook returns `handled:'refund_pending'` and notifies nobody.

This is an honest, recoverable state rather than a silent success. **But nothing completes it.** No cron, no queue, no dashboard, no alert. The only way to resolve it is for an operator to open the Razorpay dashboard manually and issue the refund; the resulting `refund.processed` webhook then records the outcome.

### P1-2 — Why this is P1 and not P3

Money is captured, the platform cannot return it, and nothing surfaces the obligation. `refund_status='PENDING'` is a *promise*, not a mechanism. The seeker is told *"your payment is being refunded"* and then waits indefinitely, and the obligation is invisible in the admin UI (§17) and unqueried by any job — so an operator has no in-product list of what owes money.

### Refund-state semantics (do not conflate)

| Concept | Where | Values |
|---|---|---|
| Payment lifecycle | `payments.status` | `VERIFIED`, `FAILED`, `REFUNDED`, `REFUND_FAILED` |
| Refund lifecycle | `payments.refund_status` (separate column) | `PENDING`, `REFUNDED`, `FAILED` |

`recordRefund` is careful in two ways worth preserving: a **pending** refund writes bookkeeping only and never advances `payments.status` (*"writing VERIFIED here would confirm a payment no money was ever received for"*), and `REFUNDED`/`REFUND_FAILED` are scoped to `.eq('status','VERIFIED')` so only genuinely captured money can be moved to a refunded state.

---

# 13. Storage Audit

| Bucket | In migrations? | Live? | Public | Size cap | MIME (bucket) | MIME (app) |
|---|---|---|---|---|---|---|
| `payment-proofs` | **YES** `phase4:546` | **VERIFIED** (seeker folders present) | No | 5 MB | jpeg/png/webp/**pdf** | jpeg/png/webp only |
| `segment-hero` | **YES** `phase7b:8` | **NOT VERIFIED AGAINST LIVE DATABASE** | Yes | 5 MB | png/jpeg/webp/gif | png/jpeg/webp/gif |
| `payment-qr` | **MISSING** | **VERIFIED** (`platform/` present) | No | 2 MB (app) | png/jpeg/webp (app) | png/jpeg/webp |

### P1-1 — `payment-qr` exists live but is in no migration

`PAYMENT_QR_BUCKET` is referenced by the `/api/admin/platform-config/qr-upload-url`, `PATCH .../qr` and `DELETE .../qr` routes, and defined in `src/lib/paymentProof.ts:49`. A search of all 38 migrations for `payment-qr` returns **no bucket-creation statement**.

The live project *does* have it — confirmed by listing objects, which returns the `platform` folder holding the configured QR. It was created by hand through the Supabase dashboard.

**Consequence:** a fresh or rebuilt database from `supabase/migrations/` alone has no `payment-qr` bucket and the admin QR upload fails. The live `platform_config.qr_image_storage_path` points into a bucket a migration-only deployment would not have. The migration set is therefore an incomplete description of the payment system.

### Policies on `payment-proofs`

| Policy | Command | Role | Condition |
|---|---|---|---|
| Seekers can upload own payment proofs | INSERT | `authenticated` | `bucket_id` + `foldername(name)[1] = auth.uid()` |
| Seekers can view own payment proofs | SELECT | `authenticated` | own folder **or** `is_admin()` |
| Admins have full access to payment proofs | **ALL** | `authenticated` | `is_admin()` |

**There is no seeker DELETE policy** — a seeker can upload and read but not remove their own proof. The proof is retained on rejection deliberately, and `scripts/purge-e2e.mjs` exists for test-data cleanup.

### File validation layers

| Layer | Check | Where |
|---|---|---|
| Browser | `validateProofFile` / `validateQrFile` | `paymentProof.ts` |
| Server | Same pure functions re-run on submitted metadata | `server.ts:2233` |
| Storage | Bucket `allowed_mime_types` + `file_size_limit` | bucket definition |
| Server, post-upload | Re-reads the **real** stored size from `metadata.size` and **deletes** an oversized object | `server.ts:2322-2326` |

The fourth layer is notable: it trusts storage's reported size rather than the client's claim, and cleans up rather than leaving an orphan.

---

# 14. RLS / Security Audit

| Assertion | Holds? | Evidence |
|---|---|---|
| A seeker cannot change payment status | **YES** | `payments` UPDATE/DELETE are admin-only; all seeker writes go through service-role handlers |
| A seeker cannot mark a payment `VERIFIED` | **YES** | Only `review_payment` (`SECURITY DEFINER`, admin-checked) and the Razorpay service (service-role) do |
| A seeker cannot modify gateway ids | **YES** | `razorpay_order_id` etc. are written only by the service-role Razorpay store |
| A seeker cannot inject refund status | **YES** | Same; no client-writable path |
| A seeker cannot impersonate an admin | **YES** | `review_payment` re-verifies `has_role(p_admin_id,'admin')` **and** `auth.uid() = p_admin_id` when a session exists |
| The webhook cannot bypass signature verification | **YES** | Unauthenticated, but `assertRazorpayUsable` + `verifyWebhookSignature` on the raw body run before any DB access. Tested with a foreign secret → rejected, nothing written. |
| Admin payment actions are actually admin-only | **YES** | `requireAuth` + `requireAdmin` on all three admin payment routes |
| Service role is not exposed | **YES (VERIFIED)** | Key value absent from the client bundle; no `VITE_`-prefixed service-role var |
| `payment_events` readable by a seeker | **Scoped** | Own payments only, via a subquery on `payments.seeker_id` |
| `webhook_events` readable by a browser | **NO** | Admin-only `FOR ALL`; no client read path |
| `platform_config` readable/writable by a client | **PROBLEM** | **RLS is not enabled** on the table. Reads are mediated by the server routes, but any role holding a grant can hit it directly through PostgREST. |

**P2-4 — `platform_config` has no RLS.** It holds the UPI id, account name and QR path. Those are deliberately public (the seeker must read them), so the *confidentiality* impact is low, but there is no `USING` clause protecting it and no policy preventing a client-side write if a grant is ever issued. `phase19_security_lockdown` set all buckets to private but never touched this table.

**P2-3 — an orphan Razorpay order is possible.** If order creation succeeds at the gateway but the response never reaches the server, a Razorpay order exists with no `payments` row. The seeker's retry creates a *second* order, because there is nothing locally to detect the first. Both expire after 300 s uncharged, so the direct risk is nil, but it is a latent reconciliation gap and contributes to P0-1's class of problem.

---

# 15. Money Integrity Audit

| # | Property | Verdict | Evidence |
|---|---|---|---|
| 1 | Amount source | **DATABASE-AUTHORITATIVE** | `bookings.amount_inr`, snapshotted at booking creation from the gig price |
| 2 | Currency | **FIXED CONSTANT** | `RAZORPAY_CURRENCY = 'INR'`, an `as const` literal. Not configurable, not client-supplied. Live `platform_config.currency` is also `INR`. |
| 3 | Decimal → paise | **Correct** | `toPaise = Math.round(amountInr * 100)`. `Math.round` (not `floor`) avoids a systematic 1-paise-undercharge on non-integer rupees. |
| 4 | Floating-point risk | **Mitigated** | The column is `INTEGER` with `CHECK (amount_inr >= 0)`, so no float is persisted. The only float arithmetic is one multiply-and-round, compared against the gateway's integer paise. |
| 5 | Integer storage | **YES** | `amount_inr INTEGER` on both `bookings` and `payments` |
| 6 | Browser manipulation | **NOT POSSIBLE** | No amount parameter is read on the order or verify routes. Verified by reading both handlers in full. |
| 7 | Order amount mismatch | **Refused** | Server sends `toPaise(booking.amount_inr)`; the gateway charges that. |
| 8 | Payment amount mismatch (verify) | **Refused + audited** | `409 RAZORPAY_AMOUNT_MISMATCH` + a `PAYMENT_AMOUNT_MISMATCH` event |
| 9 | Payment amount mismatch (webhook) | **Refused + audited** | `handled:'amount_mismatch'` + the same event type |
| 10 | Duplicate capture | **Cannot double-apply** | Conditional update scoped to `PAYMENT_PROCESSING`; the loser gets `captured_duplicate` |
| 11 | Double booking | **Impossible** | `EXCLUDE USING gist` on `mentor_id` + `tstzrange` for all non-`CANCELLED`/`REJECTED` bookings |
| 12 | Partial payment | **Not representable** | Single-amount orders; `payment_capture: 1` at creation |
| 13 | Overpayment | **Refused** | The gateway figure must equal the booking figure exactly |
| 14 | Underpayment | **Refused** | Same check; a non-captured payment is rejected with `PAYMENT_NOT_CAPTURED` |

### Can a user pay ₹X while the system records ₹Y?

**NO PATH WAS FOUND.** This is the single most important negative finding in the audit.

- **Manual:** `payments.amount_inr` is a server-side copy of `bookings.amount_inr` (`server.ts:2338`). The client cannot influence either.
- **Razorpay (browser):** signature verified first, then the amount compared against `toPaise(payment.amount_inr)`.
- **Razorpay (webhook):** `event.amount !== toPaise(payment.amount_inr)` is refused and recorded.

One theoretical gap worth naming: the verify path's gateway cross-check is **best-effort** — if `fetchPayment` fails, verification proceeds on the signature alone. This is safe because the HMAC proves the payment id belongs to the order created from the server amount, and Razorpay does not permit partial capture on an auto-captured order. A deliberate availability-over-verification trade-off, documented in the code.

**`payment_capture: 1`** is set at order creation, so Razorpay captures automatically. That is precisely why the webhook matters so much: money can move without the browser ever calling verify.

---

# 16. Concurrency Audit

| Race | Protection | Test coverage |
|---|---|---|
| Two seekers book the same slot | `EXCLUDE no_overlapping_mentor_bookings` + `no_overlapping_active_holds`; `create_booking_with_hold` takes a mentor row lock | `booking_concurrency.test.ts` |
| Two payment clicks (Razorpay order) | In-flight order is **reused**, `200` not `201`; `attachGatewayOrder` is a plain INSERT so a race surfaces as `23505` → `409` | *"returns the SAME order when the seeker retries while one is in flight"* |
| Browser verify + webhook simultaneously | Both funnel through one conditional `PAYMENT_PROCESSING → VERIFIED` update | *"reaches the same end state when the webhook arrives before the browser"* |
| Two webhook deliveries | `UNIQUE(gateway,event_id)` + conditional business updates | 3 distinct idempotency tests |
| Same capture, different event id | Business-level conditional update (the second layer) | Documented as a distinct protected property |
| Two admins approving one manual payment | `review_payment` takes `FOR UPDATE` on both rows, then raises `PAYMENT_ALREADY_PROCESSED` on the second call | **MISSING TEST** |
| Payment retry + late webhook | Re-arm clears the old ids, so a stale delivery cannot be attributed to the new attempt | Covered by the state-machine suite |
| Payment failure + retry | `markPaymentFailed` scoped to in-flight states; the re-arm scoped to `FAILED` | *"keeps the booking in PAYMENT_PENDING and accepts a new attempt"* |
| Hold expiry + payment capture | The cron targets only `PAYMENT_PENDING`; a capture that wins sets `MENTOR_PENDING` and is then untouchable | Capture side covered; **exact-simultaneous cron side MISSING** |

**The concurrency design is sound.** Its unifying principle: *every* business write is a conditional update scoped to the status it may move from, and the caller is told whether it won. That single rule makes duplicate notification impossible without a separate de-duplication table.

---

# 17. Notification Audit

| Event | Recipient | Writer | Idempotency |
|---|---|---|---|
| Payment proof submitted | Seeker | `insertPaymentNotifications` | Gated on `isNewReviewRequest` — no repeat spam |
| Payment proof submitted | **All active admins** | `resolveActiveAdminIds(admin)` | Same gate |
| Payment approved | Seeker | `notifyPaymentReviewed` | One call per successful `review_payment` |
| Payment approved | Mentor | `NEW_BOOKING` **inside the RPC** | Guaranteed once by `FOR UPDATE` + raise-on-replay |
| Payment rejected | Seeker | `notifyPaymentReviewed` | One call |
| Payment captured (Razorpay) | Mentor | `notifyMentorOfPaymentCaptured` | **Only the winner of the conditional booking update** |

**Is the mentor notified exactly once for a successful payment? YES — by two mechanisms, both correct:**

- *Manual:* the notification is written **inside** `review_payment`, after `SELECT ... FOR UPDATE` on payment and booking. A second call raises `PAYMENT_ALREADY_PROCESSED` before reaching the insert. Recipients are resolved from the rows, not from a parameter, so a notification cannot be misdirected.
- *Razorpay:* `notifyMentorOfPaymentCaptured` runs **only** when `result.mentorNotified` is true, which happens only for the caller that won `markBookingMentorPending()`. The code states the intent: *"the webhook, the browser verification, and a retried webhook all contend for that single update, and only the winner reaches this function."*

**Admin recipient resolution is correct.** `resolveActiveAdminIds` filters suspended and deactivated admins via `canPerformOperationalActions`, so a suspended admin is not woken by a new payment.

**Delivery is not realtime.** `notifications` is **not** in the `supabase_realtime` publication, so a newly-queued payment reaches an admin's screen only on the next poll. `NotificationContext` polls every 30 s, ungated by tab visibility (unlike every other sync hook). Severity **P3** — a queued payment is not time-critical, but the latency and the permanently-polling background tab are both real.

---

# 18. Realtime Audit

| Table | In `supabase_realtime`? | Subscribed by | Consumer refreshes? |
|---|---|---|---|
| `payments` | **YES** (`phase25`) | `usePaymentSync` (filter `seeker_id=eq.<id>`) | Yes |
| `bookings` | **YES** (`phase17`) | `usePaymentSync`, `useSessionSync` | Yes |
| `payment_events` | **YES** (`phase25`) | **nobody** | No |
| `webhook_events` | **YES** (`phase25`) | **nobody** | No |
| `notifications` | **NO** | — | Polling only |

**Does the seeker UI update automatically after payment?** Partially.

- **Razorpay capture confirmed via webhook while the seeker has the page open:** `payments` and `bookings` are both published *and* both carry `seeker_id`, so `usePaymentSync` receives the change and refetches. This is genuine realtime.
- **Manual approval by an admin:** same path — `payments` and `bookings` both change, both published, both filtered by `seeker_id`. Realtime works.
- **Fallback:** `usePaymentSync` also polls every 60 s (floor 30 s), gated on tab visibility, and revalidates on focus. So a missed realtime event self-heals within a minute.

**`payment_events` and `webhook_events` are published but nobody subscribes.** This is not harmful — they are append-only audit logs and the browser has no reason to watch them — but it is dead publication surface, and it means a seeker cannot see live gateway progress (e.g. "capture received, being verified").

**`REPLICA IDENTITY FULL` is not set** on `payments`, `payment_events`, `webhook_events` or `segment_topics`, so those deliver key-only UPDATE payloads. For the seeker's use case (an UPDATE exists → refetch) that is sufficient.

---

# 19. Admin Payment Audit

`GET /api/admin/payments` → `AdminPaymentsPage`.

### What the admin can see and do

| Capability | Present? |
|---|---|
| List all payments, newest first | **Yes** |
| Pending-payment count | **Yes** |
| Seeker / mentor / gig names resolved from real rows | **Yes** (unresolvable names stay `null`; the UI says so rather than faking) |
| Booking status alongside payment status | **Yes** |
| UTR / transaction reference | **Yes** |
| View the proof screenshot via a **signed URL** | **Yes**, TTL 300 s |
| Approve | **Yes** → `PATCH /approve` |
| Reject with a reason | **Yes** → `PATCH /reject` |
| **Razorpay order / payment ids** | **NO — not returned** |
| **Gateway (`manual` vs `razorpay`)** | **NO — not returned** |
| **`refund_status` / refund-owed flag** | **NO — not returned** |
| **`payment_events` timeline** | **NO — not fetched** |
| Change the amount | **No** (good) |
| Force a status directly | **No** (good) |

### P2-5 — The admin API projects away every gateway field

`GET /api/admin/payments` selects `*` from `payments` but maps an explicit projection that omits `gateway`, `razorpay_order_id`, `razorpay_payment_id`, `refund_status`, `refund_id` and `failure_reason`. The client type declares only `status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED'`.

Consequences if Razorpay is ever enabled:
- A `PAYMENT_PROCESSING` or `FAILED` payment renders with no explanation, and the admin sees a state outside their type union.
- **A payment in `refund_status='PENDING'` — money that is owed back — is completely invisible.** There is no filter for it, no badge, no count, no list.
- There is no way to see *why* a payment failed, or which gateway attempt it belongs to.

This compounds P1-2: the obligation is not only un-actionable in code, it is invisible in the product.

### Can the admin perform dangerous actions?

| Action | Possible? | Why |
|---|---|---|
| Approve an already-paid payment | **No** | `review_payment` requires `payments.status = 'PENDING_VERIFICATION'` |
| Change the amount | **No** | No parameter exists |
| Force a status directly | **No** | No such route; all transitions go through the guarded RPC |
| Approve an expired booking | **YES** | No time check in `review_payment` — see **P2-1** |
| Approve another user's payment | **Yes, by design** | That is the admin's role; it is recorded in `verified_by` and audited |
| Trigger a refund | **No** | No capability exists (**P1-2**) |

**The audit trail on admin decisions is good:** `auditAction(req.auth, 'payment_approved' | 'payment_rejected', …)` records the acting admin, the request id and the reason.

---

# 20. Seeker Payment UI Audit

`SeekerPaymentPage` + `RazorpayCheckoutCard`.

### State coverage

`RazorpayUiState` declares 13 states, and each has authored copy in a `STATE_COPY` map:

`idle`, `loading_config`, `not_enabled`, `config_error`, `creating_order`, `opening_checkout`, `processing`, `verifying`, `success`, `failed`, `expired`, `already_completed`, `unavailable`

Predicates `isProcessingState`, `isRetryableState`, `isTerminalState` and `mapRazorpayErrorCode` drive the button label, disabled state and which affordance is offered. This is a genuinely complete state machine on the client, not a spinner-and-hope implementation.

**Every state is derived from a server response**, not from optimism:
- Payment state is read from `GET /api/seeker/bookings/:id/payment-proof`, not inferred from "the user visited the page".
- Razorpay availability comes from `GET /api/payments/razorpay/config`; the seeker page deliberately shows **no placeholder** payment details when the config call fails, because *"showing a plausible-looking placeholder would let a seeker transfer money to an account that may not exist."*
- Razorpay is preselected **only** when genuinely enabled *and* keyed.
- The two probes (payment state, Razorpay config) are independent by design, so a Razorpay outage degrades to manual rather than breaking the page.
- `expired` is driven by the hold countdown reaching zero, and the server refuses the payment regardless.

### Manual path UX

- UPI id with copy-to-clipboard.
- Drag-and-drop or picker upload, client-side `validateProofFile` before any network call.
- UTR input with `normaliseTransactionReference` validation.
- Live hold countdown (`HoldCountdown`), server-refused on expiry.
- Distinct copy for each payment state rather than a generic error.

### Gaps

| Gap | Severity | Note |
|---|---|---|
| `refund_pending` has no seeker-facing state | **P2-6** | The server returns `409 BOOKING_CLOSED_REFUND_PENDING` and `mapRazorpayErrorCode` maps it, but there is no dedicated "your refund is pending" screen or status in the payment list. A seeker returning to the booking sees a `FAILED` payment with no explanation. |
| Payment instructions empty in production | P3-1 | `payment_instructions` is `null`; the UI renders an empty block |
| No way to see the gateway timeline | INFO | `payment_events` is never fetched by any client |

---

# 21. Test Quality Audit

**Overall: the payment test suite is genuinely good.** This is unusual and worth stating plainly — it is the strongest part of the payment system.

### What I ran

| Command | Result |
|---|---|
| `tsx --test payment_proof + razorpay_signature` | **46 pass, 0 fail** |
| `tsx --test razorpay_state_machine + webhook_idempotency + payment_safety` | **53 pass, 0 fail** |
| `tsx --test razorpay_backend + razorpay_store` | **86 pass, 0 fail** |
| `npx tsc --noEmit` | **Clean** |
| `npm run build` | **Succeeds** (4.76 s; 1,555 kB main chunk, >500 kB warning) |
| `npm test` (full suite) | **Did not complete in the execution window** — see §26 |

**185 payment tests, all passing.**

### Quality assessment

| File | Tests | Imports production code? | Verdict |
|---|---|---|---|
| `razorpay_backend.test.ts` | 58 | Yes — the order + verify runners | **GOOD** |
| `razorpay_state_machine.test.ts` | 18 | Yes — the three runners | **GOOD** |
| `razorpay_store.test.ts` | 28 | Yes — the real Supabase adapter against a fake client; pins exact query shapes, filters, update scopes | **GOOD** |
| `razorpay_signature.test.ts` | 19 | Yes — including a **real Express route** | **GOOD** — strongest file |
| `razorpay_webhook_idempotency.test.ts` | 10 | Yes — `runRazorpayWebhook` | **GOOD** |
| `razorpay_payment_safety.test.ts` | 29 | Yes | **GOOD** |
| `payment_proof.test.ts` | 27 | Yes — validators, path sanitisation | **GOOD** |
| `razorpay_client.test.ts` | 34 | Yes — response mappers, script loader | **CONTRACT-ONLY** — no network, by design |
| `razorpay_frontend_review.test.ts` | 77 | Yes — UI state machine | **GOOD**, but the most brittle |

**No test reimplements production logic as its own subject.** The one substitution is the `RazorpayStore` port, replaced by an in-memory harness — the correct seam, because the port *is* the designed boundary. The file documents the earlier version's flaw: *"The previous version of this file built its own `Map`-based 'store' and asserted against that, so it tested nothing but its own test code."*

`razorpay_store.test.ts` closes the gap the harness leaves by pinning the real adapter's query payloads, `.eq()` filters and `in()` scopes, so the harness's fidelity is itself verified.

### The distinctive property

Three idempotency properties are tested as **distinct** concerns, not merged: (1) event idempotency, (2) business idempotency — two different event ids, same capture, (3) no payment loss — a failed processing must stay resumable. Most suites would test only the first.

### Missing tests

| Gap | Severity | Note |
|---|---|---|
| Two admins racing `review_payment` | **P3** | The `FOR UPDATE` + raise-on-replay behaviour is real but unexercised. Highest-value gap, since the manual path is the live one. |
| Hold-expiry vs capture at the same instant | **P3** | Each side covered; the interleaving is not. |
| `expire_stale_holds` as a unit | **P3** | It is SQL, untestable by design in this runner. |
| Live gateway integration | INFO | Impossible without credentials; the fake gateway is the correct CI substitute. |
| `payment-qr` upload | INFO | The bucket is absent from migrations, so such a test could not pass today — which is itself the argument for P1-1. |

**I added no tests**, per the audit-only constraint.

---

# 22. Migration Audit

### Payment-related migrations, in applied order

| Migration | Adds | Idempotent? |
|---|---|---|
| `phase4_mvp_schema` | `payments`, `slot_holds`, `bookings` (with `EXCLUDE` constraints), `payment-proofs` bucket + 3 policies, `bookings_status_check` (7 values), `payments_status_check` (3 values) | `IF NOT EXISTS`; policies `DROP ... IF EXISTS` |
| `phase20_mentor_booking_notification_link` | `review_payment` — the admin decision RPC | `CREATE OR REPLACE` |
| `phase21_hold_expiry_cron` | `expire_stale_holds()` + `pg_cron` schedule | `CREATE OR REPLACE`; cron guarded by name |
| `phase25_payment_foundation` | `platform_config` (+ `hold_duration_minutes`), gateway columns, `proof_storage_path` NULLABLE, `bookings_status_check` → 8, `payments_status_check` → 8, `payment_events`, `webhook_events`, 4 indexes, 3 tables added to realtime, RLS + grants | `IF NOT EXISTS`; both CHECKs dropped by name and re-added |
| `phase26_hold_duration_5min` | `hold_duration_interval()`, rewritten `acquire_slot_hold` / `create_booking_with_hold` / `expire_stale_holds` | `CREATE OR REPLACE` |

### Does a fresh database from migrations produce a working payment system?

**No — one blocking omission.**

| Requirement | From migrations? |
|---|---|
| `payments` / `payment_events` / `webhook_events` | **YES** |
| Correct 8-value CHECKs on both tables | **YES** |
| `UNIQUE(booking_id)` on `payments` | **YES** |
| `UNIQUE(gateway, event_id)` on `webhook_events` | **YES** |
| RLS on all three | **YES** |
| `platform_config` + 5-minute hold | **YES** |
| `review_payment` RPC | **YES** |
| Hold-expiry cron | **YES** |
| `payment-proofs` bucket + policies | **YES** |
| Razorpay columns (nullable, safe for existing rows) | **YES** |
| **`payment-qr` bucket + policies** | **NO — MISSING (P1-1)** |
| **`platform_config.updated_by`** | **NO — but present live (P2-2)** |

### P2-2 — Live schema has drifted from the migration set

`platform_config` in the live project carries an **`updated_by UUID`** column. No migration creates it — a grep across all 38 finds `updated_by` only on `system_log_retention` and `login_failure_config`, both unrelated. The table was altered directly in the Supabase SQL editor.

Impact: a rebuild from migrations yields a table the running admin PATCH does not fully match, and the drift is invisible to review. Low severity (one nullable column), but it is the same root cause as P1-1 — payment configuration is not fully version-controlled — and it should be captured before the next migration runs against this project.

### Other migration observations

- **Ordering is correct.** `phase25` applies after `phase4` and before `phase26`. The `phase7*`/`phase8*` files carry later timestamps so they apply last; they touch `segments`/`segment_topics`, not payments.
- **No conflicting CHECK constraints.** Both are dropped by their auto-generated name before being re-added, so re-running is safe.
- **No duplicate `platform_config`.** `phase25` and `phase26` both use `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`. Note `phase26`'s upsert hard-sets `hold_duration_minutes = 5`, which would overwrite an operator's later change — a minor footgun.
- **Realtime publication is cumulative and guarded** by a `pg_publication_tables` check in every migration, so re-running cannot double-add a table.
- **`webhook_events` has a partial index on `processed = FALSE`**, which is what makes the `resume` path cheap. Good.

---

# 23. Production Readiness

## Manual UPI/QR — **READY FOR LIMITED PRODUCTION**, conditional on one migration

It is already running in production with two real verified payments, so "readiness" here means *reproducibility and durability*, not correctness of the happy path.

**Supporting readiness:**
- Exercised in production with real money and real UTRs (VERIFIED AGAINST LIVE DB).
- Amount, ownership, storage path, file type, file size and object existence are all server-enforced.
- The admin decision is a guarded `SECURITY DEFINER` RPC with row locks and an admin re-check.
- Signed, 300-second proof URLs; the raw storage path is never handed to the browser.
- Bucket, RLS, grants and the RPC are all in migrations.
- Audit logging on submission, approval and rejection.

**Blocking readiness:**
- **P1-1** — a fresh deployment has no `payment-qr` bucket, so the default payment path's QR cannot be uploaded. Must be fixed as a migration.

**Recommended but not blocking:**
- **P2-1** — a `PENDING_VERIFICATION` booking has no expiry. If the admin queue is not worked daily, mentor slots stay blocked indefinitely. This is an operational risk, not a code defect, and is arguably the most likely thing to bite first in real use.

## Razorpay — **NOT READY**

Not "partially ready": the code is complete, but three things are absent that make it unsafe to enable.

**Supporting readiness:**
- Every business rule is implemented and unit-tested against the real production functions (185 tests).
- Signature verification is server-side over the raw body, and is tested through the real Express route.
- Idempotency is two-layered and the "resume" case is handled explicitly.
- Amounts are server-derived and re-checked against the gateway on both paths.
- Retry re-arms the same row; a failed attempt never blocks the booking.
- Dead-end captures are recorded honestly rather than confirmed.

**Blocking readiness:**
1. **P0-1** — an unmatched capture is silently dropped with a `200`. Money can vanish with no record and no alert. This alone blocks enablement.
2. **P1-2** — no refund can be issued. A seeker can be told "your payment is being refunded" and then wait forever.
3. **No credentials and no test against the gateway.** `RAZORPAY_ENABLED=false`, all three secrets empty. Nothing about real gateway behaviour — real signature encoding, real event shapes, real capture timing, real retry cadence — has been observed. The code is written from the documented contract and unit-tested against a fake.

**Also required before enablement:** P2-5 (admin cannot see gateway or refund state), P2-6 (no seeker-facing refund-pending state).

**Explicitly not a blocker:** the `payment-qr` migration is required for the manual path, not for Razorpay.

---

# 24. Risk Register

| ID | Severity | Area | Finding | Evidence | Impact | Required Action |
|---|---|---|---|---|---|---|
| **P0-1** | **P0** | Webhook | A capture that cannot be routed to a `payments` row is acknowledged with `200` and written nowhere | `handleCaptured` → `handled:'unmatched'`; route returns 200 | **Money taken, no record, no alert, no retry.** Permanent, silent loss | Persist the orphan capture; return a non-2xx so Razorpay retries; add a reconciliation query |
| **P1-1** | **P1** | Storage / Migrations | `payment-qr` bucket is referenced by code but created by no migration | No `payment-qr` statement in any of 38 migrations; `PAYMENT_QR_BUCKET` in `paymentProof.ts:49` + 3 routes; bucket verified present live | A fresh/rebuilt DB cannot accept a QR upload; the default payment path is not reproducible | Add an idempotent migration creating `payment-qr` (private, 2 MB, png/jpeg/webp) plus an admin-only `FOR ALL` policy on `storage.objects` |
| **P1-2** | **P1** | Refunds | No refund can be initiated by any code path | `RazorpayGatewayClient` implements only `createOrder` and `fetchPayment`; no route, service method or UI control | Captured money against a cancelled booking can only be returned by hand in the Razorpay dashboard; the seeker is told it "is being refunded" and waits indefinitely | Add a `refunds` gateway method, an idempotent refund service, an admin action, and a reconciliation job over `refund_status='PENDING'` |
| **P2-1** | **P2** | Manual / Holds | `PENDING_VERIFICATION` never expires | `expire_stale_holds()` targets only `PAYMENT_PENDING`; no other job ages out a proof | An unattended admin queue blocks the mentor's slot indefinitely via the overlap exclusion; an admin can approve a long-past session | Decide a policy and enforce it in SQL; block approval when `start_time` has passed |
| **P2-2** | **P2** | Migrations | Live `platform_config` has an `updated_by` column no migration creates | Live column present; grep finds `updated_by` only on two unrelated tables | Rebuild-from-migrations differs from production; drift invisible to review | Capture the column in a migration before the next one runs |
| **P2-3** | **P2** | Razorpay | An order can be created at the gateway with no local `payments` row if the response is lost | `attachGatewayOrder` runs after the gateway call | A duplicate order on retry; both expire uncharged, so no direct loss, but same class as P0-1 | Reconcile open orders, or persist the order id before the response can be lost |
| **P2-4** | **P2** | RLS | `platform_config` has no RLS enabled | `phase25`/`phase26` create it; no `ENABLE ROW LEVEL SECURITY` | Any granted role can read/write via PostgREST. Low confidentiality impact (values are public by design) but a future grant would expose client writes | Enable RLS with public-read, admin-write |
| **P2-5** | **P2** | Admin UI | The admin API omits `gateway`, all Razorpay ids, `refund_status` and `failure_reason` | Explicit projection at `server.ts:8387-8402`; client type unions only 3 statuses | A refund-owed payment is **invisible**; a `FAILED` payment renders unexplained | Return the gateway/refund fields; add a "refunds owed" filter |
| **P2-6** | **P2** | Seeker UI | No seeker-facing "refund pending" state | Server returns `409 BOOKING_CLOSED_REFUND_PENDING`; list shows a bare `FAILED` | A seeker whose money is owed back sees an unexplained failure | Add a `refund_pending` pill and copy derived from `refund_status` |
| **P3-1** | **P3** | Config | `payment_instructions` is `null` in production | Live `platform_config` | Seeker payment page renders an empty instruction block | Populate the field |
| **P3-2** | **P3** | Tests | Two admins racing `review_payment` is untested | `FOR UPDATE` + raise-on-replay at `phase20:44-53`; no test | The live manual path's most important concurrency guarantee is unverified | Add a test asserting the second call raises and writes no notification |
| **P3-3** | **P3** | Migrations | `phase26` hard-resets `hold_duration_minutes = 5` on apply | `phase26:36-40` | Re-running migrations silently reverts operator tuning | Only set the value when the row is first created |
| **INFO-1** | INFO | Realtime | `payment_events` / `webhook_events` published but nothing subscribes | `phase25` publication block; no hook | Dead publication surface; no seeker-facing gateway progress | Subscribe or remove from the publication |
| **INFO-2** | INFO | Notifications | `notifications` unpublished; `NotificationContext` polls every 30 s ungated | `NotificationContext.tsx` | Up to 30 s latency; a background tab polls forever | Publish it with `REPLICA IDENTITY FULL`; add the visibility gate |
| **INFO-3** | INFO | Docs | `docs/` says admin rejection sets `CANCELLED`; the RPC sets `REJECTED` | `phase20:79` vs `MVP-UPDATED.md:1110` | Docs mislead; code is correct and the slot is freed either way | Correct the three documents |

**No P0 exists on the manual path.** The single P0 is reachable only once Razorpay is enabled.

---

# 25. Required Fixes

### MUST FIX BEFORE TESTING (the manual path, which is live)

1. **P1-1 — Add the `payment-qr` bucket migration.** The only true blocker for the live path, and a small, idempotent, additive change. Until it exists, the migration set does not describe the running system.
2. **P2-2 — Capture `platform_config.updated_by` in a migration**, before the next migration is applied and the manual change is lost.

### MUST FIX BEFORE RAZORPAY TEST MODE

3. **P0-1 — Stop discarding unmatched captures.** Persist them, return a non-2xx so the gateway retries, and add reconciliation. Nothing else about Razorpay should be attempted until money cannot go missing.
4. **P2-5 — Expose gateway and refund state to the admin.** Without it, test-mode operators cannot see what they are testing.
5. **Provision test credentials** and register the webhook against the Razorpay test dashboard. Confirm the real event shapes match `parseRazorpayWebhookEvent`'s assumptions — the first point at which the code is validated against reality rather than documentation.

### MUST FIX BEFORE PRODUCTION

6. **P1-2 — Implement refund initiation** end to end: gateway method, service, admin action, and a reconciliation job over `refund_status='PENDING'`. Without this the platform can take money it has no mechanism to return.
7. **P2-6 — Add the seeker-facing refund-pending state**, so a person told "your payment is being refunded" can see that it is true.
8. **P2-1 — Decide and enforce a `PENDING_VERIFICATION` expiry policy**, so an unattended admin queue cannot silently block mentor slots.
9. **P2-4 — Enable RLS on `platform_config`.**
10. **P3-2 — Add the two-admin concurrency test** for the live manual path.

### OPTIONAL FUTURE WORK

11. P2-3 — reconcile orphan gateway orders.
12. INFO-1 — subscribe to `payment_events` or drop it from the publication.
13. INFO-2 — publish `notifications`; add the visibility gate to `NotificationContext`.
14. P3-1 — populate `payment_instructions`.
15. P3-3 — make the `phase26` upsert non-destructive.
16. INFO-3 — correct the `CANCELLED`/`REJECTED` claim in the three documents.
17. Code-split the 1,555 kB main bundle (general build concern, not payment-specific).

### Exact Recommended Next Step

**Write the `payment-qr` bucket migration and apply it. Then, and only then, fix P0-1.**

Rationale, in order:
- P1-1 is the only item that affects the **live, money-moving path** today, it is small, and it is pure risk reduction with no behavioural change.
- P0-1 is the only item that makes money *disappear*, but it is unreachable while `RAZORPAY_ENABLED=false`, so it can follow immediately without production risk.
- Everything else is either an operational policy decision (P2-1) or a Razorpay-enablement prerequisite that should not be started until P0-1 is closed.

Doing them in the other order would mean either leaving a live gap open (P1-1 last) or doing money-safety work before the path it protects can be reached at all (P0-1 first) — neither is harmful, but the first leaves a real, reachable defect in production for longer than necessary.

---

# 26. Validation Results

| Command | Result | Detail |
|---|---|---|
| `npx tsc --noEmit` | **PASS** | No type errors. |
| `npm run build` | **PASS** | Vite build 4.76 s; 2,267 modules; `dist/index.html` 1.82 kB, CSS 171.45 kB (gzip 27.18 kB), JS 1,555.06 kB (gzip 377.95 kB); esbuild server bundle 579.6 kB. One pre-existing warning: chunk >500 kB. |
| `tsx --test tests/payment_proof.test.ts tests/razorpay_signature.test.ts` | **PASS** | 46 tests, 46 pass, 0 fail |
| `tsx --test tests/razorpay_state_machine.test.ts tests/razorpay_webhook_idempotency.test.ts tests/razorpay_payment_safety.test.ts` | **PASS** | 53 tests, 53 pass, 0 fail |
| `tsx --test tests/razorpay_backend.test.ts tests/razorpay_store.test.ts` | **PASS** | 86 tests, 86 pass, 0 fail |
| `npm test` (full 43-file suite) | **INCOMPLETE** | Did not finish within the execution window. I ran all 9 payment test files individually instead, and they pass. The 34 non-payment test files were **not** executed and this audit makes **no claim** about them. |

**Client bundle secret scan (on the fresh build):**

| Check | Result |
|---|---|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` / `RAZORPAY_ENABLED` literals | **Absent** |
| Service-role key value | **Absent** |
| `SUPABASE_SERVICE_ROLE_KEY` string | **Absent** |
| `checkout.js.razorpay` | Present (public SDK URL, by design) |
| Anon key value | Present (by design) |

**I changed no code to make any of these pass.** No test was added, removed or modified.

---

# 27. Files Inspected

### Live database (read-only, service-role)
`platform_config`, `payments`, `payment_events`, `webhook_events`, `bookings`; Storage API object listings for `payment-qr`, `payment-proofs`, `segment-hero`.

### Backend
`server.ts` — specifically the auth/notification helpers (`:320-437`), the hold route (`:1608-1850`), the seeker booking routes (`:2014-2210`), the payment-proof POST/GET (`:2210-2482`), the Razorpay block (`:2484-2747`), the booking detail/list (`:2014-2210`), the admin payments block (`:8323-8497`), platform-config routes (`:8503-8850`), and the raw-body middleware (`:1369`).

`src/lib/` — `razorpayConfig.ts`, `razorpaySignature.ts`, `razorpayService.ts` (full), `razorpayStore.ts` (full), `razorpayClient.ts`, `paymentProof.ts`, `sessionState.ts`, `sessionAccess.ts`, `logSanitizer.ts`.
`src/config/app.ts`, `src/config/navigation.ts`.
`src/hooks/` — `usePaymentSync.ts`, `useAvailabilitySync.ts`, `useNotificationSync.ts`, `useSessionSync.ts`.
`src/types/database.ts`, `src/components/booking/statusTone.ts`.

### Frontend
`src/pages/seeker/SeekerPaymentPage.tsx`, `src/components/seeker/RazorpayCheckoutCard.tsx`, `src/pages/admin/AdminPaymentsPage.tsx`, `src/routes/Router.tsx`, `src/App.tsx`.

### Migrations (all 38 enumerated; 7 read in full)
`20260920000000_phase3_auth_roles`, `20260920000001_phase4_mvp_schema`, `20260924000000_phase12_mentor_onboarding`, `20260924000001_phase13_system_logs`, `20260925000000_phase13_mentor_onboarding_admin_control`, `20260926000000_phase14_admin_mentor_control`, `20260926010000_phase16_role_integrity_backfill`, `20260926020000_phase17_realtime_availability_sync`, `20260926020001_phase17_stale_slot_hold_guard`, `20260926030000_phase18_booking_cutoff_5min`, `20260926040000_phase19_login_failure_alerts`, `20260927000000_phase19_security_lockdown`, `20260927010000_phase20_mentor_booking_notification_link`, `20260927011000_phase20b_seeker_confirm_notification_link`, `20260927020000_phase21_hold_expiry_cron`, `20260927050000_phase24_session_time_authority`, `20260927060000_phase24b_reconcile_null_sentinel`, `20260927070000_phase24c_bookings_privilege_tightening`, `20260927080000_phase24d_role_aware_session_notification_links`, `20260927090000_phase24e_scoped_bulk_reconcile_and_service_role`, `20260927100000_phase24f_backfill_completed_actual_ended_at`, `20260927110000_phase25_payment_foundation`, `20260928000000_phase26_hold_duration_5min`, `20260930000000_phase7a_segment_experience_config`, `20260930000001_phase7b_segment_hero_storage`, `20261001000000_phase8a_segments_realtime`, `20261001000001_seeker_experience_rebuild_segment_topics`, `20261001000002_seeker_experience_rebuild_seed_topics`, `20261001000003_seeker_experience_rebuild_seed_config`, `20261001000004_fix_relationship_segment_slug`.

### Config and build
`package.json`, `vercel.json`, `.env.example`, `.env` (read with values redacted — no secret was reproduced in this report), `vite.config.ts`, `tsconfig.json`.

### Tests
`tests/razorpay_backend.test.ts`, `razorpay_state_machine.test.ts`, `razorpay_store.test.ts`, `razorpay_signature.test.ts`, `razorpay_webhook_idempotency.test.ts`, `razorpay_payment_safety.test.ts`, `razorpay_client.test.ts`, `razorpay_frontend_review.test.ts`, `payment_proof.test.ts`, `helpers/razorpayHarness.ts`, plus the `server.ts` route extraction used to enumerate all API routes.

### Documentation (read for conflict-checking only — not modified)
`docs/architecture.md`, `docs/rules.md`, `docs/prd.md`, `docs/memory.md`, `docs/SUGGEST-KEY-MVP-UPDATED.md`, `docs/data-source-audit.md`, `docs/technical-audit.md`, `docs/SUGGEST-KEY-UI-DESIGN-SYSTEM.md`.

---

## Closing statement

This was a read-only audit. **No production code, frontend code, backend code, migration, schema, configuration or data was modified.** The only file created is `payment_audit.md`.

Where a document and the code disagreed, the code was treated as authoritative and the conflict was reported (INFO-3). Where behaviour could not be confirmed — the Razorpay gateway, `segment-hero` in the live project, and the 34 non-payment test files — it is explicitly marked as unverified rather than assumed.

---

---

---

---

---

---

---

---

---

---

---

