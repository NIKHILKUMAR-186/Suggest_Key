import React, { useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { AlertCircle, ArrowLeft, CheckCircle2, Lock, Eye, EyeOff } from 'lucide-react';
import mapAuthError from '@/src/lib/authErrors';

export const ResetPasswordPage: React.FC = () => {
  const { updatePassword, error, clearError } = useAuth();
  const { navigate } = useNavigation();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
      <div className="auth-form-card space-y-6">
        {/* Header */}
        <div className="auth-form-header">
          <div className="auth-form-logo" aria-hidden="true">
            <Lock className="h-6 w-6" />
          </div>
          <AuthHeading>Choose a new password</AuthHeading>
          <AuthBody>Use at least 6 characters to protect your account.</AuthBody>
        </div>

        {isSuccess ? (
          <div className="auth-success-state" aria-live="polite">
            <div className="auth-success-icon" aria-hidden="true">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <h2 className="auth-success-title">Password updated</h2>
            <p className="auth-success-text">You can now sign in with your new password.</p>
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
                <label htmlFor="password" className="auth-input-label">New Password</label>
                <div className="auth-password-wrapper">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
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
                    className="auth-input-field"
                    aria-invalid={!!passwordError}
                    aria-describedby={passwordError ? 'password-error' : 'password-helper'}
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
                      <EyeOff className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-5 w-5" aria-hidden="true" />
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

              <div className="auth-form-group">
                <label htmlFor="confirmPassword" className="auth-input-label">Confirm New Password</label>
                <div className="auth-password-wrapper">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setConfirmPasswordError(null);
                      setFeedback(null);
                      clearError();
                    }}
                    onBlur={validatePasswords}
                    className="auth-input-field"
                    aria-invalid={!!confirmPasswordError}
                    aria-describedby={confirmPasswordError ? 'confirmPassword-error' : undefined}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showConfirmPassword}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-5 w-5" aria-hidden="true" />
                    )}
                  </button>
                  {confirmPasswordError && (
                    <p id="confirmPassword-error" className="auth-input-error" role="alert">{confirmPasswordError}</p>
                  )}
                </div>
              </div>

              <div className="auth-form-actions">
                <Button
                  type="submit"
                  size="md"
                  isLoading={isSubmitting}
                  loadingText="Updating..."
                  className="auth-button auth-button--accent w-full"
                >
                  <Lock className="h-5 w-5" aria-hidden="true" />
                  <span>Update Password</span>
                </Button>
              </div>
            </form>
          </>
        )}
      </div>
    </AuthLayout>
  );
};