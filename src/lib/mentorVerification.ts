/**
 * Mentor verification state machine.
 *
 * The mentor portal must never treat an unresolved verification state as
 * "not verified". A nullable boolean (`is_approved === undefined`) is an
 * implicit state machine that silently collapses `loading` into
 * `not_verified`, which is exactly what caused the "Mentor Verification
 * Required" flash on every portal load.
 *
 * This module centralizes the three-state decision so every consumer
 * (route guard, home page, tests) resolves the same way:
 *
 *     loading        -> render a loading/skeleton UI
 *       |
 *       +----> verified      -> Mentor Space
 *       |
 *       +----> not_verified -> Mentor Verification Required
 *
 * `verified` is ONLY returned when the backend has definitively established
 * that the mentor is approved. `not_verified` is ONLY returned when the
 * backend has definitively established that the mentor is awaiting review
 * or has been rejected. Anything in between is `loading`.
 */

export type MentorVerificationState = 'loading' | 'verified' | 'not_verified';

export interface MentorVerificationInput {
  applicationStatus?: string | null;
  mentorProfileIsApproved?: boolean | null;
  mentorProfileApprovalStatus?: string | null;
  mentorProfileIsActive?: boolean | null;
  /** When true, the backend has definitively answered the verification query. */
  resolved: boolean;
}

/**
 * Resolve the three-state verification outcome from raw backend fields.
 *
 * `resolved` is the gate: until the onboarding/verification request has
 * settled, the state is always `loading`, regardless of what the nullable
 * fields happen to hold. This prevents a partially-resolved response (or a
 * transient null in the middle of a fetch) from being interpreted as
 * "not verified".
 *
 * Verification is considered definitive when EITHER:
 *   - the mentor application row reports status 'approved', OR
 *   - the mentor profile row reports is_approved/approval_status/is_active
 *     all true.
 *
 * Any other resolved combination is treated as not_verified. We do NOT
 * guess: a missing application row with `resolved: true` is not_verified,
 * because the mentor has no approved application on record.
 */
export function resolveMentorVerification(
  input: MentorVerificationInput,
): MentorVerificationState {
  if (!input.resolved) {
    return 'loading';
  }

  const applicationApproved = input.applicationStatus === 'approved';
  const profileApproved =
    input.mentorProfileIsApproved === true &&
    input.mentorProfileApprovalStatus === 'approved' &&
    input.mentorProfileIsActive === true;

  return applicationApproved || profileApproved ? 'verified' : 'not_verified';
}

/** Convenience predicate: is the mentor definitively verified? */
export function isMentorVerified(
  input: MentorVerificationInput,
): boolean {
  return resolveMentorVerification(input) === 'verified';
}

/** Convenience predicate: is the mentor definitively NOT verified? */
export function isMentorNotVerified(
  input: MentorVerificationInput,
): boolean {
  return resolveMentorVerification(input) === 'not_verified';
}

/** Convenience predicate: is the verification state still unresolved? */
export function isMentorVerificationLoading(
  input: MentorVerificationInput,
): boolean {
  return resolveMentorVerification(input) === 'loading';
}