import React, { useState } from 'react';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { ArrowLeft, CheckCircle2, Lock } from 'lucide-react';

export const ResetPasswordPage: React.FC = () => {
  const { navigate } = useNavigation();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setFeedback('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setFeedback('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    // Simulate password reset completion
    setIsSubmitting(false);
    setIsSuccess(true);
  };

  return (
    <AuthLayout>
      <div className="auth-card space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#663af3] text-white shadow-xs">
              <Lock className="h-5 w-5" />
            </div>
            <span className="text-base font-bold tracking-tight text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Suggest Key
            </span>
          </div>
          <AuthEyebrow>Set New Password</AuthEyebrow>
          <AuthHeading>Reset Password</AuthHeading>
          <AuthBody>Choose a new password for your account</AuthBody>
        </div>

        {isSuccess ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-[rgba(199,211,234,0.06)] border border-[rgba(186,215,247,0.12)] p-4 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-[#b6d9fc] mx-auto" />
              <p className="text-sm text-[#d1e4fa]">Password updated successfully</p>
              <p className="text-xs text-[#9da7ba]">You can now sign in with your new password.</p>
            </div>
            <Button
              size="md"
              onClick={() => navigate('/auth/login')}
              className="w-full"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Sign In
            </Button>
          </div>
        ) : (
          <>
            {/* Error Notice */}
            {feedback && (
              <div className="rounded-lg bg-[rgba(231,76,60,0.08)] border border-[rgba(231,76,60,0.2)] p-3 text-xs text-[#e46d4c] flex items-start gap-2">
                <span>{feedback}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="New Password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="auth-input"
              />

              <Input
                label="Confirm New Password"
                type="password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="auth-input"
              />

              <Button
                type="submit"
                size="md"
                disabled={isSubmitting}
                className="w-full auth-button-primary"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>{isSubmitting ? 'Updating...' : 'Update Password'}</span>
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthLayout>
  );
};