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
      <div className="auth-card space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-shell-primary)] text-[var(--color-shell-surface)] shadow-xs">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <span className="text-base font-bold tracking-tight text-[var(--color-shell-text)]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Suggest Key
            </span>
          </div>
          <AuthEyebrow>Access Denied</AuthEyebrow>
          <AuthHeading>403 Forbidden</AuthHeading>
          <AuthBody>You don't have permission to access this resource</AuthBody>
        </div>

        <div className="rounded-lg bg-[var(--color-shell-bg)] border border-[var(--color-shell-border-strong)] p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-[var(--color-shell-border-strong)] pb-2">
            <span className="text-xs text-[var(--color-shell-text-subtle)]">Current User:</span>
            <span className="font-mono font-medium text-[var(--color-shell-text)]">{user?.email || 'Anonymous'}</span>
          </div>
          <div className="flex justify-between items-center border-b border-[var(--color-shell-border-strong)] pb-2">
            <span className="text-xs text-[var(--color-shell-text-subtle)]">Assigned Roles:</span>
            <span className="font-mono font-medium text-[var(--color-shell-text)] uppercase">
              {roles.join(', ') || 'NONE'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-[var(--color-shell-text-subtle)]">Active Shell:</span>
            <span className="font-mono font-medium text-[var(--color-shell-text)] capitalize">{activeRole}</span>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] p-3 text-left text-xs text-[var(--color-shell-text-muted)] space-y-1">
          <span className="font-medium text-[var(--color-shell-text)] flex items-center gap-1">
            <Lock className="h-3 w-3" />
            Server-Side & Database Security:
          </span>
          <p>
            Suggest Key enforces authorization at the database layer using Supabase Row Level Security (RLS). Even if the client route was bypassed, PostgreSQL rejects data access for non-matching role permissions.
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
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Back to Authorized Area
          </Button>

          <Button
            size="md"
            onClick={async () => {
              await signOut();
              navigate('/auth/login');
            }}
            className="text-xs"
          >
            <LogOut className="h-3.5 w-3.5 mr-1" />
            Sign In with Different Account
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
};