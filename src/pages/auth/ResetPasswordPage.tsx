import React, { useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { PasswordInput } from '@/src/components/ui/PasswordInput';
import { ArrowLeft, CheckCircle2, Lock } from 'lucide-react';
import mapAuthError from '@/src/lib/authErrors';

export const ResetPasswordPage: React.FC = () => {
  const { updatePassword, error, clearError } = useAuth();
  const { navigate } = useNavigation();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const validatePasswords = () => {
    const nextPasswordError = password.length < 6 ? 'Password must be at least 6 characters.' : null;
    const nextConfirmError = !confirmPassword ? 'Confirm your new password.' : password !== confirmPassword ? 'Passwords do not match.' : null;

    setPasswordError(nextPasswordError);
    setConfirmPasswordError(nextConfirmError);
    return !nextPasswordError && !nextConfirmError;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    clearError();

    if (!validatePasswords()) return;

    setIsSubmitting(true);
    try {
      const res = await updatePassword(password);
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
            <Lock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="mt-4 space-y-2">
            <AuthHeading className="mb-2">Choose a new password</AuthHeading>
            <AuthBody className="mb-0">Use at least 6 characters to protect your account.</AuthBody>
          </div>
        </div>

        {isSuccess ? (
          <div className="space-y-4" aria-live="polite">
            <div className="rounded-lg bg-[var(--color-shell-bg)] border border-[var(--color-shell-border-strong)] p-4 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-[var(--color-shell-primary)] mx-auto" aria-hidden="true" />
              <p className="text-sm font-medium text-[var(--color-shell-text)]">Password updated</p>
              <p className="text-xs text-[var(--color-shell-text-subtle)]">You can now sign in with your new password.</p>
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
                <span>{displayError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <PasswordInput
                label="New Password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(null);
                  setConfirmPasswordError(null);
                  setFeedback(null);
                  clearError();
                }}
                onBlur={validatePasswords}
                error={passwordError}
                helperText={!passwordError ? 'Use a password you do not use elsewhere.' : undefined}
                autoComplete="new-password"
                className="auth-input"
              />

              <PasswordInput
                label="Confirm New Password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setConfirmPasswordError(null);
                  setFeedback(null);
                  clearError();
                }}
                onBlur={validatePasswords}
                error={confirmPasswordError}
                autoComplete="new-password"
                className="auth-input"
              />

              <Button
                type="submit"
                size="md"
                isLoading={isSubmitting}
                loadingText="Updating..."
                className="w-full"
              >
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Update Password</span>
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthLayout>
  );
};