import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditAction, type AuthInfo } from '../src/lib/auditLogger';

describe('Audit Logger', () => {
  it('auditAction does not throw when Supabase is not configured', async () => {
    // Should not throw even without a configured Supabase client
    await assert.doesNotReject(
      auditAction(
        { user: { id: 'admin-1', email: 'admin@example.com' }, roles: ['admin'] },
        'mentor_approved',
        {
          entityType: 'mentor_profile',
          entityId: 'mentor-1',
          requestId: 'req_test123',
          metadata: { action: 'approve' },
        },
      ),
    );
  });

  it('auditAction handles undefined auth gracefully', async () => {
    await assert.doesNotReject(
      auditAction(undefined, 'system_event', { metadata: { source: 'test' } }),
    );
  });

  it('auditAction handles missing metadata', async () => {
    await assert.doesNotReject(
      auditAction(
        { user: { id: 'admin-1', email: 'admin@example.com' }, roles: ['admin'] },
        'segment_created',
        {},
      ),
    );
  });
});