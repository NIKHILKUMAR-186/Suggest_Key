/**
 * Mentor-application approval decisions
 * =====================================
 * The approve/reject state machine is a pure decision, so it lives here rather
 * than being duplicated inside the route handler and the admin page. Both the
 * server (which must enforce it) and the browser (which must reconcile against
 * it) import the same rules, so they cannot drift.
 *
 * The contract is deliberately narrow:
 *
 *   pending_review -> approved   valid, and the only valid outcome
 *   anything else  -> 409        a conflict the caller must reconcile against
 *
 * A conflicting request is NEVER treated as a successful no-op. The caller is
 * told which status actually won so it can re-read the server.
 */

/** The only status an application-level approval or rejection may start from. */
export const PENDING_REVIEW_STATUS = 'pending_review';

export type ApplicationStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | (string & {});

/**
 * The 409 body for a lost or invalid transition. Shared by the approve and
 * reject routes so the shape and wording cannot drift between them.
 *
 * @param currentStatus the status re-read from the server after the conditional
 *                      UPDATE matched no row, i.e. another request won the race
 */
export function transitionConflictPayload(
  currentStatus?: string | null,
): {
  success: false;
  error: { code: 'CONFLICT'; message: string };
} {
  return {
    success: false,
    error: {
      code: 'CONFLICT',
      message: `Application is not pending review (current: ${currentStatus ?? 'unknown'}).`,
    },
  };
}

/**
 * How the admin page should present a 409 from the approve action, given the
 * status the server reported when it was re-read.
 *
 * The point of re-reading is that a 409 is usually benign — it means a double
 * click, or another admin/tab got there first, and the application is already in
 * its final state. Those cases must reconcile the UI to that state instead of
 * showing a raw conflict message. Any other status is a genuine conflict and the
 * server's own wording is preserved so nothing is hidden.
 */
export type ApproveConflictReconciliation =
  | { kind: 'already-approved'; message: string }
  | { kind: 'already-rejected'; message: string }
  | { kind: 'no-longer-pending'; message: string }
  | { kind: 'conflict'; message: string };

export function reconcileApproveConflict(
  currentStatus: string | null | undefined,
  serverMessage?: string,
): ApproveConflictReconciliation {
  switch (currentStatus) {
    case 'approved':
      return { kind: 'already-approved', message: 'This application has already been approved.' };
    case 'rejected':
      return { kind: 'already-rejected', message: 'This application has already been rejected.' };
    case 'draft':
      return { kind: 'no-longer-pending', message: 'This application is no longer pending review.' };
    default:
      return {
        kind: 'conflict',
        message: serverMessage || 'Could not approve application: state changed on the server.',
      };
  }
}

/**
 * Client-side gate: an approval may only be dispatched while the application is
 * still `pending_review`. Used to refuse a POST the server would certainly 409.
 */
export function canDispatchApproval(status: string | null | undefined): boolean {
  return status === PENDING_REVIEW_STATUS;
}

// ---------------------------------------------------------------------------
// RPC outcome contract
// ---------------------------------------------------------------------------

/**
 * The structured result shape returned by the atomic decision RPCs in
 * `20261020000000_phase44_mentor_verification_authoritative_realtime.sql`.
 *
 * The database returns an outcome instead of raising for ordinary business
 * results, so a rejected transition is DATA (map it to 409) rather than an
 * exception (map it to 500). A genuine fault still raises inside the function,
 * rolls the whole transaction back, and surfaces as a 5xx - which is exactly
 * why there is no partially-approved state to reconcile against.
 *
 * Declared here rather than in the route so the vocabulary has one owner and can
 * be asserted directly in tests.
 */
export type MentorDecisionOutcome =
  /** Approve. */
  | 'approved'
  /** The acting user is not an admin (checked against `user_roles` in the DB). */
  | 'forbidden'
  /** No such application. */
  | 'not_found'
  /** The application is not `pending_review`; `current_status` says what it is. */
  | 'not_pending_review'
  /** `missing` lists required document types that are not approved yet. */
  | 'missing_documents'
  /** Reject only. */
  | 'rejected'
  /** Reject only: the reason was blank. */
  | 'reason_required'
  /** Document review only. */
  | 'reviewed'
  /** Document review only: `p_status` was outside pending/approved/rejected. */
  | 'invalid_status'
  /** Document review only: the document already carries a decision. */
  | 'already_reviewed';

export interface MentorDecisionResult {
  outcome: MentorDecisionOutcome | (string & {});
  /** Present on `not_pending_review` / `already_reviewed`. */
  current_status?: string;
  /** Present on `missing_documents`. */
  missing?: string[];
  /** Present on every successful application decision. */
  application_id?: string;
  application_status?: string;
  /** The applicant, who becomes the mentor. */
  mentor_user_id?: string;
  approval_status?: string;
  is_approved?: boolean;
  is_active?: boolean;
  /** Document review results. */
  document_id?: string;
  document_type?: string;
  status?: string;
}

/** How the API must answer each outcome. Shared so the mapping is testable. */
export interface MentorDecisionHttpMapping {
  status: number;
  code: string;
  /** 2xx when the decision was recorded. */
  ok: boolean;
}

/**
 * The single place that turns a database outcome into an HTTP answer.
 *
 * The rule is the same for all three decision routes: only the outcome that
 * actually records a decision is a 2xx. Every other outcome keeps the status
 * code the hand-written route has always returned, so no client contract
 * changes.
 */
export function mentorDecisionHttpMapping(
  outcome: MentorDecisionResult['outcome'],
): MentorDecisionHttpMapping {
  switch (outcome) {
    case 'approved':
    case 'rejected':
    case 'reviewed':
      return { status: 200, code: 'OK', ok: true };
    case 'forbidden':
      return { status: 403, code: 'FORBIDDEN', ok: false };
    case 'not_found':
      return { status: 404, code: 'NOT_FOUND', ok: false };
    case 'not_pending_review':
      return { status: 409, code: 'CONFLICT', ok: false };
    case 'already_reviewed':
      return { status: 409, code: 'DOCUMENT_ALREADY_REVIEWED', ok: false };
    case 'missing_documents':
    case 'reason_required':
    case 'invalid_status':
      return { status: 400, code: 'BAD_REQUEST', ok: false };
    default:
      // An outcome this code does not know about is never treated as success.
      // The caller turns it into a 500, because silently 2xx-ing an unknown
      // outcome is how an admin ends up believing a decision was recorded.
      return { status: 500, code: 'DECISION_OUTCOME_UNRECOGNISED', ok: false };
  }
}

/** Success outcomes, i.e. the ones where a decision is now committed. */
export const MENTOR_DECISION_SUCCESS_OUTCOMES: ReadonlySet<string> = new Set([
  'approved',
  'rejected',
  'reviewed',
]);
