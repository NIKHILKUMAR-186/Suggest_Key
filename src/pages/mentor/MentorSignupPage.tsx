import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { BrandPanel } from '@/src/components/auth/BrandPanel';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { AlertCircle, UserCheck, ArrowRight, Info, ShieldCheck } from 'lucide-react';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    setIsSubmitting(true);

    try {
      // Sign up as mentor (role will be overridden to 'mentor' - but the signup
      // function uses requestedRole to set the initial role via user_metadata)
      // The signUp function will create the auth user + call our server to
      // create the mentor_application on first login
      const res = await signUp(email.trim(), password, fullName.trim(), 'mentor');
      if (res.error) {
        setFeedback(res.error.message);
      } else {
        // After signup, user needs to verify email, then navigate to verification page
        navigate('/auth/verify');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const friendlyError = error || null;
  const displayError = feedback ?? friendlyError;

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

        {(displayError || error) && (
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
              clearError();
            }}
            onBlur={validateEmail}
            error={emailError}
            helperText={!emailError ? 'We will verify this email during onboarding.' : undefined}
            autoComplete="email"
            className="auth-input"
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

          {displayError && !fullNameError && !emailError && !passwordError && !bioError && (
            <p className="text-[10px] text-[var(--color-shell-error)] text-center">{displayError}</p>
          )}

          <Button
            type="submit"
            size="md"
            disabled={isSubmitting}
            className="w-full"
          >
            <span>{isSubmitting ? 'Creating Account...' : 'Create Account & Start Verification'}</span>
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
