/**
 * ADMIN MENTOR OPERATIONAL CONTROL (domain rules)
 * ==============================================
 * Single source of truth for "what state is this mentor account in?" and
 * "what does an Admin status action write?".
 *
 * These functions are deliberately PURE so the exact same rules run in:
 *   - the Express API (server-side authorization),
 *   - the Admin UI (labels, which buttons to show),
 *   - the unit tests.
 *
 * The database remains the source of truth (prompt section 13): this module
 * only interprets rows that were READ from the database. It never invents a
 * status.
 *
 * Public mentor onboarding (self-signup -> verification -> admin approval) is
 * a SEPARATE flow and is deliberately not merged with Admin-created mentors
 * (prompt section 14 / TEST F).
 *
 * The `profiles.account_status` lifecycle itself is shared with the generic
 * user Control Center and lives in `adminAccountControl.ts`, so a mentor and a
 * seeker can never disagree about what a status action writes.
 */

import {
  buildAccountStatusUpdate,
  deriveAccountState,
  validateAccountStatusAction,
  type AccountProfileStatusUpdate,
  type AccountStatusAction,
} from '@/src/lib/adminAccountControl';

// ---------------------------------------------------------------------------
// Audit actions (prompt section 12)
// ---------------------------------------------------------------------------

export const MENTOR_ADMIN_AUDIT_ACTIONS = {
  CREATED: 'MENTOR_CREATED_BY_ADMIN',
  ACTIVATED: 'MENTOR_ACTIVATED',
  DEACTIVATED: 'MENTOR_DEACTIVATED',
  SUSPENDED: 'MENTOR_SUSPENDED',
  REACTIVATED: 'MENTOR_REACTIVATED',
  PROFILE_UPDATED: 'MENTOR_PROFILE_UPDATED_BY_ADMIN',
  SEGMENTS_UPDATED: 'MENTOR_SEGMENTS_UPDATED_BY_ADMIN',
  GIG_CREATED: 'MENTOR_GIG_CREATED_BY_ADMIN',
  GIG_UPDATED: 'MENTOR_GIG_UPDATED_BY_ADMIN',
  GIG_ARCHIVED: 'MENTOR_GIG_ARCHIVED_BY_ADMIN',
  AVAILABILITY_UPDATED: 'MENTOR_AVAILABILITY_UPDATED_BY_ADMIN',
} as const;

export type MentorAdminAuditAction =
  (typeof MENTOR_ADMIN_AUDIT_ACTIONS)[keyof typeof MENTOR_ADMIN_AUDIT_ACTIONS];

// ---------------------------------------------------------------------------
// Account status actions (prompt sections 3, 5, 6, 7)
// ---------------------------------------------------------------------------

export const MENTOR_STATUS_ACTIONS = ['activate', 'deactivate', 'suspend', 'reactivate'] as const;
export type MentorStatusAction = (typeof MENTOR_STATUS_ACTIONS)[number];

export function isMentorStatusAction(value: unknown): value is MentorStatusAction {
  return typeof value === 'string' && (MENTOR_STATUS_ACTIONS as readonly string[]).includes(value);
}

export function parseMentorStatusAction(value: unknown): MentorStatusAction | null {
  return isMentorStatusAction(value) ? value : null;
}

export interface MentorStatusActionSpec {
  /** Audit action recorded for this transition. */
  auditAction: MentorAdminAuditAction;
  /** Value written to `mentor_profiles.is_active`. */
  isActive: boolean;
  /** Value written to `profiles.account_status`. */
  accountStatus: 'active' | 'deactivated' | 'suspended';
  /** Whether the reason field is mandatory. */
  requiresReason: boolean;
  /** Whether `suspended_until` is accepted. */
  supportsSuspendedUntil: boolean;
  label: string;
}

export const MENTOR_STATUS_ACTION_SPECS: Record<MentorStatusAction, MentorStatusActionSpec> = {
  activate: {
    auditAction: MENTOR_ADMIN_AUDIT_ACTIONS.ACTIVATED,
    isActive: true,
    accountStatus: 'active',
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: 'Activate Mentor',
  },
  deactivate: {
    auditAction: MENTOR_ADMIN_AUDIT_ACTIONS.DEACTIVATED,
    isActive: false,
    accountStatus: 'deactivated',
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: 'Deactivate Mentor',
  },
  suspend: {
    auditAction: MENTOR_ADMIN_AUDIT_ACTIONS.SUSPENDED,
    isActive: false,
    accountStatus: 'suspended',
    requiresReason: true,
    supportsSuspendedUntil: true,
    label: 'Suspend Mentor',
  },
  reactivate: {
    auditAction: MENTOR_ADMIN_AUDIT_ACTIONS.REACTIVATED,
    isActive: true,
    accountStatus: 'active',
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: 'Reactivate Mentor',
  },
};


// ---------------------------------------------------------------------------
// Derived account state (prompt sections 4, 5, 7)
// ---------------------------------------------------------------------------

/**
 * The subset of database columns this module needs. Every field is nullable so
 * it can be fed straight from a partially-hydrated Supabase row.
 */
export interface MentorStatusSource {
  /** `mentor_profiles.approval_status` */
  approval_status?: string | null;
  /** `mentor_profiles.is_approved` */
  is_approved?: boolean | null;
  /** `mentor_profiles.is_active` */
  is_active?: boolean | null;
  /** `profiles.account_status` */
  account_status?: string | null;
  /** `profiles.suspended_until` */
  suspended_until?: string | null;
}

export interface MentorAccountState {
  /** approval_status === 'approved' (falls back to the legacy is_approved flag). */
  isApproved: boolean;
  /** `mentor_profiles.is_active`, as stored. */
  isActive: boolean;
  /** Suspension is in force right now. */
  isSuspended: boolean;
  /** A time-boxed suspension whose window has already elapsed. */
  isSuspensionLapsed: boolean;
  /** Admin explicitly turned the account off. */
  isDeactivated: boolean;
  /**
   * Approved + active + not suspended. This is the mentor-level eligibility
   * (section 4). Seeker discovery additionally requires an eligible segment,
   * an active gig and a valid bookable slot.
   */
  isEligible: boolean;
  /**
   * The mentor may perform normal operational actions (edit gigs, manage
   * availability, receive bookings). Blocked while deactivated or suspended.
   */
  canPerformOperationalActions: boolean;
}

/**
 * Interpret database columns into a single account state.
 *
 * `approval_status` is authoritative when present (it is the column the whole
 * verification flow writes). The legacy `is_approved` boolean is only consulted
 * for rows written before that column existed, so a row can never be reported
 * as "approved" purely because of a stale boolean.
 */
export function deriveMentorAccountState(
  source: MentorStatusSource,
  now: Date = new Date(),
): MentorAccountState {
  const approvalStatus = source.approval_status ?? null;
  const isApproved =
    approvalStatus !== null
      ? approvalStatus === 'approved'
      : source.is_approved === true;

  const isActive = source.is_active === true;
  const account = deriveAccountState(
    { account_status: source.account_status, suspended_until: source.suspended_until },
    now,
  );

  const isEligible = isApproved && isActive && account.isActive;

  return {
    isApproved,
    isActive,
    isSuspended: account.isSuspended,
    isSuspensionLapsed: account.isSuspensionLapsed,
    isDeactivated: account.isDeactivated,
    isEligible,
    canPerformOperationalActions: isEligible,
  };
}


// ---------------------------------------------------------------------------
// Status transitions (prompt sections 3, 5, 6, 7)
// ---------------------------------------------------------------------------

export interface MentorStatusUpdate {
  mentorProfile: {
    is_active: boolean;
    updated_at: string;
  };
  profile: AccountProfileStatusUpdate;
}

export interface BuildStatusUpdateInput {
  action: MentorStatusAction;
  /** The acting Admin. Recorded as `suspended_by` for a suspension. */
  adminId: string;
  reason?: string | null;
  /** ISO timestamp; must be in the future when supplied. */
  suspendedUntil?: string | null;
  now?: Date;
}

/**
 * Translate a status action into the exact column writes for
 * `mentor_profiles` and `profiles`.
 *
 * Deactivation and suspension are STATUS CHANGES ONLY. Nothing is ever
 * deleted: no profile, gig, availability row, booking, payment, workspace,
 * notification or audit record (prompt section 5).
 */
export function buildMentorStatusUpdate(input: BuildStatusUpdateInput): MentorStatusUpdate {
  const nowIso = (input.now ?? new Date()).toISOString();

  return {
    mentorProfile: {
      is_active: MENTOR_STATUS_ACTION_SPECS[input.action].isActive,
      updated_at: nowIso,
    },
    // Shared with the generic user Control Center: one definition of the
    // `profiles` writes, so a mentor and a seeker behave identically.
    profile: buildAccountStatusUpdate({
      action: input.action as AccountStatusAction,
      adminId: input.adminId,
      reason: input.reason,
      suspendedUntil: input.suspendedUntil,
      now: input.now,
    }),
  };
}


export type MentorStatusValidationCode =
  | 'VALIDATION_ERROR'
  | 'REASON_REQUIRED'
  | 'SUSPENDED_UNTIL_INVALID'
  | 'SUSPENDED_UNTIL_IN_PAST'
  | 'MENTOR_NOT_FOUND'
  | 'MENTOR_NOT_APPROVED';

export interface MentorStatusValidation {
  valid: boolean;
  code?: MentorStatusValidationCode;
  message?: string;
  /** Normalised reason, safe to persist. */
  reason?: string | null;
  suspendedUntil?: string | null;
}

/**
 * Validate a status action before anything is written.
 *
 * A suspension REQUIRES a reason (operational accountability), and
 * `suspended_until`, when supplied, must be in the future.
 */
export function validateMentorStatusAction(input: {
  action: unknown;
  reason?: unknown;
  suspendedUntil?: unknown;
  state?: MentorAccountState | null;
  now?: Date;
}): MentorStatusValidation {
  const action = parseMentorStatusAction(input.action);
  if (!action) {
    return {
      valid: false,
      code: 'VALIDATION_ERROR',
      message: `action must be one of: ${MENTOR_STATUS_ACTIONS.join(', ')}.`,
    };
  }

  // Reason and suspension-window rules are the shared account rules, so a
  // mentor and a seeker are validated identically.
  const base = validateAccountStatusAction({
    action,
    reason: input.reason,
    suspendedUntil: input.suspendedUntil,
    now: input.now,
  });
  if (!base.valid) {
    return { valid: false, code: base.code, message: base.message };
  }

  // Reactivating / activating requires the mentor to still be approved, so an
  // Admin cannot accidentally bypass the public verification flow by
  // force-activating a rejected applicant (prompt section 14 / TEST F).
  if ((action === 'activate' || action === 'reactivate') && input.state && !input.state.isApproved) {
    return {
      valid: false,
      code: 'MENTOR_NOT_APPROVED',
      message: 'This mentor is not approved. Approve the mentor before activating them.',
    };
  }

  return { valid: true, reason: base.reason ?? null, suspendedUntil: base.suspendedUntil ?? null };
}


// ---------------------------------------------------------------------------
// Admin-created mentors (prompt sections 1, 2)
// ---------------------------------------------------------------------------

/** Default column values for a mentor created directly by an Admin. */
export const ADMIN_CREATED_MENTOR_DEFAULTS = {
  approval_status: 'approved',
  is_approved: true,
  is_active: true,
  account_status: 'active',
} as const;

/**
 * A mentor created by an Admin through Add User is APPROVED and ACTIVE the
 * moment the account is created. The Admin's explicit creation action IS the
 * approval - no application, no documents, no second approval step.
 *
 * This is a direct mentor. It never gets a pending verification application.
 */
export function buildAdminCreatedMentorProfile(input: {
  headline?: string | null;
  about?: string | null;
  experienceYears?: number;
  now?: Date;
}): Record<string, unknown> {
  const nowIso = (input.now ?? new Date()).toISOString();
  return {
    headline: input.headline?.trim() || '',
    about: input.about?.trim() || null,
    experience_years:
      typeof input.experienceYears === 'number'
        && Number.isInteger(input.experienceYears)
        && input.experienceYears >= 0
        ? input.experienceYears
        : 0,
    languages: [] as unknown as string,
    rating: 0.0,
    review_count: 0,
    session_count: 0,
    is_approved: ADMIN_CREATED_MENTOR_DEFAULTS.is_approved,
    is_featured: false,
    approval_status: ADMIN_CREATED_MENTOR_DEFAULTS.approval_status,
    is_active: ADMIN_CREATED_MENTOR_DEFAULTS.is_active,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

/** Companion row values for `profiles` when an Admin creates a mentor. */
export function buildAdminCreatedAccountProfile(input: {
  fullName?: string | null;
  email: string;
  timezone?: string | null;
  now?: Date;
}): Record<string, unknown> {
  const nowIso = (input.now ?? new Date()).toISOString();
  return {
    full_name: input.fullName?.trim() || input.email,
    timezone: input.timezone?.trim() || 'Asia/Kolkata',
    account_status: ADMIN_CREATED_MENTOR_DEFAULTS.account_status,
    suspended_at: null,
    suspended_until: null,
    suspension_reason: null,
    suspended_by: null,
    internal_note: null,
    deactivated_at: null,
    updated_at: nowIso,
  };
}


// ---------------------------------------------------------------------------
// Presentation helpers for the Admin UI
// ---------------------------------------------------------------------------

export type MentorAccountBadge =
  | 'active'
  | 'deactivated'
  | 'suspended'
  | 'suspended_lapsed'
  | 'pending';

export function mentorAccountBadge(state: MentorAccountState): MentorAccountBadge {
  if (state.isDeactivated) return 'deactivated';
  if (state.isSuspended) return 'suspended';
  if (state.isSuspensionLapsed) return 'suspended_lapsed';
  if (!state.isApproved) return 'pending';
  return state.isActive ? 'active' : 'deactivated';
}

export const MENTOR_ACCOUNT_BADGE_LABELS: Record<MentorAccountBadge, string> = {
  active: 'Active',
  deactivated: 'Deactivated',
  suspended: 'Suspended',
  suspended_lapsed: 'Suspension Lapsed',
  pending: 'Pending Verification',
};

/** Status actions the Admin UI should offer for a mentor in this state. */
export function availableMentorStatusActions(state: MentorAccountState): MentorStatusAction[] {
  if (state.isSuspended) return ['reactivate', 'deactivate'];
  if (state.isDeactivated) return state.isApproved ? ['activate', 'suspend'] : [];
  if (state.isActive) return ['deactivate', 'suspend'];
  return state.isApproved ? ['activate', 'suspend'] : [];
}

// ---------------------------------------------------------------------------
// Mentor creation source (public signup vs admin direct create)
// ---------------------------------------------------------------------------

/**
 * How a mentor joined the platform.
 *
 *  - public_signup: /mentor/signup -> application -> documents -> review
 *  - admin_direct:  Admin -> Create User -> Mentor. Already approved and
 *                   active on creation; no application or documents exist,
 *                   and that is CORRECT, not an error state.
 *  - unknown:       a legacy row with no creation-source evidence. Rendered as
 *                   a neutral state; never guessed from a name or id.
 */
export const MENTOR_CREATION_SOURCES = ['public_signup', 'admin_direct', 'unknown'] as const;
export type MentorCreationSource = (typeof MENTOR_CREATION_SOURCES)[number];

export const MENTOR_CREATION_SOURCE_LABELS: Record<MentorCreationSource, string> = {
  public_signup: 'Public Mentor Signup',
  admin_direct: 'Admin Verified Mentor',
  unknown: 'Source Unknown',
};

export function isMentorCreationSource(value: unknown): value is MentorCreationSource {
  return (
    typeof value === 'string' && (MENTOR_CREATION_SOURCES as readonly string[]).includes(value)
  );
}

/** Evidence used to resolve the creation source, gathered from the database. */
export interface MentorCreationEvidence {
  /** `mentor_profiles.created_via` (null on legacy rows). */
  createdVia?: string | null;
  /** True when audit_logs holds a MENTOR_CREATED_BY_ADMIN event for this mentor. */
  hasAdminCreationAudit?: boolean;
  /** True when a mentor_applications row exists for this mentor. */
  hasApplication?: boolean;
}

/**
 * Resolve the creation source from real database evidence.
 *
 * Precedence is most-authoritative first:
 *   1. the explicit `created_via` column
 *   2. the MENTOR_CREATED_BY_ADMIN audit record
 *   3. application presence
 *   4. unknown - never guessed
 *
 * The audit trail is consulted BEFORE application presence so the answer does
 * not depend solely on "does an application row exist", which would misreport
 * an Admin-created mentor that later opened a draft application.
 */
export function resolveMentorCreationSource(
  evidence: MentorCreationEvidence,
): MentorCreationSource {
  if (isMentorCreationSource(evidence.createdVia) && evidence.createdVia !== 'unknown') {
    return evidence.createdVia;
  }
  if (evidence.hasAdminCreationAudit === true) return 'admin_direct';
  if (evidence.hasApplication === true) return 'public_signup';
  return 'unknown';
}

/**
 * An Admin-created mentor is already verified by definition: the Admin's
 * creation action IS the approval. Such a mentor legitimately has no
 * application, so the UI must present "Admin Verified" rather than an error.
 */
export function isAdminCreatedMentor(source: MentorCreationSource): boolean {
  return source === 'admin_direct';
}

/** Helper text shown for an Admin-created mentor. */
export const ADMIN_CREATED_MENTOR_HELPER =
  'This mentor was created directly by an administrator and is already verified. '
  + 'No public verification application is required.';

