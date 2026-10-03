/**
 * Admin review of a mentor verification document
 * ================================================
 * Regression cover for the 400 "Invalid input" an admin got on every plain
 * approval from `/admin/mentor-verification/:applicationId`.
 *
 * The failure was a contract mismatch, not a bad click:
 * `AdminMentorVerificationDetailPage.handleDocumentReview` sent
 * `{ status, adminNote: note || null }`, so an approval with no note carried an
 * explicit `adminNote: null`. `apiSchemas.mentorDocumentReview` declared that
 * field with `optionalText`, which accepts `string | '' | undefined` but NOT
 * `null`, so the union failed and `validateBody` replied 400 with Zod's bare
 * `invalid_union` text — literally "Invalid input". Reject happened to work only
 * because the UI's prompt always supplies a string.
 *
 * The tests below pin the contract from both ends: what the schema accepts, what
 * the page actually sends, and the transition/authorisation rules the route must
 * keep enforcing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';

import { apiSchemas, validateBody } from '../src/lib/validation';
import { canReviewMentorDocument } from '../server';

const root = join(import.meta.dirname, '..');
/** CRLF-normalised so the source assertions below are line-ending agnostic. */
const serverSrc = readFileSync(join(root, 'server.ts'), 'utf8').replace(/\r\n/g, '\n');
const pageSrc = readFileSync(
  join(root, 'src', 'pages', 'admin', 'AdminMentorVerificationDetailPage.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const phase44Src = readFileSync(
  join(root, 'supabase', 'migrations', '20261020000000_phase44_mentor_verification_authoritative_realtime.sql'),
  'utf8',
).replace(/\r\n/g, '\n');
/** The atomic document-review function, from its definition to its COMMENT. */
const reviewFunctionSrc = phase44Src.slice(
  phase44Src.indexOf('CREATE OR REPLACE FUNCTION public.review_mentor_document'),
  phase44Src.indexOf('COMMENT ON FUNCTION public.review_mentor_document'),
);

const ROUTE_PATH = '/api/admin/mentor-documents/:id/review';

/**
 * The source of one route, from its registration up to the next registration of
 * any method. Anchoring on the path means this survives a middleware list that
 * grows or a call whose arguments wrap onto several lines.
 */
function sliceRoute(src: string, method: string, path: string): string {
  const start = src.search(new RegExp(`app\\.${method}\\(\\s*'${path.replace(/[/:]/g, (c) => `\\${c}`)}'`));
  assert.notEqual(start, -1, `no app.${method}('${path}') registration in server.ts`);

  const rest = src.slice(start + 1);
  const next = rest.search(/\n\s*app\.(get|post|put|patch|delete)\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Runs the middleware exactly as Express does and reports what it did. */
function runValidation(body: unknown) {
  const req = { body } as unknown as { body: unknown };
  let statusCode: number | null = null;
  let payload: any = null;
  let nexted = false;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(value: unknown) {
      payload = value;
      return res;
    },
  };

  (validateBody(apiSchemas.mentorDocumentReview) as unknown as (
    r: unknown,
    s: unknown,
    n: unknown,
  ) => void)(req, res, () => {
    nexted = true;
  });

  return { statusCode, payload, nexted, body: req.body };
}

const parse = (body: unknown) => apiSchemas.mentorDocumentReview.safeParse(body);

// ===========================================================================
// The reported bug: an approval with no note must not be a 400
// ===========================================================================

describe('an admin approval with no note is accepted', () => {
  it('accepts the exact payload the admin screen sends for an approval', () => {
    // THE REGRESSION. `note` is undefined on the Approve button, so the page
    // serialises `adminNote: null`. Before the fix this was a union failure.
    const result = runValidation({ status: 'approved', adminNote: null });

    assert.equal(result.nexted, true, 'the request must reach the handler');
    assert.equal(result.statusCode, null);
    assert.deepEqual(result.body, { status: 'approved', adminNote: null });
  });

  it('accepts an approval that omits the note entirely', () => {
    const result = parse({ status: 'approved' });
    assert.equal(result.success, true);
  });

  it('accepts a rejection that carries a reason', () => {
    const result = parse({ status: 'rejected', adminNote: 'Blurry photo, please re-upload.' });
    assert.equal(result.success, true);
  });

  it('treats a blank note as "no note" rather than a stored empty string', () => {
    const result = parse({ status: 'approved', adminNote: '   ' });
    assert.equal(result.success, true);
    assert.equal(result.success && result.data.adminNote, null);
  });

  it('still strips HTML from a note that does carry one', () => {
    const result = parse({ status: 'rejected', adminNote: '<script>alert(1)</script>Blurry' });
    assert.equal(result.success, true);
    assert.equal(result.success && result.data.adminNote, 'Blurry');
  });
});

// ===========================================================================
// Invalid payloads are still rejected, with a message that says what is wrong
// ===========================================================================

describe('an invalid review payload is a 400 that names the problem', () => {
  it('rejects a status outside the two decided values', () => {
    const result = runValidation({ status: 'pending_review', adminNote: null });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.success, false);
    assert.equal(result.payload.error.code, 'VALIDATION_ERROR');
    assert.equal(result.payload.error.message, 'Status must be "approved" or "rejected".');
    assert.equal(result.payload.error.fields.status, 'Status must be "approved" or "rejected".');
  });

  it('refuses the undecided and application-level statuses', () => {
    // `pending` is the pre-decision state, not something a review writes;
    // `pending_review` and `draft` belong to mentor_applications.
    for (const status of ['pending', 'pending_review', 'draft', 'approved ', 'Approved', 1, null, undefined]) {
      assert.equal(parse({ status, adminNote: null }).success, false, `${String(status)} must be refused`);
    }
  });

  it('refuses an unknown key instead of ignoring it', () => {
    const result = runValidation({ status: 'approved', adminNote: null, approve: true });

    assert.equal(result.statusCode, 400);
    assert.match(result.payload.error.message, /Unrecognized key: "approve"/);
  });

  it('never answers with the bare "Invalid input"', () => {
    // Zod collapses every union type mismatch into one issue whose default text
    // is exactly "Invalid input", which told the admin nothing. Each of these
    // bodies reaches the client through the shared envelope, so the assertion is
    // made on that envelope rather than on the raw Zod issue.
    const bodies = [
      { status: 'approved', adminNote: null },
      { status: 'approved', adminNote: 42 },
      { status: 'approved', adminNote: { note: 'x' } },
      { status: 'approved', adminNote: ['x'] },
      {},
      { status: 'approved', adminNote: null, approve: true },
    ];

    for (const body of bodies) {
      const result = runValidation(body);
      if (result.statusCode === null) continue;
      assert.notEqual(result.payload.error.message, 'Invalid input', `uninformative message for ${JSON.stringify(body)}`);
      for (const message of Object.values(result.payload.error.fields as Record<string, string>)) {
        assert.notEqual(message, 'Invalid input', `uninformative field message for ${JSON.stringify(body)}`);
      }
    }
  });

  it('names the offending field when the note has the wrong type', () => {
    const result = runValidation({ status: 'approved', adminNote: 42 });

    assert.equal(result.statusCode, 400);
    assert.match(result.payload.error.message, /adminNote/);
    assert.ok(result.payload.error.fields.adminNote);
  });

  it('keeps the bound on a note that is too long, with the real message', () => {
    const result = runValidation({ status: 'rejected', adminNote: 'x'.repeat(501) });

    assert.equal(result.statusCode, 400);
    // A union-level error override would have replaced this with a type
    // message; the specific branch wording must survive.
    assert.equal(result.payload.error.message, 'Admin note must be 500 characters or fewer.');
  });
});

// ===========================================================================
// A document is reviewed once
// ===========================================================================

describe('a document carries one admin decision', () => {
  it('allows a review only out of pending', () => {
    assert.equal(canReviewMentorDocument('pending'), true);
  });

  it('refuses to re-review a document that already has a decision', () => {
    for (const decided of ['approved', 'rejected']) {
      assert.equal(canReviewMentorDocument(decided), false, `${decided} must be final`);
    }
  });

  it('refuses anything that is not the pending state', () => {
    // A missing or malformed status is never treated as reviewable: the route
    // must fail closed, not guess.
    for (const value of [null, undefined, '', 'PENDING', 0, {}, []]) {
      assert.equal(canReviewMentorDocument(value), false, `${JSON.stringify(value)} must not be reviewable`);
    }
  });

  it('the route answers 409 when the document is already decided', () => {
    const route = sliceRoute(serverSrc, 'patch', ROUTE_PATH);

    // The decision is one transaction in one function, so the 409 is now
    // produced by the `already_reviewed` outcome rather than by a pre-write
    // guard in the handler. The handler still maps it to the same status and
    // the same code, so no client contract changed.
    assert.match(route, /result\.outcome === 'already_reviewed'[\s\S]{0,300}res\.status\(409\)/);
    assert.match(route, /DOCUMENT_ALREADY_REVIEWED/);

    // ...and it really is decided before anything is written: the route's only
    // mutation is the RPC itself, which performs the row-locked check.
    assert.match(route, /\.rpc\('review_mentor_document'/);
    assert.doesNotMatch(route, /\.from\('mentor_verification_documents'\)[\s\S]{0,160}?\.(update|upsert)\(/);
  });

  it('decides the transition under a row lock, so a lost race cannot overwrite', () => {
    // A read-then-write would let two admins both "win": both could observe
    // `pending` before either committed. FOR UPDATE serialises them, and the
    // loser re-reads the committed status and is refused.
    assert.match(reviewFunctionSrc, /SELECT \* INTO v_doc[\s\S]{0,160}FOR UPDATE;/);
    assert.match(reviewFunctionSrc, /IF v_doc\.status <> 'pending' THEN[\s\S]{0,200}'already_reviewed'/);
    assert.match(reviewFunctionSrc, /'current_status', v_doc\.status/);
  });

  it('never writes a document row outside the transaction', () => {
    // The route re-reads the decided row to keep its response shape, and only
    // reads it.
    const route = sliceRoute(serverSrc, 'patch', ROUTE_PATH);
    assert.match(route, /\.from\('mentor_verification_documents'\)\s*\n\s*\.select\('\*'\)/);
    assert.doesNotMatch(route, /\.single\(\)/);
  });

  it('the admin screen offers Approve/Reject only for an undecided document', () => {
    // The server stays authoritative; this keeps the buttons from offering an
    // action the API will refuse.
    assert.match(pageSrc, /const isReviewable =[\s\S]{0,200}?isPending;/);
  });
});

// ===========================================================================
// Authorisation is unchanged
// ===========================================================================

describe('only an authenticated admin can review a document', () => {
  it('gates the route on requireAuth and requireAdmin, before validation', () => {
    const route = sliceRoute(serverSrc, 'patch', ROUTE_PATH);

    const authAt = route.indexOf('requireAuth');
    const adminAt = route.indexOf('requireAdmin');
    const validateAt = route.indexOf('validateBody(apiSchemas.mentorDocumentReview)');
    const handlerAt = route.indexOf('async (req: AuthRequest, res)');

    assert.notEqual(authAt, -1, 'requireAuth must be on the route');
    assert.notEqual(adminAt, -1, 'requireAdmin must be on the route');
    assert.ok(authAt < adminAt, 'requireAuth must precede requireAdmin');
    assert.ok(adminAt < validateAt, 'authorisation must precede body validation');
    assert.ok(validateAt < handlerAt, 'validation must precede the handler');
  });

  it('registers exactly one mentor-document review route', () => {
    const registrations = serverSrc.match(/app\.(get|post|put|patch|delete)\(\s*'\/api\/admin\/mentor-documents/g) ?? [];
    assert.equal(registrations.length, 1, 'a second, differently guarded route must not appear');
  });

  it('reads the admin identity from the verified session, never from the body', () => {
    const route = sliceRoute(serverSrc, 'patch', ROUTE_PATH);
    assert.match(route, /req\.auth!\.user\.id/);
    assert.doesNotMatch(route, /reviewed_by:\s*req\.body/);
  });

  it('keeps the service-role client on the server and out of the review payload', () => {
    // The admin client is created by getSupabaseAdmin(); the page must not carry
    // any key at all.
    assert.doesNotMatch(pageSrc, /service_role|SERVICE_ROLE|eyJ[A-Za-z0-9_-]{10,}/);
  });
});

// ===========================================================================
// The decision is still audited, and a refused one is not
// ===========================================================================

describe('a successful review is audited', () => {
  it('writes the mentor_application_audit row the detail page renders', () => {
    // Inside the transaction: a review that rolled back must leave no audit
    // trail claiming it happened, and an audited review can never disagree with
    // the row it describes.
    assert.match(reviewFunctionSrc, /PERFORM public\._log_mentor_app_audit\(\s*\n\s*v_app_id, 'document_reviewed', p_admin_user_id, p_admin_note,/);
    assert.match(reviewFunctionSrc, /'document_id',\s*v_doc\.id/);
    assert.match(reviewFunctionSrc, /'document_type', v_doc\.document_type/);
    assert.doesNotMatch(reviewFunctionSrc, /reviewed_by:\s*p_admin_user_id\s*\n/);
    assert.doesNotMatch(sliceRoute(serverSrc, 'patch', ROUTE_PATH), /mentor_application_audit/);
  });

  it('also records the platform audit action', () => {
    assert.match(sliceRoute(serverSrc, 'patch', ROUTE_PATH), /auditAction\(req\.auth, 'mentor_document_reviewed', \{/);
  });

  it('audits only after the outcome confirmed the decision', () => {
    const route = sliceRoute(serverSrc, 'patch', ROUTE_PATH);
    const earlyReturnAt = route.indexOf('return res.status(mapping.status).json({');
    const auditActionAt = route.indexOf("auditAction(req.auth, 'mentor_document_reviewed'");

    assert.notEqual(earlyReturnAt, -1, 'the non-success branch must exist');
    assert.notEqual(auditActionAt, -1, 'the audit call must exist');
    assert.ok(earlyReturnAt < auditActionAt, 'a refused review must return before it is audited');
    assert.ok(route.indexOf('DOCUMENT_ALREADY_REVIEWED') < auditActionAt, 'the 409 is decided before any audit write');
  });

  it('stamps the reviewer and the decision time on the document itself', () => {
    assert.match(reviewFunctionSrc, /reviewed_at = NOW\(\)/);
    assert.match(reviewFunctionSrc, /reviewed_by = p_admin_user_id/);
    assert.match(reviewFunctionSrc, /admin_note  = p_admin_note/);
    // And the note is normalised once, at the edge.
    assert.match(sliceRoute(serverSrc, 'patch', ROUTE_PATH), /p_admin_note: adminNote \|\| null,/);
  });

  it('authorises the reviewer against user_roles, not against the caller', () => {
    // auth.uid() is NULL on the service-role client the API uses, which is why
    // the acting admin's id is a parameter and is re-verified here.
    assert.match(reviewFunctionSrc, /ur\.user_id = p_admin_user_id AND ur\.role = 'admin'/);
    assert.match(reviewFunctionSrc, /'outcome', 'forbidden'/);
    assert.match(sliceRoute(serverSrc, 'patch', ROUTE_PATH), /p_admin_user_id: adminUserId/);
  });

  it('changes no other table and no application status', () => {
    // The document review is its own operation: it must not touch the mentor
    // application, which has its own approve/reject endpoints.
    assert.doesNotMatch(reviewFunctionSrc, /FROM public\.mentor_applications/);
    assert.doesNotMatch(reviewFunctionSrc, /UPDATE public\.mentor_applications/);
    assert.doesNotMatch(reviewFunctionSrc, /INSERT INTO public\.mentor_profiles/);
  });
});

// ===========================================================================
// The rejection contract
// ===========================================================================

describe('rejection', () => {
  it('does not require a reason: the API has never required one', () => {
    // Stated explicitly so the behaviour is a decision, not an accident. The
    // mentor APPLICATION rejection is the one that requires a reason
    // (apiSchemas.mentorApplicationReject), and it is unchanged.
    assert.equal(parse({ status: 'rejected' }).success, true);
    assert.equal(parse({ status: 'rejected', adminNote: null }).success, true);
    assert.equal(apiSchemas.mentorApplicationReject.safeParse({}).success, false);
  });

  it('reports an over-long reason as a field error the page can display', () => {
    const result = runValidation({ status: 'rejected', adminNote: 'x'.repeat(501) });
    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.error.fields.adminNote, 'Admin note must be 500 characters or fewer.');
  });

  it('the page refuses a blank reason instead of firing a silent PATCH', () => {
    assert.match(pageSrc, /if \(note === null\) return;/);
    assert.match(pageSrc, /if \(!note\.trim\(\)\) \{[\s\S]{0,160}?setError\(/);
  });
});

// ===========================================================================
// The page and the API agree on the contract
// ===========================================================================

describe('the admin page sends exactly the payload the API accepts', () => {
  it('requests the route the server registers', () => {
    assert.match(pageSrc, /apiFetch\(`\/api\/admin\/mentor-documents\/\$\{docId\}\/review`/);
  });

  it('sends precisely the keys the schema declares, no more and no fewer', () => {
    const literal = pageSrc.match(/body: JSON\.stringify\(\{([\s\S]*?)\}\),/);
    assert.ok(literal, 'the page must build its body with JSON.stringify({ ... })');

    const keys = [...literal[1].matchAll(/([A-Za-z_$][\w$]*)\s*[:,}]/g)].map((m) => m[1]);
    const declared = Object.keys(apiSchemas.mentorDocumentReview.shape as z.ZodRawShape);

    assert.deepEqual([...new Set(keys)].sort(), [...declared].sort());
  });

  it('sends null for an absent note, which the schema now accepts', () => {
    assert.match(pageSrc, /adminNote: note \?\? null/);
    // And the value the browser puts on the wire really does validate.
    for (const note of [undefined, null, '', 'Blurry photo']) {
      const body = { status: 'approved', adminNote: note ?? null };
      assert.equal(parse(body).success, true, `${JSON.stringify(body)} must be accepted`);
    }
  });

  it('refreshes from the server instead of assuming the new status', () => {
    const review = pageSrc.slice(
      pageSrc.indexOf('const handleDocumentReview'),
      pageSrc.indexOf('const handleRejectDocument'),
    );
    // No local status write, and a re-fetch of the authoritative row. It is a
    // background revalidation so the already-rendered page updates in place
    // rather than flashing back to a loading skeleton.
    assert.doesNotMatch(review, /setApplication\(/);
    assert.match(review, /await fetchApplication\(\{ background: true \}\);/);
  });

  it('disables the review buttons while a review is in flight', () => {
    assert.match(pageSrc, /const isReviewBusy = docReviewLoading !== null;/);
    const buttons = pageSrc.slice(pageSrc.indexOf('isReviewBusy = docReviewLoading'), pageSrc.indexOf('</div>\n                </div>'));
    assert.equal((buttons.match(/disabled=\{isReviewBusy\}/g) ?? []).length, 2, 'Approve and Reject must both be disabled');
  });

  it('surfaces the server message rather than a fixed string', () => {
    assert.match(pageSrc, /data\.error\?\.message \|\| fieldDetail/);
    // The generic "Failed to review document" is now only the fallback of last
    // resort, after the server's own wording.
    assert.doesNotMatch(
      pageSrc.slice(pageSrc.indexOf('const handleDocumentReview'), pageSrc.indexOf('const handleRejectDocument')),
      /throw new Error\('Failed to review document'\)/,
    );
  });

  it('re-checks the whole approval flow still uses the same admin endpoints', () => {
    // The document review must not have been folded into the application
    // endpoints or the other way round.
    assert.match(pageSrc, /apiFetch\(`\/api\/admin\/mentor-applications\/\$\{applicationId\}\/approve`, \{/);
    assert.match(pageSrc, /apiFetch\(`\/api\/admin\/mentor-applications\/\$\{applicationId\}\/reject`, \{/);
  });
});