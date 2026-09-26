import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { BrandPanel } from '@/src/components/auth/BrandPanel';
import { PasswordInput } from '@/src/components/ui/PasswordInput';
import { Input } from '@/src/components/ui/Input';
import { Button } from '@/src/components/ui/Button';
import mapAuthError from '@/src/lib/authErrors';
import { AlertCircle, ArrowLeft, KeyRound } from 'lucide-react';
import type { UserRole } from '@/src/types/auth';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LoginPage: React.FC = () => {
  const { signInWithPassword, signInWithGoogle, signInWithDemoPersona, error, clearError, activeRole, isAuthenticated } = useAuth();
  const { navigate } = useNavigation();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
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

  const validateEmail = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError('Enter your email address.');
      return 'Enter your email address.';
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setEmailError('Enter a valid email address.');
      return 'Enter a valid email address.';
    }
    setEmailError(null);
    return null;
  };

  const validatePassword = () => {
    if (!password) {
      setPasswordError('Enter your password.');
      return 'Enter your password.';
    }
    setPasswordError(null);
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    clearError();

    const emailValidationError = validateEmail();
    const passwordValidationError = validatePassword();
    if (emailValidationError || passwordValidationError) {
      if (emailValidationError) emailRef.current?.focus();
      else passwordRef.current?.focus();
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await signInWithPassword(email.trim(), password);

      if (res.error) {
        setFeedback(mapAuthError(res.error));
      } else {
        const targetRole = res.role ?? activeRole;
        if (targetRole === 'admin') navigate('/admin');
        else if (targetRole === 'mentor') navigate('/mentor');
        else navigate('/seeker');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const friendlyError = error ? mapAuthError(new Error(error)) : null;
  const displayError = feedback ?? friendlyError;

  return (
    <AuthLayout brandPanel={<BrandPanel />}>
      <div className="auth-card space-y-6">
        <div className="text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-shell-primary)] text-[var(--color-shell-surface)] shadow-sm">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="mt-4 space-y-2">
            <AuthHeading className="mb-2">Welcome back</AuthHeading>
            <AuthBody className="mb-0">Sign in to continue your mentorship journey.</AuthBody>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            type="button"
            size="md"
            variant="outline"
            className="w-full"
            onClick={async () => {
              const res = await signInWithGoogle();
              if (res.error) setFeedback(mapAuthError(res.error));
            }}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.21h5.96-2.27v8.29h3.75c0-2.17 1.75-3.95 3.96-3.95v-6.3z" />
              <path d="M12 23c2.43 0 4.47-.8 5.93-2.16l-3.66-2.85c-1.43 1.06-3.29 1.7-5.27 1.7-4.07 0-7.44-3.26-7.44-7.25 0-1.39.25-2.71.69-3.91l-.09-.01C4.03 7.44 7.96 3.5 12 3.5c1.64 0 3.14.6 4.31 1.59l2.88-2.88C17.54 1.26 14.96 0 12 0 6.84 0 2.56 4.93 2.56 10.06c0 2.33.89 4.45 2.35 6.02l-.02.18z" />
            </svg>
            <span>Continue with Google</span>
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <Input
            ref={emailRef}
            label="Email Address"
            type="email"
            placeholder="e.g. yourname@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
              setFeedback(null);
              clearError();
            }}
            onBlur={validateEmail}
            error={emailError}
            helperText={!emailError ? 'Use the email associated with your account.' : undefined}
            autoComplete="email"
            className="auth-input"
          />

          <PasswordInput
            ref={passwordRef}
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
              setFeedback(null);
              clearError();
            }}
            onBlur={validatePassword}
            error={passwordError}
            helperText={!passwordError ? 'Keep your password private.' : undefined}
            autoComplete="current-password"
            className="auth-input"
          />

          <Button
            type="submit"
            size="md"
            isLoading={isSubmitting}
            loadingText="Signing In..."
            className="w-full"
          >
            Continue
          </Button>
        </form>

        {displayError && (
          <div
            className="rounded-lg bg-[var(--color-shell-error-soft)] border border-[var(--color-shell-error)] p-3 text-xs text-[var(--color-shell-error)] flex items-start gap-2"
            role="alert"
            aria-live="polite"
          >
            <AlertCircle className="h-4 w-4 text-[var(--color-shell-error)] shrink-0 mt-0.5" aria-hidden="true" />
            <span>{displayError}</span>
          </div>
        )}

        {/* Forgot password */}
        <div className="text-center text-xs text-[var(--color-shell-text-subtle)]">
          <button
            type="button"
            onClick={() => navigate('/auth/forgot-password')}
            className="font-medium text-[var(--color-shell-text)] hover:text-[var(--color-shell-accent)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] rounded"
          >
            Forgot your password?
          </button>
        </div>

        {/* Create account link */}
        <div className="pt-2 text-center text-xs text-[var(--color-shell-text-subtle)]">
          Don't have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/auth/signup')}
            className="font-medium text-[var(--color-shell-text)] hover:text-[var(--color-shell-accent)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] rounded"
          >
            Create an Account
          </button>
        </div>
      </div>

      {/* Development-only test personas */}
      {import.meta.env?.DEV && (
        <div className="mt-6 rounded-xl border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-[var(--color-shell-text-subtle)] uppercase tracking-wider">Development Only</span>
            <span className="text-[10px] text-[var(--color-shell-text-subtle)]">Test Personas</span>
          </div>
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Click any persona to test instant login and role-aware routing:
          </p>
          <div className="grid grid-cols-1 gap-2 pt-1">
            {[
              { name: 'Aman Kumar', role: 'SEEKER', path: '/seeker', persona: 'seeker' },
              { name: 'Rahul Sharma', role: 'MENTOR', path: '/mentor', persona: 'mentor' },
              { name: 'Platform Admin', role: 'ADMIN', path: '/admin', persona: 'admin' },
            ].map((persona) => (
              <button
                key={persona.persona}
                type="button"
                onClick={async () => {
                  const res = await signInWithDemoPersona(persona.persona as UserRole);
                  if (!res.error) {
                    navigate(persona.path);
                  }
                }}
                className="p-2.5 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)] hover:border-[var(--color-shell-border)] text-left transition-all flex items-center justify-between cursor-pointer"
              >
                <div>
                  <div className="text-xs font-medium text-[var(--color-shell-text)] flex items-center gap-1.5">
                    <span>{persona.name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--color-shell-bg)] text-[var(--color-shell-text-muted)] text-[9px] font-bold">
                      {persona.role}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--color-shell-text-subtle)]">{persona.path}</span>
                </div>
                <ArrowLeft className="h-4 w-4 text-[var(--color-shell-text-subtle)] rotate-180" />
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
};
