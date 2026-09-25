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
 */

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

function isSuspendedWindowElapsed(suspendedUntil: string | null | undefined, now: Date): boolean {
  if (!suspendedUntil) return false;
  const until = Date.parse(suspendedUntil);
  if (Number.isNaN(until)) return false;
  return now.getTime() >= until;
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

  const accountStatus = (source.account_status ?? 'active').toString();
  const suspendedByExpiry = accountStatus === 'suspended'
    && isSuspendedWindowElapsed(source.suspended_until, now);
  const isSuspended = accountStatus === 'suspended' && !suspendedByExpiry;
  const isSuspensionLapsed = suspendedByExpiry;
  const isDeactivated = accountStatus === 'deactivated';

  const isEligible = isApproved && isActive && !isSuspended && !isDeactivated;

  return {
    isApproved,
    isActive,
    isSuspended,
    isSuspensionLapsed,
    isDeactivated,
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
  profile: {
    account_status: 'active' | 'deactivated' | 'suspended';
    suspended_at: string | null;
    suspended_until: string | null;
    suspension_reason: string | null;
    suspended_by: string | null;
    deactivated_at: string | null;
    updated_at: string;
  };
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
  const spec = MENTOR_STATUS_ACTION_SPECS[input.action];
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const reason = input.reason?.trim() ? input.reason.trim() : null;
  const suspendedUntil = spec.supportsSuspendedUntil && input.suspendedUntil
    ? new Date(input.suspendedUntil).toISOString()
    : null;

  return {
    mentorProfile: {
      is_active: spec.isActive,
      updated_at: nowIso,
    },
    profile: {
      account_status: spec.accountStatus,
      // Activation, deactivation and reactivation all clear the suspension
      // markers. Historical suspension detail survives in audit_logs.
      suspended_at: spec.accountStatus === 'suspended' ? nowIso : null,
      suspended_until: spec.accountStatus === 'suspended' ? suspendedUntil : null,
      suspension_reason: spec.accountStatus === 'suspended' ? reason : null,
      suspended_by: spec.accountStatus === 'suspended' ? input.adminId : null,
      deactivated_at: spec.accountStatus === 'deactivated' ? nowIso : null,
      updated_at: nowIso,
    },
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

  const spec = MENTOR_STATUS_ACTION_SPECS[action];
  const now = input.now ?? new Date();
  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : null;

  if (spec.requiresReason && !reason) {
    return { valid: false, code: 'REASON_REQUIRED', message: 'A reason is required for this action.' };
  }

  let suspendedUntil: string | null = null;
  if (
    spec.supportsSuspendedUntil
    && input.suspendedUntil !== undefined
    && input.suspendedUntil !== null
    && input.suspendedUntil !== ''
  ) {
    if (typeof input.suspendedUntil !== 'string') {
      return { valid: false, code: 'SUSPENDED_UNTIL_INVALID', message: 'suspendedUntil must be an ISO timestamp.' };
    }
    const parsed = Date.parse(input.suspendedUntil);
    if (Number.isNaN(parsed)) {
      return { valid: false, code: 'SUSPENDED_UNTIL_INVALID', message: 'suspendedUntil must be an ISO timestamp.' };
    }
    if (parsed <= now.getTime()) {
      return { valid: false, code: 'SUSPENDED_UNTIL_IN_PAST', message: 'suspendedUntil must be in the future.' };
    }
    suspendedUntil = new Date(parsed).toISOString();
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

  return { valid: true, reason, suspendedUntil: suspendedUntil ?? null };
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
