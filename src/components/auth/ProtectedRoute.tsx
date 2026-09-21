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
        <RefreshCw className="h-8 w-8 text-zinc-400 animate-spin" />
        <p className="text-xs font-medium text-zinc-500">Verifying session & role authorizations...</p>
      </div>
    );
  }

  // 2. Authentication Requirement Check
  if (requireAuth && !isAuthenticated) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 rounded-2xl border border-zinc-200 bg-white shadow-xs text-center space-y-4">
        <div className="h-12 w-12 rounded-full bg-zinc-100 flex items-center justify-center mx-auto text-zinc-700">
          <LogIn className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-zinc-950">Authentication Required</h2>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
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
        <div className="max-w-lg mx-auto my-12 p-6 rounded-2xl border border-rose-200 bg-rose-50/50 shadow-xs text-center space-y-4">
          <div className="h-12 w-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto text-rose-700">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <span className="inline-block px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold uppercase tracking-wider mb-2">
              403 Forbidden · RLS Enforcement
            </span>
            <h2 className="text-lg font-bold text-zinc-950">Role Authorization Required</h2>
            <p className="text-xs text-zinc-600 mt-2 leading-relaxed">
              Your account (<span className="font-mono font-semibold">{user?.email}</span>) is assigned role{' '}
              <strong className="uppercase font-mono text-zinc-900">{roles.join(', ') || 'NONE'}</strong>. Access to this view requires{' '}
              <strong className="uppercase font-mono text-rose-900">{allowedRoles.join(' or ')}</strong> privileges.
            </p>
          </div>

          <div className="rounded-lg border border-rose-200 bg-white p-3 text-left text-[11px] text-zinc-600 space-y-1">
            <span className="font-bold text-zinc-900 block">Security Invariant:</span>
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
