import React from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { ShieldAlert, ArrowLeft, LogOut, Lock } from 'lucide-react';

export const UnauthorizedPage: React.FC = () => {
  const { user, roles, activeRole, signOut } = useAuth();
  const { navigate, currentPath } = useNavigation();

  return (
    <AuthLayout>
      <div className="auth-form-card space-y-6">
        {/* Brand */}
        <div className="auth-form-header">
          <div className="auth-form-logo" aria-hidden="true">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <AuthEyebrow>Access Denied</AuthEyebrow>
          <AuthHeading>403 Forbidden</AuthHeading>
          <AuthBody>You don't have permission to access this resource</AuthBody>
        </div>

        <div className="rounded-lg bg-[var(--dew)] border border-[var(--hairline)] p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-[var(--hairline-strong)] pb-2">
            <span className="auth-body-sm" style={{ color: 'var(--muted)' }}>Current User:</span>
            <span className="auth-body-sm font-mono font-medium" style={{ color: 'var(--ink)' }}>{user?.email || 'Anonymous'}</span>
          </div>
          <div className="flex justify-between items-center border-b border-[var(--hairline-strong)] pb-2">
            <span className="auth-body-sm" style={{ color: 'var(--muted)' }}>Assigned Roles:</span>
            <span className="auth-body-sm font-mono font-medium uppercase" style={{ color: 'var(--ink)' }}>
              {roles.join(', ') || 'NONE'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="auth-body-sm" style={{ color: 'var(--muted)' }}>Active Shell:</span>
            <span className="auth-body-sm font-mono font-medium capitalize" style={{ color: 'var(--ink)' }}>{activeRole}</span>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--hairline-strong)] bg-[var(--dew)] p-3 text-left space-y-1">
          <span className="auth-body-sm font-medium flex items-center gap-1" style={{ color: 'var(--ink)' }}>
            <Lock className="h-4 w-4" />
            Server-Side & Database Security:
          </span>
          <p className="auth-body-sm" style={{ color: 'var(--muted)' }}>
            Suggest Key enforces authorization at the database layer using Supabase Row Level Security (RLS). Even if the client route was bypassed, PostgreSQL rejects data access for non-matching role permissions.
          </p>
        </div>

        <div className="auth-form-actions flex flex-col sm:flex-row gap-2 justify-center">
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              if (roles.includes('admin')) navigate('/admin');
              else if (roles.includes('mentor')) navigate('/mentor');
              else navigate('/seeker');
            }}
            className="auth-button auth-button--outline"
          >
            <ArrowLeft className="h-5 w-5 mr-1" aria-hidden="true" />
            Back to Authorized Area
          </Button>

          <Button
            size="md"
            onClick={async () => {
              await signOut();
              navigate('/auth/login');
            }}
            className="auth-button auth-button--accent"
          >
            <LogOut className="h-5 w-5 mr-1" aria-hidden="true" />
            Sign In with Different Account
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
};