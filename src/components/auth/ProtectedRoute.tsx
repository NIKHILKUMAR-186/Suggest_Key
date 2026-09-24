import React from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import type { UserRole } from '@/src/types/auth';
import { ShieldAlert, LogIn, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  requireAuth?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  requireAuth = true,
}) => {
  const { user, roles, isAuthenticated, isLoading, activeRole } = useAuth();
  const { navigate, currentPath } = useNavigation();

  // 1. Loading State
  if (isLoading) {
return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center space-y-4">
      <RefreshCw className="h-8 w-8 text-[var(--color-shell-accent)] animate-spin" />
      <p className="text-xs font-medium text-[var(--color-shell-text-muted)]">Verifying session & role authorizations...</p>
    </div>
  );
}

// 2. Authentication Requirement Check
if (requireAuth && !isAuthenticated) {
  return (
    <div className="max-w-md mx-auto my-12 p-6 rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-xs text-center space-y-4">
      <div className="h-12 w-12 rounded-full bg-[var(--color-shell-surface-elevated)] flex items-center justify-center mx-auto text-[var(--color-shell-accent)]">
        <LogIn className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-[var(--color-shell-text)]">Authentication Required</h2>
        <p className="text-xs text-[var(--color-shell-text-muted)] mt-1 leading-relaxed">
          You must be signed in with an authorized account to access this section ({currentPath}).
        </p>
      </div>

      <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
        <Button
          size="md"
          onClick={() => navigate('/auth/login')}
          className="text-xs w-full sm:w-auto"
        >
          Sign In to Continue
        </Button>
        <Button
          variant="outline"
          size="md"
          onClick={() => navigate('/seeker')}
          className="text-xs w-full sm:w-auto"
        >
          Back to Public Home
        </Button>
      </div>
    </div>
  );
}

// 3. Role Authorization Requirement Check (Server/Database Authority)
if (allowedRoles && allowedRoles.length > 0) {
  const hasAuthorizedRole = allowedRoles.some(
    (requiredRole) => roles.includes(requiredRole) || roles.includes('admin')
  );

  if (!hasAuthorizedRole) {
    return (
      <div className="max-w-lg mx-auto my-12 p-6 rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] shadow-xs text-center space-y-4">
        <div className="h-12 w-12 rounded-full bg-[var(--color-shell-error-soft)] flex items-center justify-center mx-auto text-[var(--color-shell-error)]">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div>
          <span className="inline-block px-2.5 py-0.5 rounded-full bg-[var(--color-shell-error-soft)] text-[var(--color-shell-error)] text-[10px] font-bold uppercase tracking-wider mb-2">
            403 Forbidden · RLS Enforcement
          </span>
          <h2 className="text-lg font-bold text-[var(--color-shell-text)]">Role Authorization Required</h2>
          <p className="text-xs text-[var(--color-shell-text-muted)] mt-2 leading-relaxed">
            Your account (<span className="font-mono font-semibold">{user?.email}</span>) is assigned role{' '}
            <strong className="uppercase font-mono text-[var(--color-shell-text)]">{roles.join(', ') || 'NONE'}</strong>. Access to this view requires{' '}
            <strong className="uppercase font-mono text-[var(--color-shell-error)]">{allowedRoles.join(' or ')}</strong> privileges.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-surface)] p-3 text-left text-[11px] text-[var(--color-shell-text-muted)] space-y-1">
          <span className="font-bold text-[var(--color-shell-text)] block">Security Invariant:</span>
          <p>
            Supabase Row Level Security (RLS) protects the underlying PostgreSQL tables (<code className="font-mono">user_roles</code>, <code className="font-mono">profiles</code>, <code className="font-mono">bookings</code>). Unauthorized requests are rejected at the database level.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              if (roles.includes('admin')) navigate('/admin');
              else if (roles.includes('mentor')) navigate('/mentor');
              else navigate('/seeker');
            }}
            className="text-xs"
          >
            Return to Authorized Workspace
          </Button>
          <Button
            size="md"
            onClick={() => navigate('/auth/login')}
            className="text-xs"
          >
            Switch Account
          </Button>
        </div>
      </div>
    );
  }
}

  return <>{children}</>;
};
