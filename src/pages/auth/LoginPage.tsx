import React, { useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { AlertCircle, ArrowLeft, CheckCircle2, Sparkles, Lock } from 'lucide-react';
import type { UserRole } from '@/src/types/auth';

export const LoginPage: React.FC = () => {
  const { signInWithPassword, error, clearError, isConfigured, activeRole } = useAuth();
  const { navigate } = useNavigation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

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
      // Role-aware redirect based on database role
      if (activeRole === 'admin') navigate('/admin');
      else if (activeRole === 'mentor') navigate('/mentor');
      else navigate('/seeker');
    }
  };

  return (
    <AuthLayout>
      <div className="auth-card space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#663af3] text-white shadow-xs">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-base font-bold tracking-tight text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Suggest Key
            </span>
          </div>
          <AuthEyebrow>Welcome Back</AuthEyebrow>
          <AuthHeading>Sign In</AuthHeading>
          <AuthBody>Access your mentorship workspace</AuthBody>
        </div>

        {/* Status Badge */}
        <div className={`rounded-lg p-3 text-xs border flex items-start gap-2.5 ${
          isConfigured
            ? 'bg-[rgba(199,211,234,0.06)] border-[rgba(186,215,247,0.12)] text-[#c7d3ea]'
            : 'bg-[rgba(199,211,234,0.06)] border-[rgba(186,215,247,0.12)] text-[#c7d3ea]'
        }`}>
          {isConfigured ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[#b6d9fc]" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[#9da7ba]" />
          )}
          <div className="space-y-0.5">
            <span className="font-medium block text-[#d1e4fa]">
              {isConfigured ? 'Supabase Backend Connected' : 'Preview Sandbox Mode Active'}
            </span>
            <p className="text-[11px] leading-relaxed text-[#9da7ba]">
              {isConfigured
                ? 'Authoritative Supabase Auth & PostgreSQL RLS are active.'
                : 'Using local role test personas for validation. Configure VITE_SUPABASE_URL to link cloud project.'}
            </p>
          </div>
        </div>

        {/* Error Notice */}
        {(error || feedback) && (
          <div className="rounded-lg bg-[rgba(231,76,60,0.08)] border border-[rgba(231,76,60,0.2)] p-3 text-xs text-[#e46d4c] flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[#e46d4c] shrink-0 mt-0.5" />
            <span>{error || feedback}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email Address"
            type="email"
            placeholder="e.g. yourname@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="auth-input"
          />

          <Input
            label="Password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="auth-input"
          />

          <Button
            type="submit"
            size="md"
            disabled={isSubmitting}
            className="w-full auth-button-primary"
          >
            <Lock className="h-3.5 w-3.5" />
            <span>{isSubmitting ? 'Authenticating...' : 'Sign In'}</span>
          </Button>
        </form>

        <div className="pt-2 text-center text-xs text-[#9da7ba]">
          Don't have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/auth/signup')}
            className="font-medium text-[#d1e4fa] hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d1e4fa] rounded"
          >
            Create an Account
          </button>
        </div>
      </div>

      {/* Development-only test personas */}
      {import.meta.env?.DEV && (
        <div className="mt-6 rounded-xl border border-[rgba(186,215,247,0.12)] bg-[rgba(186,214,247,0.03)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[#9da7ba] uppercase tracking-wider">Development Only</span>
            <span className="text-[10px] text-[#9da7ba]">Test Personas</span>
          </div>
          <p className="text-[11px] text-[#9da7ba]">
            Click any persona to test instant login and role-aware routing:
          </p>
          <div className="grid grid-cols-1 gap-2 pt-1">
            {[
              { name: 'Aman Kumar', role: 'SEEKER', email: 'seeker@suggestkey.com', path: '/seeker' },
              { name: 'Rahul Sharma', role: 'MENTOR', email: 'mentor@suggestkey.com', path: '/mentor' },
              { name: 'Platform Admin', role: 'ADMIN', email: 'admin@suggestkey.com', path: '/admin' },
            ].map((persona) => (
              <button
                key={persona.email}
                type="button"
                onClick={async () => {
                  const res = await signInWithPassword(persona.email, 'password123');
                  if (!res.error) {
                    navigate(persona.path);
                  }
                }}
                className="p-2.5 rounded-lg border border-[rgba(186,215,247,0.12)] bg-[rgba(5,6,15,0.97)] hover:border-[rgba(186,215,247,0.2)] text-left transition-all flex items-center justify-between cursor-pointer"
              >
                <div>
                  <div className="text-xs font-medium text-white flex items-center gap-1.5">
                    <span>{persona.name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-[rgba(186,215,247,0.1)] text-[#c7d3ea] text-[9px] font-bold">
                      {persona.role}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#9da7ba]">{persona.email}</span>
                </div>
                <ArrowLeft className="h-4 w-4 text-[#9da7ba] rotate-180" />
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
};