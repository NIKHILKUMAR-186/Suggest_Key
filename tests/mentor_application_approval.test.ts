/**
 * Admin mentor-application approval — atomicity, state sync, realtime propagation
 * =============================================================================
 *
 * Regression cover for the two defects behind the reported incident
 * (application 9ace5bf7..., approved 2026-10-03 20:44:38Z with
 * `mentor_profiles.approval_status` still `draft`, `is_active` false, no
 * approval notification and no `audit_logs` row):
 *
 *  1. BACKEND ATOMICITY — the route committed `mentor_applications.status` as
 *     its FIRST of six independent writes and synchronised `mentor_profiles`
 *     afterwards. Any failure after the first write left the database
 *     self-contradictory, and because re-approving a non-pending application is
 *     a 409 by design, the drift was unrepairable through the product. The whole
 *     decision now happens in one transaction inside one function.
 *
 *  2. BACKEND AUTHORISATION — the previous RPC gated on `auth.uid()`, which is
 *     NULL on the service-role client the API uses, so the route could not call
 *     it and hand-rolled its own writes. The function now takes the acting
 *     admin's id as a parameter and re-verifies it against `user_roles`, so a
 *     handler bug cannot widen access.
 *
 *  3. FRONTEND STALENESS — a stale page could not notice another tab or admin
 *     had already decided. A synchronous re-entry guard and 409 reconciliation
 *     are still the first line of defence; realtime propagation is now the
 *     second, so the page reconciles without the admin doing anything.
 *
 * The tests are split into two kinds:
 *
 *  - BEHAVIOURAL: pure functions imported from `src/lib/mentorApplicationApproval`
 *    and `src/hooks/useMentorVerificationSync` are executed directly.
 *  - STRUCTURAL: assertions over source text, which pin the ARCHITECTURE. The
 *    atomicity guarantee lives in SQL, so the only way to prove "the route has
 *    exactly one writer" without a live database is to assert the route contains
 *    no direct table writes at all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MENTOR_DECISION_SUCCESS_OUTCOMES,
  PENDING_REVIEW_STATUS,
  canDispatchApproval,
  mentorDecisionHttpMapping,
  reconcileApproveConflict,
  transitionConflictPayload,
  type MentorDecisionOutcome,
} from '../src/lib/mentorApplicationApproval';
import { buildMentorVerificationWatches } from '../src/hooks/useMentorVerificationSync';

const root = join(import.meta.dirname, '..');
/** CRLF-normalised so the source assertions below are line-ending agnostic. */
const serverSrc = readFileSync(join(root, 'server.ts'), 'utf8').replace(/\r\n/g, '\n');
const pageSrc = readFileSync(
  join(root, 'src', 'pages', 'admin', 'AdminMentorVerificationDetailPage.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const detailPageSrc = readFileSync(
  join(root, 'src', 'pages', 'admin', 'AdminMentorDetailPage.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const mentorsPageSrc = readFileSync(
  join(root, 'src', 'pages', 'admin', 'AdminMentorsPage.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const queuePageSrc = readFileSync(
  join(root, 'src', 'pages', 'admin', 'AdminMentorVerificationPage.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');
const hookSrc = readFileSync(join(root, 'src', 'hooks', 'useMentorVerificationSync.ts'), 'utf8').replace(/\r\n/g, '\n');
const phase44Src = readFileSync(
  join(root, 'supabase', 'migrations', '20261020000000_phase44_mentor_verification_authoritative_realtime.sql'),
  'utf8',
).replace(/\r\n/g, '\n');
const phase44bSrc = readFileSync(
  join(root, 'supabase', 'migrations', '20261020000001_phase44b_mentor_discovery_readiness_for_all.sql'),
  'utf8',
).replace(/\r\n/g, '\n');

/**
 * One route registration, from its `app.<method>('...')` up to the next
 * registration of any method. Survives middleware-list growth and line wrapping.
 */
function sliceRoute(src: string, method: string, path: string): string {
  const start = src.search(new RegExp(`app\\.${method}\\(\\s*'${path.replace(/[/:]/g, (c) => `\\${c}`)}'`));
  assert.notEqual(start, -1, `no app.${method}('${path}') registration in server.ts`);

  const rest = src.slice(start + 1);
  const next = rest.search(/\n\s*app\.(get|post|put|patch|delete)\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

const approveHandler = () =>
  pageSrc.slice(
    pageSrc.indexOf('const handleApproveApplication'),
    pageSrc.indexOf('const handleRejectApplication'),
  );

const APPROVE_ROUTE_PATH = '/api/admin/mentor-applications/:id/approve';
const approveRoute = sliceRoute(serverSrc, 'post', APPROVE_ROUTE_PATH);
const rejectRoute = sliceRoute(serverSrc, 'post', '/api/admin/mentor-applications/:id/reject');
const documentReviewRoute = sliceRoute(serverSrc, 'patch', '/api/admin/mentor-documents/:id/review');

// ===========================================================================
// (1) pending_review can be approved
// ===========================================================================

describe('a pending_review application can be approved', () => {
  it('treats pending_review as the only dispatchable status', () => {
    assert.equal(PENDING_REVIEW_STATUS, 'pending_review');
    assert.equal(canDispatchApproval('pending_review'), true);
    assert.equal(canDispatchApproval('approved'), false);
    assert.equal(canDispatchApproval('rejected'), false);
    assert.equal(canDispatchApproval('draft'), false);
    assert.equal(canDispatchApproval(null), false);
    assert.equal(canDispatchApproval(undefined), false);
  });

  it('writes the approved transition inside the transaction, not in the route', () => {
    assert.match(phase44Src, /SET status\s+= 'approved'/);
    assert.match(phase44Src, /reviewed_by\s+= p_admin_user_id/);
    assert.match(phase44Src, /rejection_reason = NULL/);
  });

  it('the UI dispatches only when the cached status allows it', () => {
    assert.match(approveHandler(), /if \(!canDispatchApproval\(application\?\.status\)\) \{/);
    assert.match(pageSrc, /const canApprove = canDispatchApproval\(application\?\.status\);/);
  });
});

// ===========================================================================
// (2) a successful approval changes the UI to approved
// (3) the Approve button disappears afterwards
// ===========================================================================

describe('a successful approval updates the screen without a manual refresh', () => {
  it('re-reads the application from the server instead of faking the status', () => {
    const handler = approveHandler();
    // The status shown on the page only ever comes from the server response.
    assert.doesNotMatch(handler, /setApplication\(/);
    assert.match(handler, /await fetchApplication\(\{ background: true \}\);/);
    const successBranch = handler.slice(handler.indexOf('await fetchApplication({ background: true });'));
    assert.doesNotMatch(successBranch, /status:\s*['"]approved['"]/);
  });

  it('renders the status from the application row', () => {
    assert.match(pageSrc, /formatStatus\(application\.status\)/);
    assert.match(pageSrc, /status\.replace\('_', ' '\)\.replace\(\/\\b\\w\/g/);
  });

  it('hides the whole action panel once the application is no longer pending', () => {
    // `canApprove` is the status, so an approved application renders no panel and
    // therefore no Approve button at all.
    assert.match(pageSrc, /\{canApprove && \(/);
    assert.equal((pageSrc.match(/onClick=\{handleApproveApplication\}/g) ?? []).length, 1);
  });

  it('revalidates in place rather than blanking the page to a skeleton', () => {
    // A background refetch updates the rendered row, so the transition to
    // Approved is visible instead of flashing a loading skeleton.
    assert.match(pageSrc, /if \(!options\?\.background\) setLoading\(true\);/);
    assert.match(detailPageSrc, /if \(!options\?\.background\) \{\s*\n\s*setLoading\(true\);/);
    assert.match(detailPageSrc, /if \(!options\?\.background\) setLoading\(false\);/);
  });

  it('guards against a stale response overwriting a newer one', () => {
    assert.match(pageSrc, /const fetchId = \+\+latestFetchIdRef\.current;/);
    assert.match(pageSrc, /fetchId === latestFetchIdRef\.current/);
  });

  it('does not write state after the Router unmounted the page', () => {
    assert.match(pageSrc, /mountedRef\.current = false;/);
    assert.match(pageSrc, /if \(mountedRef\.current && fetchId === latestFetchIdRef\.current\)/);
  });
});

// ===========================================================================
// (4) a double-click sends no duplicate request
// ===========================================================================

describe('a double-click does not send a duplicate request', () => {
  it('has a synchronous re-entry guard that defeats a fast double-click', () => {
    // A ref (not state) is what makes the guard instant: it is checked before
    // the first await, so a second invocation returns before any POST fires.
    const handler = approveHandler();
    assert.match(pageSrc, /const approveInFlightRef = useRef\(false\);/);
    assert.match(handler, /if \(approveInFlightRef\.current\) return;/);
    assert.match(handler, /approveInFlightRef\.current = true;/);
  });

  it('clears the in-flight guard on every exit path', () => {
    assert.match(
      approveHandler(),
      /finally \{[\s\S]{0,140}setActionLoading\(null\);[\s\S]{0,140}approveInFlightRef\.current = false;/,
    );
  });

  it('applies the same guard to the reject action', () => {
    const reject = pageSrc.slice(
      pageSrc.indexOf('const handleRejectApplication'),
      pageSrc.indexOf('const canApprove'),
    );
    assert.match(pageSrc, /const rejectInFlightRef = useRef\(false\);/);
    assert.match(reject, /if \(rejectInFlightRef\.current\) return;/);
    assert.match(reject, /rejectInFlightRef\.current = false;/);
  });

  it('is a non-submitting button with no implicit Enter submission', () => {
    const actions = pageSrc.slice(pageSrc.indexOf('>Application Actions<'), pageSrc.indexOf('Audit Trail'));
    assert.match(actions, /type="button"/);
    assert.match(actions, /disabled=\{actionLoading === 'approve'\}/);
  });

  it('shows an Approving... state while the request is in flight', () => {
    const actions = pageSrc.slice(pageSrc.indexOf('>Application Actions<'), pageSrc.indexOf('Audit Trail'));
    assert.match(actions, /aria-busy=\{actionLoading === 'approve'\}/);
    assert.match(actions, /<span>Approving\.\.\.<\/span>/);
    assert.match(actions, /actionLoading === 'approve' \? \(\s*<>/);
  });
});

// ===========================================================================
// (5) an approved application cannot be approved again
// ===========================================================================

describe('an approved application cannot be approved again', () => {
  it('rejects the invalid transition with 409, never as a silent no-op', () => {
    // The rule itself is now enforced under a row lock inside the function.
    assert.match(phase44Src, /IF v_app\.status <> 'pending_review' THEN[\s\S]{0,200}'not_pending_review'/);
    // ...and the route maps that outcome to the 409 it has always returned.
    assert.match(approveRoute, /mentorDecisionHttpMapping\(result\.outcome\)/);
    assert.equal(mentorDecisionHttpMapping('not_pending_review').status, 409);
    assert.match(approveRoute, /result\.outcome === 'not_pending_review'[\s\S]{0,120}res\.status\(409\)/);
  });

  it('never returns success for an already-approved application', () => {
    // The previous function returned early and was documented as "idempotent".
    // That early return skipped the mentor_profiles sync entirely, which is why a
    // drifted row could never be repaired.
    assert.doesNotMatch(phase44Src, /IF v_app\.status = 'approved' THEN/);
    assert.match(phase44Src, /IF v_app\.status <> 'pending_review' THEN/);
  });

  it('produces the documented 409 body for the re-read status', () => {
    assert.deepEqual(transitionConflictPayload('approved'), {
      success: false,
      error: { code: 'CONFLICT', message: 'Application is not pending review (current: approved).' },
    });
  });

  it('falls back to "unknown" if the row vanished between the two reads', () => {
    assert.equal(
      transitionConflictPayload(undefined).error.message,
      'Application is not pending review (current: unknown).',
    );
  });
});

// ===========================================================================
// (6)(7) a 409 triggers revalidation and reconciles instead of erroring
// ===========================================================================

describe('a 409 causes revalidation and reconciles to the server state', () => {
  it('detects the 409 and re-fetches the authoritative application', () => {
    const handler = approveHandler();
    assert.match(handler, /res\.status === 409/);
    assert.match(handler, /const refreshed = await fetchApplication\(\{ background: true \}\);/);
    assert.match(handler, /reconcileApproveConflict\(refreshed\?\.status, data\.error\?\.message\)/);
  });

  it('maps an approved application to an explicit "already approved" note', () => {
    assert.deepEqual(reconcileApproveConflict('approved'), {
      kind: 'already-approved',
      message: 'This application has already been approved.',
    });
  });

  it('maps the other terminal and pre-review states to reconciling notes', () => {
    assert.equal(reconcileApproveConflict('rejected').kind, 'already-rejected');
    assert.equal(reconcileApproveConflict('draft').kind, 'no-longer-pending');
  });

  it('shows the approved note rather than a generic error', () => {
    const handler = approveHandler();
    // Only a genuinely unexplained conflict may reach setError; the approved,
    // rejected and draft outcomes must take the toast path.
    assert.match(handler, /if \(reconciliation\.kind === 'conflict'\) \{[\s\S]{0,200}setError\(reconciliation\.message\);\s*\} else \{\s*toast\.info\(reconciliation\.message\);/);
  });

  it('preserves a genuine conflict instead of masking it', () => {
    const genuine = reconcileApproveConflict(
      'pending_review',
      'Application is not pending review (current: pending_review).',
    );
    assert.equal(genuine.kind, 'conflict');
    assert.equal(
      genuine.message,
      'Application is not pending review (current: pending_review).',
    );
    // ...and an unreadable status still yields a meaningful message.
    assert.equal(reconcileApproveConflict(undefined).kind, 'conflict');
    assert.equal(reconcileApproveConflict(null).message, 'Could not approve application: state changed on the server.');
  });
});

// ===========================================================================
// Atomicity: the route has exactly ONE writer
// ===========================================================================

describe('the approval is atomic, so the route has exactly one writer', () => {
  it('performs the decision through the function, not through table writes', () => {
    assert.match(approveRoute, /\.rpc\('approve_mentor_application', \{\s*\n\s*p_application_id: id,\s*\n\s*p_admin_user_id: adminUserId,/);
    // The defect being fixed: six independent writes, the first of which
    // committed the authoritative status.
    assert.doesNotMatch(approveRoute, /\.from\('mentor_applications'\)/);
    assert.doesNotMatch(approveRoute, /\.from\('mentor_profiles'\)/);
    assert.doesNotMatch(approveRoute, /\.from\('user_roles'\)/);
    assert.doesNotMatch(approveRoute, /\.from\('notifications'\)/);
    assert.doesNotMatch(approveRoute, /\.from\('mentor_application_audit'\)/);
  });

  it('applies the same single-writer rule to reject and document review', () => {
    assert.match(rejectRoute, /\.rpc\('reject_mentor_application'/);
    assert.doesNotMatch(rejectRoute, /\.from\('mentor_applications'\)/);
    assert.doesNotMatch(rejectRoute, /\.from\('mentor_application_audit'\)/);
    assert.doesNotMatch(rejectRoute, /\.from\('notifications'\)/);

    assert.match(documentReviewRoute, /\.rpc\('review_mentor_document'/);
    assert.doesNotMatch(documentReviewRoute, /\.from\('mentor_application_audit'\)/);
  });

  it('passes the acting admin id, because auth.uid() is NULL on the service role', () => {
    // This is the exact reason the old RPC could never be called from the API:
    // it gated on auth.uid(), which is always NULL through the service-role
    // client, so the route had to hand-roll its own writes.
    assert.match(phase44Src, /approve_mentor_application\(\s*p_application_id\s+UUID,\s*p_admin_user_id\s+UUID\s*\)/);
    assert.match(phase44Src, /WHERE ur\.user_id = p_admin_user_id AND ur\.role = 'admin'/);
    assert.match(rejectRoute, /p_admin_user_id: adminUserId/);
    assert.match(documentReviewRoute, /p_admin_user_id: adminUserId/);
  });

  it('holds the row lock for the whole decision', () => {
    // A read-then-write guard cannot make the transition safe: both requests can
    // pass the read before either commits. FOR UPDATE is what serialises them.
    assert.match(phase44Src, /SELECT \* INTO v_app[\s\S]{0,120}FROM public\.mentor_applications[\s\S]{0,80}FOR UPDATE;/);
    assert.match(phase44Src, /SELECT \* INTO v_doc[\s\S]{0,140}FROM public\.mentor_verification_documents[\s\S]{0,80}FOR UPDATE;/);
  });

  it('checks the required-document gate inside the same transaction', () => {
    // Previously a separate round trip that could disagree with the write.
    const fn = phase44Src.slice(phase44Src.indexOf('CREATE OR REPLACE FUNCTION public.approve_mentor_application'));
    const gateAt = fn.indexOf("WHERE is_required = TRUE AND is_active = TRUE");
    const writeAt = fn.indexOf("SET status           = 'approved'");
    assert.notEqual(gateAt, -1, 'the required-document gate must exist');
    assert.notEqual(writeAt, -1, 'the transition must exist');
    assert.ok(gateAt < writeAt, 'the gate must run before the transition commits');
    assert.match(phase44Src, /'outcome', 'missing_documents'/);
  });

  it('never overwrites the mentor profile content on approval', () => {
    // The previous route upserted headline/about/experience_years/languages/rating,
    // which replaced a real mentor's bio with the application bio and reset their
    // rating. The ON CONFLICT branch touches the approval fields and nothing else.
    const conflictBranch = phase44Src.slice(
      phase44Src.indexOf('ON CONFLICT (id) DO UPDATE\n  SET approval_status'),
      phase44Src.indexOf('-- 2. ATOMIC REJECTION'),
    );
    assert.match(conflictBranch, /approval_status = 'approved'/);
    assert.match(conflictBranch, /is_approved     = TRUE/);
    assert.match(conflictBranch, /is_active       = TRUE/);
    assert.doesNotMatch(conflictBranch, /headline\s*=/);
    assert.doesNotMatch(conflictBranch, /about\s*=/);
    assert.doesNotMatch(conflictBranch, /rating\s*=/);
    assert.doesNotMatch(conflictBranch, /languages\s*=/);
  });

  it('does not let an approval undo an admin suspension', () => {
    // profiles.account_status is a moderation decision, not part of the
    // verification lifecycle. The old SQL function did reset it.
    const fn = phase44Src.slice(
      phase44Src.indexOf('CREATE OR REPLACE FUNCTION public.approve_mentor_application'),
      phase44Src.indexOf('COMMENT ON FUNCTION public.approve_mentor_application'),
    );
    assert.doesNotMatch(fn, /FROM public\.profiles\s*\n\s*SET account_status/);
    assert.doesNotMatch(fn, /UPDATE public\.profiles/);
  });

  it('does not let an approval create discovery artefacts on its own', () => {
    // Approval is not discoverability. Gigs, availability and segments stay the
    // mentor's own work; only the approval/active flags are synchronised.
    const fn = phase44Src.slice(
      phase44Src.indexOf('CREATE OR REPLACE FUNCTION public.approve_mentor_application'),
      phase44Src.indexOf('COMMENT ON FUNCTION public.approve_mentor_application'),
    );
    assert.doesNotMatch(fn, /INSERT INTO public\.gigs/);
    assert.doesNotMatch(fn, /INSERT INTO public\.mentor_availability/);
    assert.doesNotMatch(fn, /INSERT INTO public\.mentor_segments/);
    // Nor does it silently approve optional documents.
    assert.doesNotMatch(fn, /UPDATE public\.mentor_verification_documents/);
  });
});

// ===========================================================================
// Outcome mapping: ordinary results are data, faults are exceptions
// ===========================================================================

describe('a database outcome is data, not an exception', () => {
  it('answers 2xx only for the outcome that actually committed a decision', () => {
    for (const outcome of MENTOR_DECISION_SUCCESS_OUTCOMES) {
      const mapping = mentorDecisionHttpMapping(outcome);
      assert.equal(mapping.ok, true, `${outcome} must be a success`);
      assert.equal(mapping.status, 200);
    }
    assert.deepEqual([...MENTOR_DECISION_SUCCESS_OUTCOMES].sort(), ['approved', 'rejected', 'reviewed']);
  });

  it('keeps the status codes the hand-written route always returned', () => {
    const expected: Array<[MentorDecisionOutcome, number, string]> = [
      ['forbidden', 403, 'FORBIDDEN'],
      ['not_found', 404, 'NOT_FOUND'],
      ['not_pending_review', 409, 'CONFLICT'],
      ['already_reviewed', 409, 'DOCUMENT_ALREADY_REVIEWED'],
      ['missing_documents', 400, 'BAD_REQUEST'],
      ['reason_required', 400, 'BAD_REQUEST'],
      ['invalid_status', 400, 'BAD_REQUEST'],
    ];
    for (const [outcome, status, code] of expected) {
      assert.deepEqual(mentorDecisionHttpMapping(outcome), { status, code, ok: false }, outcome);
    }
  });

  it('never turns an unrecognised outcome into a success', () => {
    // Silently 2xx-ing an unknown outcome is how an admin comes to believe a
    // decision was recorded when it was not.
    const mapping = mentorDecisionHttpMapping('some_future_outcome');
    assert.equal(mapping.ok, false);
    assert.equal(mapping.status, 500);
    assert.equal(mentorDecisionHttpMapping(undefined as unknown as MentorDecisionOutcome).status, 500);
  });

  it('returns the committed identifiers so a stale tab can reconcile without guessing', () => {
    assert.match(approveRoute, /applicationId: result\.application_id/);
    assert.match(approveRoute, /mentorUserId: result\.mentor_user_id/);
    assert.match(approveRoute, /applicationStatus: result\.application_status/);
    assert.match(phase44Src, /'mentor_user_id', v_app\.user_id/);
  });

  it('answers a lost race with the status the transaction actually found', () => {
    assert.match(phase44Src, /'outcome', 'not_pending_review',\s*\n\s*'current_status', v_app\.status/);
    assert.match(approveRoute, /transitionConflictPayload\(result\.current_status\)/);
  });

  it('keeps a document review a single decision, reported under its own code', () => {
    assert.match(documentReviewRoute, /result\.outcome === 'already_reviewed'[\s\S]{0,200}DOCUMENT_ALREADY_REVIEWED/);
    assert.match(phase44Src, /'outcome', 'already_reviewed',\s*\n\s*'current_status', v_doc\.status/);
  });
});

// ===========================================================================
// (9) authorisation and (10) audit logging are preserved
// ===========================================================================

describe('admin authorization remains enforced', () => {
  it('registers the approve route exactly once', () => {
    const registrations =
      serverSrc.match(/app\.post\(\s*'\/api\/admin\/mentor-applications\/:id\/approve'/g) ?? [];
    assert.equal(registrations.length, 1, 'a second, differently guarded approve route must not appear');
  });

  it('gates the route on requireAuth and requireAdmin, before the handler', () => {
    for (const route of [approveRoute, rejectRoute, documentReviewRoute]) {
      const authAt = route.indexOf('requireAuth');
      const adminAt = route.indexOf('requireAdmin');
      const handlerAt = route.indexOf('async (req: AuthRequest, res)');

      assert.notEqual(authAt, -1, 'requireAuth must be on the route');
      assert.notEqual(adminAt, -1, 'requireAdmin must be on the route');
      assert.ok(authAt < adminAt, 'requireAuth must precede requireAdmin');
      assert.ok(handlerAt === -1 || adminAt < handlerAt, 'authorisation must precede the handler');
    }
  });

  it('rejects a non-admin inside the transaction, before any existence read', () => {
    // A non-admin must learn nothing about the row, so the authorisation check
    // comes before the SELECT.
    const fn = phase44Src.slice(
      phase44Src.indexOf('CREATE OR REPLACE FUNCTION public.approve_mentor_application'),
      phase44Src.indexOf('COMMENT ON FUNCTION public.approve_mentor_application'),
    );
    const authAt = fn.indexOf("'outcome', 'forbidden'");
    const readAt = fn.indexOf('SELECT * INTO v_app');
    assert.notEqual(authAt, -1, 'the authorisation gate must exist');
    assert.ok(authAt < readAt, 'authorisation must precede the existence read');
  });

  it('keeps the decision functions reachable only by the service role', () => {
    for (const signature of [
      'public.approve_mentor_application(UUID, UUID)',
      'public.reject_mentor_application(UUID, TEXT, UUID)',
      'public.review_mentor_document(UUID, TEXT, TEXT, UUID)',
      'public.mentor_discovery_readiness(UUID)',
    ]) {
      assert.match(
        phase44Src,
        new RegExp(`REVOKE ALL ON FUNCTION ${signature.replace(/[()]/g, '\\$&')} FROM PUBLIC, anon, authenticated;`),
        signature,
      );
      assert.match(
        phase44Src,
        new RegExp(`GRANT EXECUTE ON FUNCTION ${signature.replace(/[()]/g, '\\$&')} TO service_role;`),
        signature,
      );
    }
    // The directory-wide readiness probe exposes every mentor's moderation
    // state, so it is held to the same containment.
    assert.match(phase44bSrc, /REVOKE ALL ON FUNCTION public\.mentor_discovery_readiness_for_all\(\) FROM PUBLIC, anon, authenticated;/);
    assert.match(phase44bSrc, /GRANT EXECUTE ON FUNCTION public\.mentor_discovery_readiness_for_all\(\) TO service_role;/);
  });

  it('drops the superseded auth.uid()-gated signatures', () => {
    // They are replaced by the parameterised versions above. Leaving them in
    // place would keep a second, differently authorised path to the same writes.
    assert.match(phase44Src, /DROP FUNCTION IF EXISTS public\.approve_mentor_application\(UUID\);/);
    assert.match(phase44Src, /DROP FUNCTION IF EXISTS public\.reject_mentor_application\(UUID, TEXT\);/);
    assert.match(phase44Src, /DROP FUNCTION IF EXISTS public\.review_mentor_document\(UUID, TEXT, TEXT\);/);
  });

  it('keeps the service-role client on the server and out of the page payload', () => {
    assert.doesNotMatch(pageSrc, /service_role|SERVICE_ROLE|eyJ[A-Za-z0-9_-]{10,}/);
  });

  it('approves through the admin route rather than writing status from the browser', () => {
    assert.match(approveHandler(), /apiFetch\(`\/api\/admin\/mentor-applications\/\$\{applicationId\}\/approve`, \{/);
    // The page issues no mutation against the database directly.
    assert.doesNotMatch(pageSrc, /supabase\.from\(/);
    assert.doesNotMatch(pageSrc, /\.rpc\(/);
  });
});

describe('approval is audited exactly once, after success', () => {
  it('writes the mentor_application_audit row inside the transaction', () => {
    // In the function, not the route: an approval that rolled back must leave no
    // audit trail claiming it happened.
    assert.match(phase44Src, /PERFORM public\._log_mentor_app_audit\(\s*\n\s*v_app\.id, 'approved', p_admin_user_id/);
    assert.match(phase44Src, /v_app\.id, 'rejected', p_admin_user_id/);
    assert.match(phase44Src, /v_app_id, 'document_reviewed', p_admin_user_id/);
    assert.doesNotMatch(approveRoute, /mentor_application_audit/);
  });

  it('records the platform audit action', () => {
    // auditAction is API-request telemetry (request_id, actor identity), which the
    // database has no way to know, so it stays in the route.
    assert.match(approveRoute, /auditAction\(req\.auth, 'mentor_application_approved', \{/);
    assert.match(rejectRoute, /auditAction\(req\.auth, 'mentor_application_rejected', \{/);
    assert.match(documentReviewRoute, /auditAction\(req\.auth, 'mentor_document_reviewed', \{/);
  });

  it('audits only after the outcome confirmed a decision', () => {
    const auditAt = approveRoute.indexOf("auditAction(req.auth, 'mentor_application_approved'");
    const earlyReturnAt = approveRoute.indexOf('return res.status(mapping.status).json({');
    assert.notEqual(auditAt, -1, 'the audit call must exist');
    assert.notEqual(earlyReturnAt, -1, 'the non-success branch must exist');
    assert.ok(earlyReturnAt < auditAt, 'a non-committed decision must return before it is audited');
  });

  it('isolates the notification so losing it cannot undo a decided approval', () => {
    const fn = phase44Src.slice(
      phase44Src.indexOf('CREATE OR REPLACE FUNCTION public.approve_mentor_application'),
      phase44Src.indexOf('COMMENT ON FUNCTION public.approve_mentor_application'),
    );
    const notifyAt = fn.indexOf('INSERT INTO public.notifications');
    const exceptionAt = fn.indexOf('EXCEPTION WHEN OTHERS THEN');
    assert.notEqual(notifyAt, -1, 'the approval notification must exist');
    assert.ok(exceptionAt > notifyAt, 'the notification insert must be wrapped in its own exception block');
  });
});

// ===========================================================================
// Repair of the drift the product could not fix
// ===========================================================================

describe('existing drift is repaired by the migration', () => {
  it('selects only applications that are approved but out of sync', () => {
    assert.match(phase44Src, /WHERE a\.status = 'approved'/);
    assert.match(phase44Src, /mp\.approval_status IS DISTINCT FROM 'approved'/);
    assert.match(phase44Src, /mp\.is_active IS DISTINCT FROM TRUE/);
  });

  it('is idempotent: a second run finds nothing left to do', () => {
    // The predicate is the whole idempotency mechanism, so a re-run is a no-op.
    const block = phase44Src.slice(phase44Src.indexOf('SELECT a.id AS application_id'));
    assert.equal((block.match(/WHERE a\.status = 'approved'/g) ?? []).length, 1);
    assert.match(block, /mp\.id IS NULL/);
  });

  it('leaves the mentor profile content and the account status alone', () => {
    const block = phase44Src.slice(
      phase44Src.indexOf('-- 8. REPAIR THE DRIFTED ROWS'),
      phase44Src.indexOf('-- 9. RELOAD THE POSTGREST SCHEMA CACHE'),
    );
    assert.doesNotMatch(block, /UPDATE public\.profiles/);
    const conflictBranch = block.slice(block.indexOf('ON CONFLICT (id) DO UPDATE'));
    assert.doesNotMatch(conflictBranch, /headline\s*=/);
    assert.doesNotMatch(conflictBranch, /about\s*=/);
    assert.doesNotMatch(conflictBranch, /rating\s*=/);
  });

  it('records what it repaired, so the repair is visible afterwards', () => {
    assert.match(phase44Src, /'reason', 'mentor_profile_state_synchronised'/);
    assert.match(phase44Src, /INSERT INTO public\.audit_logs/);
  });
});

// ===========================================================================
// Realtime propagation
// ===========================================================================

describe('the required tables are actually published', () => {
  it('adds every table these pages display', () => {
    for (const table of [
      'mentor_profiles',
      'profiles',
      'mentor_applications',
      'mentor_verification_documents',
      'mentor_segments',
    ]) {
      assert.match(
        phase44Src,
        new RegExp(`'${table}'`),
        `${table} must be added to the supabase_realtime publication`,
      );
    }
    assert.match(phase44Src, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.%I/);
  });

  it('sets REPLICA IDENTITY FULL only where a subscription filters a non-PK column', () => {
    // Supabase matches a client filter against the replica identity, so a filter
    // on a non-primary-key column cannot match UPDATE/DELETE events without it.
    // The hot tables deliberately keep the default: FULL would publish every
    // column of every profile change on every replica.
    assert.match(phase44Src, /ALTER TABLE public\.mentor_applications\s+REPLICA IDENTITY FULL;/);
    assert.match(phase44Src, /ALTER TABLE public\.mentor_segments\s+REPLICA IDENTITY FULL;/);
    assert.match(phase44Src, /ALTER TABLE public\.mentor_verification_documents REPLICA IDENTITY FULL;/);
    assert.doesNotMatch(phase44Src, /ALTER TABLE public\.mentor_profiles\s+REPLICA IDENTITY FULL;/);
    assert.doesNotMatch(phase44Src, /ALTER TABLE public\.profiles\s+REPLICA IDENTITY FULL;/);
  });

  it('does not duplicate the existing notifications subscription', () => {
    assert.doesNotMatch(phase44Src, /ADD TABLE public\.notifications/);
  });

  it('reloads the PostgREST schema cache after changing the signatures', () => {
    assert.match(phase44Src, /pg_notify\('pgrst', 'reload schema'\)/);
    assert.match(phase44bSrc, /pg_notify\('pgrst', 'reload schema'\)/);
  });
});

describe('subscriptions are scoped as narrowly as each page allows', () => {
  it('filters the application detail page to one application and its documents', () => {
    const watches = buildMentorVerificationWatches('application-detail', {
      applicationId: 'app-1',
      mentorId: 'mentor-1',
    });
    assert.deepEqual(
      watches.map((w) => `${w.table}|${w.filter}`),
      [
        'mentor_applications|id=eq.app-1',
        'mentor_verification_documents|application_id=eq.app-1',
        'mentor_profiles|id=eq.mentor-1',
        'profiles|id=eq.mentor-1',
        'mentor_segments|mentor_id=eq.mentor-1',
      ],
    );
  });

  it('omits the profile tables until the applicant is known', () => {
    // The profile is synchronised by the transaction that decides the
    // application, so there is nothing to watch before the id is available.
    const watches = buildMentorVerificationWatches('application-detail', { applicationId: 'app-1' });
    assert.deepEqual(
      watches.map((w) => w.table),
      ['mentor_applications', 'mentor_verification_documents'],
    );
  });

  it('filters the mentor Control Center to one mentor, including by user_id', () => {
    const watches = buildMentorVerificationWatches('mentor-detail', { mentorId: 'mentor-1' });
    assert.deepEqual(
      watches.map((w) => `${w.table}|${w.filter}`),
      [
        'mentor_profiles|id=eq.mentor-1',
        'profiles|id=eq.mentor-1',
        'mentor_segments|mentor_id=eq.mentor-1',
        // The Control Center shows `applicationStatus`, and that row is keyed by
        // user_id, not id.
        'mentor_applications|user_id=eq.mentor-1',
      ],
    );
  });

  it('subscribes to nothing at all before the mentor id is known', () => {
    assert.deepEqual(buildMentorVerificationWatches('mentor-detail', {}), []);
  });

  it('leaves the queue and the directory unfiltered, because they span every row', () => {
    const queue = buildMentorVerificationWatches('verification-queue', {});
    assert.deepEqual(queue.map((w) => w.table), ['mentor_applications', 'mentor_verification_documents']);
    assert.ok(queue.every((w) => w.filter === undefined));

    const directory = buildMentorVerificationWatches('mentors-list', {});
    assert.ok(directory.every((w) => w.filter === undefined));
  });

  it('never subscribes to a table a page does not display', () => {
    const allowed = new Set([
      'mentor_applications',
      'mentor_verification_documents',
      'mentor_profiles',
      'profiles',
      'mentor_segments',
    ]);
    for (const scope of ['application-detail', 'verification-queue', 'mentor-detail', 'mentors-list'] as const) {
      for (const watch of buildMentorVerificationWatches(scope, { applicationId: 'a', mentorId: 'm' })) {
        assert.ok(allowed.has(watch.table), `${scope} watches unexpected table ${watch.table}`);
      }
    }
  });
});

describe('the realtime hook never derives state from an event', () => {
  it('uses a signal, not a payload, and never subscribes to notifications', () => {
    assert.match(hookSrc, /The event is a signal, never data/);
    assert.match(hookSrc, /The payload is used for tracing only\. State is never derived from/);
    assert.doesNotMatch(hookSrc, /'notifications'/);
  });

  it('gives every instance its own channel topic', () => {
    // `supabase.channel(topic)` reuses a channel with the same topic, so under
    // React StrictMode a shared topic can hand a remount a half-torn-down
    // channel whose listeners never deliver an event.
    assert.match(hookSrc, /\+\+channelSequence/);
    assert.match(hookSrc, /const topic = `mentor-verification:\$\{scope\}/);
  });

  it('coalesces a burst into one re-read', () => {
    // One approval is several statements in one transaction.
    assert.match(hookSrc, /if \(burstTimer\) clearTimeout\(burstTimer\);/);
    assert.match(hookSrc, /BURST_WINDOW_MS/);
  });

  it('re-reads when the tab resumes and when the channel re-joins', () => {
    for (const trigger of ['visibilitychange', 'focus', 'online', 'pageshow']) {
      assert.match(hookSrc, new RegExp(`addEventListener\\('${trigger}', onResume\\)`), trigger);
    }
    assert.match(hookSrc, /if \(status === 'SUBSCRIBED'\) \{[\s\S]{0,120}if \(settled\)/);
  });

  it('removes the channel on cleanup so subscriptions cannot accumulate', () => {
    assert.match(hookSrc, /void supabase\.removeChannel\(channel\);/);
  });

  it('has no polling interval, because every change here is a database write', () => {
    // useAvailabilitySync needs one because a slot hold lapses with no write.
    assert.doesNotMatch(hookSrc, /setInterval\(/);
  });

  it('surfaces a degraded socket as staleness, never as an error', () => {
    assert.match(hookSrc, /CHANNEL_ERROR[\s\S]{0,60}TIMED_OUT/);
  });
});

describe('every admin verification surface revalidates from the server', () => {
  it('wires the detail page to the application-detail scope', () => {
    assert.match(pageSrc, /useMentorVerificationSync\(\{\s*\n\s*scope: 'application-detail',/);
    assert.match(pageSrc, /mentorId: application\?\.user_id \?\? null,/);
    // Replaced the local focus/visibility listener so one resume cannot refetch twice.
    assert.doesNotMatch(pageSrc, /window\.addEventListener\('focus', revalidate\)/);
    // ...and a revalidation still never races an in-flight mutation.
    assert.match(pageSrc, /if \(approveInFlightRef\.current \|\| rejectInFlightRef\.current\) return;/);
    assert.match(pageSrc, /void fetchApplication\(\{ background: true \}\);/);
  });

  it('wires the queue to the verification-queue scope with a silent reload', () => {
    assert.match(queuePageSrc, /useMentorVerificationSync\(\{\s*\n\s*scope: 'verification-queue',/);
    assert.match(queuePageSrc, /setSilentReloadToken\(\(token\) => token \+ 1\)/);
    // A background revalidation must not blank a populated queue to a spinner.
    assert.match(queuePageSrc, /if \(!silentReload\) \{\s*\n\s*setLoading\(true\);/);
    assert.match(queuePageSrc, /if \(silentReload\) return;/);
  });

  it('wires the Control Center to the mentor-detail scope', () => {
    assert.match(detailPageSrc, /useMentorVerificationSync\(\{\s*\n\s*scope: 'mentor-detail',/);
    assert.match(detailPageSrc, /mentorId: mentorId \|\| null,/);
    assert.match(detailPageSrc, /void load\(\{ background: true \}\);/);
  });

  it('wires the mentor directory to the mentors-list scope', () => {
    assert.match(mentorsPageSrc, /useMentorVerificationSync\(\{ scope: 'mentors-list', onInvalidate: refreshMentors \}\);/);
    // A background re-read keeps the last known-good list instead of erroring.
    assert.match(mentorsPageSrc, /const refreshMentors = useCallback\(async \(\) => \{[\s\S]{0,400}catch \{/);
    assert.doesNotMatch(mentorsPageSrc.slice(mentorsPageSrc.indexOf('const refreshMentors'), mentorsPageSrc.indexOf('useMentorVerificationSync')), /setLoading\(true\)/);
  });
});

// ===========================================================================
// Discovery readiness is computed once, in the database
// ===========================================================================

describe('discovery readiness is database-authoritative, not re-derived per page', () => {
  it('the API returns the database answer on the Control Center payload', () => {
    const route = sliceRoute(serverSrc, 'get', '/api/admin/mentors/:id');
    assert.match(route, /\.rpc\('mentor_discovery_readiness', \{\s*\n\s*p_mentor_id: mentorId,/);
    assert.match(route, /discovery: readiness,/);
  });

  it('the directory asks for every mentor in one statement', () => {
    const route = sliceRoute(serverSrc, 'get', '/api/admin/mentors');
    assert.match(route, /\.rpc\(\s*\n\s*'mentor_discovery_readiness_for_all',/);
    assert.match(route, /isDiscoverable: readiness\?\.isDiscoverable \?\? false/);
  });

  it('the set-based function delegates rather than restating the predicate', () => {
    // A third copy of the discoverability rule is exactly the duplication this
    // change removes; the canonical functions stay the single owner.
    assert.match(phase44bSrc, /public\.mentor_is_publicly_visible\(mp\.id\)/);
    assert.match(phase44bSrc, /public\.is_mentor_discoverable\(mp\.id\)/);
    assert.doesNotMatch(phase44bSrc, /FROM public\.gigs/);
    assert.doesNotMatch(phase44bSrc, /EXISTS/);
  });

  it('the Control Center renders the six checks verbatim instead of recomputing them', () => {
    const section = detailPageSrc.slice(
      detailPageSrc.indexOf('<Section title="Discovery readiness">'),
      detailPageSrc.indexOf('</Section>', detailPageSrc.indexOf('<Section title="Discovery readiness">')),
    );
    for (const check of [
      'approved',
      'active',
      'notSuspended',
      'hasEligibleSegment',
      'hasActiveGig',
      'hasRecurringAvailability',
    ]) {
      assert.match(section, new RegExp(`discovery\\.checks\\.${check}\\b`), check);
    }
    // The eligible-segment test needs segments.is_active, which a client-side copy
    // cannot reproduce from this payload.
    assert.doesNotMatch(section, /mentor\.segments\.length > 0/);
    assert.doesNotMatch(section, /mentor\.gigs\.some/);
    assert.doesNotMatch(section, /mentor\.availability\.length > 0/);
    assert.doesNotMatch(section, /accountState\.isApproved/);
  });

  it('shows an inconsistency between the approval columns instead of hiding it', () => {
    // approval_status is authoritative; is_approved is legacy and only has to
    // agree, because the database's visibility functions require both.
    assert.match(phase44Src, /'approvalStatusConsistent'/);
    assert.match(detailPageSrc, /!discovery\.approvalStatusConsistent &&/);
    assert.match(detailPageSrc, /Approval columns disagree/);
  });

  it('renders unknown readiness as unknown rather than guessing', () => {
    // Readiness that the API did not return is shown as unavailable, never
    // recomputed from the payload it was supposed to replace.
    assert.match(detailPageSrc, /\{discovery \? \(/);
    assert.match(detailPageSrc, /Discovery readiness is unavailable/);
    assert.match(detailPageSrc, /const discovery = mentor\?\.discovery \?\? null;/);
  });

  it('stops labelling mentor-level eligibility as discoverability', () => {
    // isEligible is approved + active + account usable; discoverability also
    // requires an active gig. Conflating them is the same class of error as the
    // incident, so both surfaces now read the database answer.
    assert.match(mentorsPageSrc, /\{mentor\.isDiscoverable \? 'Discoverable' : 'Not discoverable'\}/);
    assert.doesNotMatch(mentorsPageSrc, /\{state\.isEligible \? 'Discoverable'/);
    assert.match(detailPageSrc, /\{discovery && !discovery\.isDiscoverable && \(/);
    assert.doesNotMatch(detailPageSrc, /\{!accountState\.isEligible && \(\s*<Badge variant="outline" className="text-\[10px\]">Not discoverable/);
  });

  it('the directory and the Control Center cannot state different rules', () => {
    // Both read a database function. Neither re-derives discoverability from
    // the payload, so they cannot disagree with seeker discovery.
    assert.match(mentorsPageSrc, /isDiscoverable: boolean;/);
    assert.match(detailPageSrc, /discovery: MentorDiscoveryReadiness \| null;/);
    assert.match(phase44Src, /'isDiscoverable', public\.is_mentor_discoverable\(p_mentor_id\)/);
    assert.match(phase44Src, /'isPubliclyVisible', public\.mentor_is_publicly_visible\(p_mentor_id\)/);
  });

  it('approved is never reported as discoverable on its own', () => {
    // `is_mentor_discoverable` requires an active gig on top of approval.
    assert.match(phase44Src, /Note what it does NOT say: approval alone is never enough/);
    assert.match(mentorsPageSrc, /Not the same as `isEligible`/);
  });
});
