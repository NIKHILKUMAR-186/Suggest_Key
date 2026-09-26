import React, { useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { AlertCircle, ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import mapAuthError from '@/src/lib/authErrors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ForgotPasswordPage: React.FC = () => {
  const { requestPasswordReset, error, clearError } = useAuth();
  const { navigate } = useNavigation();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    clearError();

    if (validateEmail()) return;

    setIsSubmitting(true);
    try {
      const res = await requestPasswordReset(email.trim());
      if (res.error) {
        setFeedback(mapAuthError(res.error));
      } else {
        setIsSuccess(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayError = feedback ?? (error ? mapAuthError(new Error(error)) : null);

  return (
    <AuthLayout>
      <div className="auth-card space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-shell-primary)] text-[var(--color-shell-surface)] shadow-sm">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="mt-4 space-y-2">
            <AuthHeading className="mb-2">Reset your password</AuthHeading>
            <AuthBody className="mb-0">We'll send a secure link to your inbox.</AuthBody>
          </div>
        </div>

        {isSuccess ? (
          <div className="space-y-4" aria-live="polite">
            <div className="rounded-lg bg-[var(--color-shell-bg)] border border-[var(--color-shell-border-strong)] p-4 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-[var(--color-shell-primary)] mx-auto" aria-hidden="true" />
              <p className="text-sm font-medium text-[var(--color-shell-text)]">Check your inbox</p>
              <p className="text-xs text-[var(--color-shell-text-subtle)]">
                If an account exists for this address, a reset link is on its way to:
              </p>
              <p className="text-xs font-mono text-[var(--color-shell-text-muted)] break-all">{email.trim()}</p>
            </div>
            <Button
              size="md"
              onClick={() => navigate('/auth/login')}
              className="w-full"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to Sign In
            </Button>
          </div>
        ) : (
          <>
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

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <Input
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

              <Button
                type="submit"
                size="md"
                isLoading={isSubmitting}
                loadingText="Sending..."
                className="w-full"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Send Reset Link</span>
              </Button>
            </form>

            <div className="pt-2 text-center text-xs text-[var(--color-shell-text-subtle)]">
              Remember your password?{' '}
              <button
                type="button"
                onClick={() => navigate('/auth/login')}
                className="font-medium text-[var(--color-shell-text)] hover:text-[var(--color-shell-accent)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] rounded"
              >
                Sign In
              </button>
            </div>
          </>
        )}
      </div>
    </AuthLayout>
  );
};