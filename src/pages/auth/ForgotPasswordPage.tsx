import React, { useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
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
      <div className="auth-form-card space-y-6">
        {/* Header */}
        <div className="auth-form-header">
          <div className="auth-form-logo" aria-hidden="true">
            <Mail className="h-6 w-6" />
          </div>
          <AuthHeading>Reset your password</AuthHeading>
          <AuthBody>We'll send a secure link to your inbox.</AuthBody>
        </div>

        {isSuccess ? (
          <div className="auth-success-state" aria-live="polite">
            <div className="auth-success-icon" aria-hidden="true">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <h2 className="auth-success-title">Check your inbox</h2>
            <p className="auth-success-text">
              If an account exists for this address, a reset link is on its way to:
            </p>
            <p className="auth-success-email">{email.trim()}</p>
            <Button
              size="md"
              onClick={() => navigate('/auth/login')}
              className="auth-button auth-button--accent w-full"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              Back to Sign In
            </Button>
          </div>
        ) : (
          <>
            {displayError && (
              <div className="auth-banner auth-banner--error" role="alert" aria-live="polite">
                <AlertCircle className="auth-banner-icon h-5 w-5" aria-hidden="true" />
                <span>{displayError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form" noValidate>
              <div className="auth-form-group">
                <label htmlFor="email" className="auth-input-label">Email Address</label>
                <div className="auth-input-wrapper">
                  <input
                    id="email"
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
                    className="auth-input-field"
                    aria-invalid={!!emailError}
                    aria-describedby={emailError ? 'email-error' : 'email-helper'}
                    autoComplete="email"
                  />
                  {emailError && (
                    <p id="email-error" className="auth-input-error" role="alert">{emailError}</p>
                  )}
                  {!emailError && (
                    <p id="email-helper" className="auth-input-helper">Use the email associated with your account.</p>
                  )}
                </div>
              </div>

              <div className="auth-form-actions">
                <Button
                  type="submit"
                  size="md"
                  isLoading={isSubmitting}
                  loadingText="Sending..."
                  className="auth-button auth-button--accent w-full"
                >
                  <Mail className="h-5 w-5" aria-hidden="true" />
                  <span>Send Reset Link</span>
                </Button>
              </div>
            </form>

            <div className="auth-footer-links">
              Remember your password?{' '}
              <button
                type="button"
                onClick={() => navigate('/auth/login')}
                className="auth-button auth-button--ghost"
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