import React, { useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { AlertCircle, ArrowLeft, CheckCircle2, Sparkles, UserPlus, Lock } from 'lucide-react';
import type { UserRole } from '@/src/types/auth';

export const SignUpPage: React.FC = () => {
  const { signUp, error, clearError, isConfigured } = useAuth();
  const { navigate } = useNavigation();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('seeker');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password) return;

    setIsSubmitting(true);
    setFeedback(null);
    clearError();

    const res = await signUp(email.trim(), password, fullName.trim(), role);
    setIsSubmitting(false);

    if (res.error) {
      setFeedback(res.error.message);
    } else {
      navigate('/seeker');
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
          <AuthEyebrow>Join the Community</AuthEyebrow>
          <AuthHeading>Create an Account</AuthHeading>
          <AuthBody>Start your mentorship journey today</AuthBody>
        </div>

        {/* Error Notice */}
        {(error || feedback) && (
          <div className="rounded-lg bg-[rgba(231,76,60,0.08)] border border-[rgba(231,76,60,0.2)] p-3 text-xs text-[#e46d4c] flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[#e46d4c] shrink-0 mt-0.5" />
            <span>{error || feedback}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Full Name"
            placeholder="e.g. Aman Kumar"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="auth-input"
          />

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
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="auth-input"
          />

          {/* Role Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[#c7d3ea]">Account Type</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole('seeker')}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  role === 'seeker'
                    ? 'border-[#663af3] bg-[rgba(102,58,243,0.08)] ring-1 ring-[#663af3]'
                    : 'border-[rgba(186,215,247,0.12)] hover:border-[rgba(186,215,247,0.2)] bg-[rgba(186,214,247,0.03)]'
                }`}
              >
                <div className="font-semibold text-xs text-white">Seeker</div>
                <div className="text-[11px] text-[#9da7ba] mt-0.5">
                  Discover mentors & book sessions
                </div>
              </button>
              <button
                type="button"
                onClick={() => setRole('mentor')}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  role === 'mentor'
                    ? 'border-[#663af3] bg-[rgba(102,58,243,0.08)] ring-1 ring-[#663af3]'
                    : 'border-[rgba(186,215,247,0.12)] hover:border-[rgba(186,215,247,0.2)] bg-[rgba(186,214,247,0.03)]'
                }`}
              >
                <div className="font-semibold text-xs text-white">Mentor</div>
                <div className="text-[11px] text-[#9da7ba] mt-0.5">
                  Offer gigs & conduct sessions
                </div>
              </button>
            </div>
            <p className="text-[10px] text-[#9da7ba] italic">
              Administrator roles are assigned by platform administrators only.
            </p>
          </div>

          <Button
            type="submit"
            size="md"
            disabled={isSubmitting}
            className="w-full auth-button-primary"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>{isSubmitting ? 'Provisioning Account...' : 'Register & Continue'}</span>
          </Button>
        </form>

        <div className="pt-2 text-center text-xs text-[#9da7ba]">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/auth/login')}
            className="font-medium text-[#d1e4fa] hover:text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d1e4fa] rounded"
          >
            Sign In
          </button>
        </div>
      </div>
    </AuthLayout>
  );
};