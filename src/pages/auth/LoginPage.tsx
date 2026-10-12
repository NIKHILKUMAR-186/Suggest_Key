import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { BrandPanel } from '@/src/components/auth/BrandPanel';
import { Button } from '@/src/components/ui/Button';
import mapAuthError from '@/src/lib/authErrors';
import { AlertCircle, ArrowLeft, KeyRound, Mail, Lock, Eye, EyeOff } from 'lucide-react';
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
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="auth-form-card space-y-6">
        {/* Header */}
        <div className="auth-form-header">
          <div className="auth-form-logo" aria-hidden="true">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="auth-form-title">Welcome back</h1>
          <p className="auth-form-subtitle">Sign in to continue your mentorship journey.</p>
        </div>

        {/* Error Banner */}
        {displayError && (
          <div className="auth-banner auth-banner--error" role="alert" aria-live="polite">
            <AlertCircle className="auth-banner-icon h-5 w-5" aria-hidden="true" />
            <span>{displayError}</span>
          </div>
        )}

        {/* Google Sign In */}
        <button
          type="button"
          className="auth-google-button"
          onClick={async () => {
            const res = await signInWithGoogle();
            if (res.error) setFeedback(mapAuthError(res.error));
          }}
          disabled={isSubmitting}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.21h5.96-2.27v8.29h3.75c0-2.17 1.75-3.95 3.96-3.95v-6.3z" />
            <path d="M12 23c2.43 0 4.47-.8 5.93-2.16l-3.66-2.85c-1.43 1.06-3.29 1.7-5.27 1.7-4.07 0-7.44-3.26-7.44-7.25 0-1.39.25-2.71.69-3.91l-.09-.01C4.03 7.44 7.96 3.5 12 3.5c1.64 0 3.14.6 4.31 1.59l2.88-2.88C17.54 1.26 14.96 0 12 0 6.84 0 2.56 4.93 2.56 10.06c0 2.33.89 4.45 2.35 6.02l-.02.18z" />
          </svg>
          <span>Continue with Google</span>
        </button>

        {/* Divider */}
        <div className="auth-divider">or</div>

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="auth-form-group">
            <label htmlFor="email" className="auth-input-label">Email Address</label>
            <div className="auth-input-wrapper">
              <input
                ref={emailRef}
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

          <div className="auth-form-group">
            <label htmlFor="password" className="auth-input-label">Password</label>
            <div className="auth-password-wrapper">
              <input
                ref={passwordRef}
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
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
                autoComplete="current-password"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Eye className="h-5 w-5" aria-hidden="true" />
                )}
              </button>
              {passwordError && (
                <p id="password-error" className="auth-input-error" role="alert">{passwordError}</p>
              )}
              {!passwordError && (
                <p id="password-helper" className="auth-input-helper">Keep your password private.</p>
              )}
            </div>
          </div>

          <div className="auth-form-actions">
            <Button
              type="submit"
              size="md"
              isLoading={isSubmitting}
              loadingText="Signing In..."
              className="auth-button auth-button--accent w-full"
            >
              Continue
            </Button>
          </div>
        </form>

        {/* Forgot password */}
        <div className="auth-footer-links">
          <button
            type="button"
            onClick={() => navigate('/auth/forgot-password')}
            className="auth-button auth-button--ghost"
          >
            Forgot your password?
          </button>
        </div>

        {/* Create account link */}
        <div className="auth-footer-links">
          Don't have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/auth/signup')}
            className="auth-button auth-button--ghost"
          >
            Create an Account
          </button>
        </div>
      </div>
    </AuthLayout>
  );
};
