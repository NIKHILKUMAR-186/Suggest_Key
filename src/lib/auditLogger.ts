import { getSupabaseAdmin } from './supabaseServer';
import type { AuthRequest } from './supabaseServer';

export type AuditAction =
  | 'mentor_approved'
  | 'mentor_rejected'
  | 'mentor_activated'
  | 'mentor_deactivated'
  | 'segment_created'
  | 'segment_edited'
  | 'segment_priority_changed'
  | 'segment_activated'
  | 'segment_deactivated'
  | 'payment_approved'
  | 'payment_rejected'
  | 'booking_cancelled'
  | 'user_role_changed'
  | 'user_role_assigned'
  | 'user_role_revoked'
  | 'workspace_published'
  | 'workspace_saved'
  | 'notification_dispatched'
  | 'mentor_application_approved'
  | 'mentor_application_rejected'
  | 'mentor_document_reviewed'
  | string;

interface AuditParams {
  actor: AuthRequest['auth'] | { user?: { id?: string } | null; roles?: string[] } | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

function getActorInfo(actor: AuditParams['actor']): { userId: string | null; role: string | null } {
  if (!actor?.user) return { userId: null, role: null };
  const roles = Array.isArray(actor.roles) ? actor.roles : [];
  const role = roles.includes('admin')
    ? 'admin'
    : roles.includes('mentor')
      ? 'mentor'
      : roles.includes('seeker')
        ? 'seeker'
        : roles[0] || null;
  return { userId: actor.user.id || null, role };
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  const { userId, role } = getActorInfo(params.actor);
  const admin = getSupabaseAdmin();
  if (!admin) {
    console.error('[Audit] Supabase admin client unavailable; audit entry not persisted');
    return;
  }
  try {
    const { error } = await admin.from('audit_logs').insert({
      actor_user_id: userId,
      actor_role: role,
      action: params.action,
      entity_type: params.entityType || null,
      entity_id: params.entityId || null,
      request_id: params.requestId || null,
      metadata: params.metadata || {},
    });
    if (error) {
      console.error('[Audit] Failed to insert audit log:', error.message);
    }
  } catch (err: any) {
    console.error('[Audit] Exception writing audit log:', err?.message || err);
  }
}

export function auditAction(
  actor: AuditParams['actor'],
  action: AuditAction,
  overrides: Omit<AuditParams, 'actor' | 'action'> = {},
) {
  return writeAuditLog({ actor, action, ...overrides });
}