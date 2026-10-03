import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { BrandPanel } from '@/src/components/auth/BrandPanel';
import { EmailVerificationNotice } from '@/src/components/auth/EmailVerificationNotice';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { useEmailVerificationLimit } from '@/src/hooks/useEmailVerificationLimit';
import {
  isEmailVerificationActionBlocked,
  type EmailVerificationPhase,
} from '@/src/lib/emailVerificationLimit';
import { AlertCircle, UserCheck, ArrowRight, Info, ShieldCheck } from 'lucide-react';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Ties the notice to the submit button for assistive technology. */
const RATE_LIMIT_NOTICE_ID = 'mentor-signup-rate-limit';

/**
 * Supabase Auth error shapes that mean the verification email was throttled.
 *
 * `signUpError.code` is the machine-readable field and is what GoTrue actually
 * sets; the message match is a fallback for older responses that only carry text.
 * Both spellings are checked because GoTrue has used `over_email_send_rate_limit`
 * and a plain "email rate limit exceeded" sentence.
 */
function isUpstreamRateLimit(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = (error.code ?? '').toLowerCase();
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many requests');
}

export const MentorSignupPage: React.FC = () => {
  const { signUp, error, clearError, activeRole, isAuthenticated } = useAuth();
  const { navigate } = useNavigation();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const bioRef = useRef<HTMLTextAreaElement>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bio, setBio] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [fullNameError, setFullNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);
  // Set when Supabase Auth itself refused the send. It exists only for the case
  // where our own ledger was unreachable at that moment and therefore has no
  // countdown to offer: without it the raw "email rate limit exceeded" text would
  // be all the user ever sees. It never overrides a server state, and it is
  // cleared the moment the address changes or a submit re-reads the ledger.
  const [providerRefused, setProviderRefused] = useState(false);

  const { phase, msRemaining, refresh, requestAttempt, reportOutcome } =
    useEmailVerificationLimit(email);

  // Redirect already-authenticated users
  useEffect(() => {
    if (isAuthenticated && activeRole) {
      if (activeRole === 'admin') navigate('/admin');
      else if (activeRole === 'mentor') navigate('/mentor/verification');
      else navigate('/seeker');
    }
  }, [isAuthenticated, activeRole, navigate]);

  const validateFullName = () => {
    if (!fullName.trim()) {
      setFullNameError('Enter your full name.');
      return 'Enter your full name.';
    }
    setFullNameError(null);
    return null;
  };

  const validateEmail = () => {
    if (!email.trim()) {
      setEmailError('Enter your email address.');
      return 'Enter your email address.';
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setEmailError('Enter a valid email address.');
      return 'Enter a valid email address.';
    }
    setEmailError(null);
    return null;
  };

  /**
   * Re-read the rate-limit budget once the address is known to be usable.
   *
   * This is what makes a refresh or a return visit rehydrate rather than reset:
   * the page holds no attempt counter, so the only thing that can restore the
   * remaining count or an in-flight cooldown is asking the server for it. A
   * read spends nothing, so losing focus repeatedly is harmless.
   */
  const validateEmailAndSyncLimit = () => {
    const errorMessage = validateEmail();
    if (!errorMessage) void refresh(email);
    return errorMessage;
  };

  const validatePassword = () => {
    if (!password) {
      setPasswordError('Enter a password.');
      return 'Enter a password.';
    }
    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      return 'Password must be at least 6 characters.';
    }
    setPasswordError(null);
    return null;
  };

  const validateBio = () => {
    if (!bio.trim()) {
      setBioError('Tell us about your mentorship background.');
      return 'Tell us about your mentorship background.';
    }
    if (bio.trim().length < 20) {
      setBioError('Bio must be at least 20 characters.');
      return 'Bio must be at least 20 characters.';
    }
    setBioError(null);
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    clearError();

    const fullValidationError = validateFullName();
    const emailValidationError = validateEmail();
    const passwordValidationError = validatePassword();
    const bioValidationError = validateBio();

    if (fullValidationError || emailValidationError || passwordValidationError || bioValidationError) {
      if (fullValidationError) fullNameRef.current?.focus();
      else if (emailValidationError) emailRef.current?.focus();
      else if (passwordValidationError) passwordRef.current?.focus();
      else bioRef.current?.focus();
      return;
    }

    // Second guard for the same condition. The button is already disabled and the
    // notice is on screen, but a repeated Enter key or a queued click can still
    // reach the handler, and it must never reach Supabase Auth while the server
    // is refusing.
    if (isEmailVerificationActionBlocked(phase)) return;

    setProviderRefused(false);
    setIsSubmitting(true);

    try {
      // Ask the server whether one more verification email may be attempted. This
      // is the authoritative check, and it happens before any provider call so a
      // throttled user never spends a request. It returns false only when the
      // server positively refused; if the ledger is unreachable it returns true
      // and Supabase Auth still validates as usual.
      const permitted = await requestAttempt(email.trim());
      if (!permitted) {
        // The notice renders "Too many email verification attempts" with the
        // server's countdown. No message here, or the two would talk over each
        // other.
        return;
      }

      // Sign up as mentor (role will be overridden to 'mentor' - but the signup
      // function uses requestedRole to set the initial role via user_metadata)
      // The signUp function will create the auth user + call our server to
      // create the mentor_application on first login
      const res = await signUp(email.trim(), password, fullName.trim(), 'mentor');

      if (res.error) {
        // Supabase Auth applied its own email rate limit. GoTrue sends no
        // retry-after, so report the refusal and let the server store the
        // operator-configured cooldown, giving the countdown a real deadline
        // instead of a guessed one. `setFeedback` is deliberately skipped for this
        // case: the raw provider sentence is exactly what the notice replaces.
        if (isUpstreamRateLimit(res.error)) {
          setProviderRefused(true);
          await reportOutcome(email.trim(), 'rate_limited');
          return;
        }
        setFeedback(res.error.message);
        await reportOutcome(email.trim(), 'failed');
      } else {
        // Keep the server's remaining count current for a resubmit.
        await reportOutcome(email.trim(), 'sent');
        // After signup, user needs to verify email, then navigate to verification page
        navigate('/auth/verify');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * What the page renders.
   *
   * The server wins whenever it has an opinion. `providerRefused` only fills the
   * one gap it cannot: a provider refusal whose outcome report also failed, where
   * the honest rendering is the blocked treatment with no countdown rather than
   * GoTrue's bare error text.
   */
  const effectivePhase: EmailVerificationPhase =
    providerRefused && phase.kind === 'unknown' ? { kind: 'blocked' } : phase;

  const friendlyError = error || null;
  const displayError = feedback ?? friendlyError;

  const rateLimitBlocked =
    isEmailVerificationActionBlocked(effectivePhase) || providerRefused;
  const submitDisabled = isSubmitting || rateLimitBlocked;

  return (
    <AuthLayout brandPanel={<BrandPanel />}>
      <div className="auth-card space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-shell-primary)] text-[var(--color-shell-surface)] shadow-xs">
              <UserCheck className="h-5 w-5" />
            </div>
            <span className="text-base font-bold tracking-tight text-[var(--color-shell-text)]" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Suggest Key
            </span>
          </div>
          <AuthEyebrow>Mentor Onboarding</AuthEyebrow>
          <AuthHeading>Create Your Mentor Account</AuthHeading>
          <AuthBody>
            Create your account to begin the mentor verification process.
            Your credentials will be reviewed by our Admin team before you appear in seeker searches.
          </AuthBody>
        </div>

        {(displayError || error) && !rateLimitBlocked && (
          <div className="rounded-lg bg-[var(--color-shell-error-soft)] border border-[var(--color-shell-error)] p-3 text-xs text-[var(--color-shell-error)] flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[var(--color-shell-error)] shrink-0 mt-0.5" />
            <span>{displayError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            ref={fullNameRef}
            label="Full Name"
            placeholder="e.g. Rahul Sharma"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              setFullNameError(null);
              setFeedback(null);
              clearError();
            }}
            onBlur={validateFullName}
            error={fullNameError}
            className="auth-input"
          />

          <Input
            ref={emailRef}
            label="Email Address"
            type="email"
            placeholder="e.g. mentor@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
              setFeedback(null);
              // A different address has a different budget; nothing about the old
              // one, including a provider refusal, carries over.
              setProviderRefused(false);
              clearError();
            }}
            onBlur={validateEmailAndSyncLimit}
            error={emailError}
            helperText={!emailError ? 'We will verify this email during onboarding.' : undefined}
            autoComplete="email"
            className="auth-input"
          />

          {/* Sits directly under the field it concerns, so the remaining-attempt
              warning reads as part of the email input rather than as a page-level
              banner. Rendered for every phase except hidden/unknown, which is what
              keeps "1 attempt remaining", the blocked countdown and the "You can try
              again now." recovery all on one surface. */}
          <EmailVerificationNotice
            phase={effectivePhase}
            msRemaining={msRemaining}
            id={RATE_LIMIT_NOTICE_ID}
          />

          <Input
            ref={passwordRef}
            label="Password"
            type="password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
              setFeedback(null);
              clearError();
            }}
            onBlur={validatePassword}
            error={passwordError}
            autoComplete="new-password"
            className="auth-input"
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[var(--color-shell-text-muted)]">Mentor Bio</label>
            <div className="relative">
              <textarea
                ref={bioRef}
                value={bio}
                onChange={(e) => {
                  setBio(e.target.value);
                  setBioError(null);
                  setFeedback(null);
                  clearError();
                }}
                onBlur={validateBio}
                placeholder="Describe your background, expertise, and what you hope to mentor on..."
                rows={4}
                maxLength={500}
                className="w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)] px-3 py-2 text-xs text-[var(--color-shell-text)] placeholder-[var(--color-shell-text-subtle)] focus:border-[var(--color-shell-primary)] focus:outline-hidden resize-y"
              />
              <Info className="absolute top-2 right-2 h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
            </div>
            {bioError && <p className="text-[10px] text-[var(--color-shell-error)]">{bioError}</p>}
            <p className="text-[10px] text-[var(--color-shell-text-subtle)]">
              This will be reviewed by Admin during verification. Minimum 20 characters.
            </p>
          </div>

          {displayError && !rateLimitBlocked && !fullNameError && !emailError && !passwordError && !bioError && (
            <p className="text-[10px] text-[var(--color-shell-error)] text-center">{displayError}</p>
          )}

          <Button
            type="submit"
            size="md"
            disabled={submitDisabled}
            // A disabled button gives a screen reader no reason why, so it is
            // pointed at the notice, which states the block and the countdown.
            aria-describedby={rateLimitBlocked ? RATE_LIMIT_NOTICE_ID : undefined}
            className="w-full"
          >
            <span>
              {isSubmitting
                ? 'Creating Account...'
                : rateLimitBlocked
                  ? 'Rate Limit Reached'
                  : 'Create Account & Start Verification'}
            </span>
          </Button>
        </form>

        <div className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)]/50 p-3.5 text-xs text-[var(--color-shell-text-muted)] space-y-2">
          <div className="flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--color-shell-accent)] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-[var(--color-shell-text)]">Verification Process</p>
              <p>After email verification, you will submit required documents (ID, qualifications) for Admin review.</p>
            </div>
          </div>
        </div>

        <div className="pt-2 text-center text-xs text-[var(--color-shell-text-subtle)]">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/auth/login')}
            className="font-medium text-[var(--color-shell-text)] hover:text-[var(--color-shell-accent)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] rounded"
          >
            Sign In
          </button>
        </div>
      </div>
    </AuthLayout>
  );
};
