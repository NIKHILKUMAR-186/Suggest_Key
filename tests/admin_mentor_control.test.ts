import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_CREATED_MENTOR_DEFAULTS,
  MENTOR_ACCOUNT_BADGE_LABELS,
  MENTOR_ADMIN_AUDIT_ACTIONS,
  MENTOR_STATUS_ACTIONS,
  MENTOR_STATUS_ACTION_SPECS,
  availableMentorStatusActions,
  buildAdminCreatedAccountProfile,
  buildAdminCreatedMentorProfile,
  buildMentorStatusUpdate,
  deriveMentorAccountState,
  isMentorStatusAction,
  mentorAccountBadge,
  parseMentorStatusAction,
  validateMentorStatusAction,
} from '../src/lib/adminMentorControl';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

const ACTIVE_MENTOR = {
  approval_status: 'approved',
  is_approved: true,
  is_active: true,
  account_status: 'active',
  suspended_until: null,
};

describe('TEST A - admin-created mentor is approved and active on creation', () => {
  it('writes approval_status=approved and is_active=true immediately', () => {
    const row = buildAdminCreatedMentorProfile({ headline: 'Career mentor', about: 'Ten years' });

    assert.equal(row.approval_status, 'approved');
    assert.equal(row.is_active, true);
    assert.equal(row.is_approved, true);
    assert.equal(row.headline, 'Career mentor');
    assert.equal(row.about, 'Ten years');
  });

  it('never creates a pending verification application', () => {
    // The direct-mentor path only ever writes mentor_profiles + profiles.
    // There is deliberately no mentor_applications write here, so no pending
    // application can be produced (prompt section 1 / TEST A).
    const row = buildAdminCreatedMentorProfile({});
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'status'), false);
    assert.equal(ADMIN_CREATED_MENTOR_DEFAULTS.approval_status, 'approved');
    assert.equal(ADMIN_CREATED_MENTOR_DEFAULTS.is_active, true);
  });

  it('defaults the companion profile row to active with no suspension', () => {
    const profile = buildAdminCreatedAccountProfile({
      fullName: 'Priya Sharma',
      email: 'priya@example.com',
      timezone: 'Asia/Kolkata',
      now: NOW,
    });

    assert.equal(profile.account_status, 'active');
    assert.equal(profile.suspended_at, null);
    assert.equal(profile.suspended_until, null);
    assert.equal(profile.suspension_reason, null);
    assert.equal(profile.suspended_by, null);
    assert.equal(profile.full_name, 'Priya Sharma');
  });

  it('derives an eligible state straight after creation', () => {
    const state = deriveMentorAccountState(ACTIVE_MENTOR, NOW);
    assert.equal(state.isApproved, true);
    assert.equal(state.isActive, true);
    assert.equal(state.isEligible, true);
    assert.equal(state.canPerformOperationalActions, true);
  });
});


describe('TEST C - reactivation', () => {
  it('writes is_active=true and account_status=active', () => {
    const update = buildMentorStatusUpdate({ action: 'activate', adminId: ADMIN_ID, now: NOW });

    assert.equal(update.mentorProfile.is_active, true);
    assert.equal(update.profile.account_status, 'active');
  });

  it('clears the deactivation marker', () => {
    const update = buildMentorStatusUpdate({ action: 'activate', adminId: ADMIN_ID, now: NOW });
    assert.equal(update.profile.deactivated_at, null);
  });

  it('makes an approved mentor eligible again with no new verification', () => {
    const state = deriveMentorAccountState(ACTIVE_MENTOR, NOW);
    assert.equal(state.isEligible, true);
  });

  it('refuses to activate a mentor who is not approved', () => {
    // Protects the public verification flow (prompt section 14 / TEST F).
    const pending = deriveMentorAccountState(
      { ...ACTIVE_MENTOR, approval_status: 'pending_review' },
      NOW,
    );
    const result = validateMentorStatusAction({
      action: 'activate',
      state: pending,
      now: NOW,
    });

    assert.equal(result.valid, false);
    assert.equal(result.code, 'MENTOR_NOT_APPROVED');
  });
});

describe('TEST B - deactivation is a status change, never a deletion', () => {
  it('writes is_active=false and account_status=deactivated', () => {
    const update = buildMentorStatusUpdate({ action: 'deactivate', adminId: ADMIN_ID, now: NOW });

    assert.equal(update.mentorProfile.is_active, false);
    assert.equal(update.profile.account_status, 'deactivated');
    assert.equal(update.profile.deactivated_at, NOW.toISOString());
  });

  it('produces no delete instructions of any kind', () => {
    const update = buildMentorStatusUpdate({ action: 'deactivate', adminId: ADMIN_ID, now: NOW });
    const serialised = JSON.stringify(update);

    // Deactivation is a status change, NOT data deletion (prompt section 5).
    for (const forbidden of ['delete', 'drop', 'truncate', 'cascade']) {
      assert.equal(serialised.includes(forbidden), false, `unexpected "${forbidden}" in status update`);
    }
  });

  it('makes the mentor immediately ineligible and blocks operational actions', () => {
    const state = deriveMentorAccountState(
      { ...ACTIVE_MENTOR, is_active: false, account_status: 'deactivated' },
      NOW,
    );

    assert.equal(state.isEligible, false);
    assert.equal(state.canPerformOperationalActions, false);
    assert.equal(state.isDeactivated, true);
  });

  it('keeps approval intact so reactivation needs no re-verification', () => {
    // TEST C: approval_status is never touched by deactivate/reactivate, so the
    // mentor never has to repeat verification.
    const off = buildMentorStatusUpdate({ action: 'deactivate', adminId: ADMIN_ID, now: NOW });
    assert.equal(Object.prototype.hasOwnProperty.call(off.mentorProfile, 'approval_status'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(off.mentorProfile, 'is_approved'), false);
  });
});


describe('Status action parsing', () => {
  it('accepts exactly the four documented actions', () => {
    assert.deepEqual([...MENTOR_STATUS_ACTIONS], ['activate', 'deactivate', 'suspend', 'reactivate']);
    for (const action of MENTOR_STATUS_ACTIONS) {
      assert.equal(isMentorStatusAction(action), true);
      assert.equal(parseMentorStatusAction(action), action);
    }
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'delete', 'remove', 'destroy', null, undefined, 42, {}]) {
      assert.equal(isMentorStatusAction(bad), false);
      assert.equal(parseMentorStatusAction(bad), null);
    }
  });

  it('validates the request body', () => {
    const result = validateMentorStatusAction({ action: 'nuke', now: NOW });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'VALIDATION_ERROR');
  });

  it('requires a reason only for suspend', () => {
    assert.equal(MENTOR_STATUS_ACTION_SPECS.suspend.requiresReason, true);
    for (const action of ['activate', 'deactivate', 'reactivate'] as const) {
      assert.equal(MENTOR_STATUS_ACTION_SPECS[action].requiresReason, false);
    }
  });
});

describe('TEST D - suspension', () => {
  const suspendedMentor = {
    ...ACTIVE_MENTOR,
    is_active: false,
    account_status: 'suspended',
    suspended_until: '2026-10-01T00:00:00.000Z',
  };

  it('records suspended_at, suspended_until, reason and suspended_by', () => {
    const update = buildMentorStatusUpdate({
      action: 'suspend',
      adminId: ADMIN_ID,
      reason: 'Repeated no-shows',
      suspendedUntil: '2026-10-01T00:00:00.000Z',
      now: NOW,
    });

    assert.equal(update.mentorProfile.is_active, false);
    assert.equal(update.profile.account_status, 'suspended');
    assert.equal(update.profile.suspended_at, NOW.toISOString());
    assert.equal(update.profile.suspended_until, '2026-10-01T00:00:00.000Z');
    assert.equal(update.profile.suspension_reason, 'Repeated no-shows');
    assert.equal(update.profile.suspended_by, ADMIN_ID);
  });

  it('requires a reason', () => {
    const result = validateMentorStatusAction({ action: 'suspend', now: NOW });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'REASON_REQUIRED');
  });

  it('rejects a suspended_until in the past', () => {
    const result = validateMentorStatusAction({
      action: 'suspend',
      reason: 'Policy breach',
      suspendedUntil: '2026-01-01T00:00:00.000Z',
      now: NOW,
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'SUSPENDED_UNTIL_IN_PAST');
  });

  it('blocks operations and discoverability while in force', () => {
    const state = deriveMentorAccountState(suspendedMentor, NOW);
    assert.equal(state.isSuspended, true);
    assert.equal(state.isEligible, false);
    assert.equal(state.canPerformOperationalActions, false);
  });

  it('lapses automatically once suspended_until has passed', () => {
    const after = deriveMentorAccountState(suspendedMentor, new Date('2026-10-02T00:00:00.000Z'));
    assert.equal(after.isSuspended, false);
    assert.equal(after.isSuspensionLapsed, true);
    // Still needs an explicit Admin activation to become discoverable again.
    assert.equal(after.canPerformOperationalActions, false);
  });

  it('reactivate clears every suspension marker', () => {
    const update = buildMentorStatusUpdate({ action: 'reactivate', adminId: ADMIN_ID, now: NOW });

    assert.equal(update.mentorProfile.is_active, true);
    assert.equal(update.profile.account_status, 'active');
    assert.equal(update.profile.suspended_at, null);
    assert.equal(update.profile.suspended_until, null);
    assert.equal(update.profile.suspension_reason, null);
    assert.equal(update.profile.suspended_by, null);
  });
});


describe('State derivation is driven by stored columns, not hardcoded', () => {
  it('treats approval_status as authoritative over the legacy is_approved flag', () => {
    // A stale is_approved=true must not make a pending applicant look approved.
    const state = deriveMentorAccountState(
      { approval_status: 'pending_review', is_approved: true, is_active: true, account_status: 'active' },
      NOW,
    );
    assert.equal(state.isApproved, false);
    assert.equal(state.isEligible, false);
  });

  it('falls back to is_approved only when approval_status is absent', () => {
    const state = deriveMentorAccountState(
      { approval_status: null, is_approved: true, is_active: true, account_status: 'active' },
      NOW,
    );
    assert.equal(state.isApproved, true);
  });

  it('defaults an absent account_status to active', () => {
    const state = deriveMentorAccountState(
      { approval_status: 'approved', is_active: true },
      NOW,
    );
    assert.equal(state.isDeactivated, false);
    assert.equal(state.isSuspended, false);
    assert.equal(state.isEligible, true);
  });

  it('requires every one of approved + active to be eligible', () => {
    assert.equal(deriveMentorAccountState({ approval_status: 'approved', is_active: false }, NOW).isEligible, false);
    assert.equal(deriveMentorAccountState({ approval_status: 'draft', is_active: true }, NOW).isEligible, false);
  });
});

describe('Audit action names (prompt section 12)', () => {
  it('uses the exact documented action strings', () => {
    assert.deepEqual(MENTOR_ADMIN_AUDIT_ACTIONS, {
      CREATED: 'MENTOR_CREATED_BY_ADMIN',
      ACTIVATED: 'MENTOR_ACTIVATED',
      DEACTIVATED: 'MENTOR_DEACTIVATED',
      SUSPENDED: 'MENTOR_SUSPENDED',
      REACTIVATED: 'MENTOR_REACTIVATED',
      PROFILE_UPDATED: 'MENTOR_PROFILE_UPDATED_BY_ADMIN',
      // Segment membership is its own audited operation.
      SEGMENTS_UPDATED: 'MENTOR_SEGMENTS_UPDATED_BY_ADMIN',
      GIG_CREATED: 'MENTOR_GIG_CREATED_BY_ADMIN',
      GIG_UPDATED: 'MENTOR_GIG_UPDATED_BY_ADMIN',
      GIG_ARCHIVED: 'MENTOR_GIG_ARCHIVED_BY_ADMIN',
      AVAILABILITY_UPDATED: 'MENTOR_AVAILABILITY_UPDATED_BY_ADMIN',
    });
  });

  it('maps every status action to a distinct audit action', () => {
    const actions = MENTOR_STATUS_ACTIONS.map((a) => MENTOR_STATUS_ACTION_SPECS[a].auditAction);
    assert.equal(new Set(actions).size, MENTOR_STATUS_ACTIONS.length);
    assert.ok(actions.includes('MENTOR_ACTIVATED'));
    assert.ok(actions.includes('MENTOR_DEACTIVATED'));
    assert.ok(actions.includes('MENTOR_SUSPENDED'));
    assert.ok(actions.includes('MENTOR_REACTIVATED'));
  });
});


describe('Admin UI helpers', () => {
  it('labels each account state', () => {
    assert.equal(mentorAccountBadge(deriveMentorAccountState(ACTIVE_MENTOR, NOW)), 'active');
    assert.equal(
      mentorAccountBadge(deriveMentorAccountState({ ...ACTIVE_MENTOR, account_status: 'deactivated', is_active: false }, NOW)),
      'deactivated',
    );
    assert.equal(
      mentorAccountBadge(deriveMentorAccountState({ ...ACTIVE_MENTOR, account_status: 'suspended', is_active: false }, NOW)),
      'suspended',
    );
    assert.equal(
      mentorAccountBadge(deriveMentorAccountState({ ...ACTIVE_MENTOR, approval_status: 'pending_review' }, NOW)),
      'pending',
    );
    assert.equal(MENTOR_ACCOUNT_BADGE_LABELS.suspended, 'Suspended');
  });

  it('always offers Admin a way to bring a suspended mentor back', () => {
    const state = deriveMentorAccountState(
      { ...ACTIVE_MENTOR, account_status: 'suspended', is_active: false },
      NOW,
    );
    const available = availableMentorStatusActions(state);
    assert.ok(available.includes('reactivate'));
    assert.ok(available.includes('deactivate'));
  });

  it('offers activate for a deactivated approved mentor', () => {
    const state = deriveMentorAccountState(
      { ...ACTIVE_MENTOR, account_status: 'deactivated', is_active: false },
      NOW,
    );
    assert.ok(availableMentorStatusActions(state).includes('activate'));
  });

  it('offers nothing operational for an unapproved mentor', () => {
    const state = deriveMentorAccountState({ approval_status: 'pending_review', is_active: false }, NOW);
    assert.deepEqual(availableMentorStatusActions(state), []);
  });
});
