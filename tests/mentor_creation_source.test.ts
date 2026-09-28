import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_CREATED_MENTOR_HELPER,
  MENTOR_CREATION_SOURCES,
  MENTOR_CREATION_SOURCE_LABELS,
  isAdminCreatedMentor,
  isMentorCreationSource,
  resolveMentorCreationSource,
} from '../src/lib/adminMentorControl';

describe('Mentor creation source resolution (prompt section 3)', () => {
  it('recognises exactly the three known sources', () => {
    assert.deepEqual([...MENTOR_CREATION_SOURCES], ['public_signup', 'admin_direct', 'unknown']);
    for (const source of MENTOR_CREATION_SOURCES) {
      assert.equal(isMentorCreationSource(source), true);
    }
    for (const bad of ['', 'admin', 'signup', null, undefined, 7]) {
      assert.equal(isMentorCreationSource(bad), false);
    }
  });

  it('prefers the explicit created_via column above all other evidence', () => {
    assert.equal(
      resolveMentorCreationSource({
        createdVia: 'admin_direct',
        hasAdminCreationAudit: false,
        hasApplication: true,
      }),
      'admin_direct',
    );
    assert.equal(
      resolveMentorCreationSource({
        createdVia: 'public_signup',
        hasAdminCreationAudit: true,
        hasApplication: false,
      }),
      'public_signup',
    );
  });

  it('falls back to the MENTOR_CREATED_BY_ADMIN audit record', () => {
    // This is the real signal already present in audit_logs.
    assert.equal(
      resolveMentorCreationSource({ createdVia: null, hasAdminCreationAudit: true, hasApplication: false }),
      'admin_direct',
    );
  });

  it('consults the audit record BEFORE application presence', () => {
    // An admin-created mentor that later opened a draft application must still
    // be reported as admin_direct, not misreported as a public signup.
    assert.equal(
      resolveMentorCreationSource({ createdVia: null, hasAdminCreationAudit: true, hasApplication: true }),
      'admin_direct',
    );
  });

  it('reports public_signup when only an application exists', () => {
    assert.equal(
      resolveMentorCreationSource({ createdVia: null, hasAdminCreationAudit: false, hasApplication: true }),
      'public_signup',
    );
  });

  it('reports unknown rather than guessing when there is no evidence', () => {
    assert.equal(
      resolveMentorCreationSource({ createdVia: null, hasAdminCreationAudit: false, hasApplication: false }),
      'unknown',
    );
    assert.equal(resolveMentorCreationSource({}), 'unknown');
  });

  it('ignores an unrecognised created_via value instead of trusting it', () => {
    assert.equal(
      resolveMentorCreationSource({ createdVia: 'made_up', hasAdminCreationAudit: true }),
      'admin_direct',
    );
    assert.equal(resolveMentorCreationSource({ createdVia: 'made_up' }), 'unknown');
  });
});

describe('TEST 1 - an admin-created mentor is never an error state', () => {
  it('is detected as admin-created without any application', () => {
    // The live data for the admin-created mentor: no application row, but a
    // MENTOR_CREATED_BY_ADMIN audit event.
    const source = resolveMentorCreationSource({
      createdVia: null,
      hasAdminCreationAudit: true,
      hasApplication: false,
    });

    assert.equal(source, 'admin_direct');
    assert.equal(isAdminCreatedMentor(source), true);
  });

  it('never requires a public verification application', () => {
    assert.match(ADMIN_CREATED_MENTOR_HELPER, /created directly by an administrator/i);
    assert.match(ADMIN_CREATED_MENTOR_HELPER, /already verified/i);
    assert.match(ADMIN_CREATED_MENTOR_HELPER, /No public verification application is required/i);
  });

  it('is labelled "Admin Verified Mentor" for the UI', () => {
    assert.equal(MENTOR_CREATION_SOURCE_LABELS.admin_direct, 'Admin Verified Mentor');
    assert.equal(MENTOR_CREATION_SOURCE_LABELS.public_signup, 'Public Mentor Signup');
  });

  it('does not treat a public mentor as admin-created', () => {
    assert.equal(
      isAdminCreatedMentor(resolveMentorCreationSource({ hasApplication: true })),
      false,
    );
    assert.equal(isAdminCreatedMentor('unknown'), false);
  });
});

describe('TEST 2 - a public mentor keeps the verification flow', () => {
  it('is reported as a public signup when an application exists', () => {
    const source = resolveMentorCreationSource({
      createdVia: null,
      hasAdminCreationAudit: false,
      hasApplication: true,
    });

    assert.equal(source, 'public_signup');
    assert.equal(isAdminCreatedMentor(source), false);
    assert.notEqual(MENTOR_CREATION_SOURCE_LABELS[source], 'Admin Verified Mentor');
  });

  it('is not collapsed into the admin flow by a created_via default', () => {
    // An explicit public_signup must survive even if audit rows are pruned.
    assert.equal(
      resolveMentorCreationSource({ createdVia: 'public_signup', hasAdminCreationAudit: false, hasApplication: false }),
      'public_signup',
    );
  });
});
