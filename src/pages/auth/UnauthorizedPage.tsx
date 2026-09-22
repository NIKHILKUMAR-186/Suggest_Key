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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#663af3] text-white shadow-xs">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <span className="text-base font-bold tracking-tight text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Suggest Key
            </span>
          </div>
          <AuthEyebrow>Access Denied</AuthEyebrow>
          <AuthHeading>403 Forbidden</AuthHeading>
          <AuthBody>You don't have permission to access this resource</AuthBody>
        </div>

        <div className="rounded-lg bg-[rgba(186,215,247,0.06)] border border-[rgba(186,215,247,0.12)] p-4 space-y-3">
          <div className="flex justify-between items-center border-b border-[rgba(186,215,247,0.12)] pb-2">
            <span className="text-xs text-[#9da7ba]">Current User:</span>
            <span className="font-mono font-medium text-[#d1e4fa]">{user?.email || 'Anonymous'}</span>
          </div>
          <div className="flex justify-between items-center border-b border-[rgba(186,215,247,0.12)] pb-2">
            <span className="text-xs text-[#9da7ba]">Assigned Roles:</span>
            <span className="font-mono font-medium text-[#d1e4fa] uppercase">
              {roles.join(', ') || 'NONE'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-[#9da7ba]">Active Shell:</span>
            <span className="font-mono font-medium text-[#d1e4fa] capitalize">{activeRole}</span>
          </div>
        </div>

        <div className="rounded-lg border border-[rgba(186,215,247,0.12)] bg-[rgba(186,214,247,0.03)] p-3 text-left text-xs text-[#c7d3ea] space-y-1">
          <span className="font-medium text-[#d1e4fa] flex items-center gap-1">
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