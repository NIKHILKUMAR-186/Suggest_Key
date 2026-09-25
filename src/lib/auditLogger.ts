import type { User } from '@supabase/supabase-js';
import type { UserRole } from '@/src/types/navigation';
import { logAuditEvent } from '@/src/lib/logger';

export interface AuthInfo {
  user: { id: string; email?: string | null; aud?: string };
  roles: UserRole[];
}

export interface AuditActionOptions {
  entityType?: string;
  entityId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

export async function auditAction(
  auth: AuthInfo | undefined,
  action: string,
  options: AuditActionOptions,
): Promise<void> {
  const userId = auth?.user?.id;
  const role = auth?.roles?.includes('admin')
    ? 'admin'
    : auth?.roles?.includes('mentor')
      ? 'mentor'
      : auth?.roles?.includes('seeker')
        ? 'seeker'
        : undefined;

  await logAuditEvent({
    actorUserId: userId,
    actorRole: role,
    action,
    entityType: options.entityType,
    entityId: options.entityId,
    requestId: options.requestId,
    metadata: options.metadata,
  }).catch(() => {});
}
