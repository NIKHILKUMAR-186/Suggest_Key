import React, { useState, useEffect } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { AlertCircle, Sparkles, UserPlus } from 'lucide-react';

export const SignUpPage: React.FC = () => {
  const { signUp, error, clearError, activeRole, isAuthenticated } = useAuth();
  const { navigate } = useNavigation();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [fullNameError, setFullNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Redirect already-authenticated users to their role-specific app
  useEffect(() => {
    if (isAuthenticated && activeRole) {
      if (activeRole === 'admin') navigate('/admin');
      else if (activeRole === 'mentor') navigate('/mentor');
      else navigate('/seeker');
    }
  }, [isAuthenticated, activeRole, navigate]);

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validateFullName = () => {
    if (!fullName.trim()) {
      setFullNameError('Enter your full name.');
      return 'Enter your full name.';
    }
    setFullNameError(null);
    return null;
  };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const fullValidationError = validateFullName();
    const emailValidationError = validateEmail();
    const passwordValidationError = validatePassword();

    if (fullValidationError || emailValidationError || passwordValidationError) {
      return;
    }

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
      <div className="auth-form-card space-y-6">
        {/* Brand Header */}
        <div className="auth-form-header">
          <div className="auth-form-logo" aria-hidden="true">
            <Sparkles className="h-6 w-6" />
          </div>
          <AuthEyebrow>Join the Community</AuthEyebrow>
          <AuthHeading>Create an Account</AuthHeading>
          <AuthBody>Start your mentorship journey today</AuthBody>
        </div>

        {/* Error Notice */}
        {(error || feedback) && (
          <div className="auth-banner auth-banner--error" role="alert" aria-live="polite">
            <AlertCircle className="auth-banner-icon h-5 w-5" aria-hidden="true" />
            <span>{error || feedback}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-form-group">
            <label htmlFor="fullName" className="auth-input-label">Full Name</label>
            <div className="auth-input-wrapper">
              <input
                id="fullName"
                type="text"
                placeholder="e.g. Aman Kumar"
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
                aria-describedby={emailError ? 'email-error' : undefined}
                required
                autoComplete="email"
              />
              {emailError && (
                <p id="email-error" className="auth-input-error" role="alert">{emailError}</p>
              )}
            </div>
          </div>

          <div className="auth-form-group">
            <label htmlFor="password" className="auth-input-label">Password</label>
            <div className="auth-password-wrapper">
              <input
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
                aria-describedby={passwordError ? 'password-error' : 'password-helper'}
                required
                minLength={6}
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
              {!passwordError && (
                <p id="password-helper" className="auth-input-helper">Use a password you do not use elsewhere.</p>
              )}
            </div>
          </div>

          <div className="auth-info-box">
            <div className="flex items-start gap-2">
              <UserPlus className="h-5 w-5 text-[var(--orange)] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="auth-info-box-title">Seeker Account</p>
                <p className="auth-info-box-text">
                  This signup creates a seeker account. To become a mentor, use the dedicated{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/mentor/signup')}
                    className="font-medium text-[var(--orange)] hover:underline cursor-pointer"
                  >
                    Mentor Signup
                  </button>{' '}
                  route instead.
                </p>
              </div>
            </div>
          </div>

          <div className="auth-form-actions">
            <Button
              type="submit"
              size="md"
              disabled={isSubmitting}
              className="auth-button auth-button--accent w-full"
            >
              <UserPlus className="h-5 w-5" aria-hidden="true" />
              <span>{isSubmitting ? 'Provisioning Account...' : 'Register & Continue'}</span>
            </Button>
          </div>
        </form>

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