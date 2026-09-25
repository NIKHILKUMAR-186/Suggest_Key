/**
 * ADMIN ACCOUNT OPERATIONAL CONTROL (domain rules)
 * ================================================
 * Single source of truth for the `profiles.account_status` lifecycle that the
 * Admin Control Center drives for ANY user (seeker, mentor or admin).
 *
 * Pure functions only, so the exact same rules run in:
 *   - the Express API (server-side authorization),
 *   - the Admin UI (labels, which buttons to show),
 *   - the unit tests.
 *
 * `adminMentorControl.ts` layers the mentor-only `mentor_profiles.is_active` and
 * approval rules on top of the profile writes defined here, so the two control
 * centers can never disagree about what a status action writes.
 *
 * The database remains the source of truth: this module only interprets rows
 * that were READ from the database. It never invents a status.
 */

// ---------------------------------------------------------------------------
// Audit actions
// ---------------------------------------------------------------------------

export const ACCOUNT_ADMIN_AUDIT_ACTIONS = {
  ACTIVATED: 'USER_ACTIVATED',
  DEACTIVATED: 'USER_DEACTIVATED',
  SUSPENDED: 'USER_SUSPENDED',
  REACTIVATED: 'USER_REACTIVATED',
} as const;

export type AccountAdminAuditAction =
  (typeof ACCOUNT_ADMIN_AUDIT_ACTIONS)[keyof typeof ACCOUNT_ADMIN_AUDIT_ACTIONS];

// ---------------------------------------------------------------------------
// Account status actions
// ---------------------------------------------------------------------------

export const ACCOUNT_STATUS_ACTIONS = ['activate', 'deactivate', 'suspend', 'reactivate'] as const;
export type AccountStatusAction = (typeof ACCOUNT_STATUS_ACTIONS)[number];

export function isAccountStatusAction(value: unknown): value is AccountStatusAction {
  return typeof value === 'string' && (ACCOUNT_STATUS_ACTIONS as readonly string[]).includes(value);
}

export function parseAccountStatusAction(value: unknown): AccountStatusAction | null {
  return isAccountStatusAction(value) ? value : null;
}

export interface AccountStatusActionSpec {
  /** Audit action recorded for this transition. */
  auditAction: AccountAdminAuditAction;
  /** Value written to `profiles.account_status`. */
  accountStatus: 'active' | 'deactivated' | 'suspended';
  /** Whether the reason field is mandatory. */
  requiresReason: boolean;
  /** Whether `suspended_until` is accepted. */
  supportsSuspendedUntil: boolean;
  label: string;
  /** Confirmation copy shown before the write. */
  confirmation: string;
}

export const ACCOUNT_STATUS_ACTION_SPECS: Record<AccountStatusAction, AccountStatusActionSpec> = {
  activate: {
    auditAction: ACCOUNT_ADMIN_AUDIT_ACTIONS.ACTIVATED,
    accountStatus: 'active',
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: 'Activate',
    confirmation:
      'This account becomes active again. The user regains normal platform access and existing records stay intact.',
  },
  deactivate: {
    auditAction: ACCOUNT_ADMIN_AUDIT_ACTIONS.DEACTIVATED,
    accountStatus: 'deactivated',
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: 'Deactivate',
    confirmation:
      'This user will no longer be able to perform normal platform operations or start new bookings. '
      + 'Profile, bookings, payments, workspaces, notifications and audit history are all preserved.',
  },
  suspend: {
    auditAction: ACCOUNT_ADMIN_AUDIT_ACTIONS.SUSPENDED,
    accountStatus: 'suspended',
    requiresReason: true,
    supportsSuspendedUntil: true,
    label: 'Suspend',
    confirmation:
      'This user is not discoverable and cannot start new bookings until the suspension is lifted. '
      + 'Historical data is preserved.',
  },
  reactivate: {
    auditAction: ACCOUNT_ADMIN_AUDIT_ACTIONS.REACTIVATED,
    accountStatus: 'active',
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: 'Reactivate',
    confirmation:
      'Suspension is lifted and the account returns to normal operation. The user does not need to recreate their account.',
  },
};

// ---------------------------------------------------------------------------
// Derived account state
// ---------------------------------------------------------------------------

/** The `profiles` columns this module needs. Every field is nullable. */
export interface AccountStatusSource {
  /** `profiles.account_status` */
  account_status?: string | null;
  /** `profiles.suspended_until` */
  suspended_until?: string | null;
}

export interface AccountState {
  /** The raw stored status, normalised to one of the three known values. */
  accountStatus: 'active' | 'deactivated' | 'suspended';
  /** Suspension is in force right now. */
  isSuspended: boolean;
  /** A time-boxed suspension whose window has already elapsed. */
  isSuspensionLapsed: boolean;
  /** Admin explicitly turned the account off. */
  isDeactivated: boolean;
  /** Not suspended and not deactivated. */
  isActive: boolean;
  /**
   * The user may perform normal platform operations (create bookings, edit
   * their own profile, receive notifications). Blocked while deactivated or
   * suspended.
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
 * Interpret `profiles` columns into a single account state.
 *
 * A suspension whose `suspended_until` has already passed is reported as
 * LAPSED, not as an active suspension: the window is over, so the account is
 * operationally usable again, but the stored `account_status` is deliberately
 * left untouched so an Admin still sees (and can clear) the original action.
 */
export function deriveAccountState(
  source: AccountStatusSource,
  now: Date = new Date(),
): AccountState {
  const raw = (source.account_status ?? 'active').toString().toLowerCase();
  const accountStatus: AccountState['accountStatus'] =
    raw === 'suspended' ? 'suspended' : raw === 'deactivated' ? 'deactivated' : 'active';

  const suspendedByExpiry =
    accountStatus === 'suspended' && isSuspendedWindowElapsed(source.suspended_until, now);

  const isSuspended = accountStatus === 'suspended' && !suspendedByExpiry;
  const isSuspensionLapsed = suspendedByExpiry;
  const isDeactivated = accountStatus === 'deactivated';
  const isActive = !isSuspended && !isDeactivated;

  return {
    accountStatus,
    isSuspended,
    isSuspensionLapsed,
    isDeactivated,
    isActive,
    canPerformOperationalActions: isActive,
  };
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/** Exact column writes for `profiles`. Never deletes anything. */
export interface AccountProfileStatusUpdate {
  account_status: 'active' | 'deactivated' | 'suspended';
  suspended_at: string | null;
  suspended_until: string | null;
  suspension_reason: string | null;
  suspended_by: string | null;
  deactivated_at: string | null;
  updated_at: string;
}

export interface BuildAccountStatusUpdateInput {
  action: AccountStatusAction;
  /** The acting Admin. Recorded as `suspended_by` for a suspension. */
  adminId: string;
  reason?: string | null;
  /** ISO timestamp; must be in the future when supplied. */
  suspendedUntil?: string | null;
  now?: Date;
}

/**
 * Translate a status action into the exact `profiles` column writes.
 *
 * Deactivation and suspension are STATUS CHANGES ONLY. Nothing is ever deleted:
 * no profile row, booking, payment, workspace, notification or audit record.
 * Activation and reactivation clear the suspension markers; the historical
 * suspension detail survives in `audit_logs`.
 */
export function buildAccountStatusUpdate(
  input: BuildAccountStatusUpdateInput,
): AccountProfileStatusUpdate {
  const spec = ACCOUNT_STATUS_ACTION_SPECS[input.action];
  const nowIso = (input.now ?? new Date()).toISOString();
  const reason = input.reason?.trim() ? input.reason.trim() : null;
  const suspendedUntil =
    spec.supportsSuspendedUntil && input.suspendedUntil
      ? new Date(input.suspendedUntil).toISOString()
      : null;
  const isSuspension = spec.accountStatus === 'suspended';

  return {
    account_status: spec.accountStatus,
    suspended_at: isSuspension ? nowIso : null,
    suspended_until: isSuspension ? suspendedUntil : null,
    suspension_reason: isSuspension ? reason : null,
    suspended_by: isSuspension ? input.adminId : null,
    deactivated_at: spec.accountStatus === 'deactivated' ? nowIso : null,
    updated_at: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type AccountStatusValidationCode =
  | 'VALIDATION_ERROR'
  | 'REASON_REQUIRED'
  | 'SUSPENDED_UNTIL_INVALID'
  | 'SUSPENDED_UNTIL_IN_PAST';

export interface AccountStatusValidation {
  valid: boolean;
  code?: AccountStatusValidationCode;
  message?: string;
  /** Normalised reason, safe to persist. */
  reason?: string | null;
  suspendedUntil?: string | null;
}

/**
 * Validate a status action before anything is written.
 *
 * A suspension REQUIRES a reason (operational accountability), and
 * `suspendedUntil`, when supplied, must be in the future.
 */
export function validateAccountStatusAction(input: {
  action: unknown;
  reason?: unknown;
  suspendedUntil?: unknown;
  now?: Date;
}): AccountStatusValidation {
  const action = parseAccountStatusAction(input.action);
  if (!action) {
    return {
      valid: false,
      code: 'VALIDATION_ERROR',
      message: `action must be one of: ${ACCOUNT_STATUS_ACTIONS.join(', ')}.`,
    };
  }

  const spec = ACCOUNT_STATUS_ACTION_SPECS[action];
  const now = input.now ?? new Date();
  const reason =
    typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : null;

  if (spec.requiresReason && !reason) {
    return { valid: false, code: 'REASON_REQUIRED', message: 'A reason is required for this action.' };
  }

  let suspendedUntil: string | null = null;
  if (
    spec.supportsSuspendedUntil &&
    input.suspendedUntil !== undefined &&
    input.suspendedUntil !== null &&
    input.suspendedUntil !== ''
  ) {
    if (typeof input.suspendedUntil !== 'string') {
      return {
        valid: false,
        code: 'SUSPENDED_UNTIL_INVALID',
        message: 'suspendedUntil must be an ISO timestamp.',
      };
    }
    const parsed = Date.parse(input.suspendedUntil);
    if (Number.isNaN(parsed)) {
      return {
        valid: false,
        code: 'SUSPENDED_UNTIL_INVALID',
        message: 'suspendedUntil must be an ISO timestamp.',
      };
    }
    if (parsed <= now.getTime()) {
      return {
        valid: false,
        code: 'SUSPENDED_UNTIL_IN_PAST',
        message: 'suspendedUntil must be in the future.',
      };
    }
    suspendedUntil = new Date(parsed).toISOString();
  }

  return { valid: true, reason, suspendedUntil };
}

// ---------------------------------------------------------------------------
// Presentation helpers for the Admin UI
// ---------------------------------------------------------------------------

export type AccountBadge = 'active' | 'deactivated' | 'suspended' | 'suspended_lapsed';

export function accountBadge(state: AccountState): AccountBadge {
  if (state.isDeactivated) return 'deactivated';
  if (state.isSuspended) return 'suspended';
  if (state.isSuspensionLapsed) return 'suspended_lapsed';
  return 'active';
}

export const ACCOUNT_BADGE_LABELS: Record<AccountBadge, string> = {
  active: 'Active',
  deactivated: 'Deactivated',
  suspended: 'Suspended',
  suspended_lapsed: 'Suspension Lapsed',
};

/** Status actions the Admin UI should offer for an account in this state. */
export function availableAccountStatusActions(state: AccountState): AccountStatusAction[] {
  if (state.isSuspended) return ['reactivate', 'deactivate'];
  if (state.isDeactivated) return ['activate', 'suspend'];
  // A lapsed suspension is operationally active, so the honest options are
  // "clear the stale suspension" and "suspend again".
  if (state.isSuspensionLapsed) return ['reactivate', 'suspend'];
  return ['deactivate', 'suspend'];
}

// ---------------------------------------------------------------------------
// Admin safety
// ---------------------------------------------------------------------------

export type AdminSafetyCode =
  | 'SELF_STATUS_CHANGE_FORBIDDEN'
  | 'LAST_ACTIVE_ADMIN'
  | 'NO_STATUS_CHANGE_NEEDED';

export interface AdminSafetyResult {
  allowed: boolean;
  code?: AdminSafetyCode;
  message?: string;
}

/**
 * Guard the platform-critical Admin invariants.
 *
 * An Admin must not be able to lock the platform out of its own admin area, so:
 *   1. nobody may change their own account status;
 *   2. the last ACTIVE admin may not be deactivated or suspended;
 *   3. an action that would not change the stored state is rejected rather than
 *      silently re-written, so the audit log never records a no-op as a change.
 */
export function assertAdminAccountSafety(input: {
  action: AccountStatusAction;
  adminId: string;
  targetId: string;
  /** Roles currently assigned to the TARGET account. */
  targetRoles: readonly string[];
  /** How many admin accounts are currently active. */
  activeAdminCount: number;
  /** Derived state of the TARGET account. */
  targetState: AccountState;
}): AdminSafetyResult {
  const { action, adminId, targetId, targetRoles, activeAdminCount, targetState } = input;

  if (targetId === adminId) {
    return {
      allowed: false,
      code: 'SELF_STATUS_CHANGE_FORBIDDEN',
      message: 'Administrators cannot change their own account status.',
    };
  }

  const targetIsAdmin = targetRoles.includes('admin');
  const wouldDisable = action === 'deactivate' || action === 'suspend';

  if (targetIsAdmin && wouldDisable && activeAdminCount <= 1) {
    return {
      allowed: false,
      code: 'LAST_ACTIVE_ADMIN',
      message: `Cannot ${action} this administrator: it is the last active admin account. `
        + 'Promote or restore another admin first.',
    };
  }

  if (action === 'activate' && !targetState.isActive) {
    return { allowed: true };
  }
  if (action === 'reactivate' && !targetState.isActive) {
    return { allowed: true };
  }
  if (action === 'deactivate' && targetState.isDeactivated) {
    return {
      allowed: false,
      code: 'NO_STATUS_CHANGE_NEEDED',
      message: 'This account is already deactivated.',
    };
  }
  if (action === 'suspend' && targetState.isSuspended) {
    return {
      allowed: false,
      code: 'NO_STATUS_CHANGE_NEEDED',
      message: 'This account is already suspended.',
    };
  }

  return { allowed: true };
}
