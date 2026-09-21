import React, { useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Shield, KeyRound, Lock, User, ArrowRight, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import type { UserRole } from '@/src/types/auth';

export const LoginPage: React.FC = () => {
  const { signInWithPassword, error, clearError, isConfigured, roles, activeRole, isAuthenticated, user } = useAuth();
  const { navigate } = useNavigation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleRoleAwareRedirect = (targetRoles: UserRole[]) => {
    if (targetRoles.includes('admin')) {
      navigate('/admin');
    } else if (targetRoles.includes('mentor')) {
      navigate('/mentor');
    } else {
      navigate('/seeker');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setIsSubmitting(true);
    setFeedback(null);
    clearError();

    const res = await signInWithPassword(email.trim(), password);
    setIsSubmitting(false);

    if (res.error) {
      setFeedback(res.error.message);
    } else {
      // Role-aware redirect
      let dest = '/seeker';
      if (email.includes('admin')) dest = '/admin';
      else if (email.includes('mentor')) dest = '/mentor';
      navigate(dest);
    }
  };

  const handleQuickFill = async (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setIsSubmitting(true);
    clearError();
    const res = await signInWithPassword(demoEmail, demoPass);
    setIsSubmitting(false);

    if (!res.error) {
      if (demoEmail.includes('admin')) navigate('/admin');
      else if (demoEmail.includes('mentor')) navigate('/mentor');
      else navigate('/seeker');
    }
  };

  return (
    <div className="max-w-md mx-auto my-8 space-y-6">
      {/* Brand Header */}
      <div className="text-center space-y-1">
        <div className="h-12 w-12 rounded-xl bg-zinc-900 text-white flex items-center justify-center mx-auto mb-3 shadow-xs">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Sign In to Suggest Key</h1>
        <p className="text-xs text-zinc-500">
          Supabase Auth with Row-Level-Security (RLS) and Role Authorization
        </p>
      </div>

      {/* Supabase Connection Status Badge */}
      <div className={`rounded-xl p-3 text-xs border flex items-start gap-2.5 ${
        isConfigured
          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
          : 'bg-zinc-50 border-zinc-200 text-zinc-700'
      }`}>
        <CheckCircle2 className={`h-4 w-4 shrink-0 mt-0.5 ${isConfigured ? 'text-emerald-600' : 'text-zinc-400'}`} />
        <div className="space-y-0.5">
          <span className="font-semibold block">
            {isConfigured ? 'Supabase Backend Connected' : 'Preview Sandbox Mode Active'}
          </span>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            {isConfigured
              ? 'Authoritative Supabase Auth & PostgreSQL RLS are active.'
              : 'Using local role test personas for validation. Configure VITE_SUPABASE_URL to link cloud project.'}
          </p>
        </div>
      </div>

      {/* Error Notice */}
      {(error || feedback) && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error || feedback}</span>
        </div>
      )}

      {/* Login Card */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email Address"
            type="email"
            placeholder="e.g. suggestkey1505@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <Button
            type="submit"
            size="md"
            disabled={isSubmitting}
            className="w-full text-xs gap-1.5"
          >
            <Lock className="h-3.5 w-3.5" />
            <span>{isSubmitting ? 'Authenticating...' : 'Sign In'}</span>
          </Button>
        </form>

        <div className="pt-2 text-center text-xs text-zinc-500">
          Don't have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/auth/signup')}
            className="font-semibold text-zinc-900 underline hover:text-zinc-700 cursor-pointer"
          >
            Create an Account
          </button>
        </div>
      </div>

      {/* Quick-Fill Persona Switcher for Instant Verification */}
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-zinc-700" />
            <span className="text-xs font-bold text-zinc-900">1-Click Test Personas</span>
          </div>
          <span className="text-[10px] text-zinc-400 font-mono">Role Verification</span>
        </div>

        <p className="text-[11px] text-zinc-500">
          Click any pre-seeded persona to test instant login and role-aware routing:
        </p>

        <div className="grid grid-cols-1 gap-2 pt-1">
          {/* Seeker Persona */}
          <button
            type="button"
            onClick={() => handleQuickFill('seeker@suggestkey.com', 'password123')}
            className="p-2.5 rounded-xl border border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 text-left transition-all flex items-center justify-between cursor-pointer"
          >
            <div>
              <div className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                <span>Aman Kumar</span>
                <span className="px-1.5 py-0.2 rounded bg-zinc-100 text-[10px] font-semibold text-zinc-700">
                  SEEKER
                </span>
              </div>
              <span className="text-[11px] text-zinc-400">Routes directly to Seeker Home (/)</span>
            </div>
            <ArrowRight className="h-4 w-4 text-zinc-400" />
          </button>

          {/* Mentor Persona */}
          <button
            type="button"
            onClick={() => handleQuickFill('mentor@suggestkey.com', 'password123')}
            className="p-2.5 rounded-xl border border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 text-left transition-all flex items-center justify-between cursor-pointer"
          >
            <div>
              <div className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                <span>Rahul Sharma</span>
                <span className="px-1.5 py-0.2 rounded bg-amber-100 text-[10px] font-semibold text-amber-800">
                  MENTOR
                </span>
              </div>
              <span className="text-[11px] text-zinc-400">Routes directly to Mentor Home (/mentor)</span>
            </div>
            <ArrowRight className="h-4 w-4 text-zinc-400" />
          </button>

          {/* Admin Persona */}
          <button
            type="button"
            onClick={() => handleQuickFill('admin@suggestkey.com', 'password123')}
            className="p-2.5 rounded-xl border border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 text-left transition-all flex items-center justify-between cursor-pointer"
          >
            <div>
              <div className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                <span>Platform Administrator</span>
                <span className="px-1.5 py-0.2 rounded bg-rose-100 text-[10px] font-semibold text-rose-800">
                  ADMIN
                </span>
              </div>
              <span className="text-[11px] text-zinc-400">Routes directly to Admin Dashboard (/admin)</span>
            </div>
            <ArrowRight className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
      </div>
    </div>
  );
};
