import React, { useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { AlertCircle, CheckCircle2, Mail, ArrowLeft, RefreshCw } from 'lucide-react';

export const VerifyPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { pendingEmail, profile, resendVerification, clearError } = useAuth();

  const displayEmail = pendingEmail || profile?.email || '';

  const [isResending, setIsResending] = useState(false);
  const [resendFeedback, setResendFeedback] = useState<string | null>(null);

  const handleResend = async () => {
    if (!displayEmail) {
      setResendFeedback('No email address available to resend verification to.');
      return;
    }
    setIsResending(true);
    setResendFeedback(null);
    clearError();
    const res = await resendVerification(displayEmail);
    if (res.error) {
      setResendFeedback(res.error.message);
    } else {
      setResendFeedback('Verification email resent. Please check your inbox.');
    }
    setIsResending(false);
  };

  return (
    <AuthLayout>
      <div className="auth-form-card space-y-6">
        {/* Brand Header */}
        <div className="auth-form-header">
          <div className="auth-form-logo" aria-hidden="true">
            <Mail className="h-6 w-6" />
          </div>
          <AuthEyebrow>Email Verification</AuthEyebrow>
          <AuthHeading>Check Your Inbox</AuthHeading>
          <AuthBody>We've sent a verification link to your email address.</AuthBody>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-[var(--dew)] border border-[var(--hairline)] p-4 text-center space-y-2">
            <CheckCircle2 className="h-10 w-10 text-[var(--orange)] mx-auto" aria-hidden="true" />
            <p className="auth-body-sm font-medium">Verification email sent</p>
            <p className="auth-body-sm" style={{ color: 'var(--muted)' }}>
              We've sent a verification link to:
            </p>
            <p className="auth-body-sm" style={{ fontFamily: 'var(--font-ui)', color: 'var(--mist)' }}>
              {displayEmail || 'user@example.com'}
            </p>
          </div>

          <div className="rounded-lg border border-[var(--hairline-strong)] bg-[var(--dew)] p-3 text-left space-y-1">
            <span className="auth-body-sm font-medium" style={{ color: 'var(--ink)' }}>What's next?</span>
            <p className="auth-body-sm" style={{ color: 'var(--muted)' }}>1. Open your email inbox</p>
            <p className="auth-body-sm" style={{ color: 'var(--muted)' }}>2. Click the verification link</p>
            <p className="auth-body-sm" style={{ color: 'var(--muted)' }}>3. Return here to continue</p>
          </div>

          {resendFeedback && (
            <div
              className={`auth-banner ${resendFeedback.includes('resent') ? 'auth-banner--success' : 'auth-banner--error'}`}
              role="alert"
              aria-live="polite"
            >
              <AlertCircle className="auth-banner-icon h-5 w-5" aria-hidden="true" />
              <span>{resendFeedback}</span>
            </div>
          )}

          <div className="auth-form-actions">
            <Button
              size="md"
              onClick={handleResend}
              disabled={isResending || !displayEmail}
              className="auth-button auth-button--accent w-full"
            >
              <RefreshCw className={`h-5 w-5 ${isResending ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isResending ? 'Resending…' : 'Resend Email'}</span>
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => navigate('/auth/login')}
              className="auth-button auth-button--outline w-full"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              Back to Sign In
            </Button>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
};
