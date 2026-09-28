import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_STATUS_ACTION_SPECS,
  assertAdminAccountSafety,
  availableAccountStatusActions,
  buildAccountStatusUpdate,
  deriveAccountState,
  parseAccountStatusAction,
  validateAccountStatusAction,
} from '../src/lib/adminAccountControl';
import {
  buildMentorStatusUpdate,
  deriveMentorAccountState,
} from '../src/lib/adminMentorControl';

const NOW = new Date('2026-09-26T10:00:00.000Z');
const ADMIN_ID = '00000000-0000-4000-8000-00000000ad01';
const TARGET_ID = '00000000-0000-4000-8000-00000000beef';

describe('Admin Account Control', () => {
  // --------------------------------------------------------------------------
  // 1. Account status interpretation
  // --------------------------------------------------------------------------
  describe('deriveAccountState', () => {
    it('treats a null account_status as active (the database default)', () => {
      const state = deriveAccountState({ account_status: null, suspended_until: null }, NOW);
      assert.equal(state.accountStatus, 'active');
      assert.equal(state.isActive, true);
      assert.equal(state.canPerformOperationalActions, true);
    });

    it('blocks operational actions for a deactivated account', () => {
      const state = deriveAccountState({ account_status: 'deactivated' }, NOW);
      assert.equal(state.isDeactivated, true);
      assert.equal(state.isActive, false);
      assert.equal(state.canPerformOperationalActions, false);
    });

    it('blocks operational actions while a suspension window is open', () => {
      const state = deriveAccountState(
        { account_status: 'suspended', suspended_until: '2026-10-01T00:00:00.000Z' },
        NOW,
      );
      assert.equal(state.isSuspended, true);
      assert.equal(state.isSuspensionLapsed, false);
      assert.equal(state.canPerformOperationalActions, false);
    });

    it('reports an elapsed suspension window as lapsed, not as an active suspension', () => {
      const state = deriveAccountState(
        { account_status: 'suspended', suspended_until: '2026-09-01T00:00:00.000Z' },
        NOW,
      );
      assert.equal(state.isSuspended, false);
      assert.equal(state.isSuspensionLapsed, true);
      // The stored status is deliberately left untouched so an Admin still
      // sees and can clear the original action.
      assert.equal(state.accountStatus, 'suspended');
      assert.equal(state.canPerformOperationalActions, true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Action parsing
  // --------------------------------------------------------------------------
  describe('parseAccountStatusAction', () => {
    it('accepts only the four supported actions', () => {
      assert.equal(parseAccountStatusAction('activate'), 'activate');
      assert.equal(parseAccountStatusAction('deactivate'), 'deactivate');
      assert.equal(parseAccountStatusAction('suspend'), 'suspend');
      assert.equal(parseAccountStatusAction('reactivate'), 'reactivate');
      assert.equal(parseAccountStatusAction('delete'), null);
      assert.equal(parseAccountStatusAction(undefined), null);
      assert.equal(parseAccountStatusAction(42), null);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Validation
  // --------------------------------------------------------------------------
  describe('validateAccountStatusAction', () => {
    it('rejects an unknown action', () => {
      const result = validateAccountStatusAction({ action: 'nuke' });
      assert.equal(result.valid, false);
      assert.equal(result.code, 'VALIDATION_ERROR');
    });

    it('requires a reason for a suspension', () => {
      const result = validateAccountStatusAction({ action: 'suspend', now: NOW });
      assert.equal(result.valid, false);
      assert.equal(result.code, 'REASON_REQUIRED');
    });

    it('does not require a reason for a deactivation', () => {
      const result = validateAccountStatusAction({ action: 'deactivate', now: NOW });
      assert.equal(result.valid, true);
    });

    it('rejects a suspendedUntil in the past', () => {
      const result = validateAccountStatusAction({
        action: 'suspend',
        reason: 'Policy breach',
        suspendedUntil: '2026-09-01T00:00:00.000Z',
        now: NOW,
      });
      assert.equal(result.valid, false);
      assert.equal(result.code, 'SUSPENDED_UNTIL_IN_PAST');
    });

    it('rejects an unparseable suspendedUntil', () => {
      const result = validateAccountStatusAction({
        action: 'suspend',
        reason: 'Policy breach',
        suspendedUntil: 'not-a-date',
        now: NOW,
      });
      assert.equal(result.valid, false);
      assert.equal(result.code, 'SUSPENDED_UNTIL_INVALID');
    });

    it('normalises a valid suspendedUntil to an ISO string', () => {
      const result = validateAccountStatusAction({
        action: 'suspend',
        reason: '  Policy breach  ',
        suspendedUntil: '2026-10-01T00:00:00.000Z',
        now: NOW,
      });
      assert.equal(result.valid, true);
      assert.equal(result.reason, 'Policy breach');
      assert.equal(result.suspendedUntil, '2026-10-01T00:00:00.000Z');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Column writes (status change only, never a delete)
  // --------------------------------------------------------------------------
  describe('buildAccountStatusUpdate', () => {
    it('deactivates without touching any suspension marker', () => {
      const update = buildAccountStatusUpdate({ action: 'deactivate', adminId: ADMIN_ID, now: NOW });
      assert.equal(update.account_status, 'deactivated');
      assert.equal(update.deactivated_at, NOW.toISOString());
      assert.equal(update.suspended_at, null);
      assert.equal(update.suspended_until, null);
      assert.equal(update.suspension_reason, null);
      assert.equal(update.suspended_by, null);
    });

    it('persists the suspension reason, window and acting admin', () => {
      const update = buildAccountStatusUpdate({
        action: 'suspend',
        adminId: ADMIN_ID,
        reason: 'Repeated no-shows',
        suspendedUntil: '2026-10-01T00:00:00.000Z',
        now: NOW,
      });
      assert.equal(update.account_status, 'suspended');
      assert.equal(update.suspended_at, NOW.toISOString());
      assert.equal(update.suspended_until, '2026-10-01T00:00:00.000Z');
      assert.equal(update.suspension_reason, 'Repeated no-shows');
      assert.equal(update.suspended_by, ADMIN_ID);
      assert.equal(update.deactivated_at, null);
    });

    it('clears the suspension markers on reactivation but keeps the account active', () => {
      const update = buildAccountStatusUpdate({ action: 'reactivate', adminId: ADMIN_ID, now: NOW });
      assert.equal(update.account_status, 'active');
      assert.equal(update.suspended_at, null);
      assert.equal(update.suspended_until, null);
      assert.equal(update.suspension_reason, null);
      assert.equal(update.suspended_by, null);
      assert.equal(update.deactivated_at, null);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Available actions
  // --------------------------------------------------------------------------
  describe('availableAccountStatusActions', () => {
    it('offers deactivate and suspend to an active account', () => {
      const actions = availableAccountStatusActions(deriveAccountState({ account_status: 'active' }, NOW));
      assert.deepEqual(actions, ['deactivate', 'suspend']);
    });

    it('offers activate and suspend to a deactivated account', () => {
      const actions = availableAccountStatusActions(deriveAccountState({ account_status: 'deactivated' }, NOW));
      assert.deepEqual(actions, ['activate', 'suspend']);
    });

    it('offers reactivate to a suspended account', () => {
      const actions = availableAccountStatusActions(
        deriveAccountState({ account_status: 'suspended', suspended_until: '2026-12-01T00:00:00.000Z' }, NOW),
      );
      assert.deepEqual(actions, ['reactivate', 'deactivate']);
    });

    it('offers reactivate for a lapsed suspension so the stale status can be cleared', () => {
      const actions = availableAccountStatusActions(
        deriveAccountState({ account_status: 'suspended', suspended_until: '2026-01-01T00:00:00.000Z' }, NOW),
      );
      assert.ok(actions.includes('reactivate'));
    });
  });

  // --------------------------------------------------------------------------
  // 6. Admin safety
  // --------------------------------------------------------------------------
  describe('assertAdminAccountSafety', () => {
    const base = {
      adminId: ADMIN_ID,
      targetId: TARGET_ID,
      targetState: deriveAccountState({ account_status: 'active' }, NOW),
    };

    it('forbids an admin from changing their own status', () => {
      const result = assertAdminAccountSafety({
        ...base,
        action: 'deactivate',
        targetId: ADMIN_ID,
        targetRoles: ['admin'],
        activeAdminCount: 3,
      });
      assert.equal(result.allowed, false);
      assert.equal(result.code, 'SELF_STATUS_CHANGE_FORBIDDEN');
    });

    it('forbids deactivating the last active admin', () => {
      const result = assertAdminAccountSafety({
        ...base,
        action: 'deactivate',
        targetRoles: ['admin'],
        activeAdminCount: 1,
      });
      assert.equal(result.allowed, false);
      assert.equal(result.code, 'LAST_ACTIVE_ADMIN');
    });

    it('forbids suspending the last active admin', () => {
      const result = assertAdminAccountSafety({
        ...base,
        action: 'suspend',
        targetRoles: ['admin'],
        activeAdminCount: 1,
      });
      assert.equal(result.allowed, false);
      assert.equal(result.code, 'LAST_ACTIVE_ADMIN');
    });

    it('allows deactivating an admin while another active admin remains', () => {
      const result = assertAdminAccountSafety({
        ...base,
        action: 'deactivate',
        targetRoles: ['admin'],
        activeAdminCount: 2,
      });
      assert.equal(result.allowed, true);
    });

    it('allows deactivating the last admin when the target is NOT an admin', () => {
      const result = assertAdminAccountSafety({
        ...base,
        action: 'deactivate',
        targetRoles: ['seeker'],
        activeAdminCount: 1,
      });
      assert.equal(result.allowed, true);
    });

    it('rejects a no-op deactivation', () => {
      const result = assertAdminAccountSafety({
        ...base,
        action: 'deactivate',
        targetRoles: ['seeker'],
        activeAdminCount: 2,
        targetState: deriveAccountState({ account_status: 'deactivated' }, NOW),
      });
      assert.equal(result.allowed, false);
      assert.equal(result.code, 'NO_STATUS_CHANGE_NEEDED');
    });

    it('rejects a no-op suspension', () => {
      const result = assertAdminAccountSafety({
        ...base,
        action: 'suspend',
        targetRoles: ['seeker'],
        activeAdminCount: 2,
        targetState: deriveAccountState(
          { account_status: 'suspended', suspended_until: '2026-12-01T00:00:00.000Z' },
          NOW,
        ),
      });
      assert.equal(result.allowed, false);
      assert.equal(result.code, 'NO_STATUS_CHANGE_NEEDED');
    });
  });

  // --------------------------------------------------------------------------
  // 7. Shared behaviour with the Mentor Control Center
  // --------------------------------------------------------------------------
  describe('mentor control centre reuses the account rules', () => {
    it('writes the same profiles columns for a mentor suspension as for a user suspension', () => {
      const user = buildAccountStatusUpdate({
        action: 'suspend',
        adminId: ADMIN_ID,
        reason: 'Repeated no-shows',
        suspendedUntil: '2026-10-01T00:00:00.000Z',
        now: NOW,
      });
      const mentor = buildMentorStatusUpdate({
        action: 'suspend',
        adminId: ADMIN_ID,
        reason: 'Repeated no-shows',
        suspendedUntil: '2026-10-01T00:00:00.000Z',
        now: NOW,
      });
      assert.deepEqual(mentor.profile, user);
      // The mentor-specific write only adds the is_active flag.
      assert.equal(mentor.mentorProfile.is_active, false);
    });

    it('keeps mentor approval untouched so reactivation never re-opens verification', () => {
      const before = deriveMentorAccountState({
        approval_status: 'approved',
        is_approved: true,
        is_active: false,
        account_status: 'deactivated',
      }, NOW);
      assert.equal(before.isEligible, false);
      assert.equal(before.isApproved, true);

      const after = deriveMentorAccountState({
        approval_status: 'approved',
        is_approved: true,
        is_active: true,
        account_status: 'active',
      }, NOW);
      assert.equal(after.isEligible, true);
      assert.equal(after.isApproved, true);
    });

    it('still blocks a mentor whose account is suspended even while is_active is true', () => {
      const state = deriveMentorAccountState({
        approval_status: 'approved',
        is_approved: true,
        is_active: true,
        account_status: 'suspended',
        suspended_until: '2026-12-01T00:00:00.000Z',
      }, NOW);
      assert.equal(state.isEligible, false);
      assert.equal(state.canPerformOperationalActions, false);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Audit action coverage
  // --------------------------------------------------------------------------
  describe('audit actions', () => {
    it('maps every action to a distinct audit action', () => {
      const actions = Object.values(ACCOUNT_STATUS_ACTION_SPECS).map((spec) => spec.auditAction);
      assert.equal(new Set(actions).size, actions.length);
      assert.ok(actions.includes('USER_ACTIVATED'));
      assert.ok(actions.includes('USER_DEACTIVATED'));
      assert.ok(actions.includes('USER_SUSPENDED'));
      assert.ok(actions.includes('USER_REACTIVATED'));
    });
  });
});
