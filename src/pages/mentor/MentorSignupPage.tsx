import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { BrandPanel } from '@/src/components/auth/BrandPanel';
import { Button } from '@/src/components/ui/Button';
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
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="auth-form-card space-y-6">
        {/* Brand */}
        <div className="auth-form-header">
          <div className="auth-form-logo" aria-hidden="true">
            <UserCheck className="h-6 w-6" />
          </div>
          <AuthEyebrow>Mentor Onboarding</AuthEyebrow>
          <AuthHeading>Create Your Mentor Account</AuthHeading>
          <AuthBody>
            Create your account to begin the mentor verification process.
            Your credentials will be reviewed by our Admin team before you appear in seeker searches.
          </AuthBody>
        </div>

        {(displayError || error) && (
          <div className="auth-banner auth-banner--error" role="alert" aria-live="polite">
            <AlertCircle className="auth-banner-icon h-5 w-5" aria-hidden="true" />
            <span>{displayError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-form-group">
            <label htmlFor="fullName" className="auth-input-label">Full Name</label>
            <div className="auth-input-wrapper">
              <input
                ref={fullNameRef}
                id="fullName"
                type="text"
                placeholder="e.g. Rahul Sharma"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setFullNameError(null);
                  setFeedback(null);
                  clearError();
                }}
                onBlur={validateFullName}
                className="auth-input-field"
                aria-invalid={!!fullNameError}
                aria-describedby={fullNameError ? 'fullName-error' : undefined}
                required
                autoComplete="name"
              />
              {fullNameError && (
                <p id="fullName-error" className="auth-input-error" role="alert">{fullNameError}</p>
              )}
            </div>
          </div>

          <div className="auth-form-group">
            <label htmlFor="email" className="auth-input-label">Email Address</label>
            <div className="auth-input-wrapper">
              <input
                ref={emailRef}
                id="email"
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
                className="auth-input-field"
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'email-error' : 'email-helper'}
                required
                autoComplete="email"
              />
              {emailError && (
                <p id="email-error" className="auth-input-error" role="alert">{emailError}</p>
              )}
              {!emailError && (
                <p id="email-helper" className="auth-input-helper">We will verify this email during onboarding.</p>
              )}
            </div>
          </div>

          <div className="auth-form-group">
            <label htmlFor="password" className="auth-input-label">Password</label>
            <div className="auth-password-wrapper">
              <input
                ref={passwordRef}
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(null);
                  setFeedback(null);
                  clearError();
                }}
                onBlur={validatePassword}
                className="auth-input-field"
                aria-invalid={!!passwordError}
                aria-describedby={passwordError ? 'password-error' : undefined}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? (
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
              {passwordError && (
                <p id="password-error" className="auth-input-error" role="alert">{passwordError}</p>
              )}
            </div>
          </div>

          <div className="auth-form-group">
            <label htmlFor="bio" className="auth-input-label">Mentor Bio</label>
            <div className="auth-input-wrapper">
              <textarea
                ref={bioRef}
                id="bio"
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
                className="auth-input-field"
                style={{ minHeight: '120px', resize: 'vertical', paddingTop: '12px', paddingBottom: '12px', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-body-sm)' }}
                aria-invalid={!!bioError}
                aria-describedby={bioError ? 'bio-error' : 'bio-helper'}
              />
              {bioError && (
                <p id="bio-error" className="auth-input-error" role="alert">{bioError}</p>
              )}
              {!bioError && (
                <p id="bio-helper" className="auth-input-helper">This will be reviewed by Admin during verification. Minimum 20 characters.</p>
              )}
            </div>
          </div>

          {displayError && !fullNameError && !emailError && !passwordError && !bioError && (
            <div className="auth-banner auth-banner--error" role="alert" aria-live="polite">
              <AlertCircle className="auth-banner-icon h-5 w-5" aria-hidden="true" />
              <span>{displayError}</span>
            </div>
          )}

          <div className="auth-form-actions">
            <Button
              type="submit"
              size="md"
              disabled={isSubmitting}
              className="auth-button auth-button--accent w-full"
            >
              <span>{isSubmitting ? 'Creating Account...' : 'Create Account & Start Verification'}</span>
            </Button>
          </div>
        </form>

        <div className="auth-info-box">
          <div className="flex items-start gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--orange)] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="auth-info-box-title">Verification Process</p>
              <p className="auth-info-box-text">After email verification, you will submit required documents (ID, qualifications) for Admin review.</p>
            </div>
          </div>
        </div>

        <div className="auth-footer-links">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/auth/login')}
            className="auth-button auth-button--ghost"
          >
            Sign In
          </button>
        </div>
      </div>
    </AuthLayout>
  );
};
