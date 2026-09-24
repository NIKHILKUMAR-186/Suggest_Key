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
      <div className="auth-card space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-shell-primary)] text-[var(--color-shell-surface)] shadow-xs">
              <Mail className="h-5 w-5" />
            </div>
            <span className="text-base font-bold tracking-tight text-[var(--color-shell-text)]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Suggest Key
            </span>
          </div>
          <AuthEyebrow>Email Verification</AuthEyebrow>
          <AuthHeading>Check Your Inbox</AuthHeading>
          <AuthBody>We've sent a verification link to your email address.</AuthBody>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-[var(--color-shell-bg)] border border-[var(--color-shell-border-strong)] p-4 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-[var(--color-shell-primary)] mx-auto" />
            <p className="text-sm text-[var(--color-shell-text)]">Verification email sent</p>
            <p className="text-xs text-[var(--color-shell-text-subtle)]">
              We've sent a verification link to:
            </p>
            <p className="text-xs font-mono text-[var(--color-shell-text-muted)] break-all">
              {displayEmail || 'user@example.com'}
            </p>
          </div>

          <div className="rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] p-3 text-left text-xs text-[var(--color-shell-text-muted)] space-y-1">
            <span className="font-medium text-[var(--color-shell-text)] block">What's next?</span>
            <p>1. Open your email inbox</p>
            <p>2. Click the verification link</p>
            <p>3. Return here to continue</p>
          </div>

          {resendFeedback && (
            <div
              className={`rounded-lg border p-3 text-xs flex items-start gap-2 ${
                resendFeedback.includes('resent')
                  ? 'bg-[var(--color-success-soft)] border-[var(--color-success)] text-[var(--color-success)]'
                  : 'bg-[var(--color-shell-error-soft)] border-[var(--color-shell-error)] text-[var(--color-shell-error)]'
              }`}
              role="alert"
              aria-live="polite"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{resendFeedback}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button
              size="md"
              onClick={handleResend}
              disabled={isResending || !displayEmail}
              className="w-full"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isResending ? 'animate-spin' : ''}`} />
              <span>{isResending ? 'Resending…' : 'Resend Email'}</span>
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => navigate('/auth/login')}
              className="w-full"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Sign In
            </Button>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
};
