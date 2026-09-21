import React from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { ShieldAlert, ArrowLeft, LogOut, Lock } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';

export const UnauthorizedPage: React.FC = () => {
  const { user, roles, activeRole, signOut } = useAuth();
  const { navigate, currentPath } = useNavigation();

  return (
    <div className="max-w-lg mx-auto my-16 p-8 rounded-2xl border border-rose-200 bg-white shadow-sm text-center space-y-5">
      <div className="h-14 w-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto text-rose-600">
        <ShieldAlert className="h-8 w-8" />
      </div>

      <div className="space-y-1">
        <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold uppercase tracking-wider">
          403 Forbidden · Role Authorization
        </span>
        <h1 className="text-xl font-bold text-zinc-950 pt-1">Access Denied</h1>
        <p className="text-xs text-zinc-500 leading-relaxed">
          You do not have the required role privileges to access <code className="font-mono text-zinc-800">{currentPath}</code>.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-left text-xs space-y-2">
        <div className="flex justify-between items-center border-b border-zinc-200 pb-2">
          <span className="text-zinc-500">Current User:</span>
          <span className="font-mono font-bold text-zinc-900">{user?.email || 'Anonymous'}</span>
        </div>
        <div className="flex justify-between items-center border-b border-zinc-200 pb-2">
          <span className="text-zinc-500">Assigned Roles:</span>
          <span className="font-mono font-bold uppercase text-zinc-900">
            {roles.join(', ') || 'NONE'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-zinc-500">Active Shell:</span>
          <span className="font-mono font-bold capitalize text-zinc-900">{activeRole}</span>
        </div>
      </div>

      <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3 text-left text-[11px] text-zinc-600 space-y-1">
        <span className="font-bold text-rose-900 flex items-center gap-1">
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
  );
};
