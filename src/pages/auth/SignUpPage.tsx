import React, { useState, useEffect } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { AlertCircle, Sparkles, UserPlus } from 'lucide-react';

export const SignUpPage: React.FC = () => {
  const { signUp, error, clearError, activeRole, isAuthenticated } = useAuth();
  const { navigate } = useNavigation();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Redirect already-authenticated users to their role-specific app
  useEffect(() => {
    if (isAuthenticated && activeRole) {
      if (activeRole === 'admin') navigate('/admin');
      else if (activeRole === 'mentor') navigate('/mentor');
      else navigate('/seeker');
    }
  }, [isAuthenticated, activeRole, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password) return;

    setIsSubmitting(true);
    setFeedback(null);
    clearError();

    // Server-side normal signup always creates seeker role.
    // Client-supplied role is never trusted.
    const res = await signUp(email.trim(), password, fullName.trim(), 'seeker');
    setIsSubmitting(false);

    if (res.error) {
      setFeedback(res.error.message);
    } else {
      navigate('/auth/verify');
    }
  };

  return (
    <AuthLayout>
      <div className="auth-card space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-shell-primary)] text-[var(--color-shell-surface)] shadow-xs">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-base font-bold tracking-tight text-[var(--color-shell-text)]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Suggest Key
            </span>
          </div>
          <AuthEyebrow>Join the Community</AuthEyebrow>
          <AuthHeading>Create an Account</AuthHeading>
          <AuthBody>Start your mentorship journey today</AuthBody>
        </div>

        {/* Error Notice */}
        {(error || feedback) && (
          <div className="rounded-lg bg-[var(--color-shell-error-soft)] border border-[var(--color-shell-error)] p-3 text-xs text-[var(--color-shell-error)] flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[var(--color-shell-error)] shrink-0 mt-0.5" />
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

          <div className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)]/50 p-3.5 text-xs text-[var(--color-shell-text-muted)] space-y-1">
            <div className="flex items-start gap-2">
              <UserPlus className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)] shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-[var(--color-shell-text)]">Seeker Account</p>
                <p>
                  This signup creates a seeker account. To become a mentor, use the dedicated{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/mentor/signup')}
                    className="font-medium text-[var(--color-shell-accent)] hover:underline cursor-pointer"
                  >
                    Mentor Signup
                  </button>{' '}
                  route instead.
                </p>
              </div>
            </div>
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

        <div className="pt-2 text-center text-xs text-[var(--color-shell-text-subtle)]">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/auth/login')}
            className="font-medium text-[var(--color-shell-text)] hover:text-[var(--color-shell-accent)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-text)] rounded"
          >
            Sign In
          </button>
        </div>
      </div>
    </AuthLayout>
  );
};