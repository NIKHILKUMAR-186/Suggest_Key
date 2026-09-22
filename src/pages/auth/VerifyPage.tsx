import React from 'react';
import { useNavigation } from '@/src/context/NavigationContext';
import { AuthLayout, AuthEyebrow, AuthHeading, AuthBody } from '@/src/components/auth/AuthLayout';
import { Button } from '@/src/components/ui/Button';
import { CheckCircle2, Mail, ArrowLeft, RefreshCw } from 'lucide-react';

export const VerifyPage: React.FC = () => {
  const { navigate } = useNavigation();

  return (
    <AuthLayout>
      <div className="auth-card space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#663af3] text-white shadow-xs">
              <Mail className="h-5 w-5" />
            </div>
            <span className="text-base font-bold tracking-tight text-white" style={{ fontFamily: 'var(--font-aeonikpro)' }}>
              Suggest Key
            </span>
          </div>
          <AuthEyebrow>Email Verification</AuthEyebrow>
          <AuthHeading>Check Your Inbox</AuthHeading>
          <AuthBody>We've sent a verification link to your email address.</AuthBody>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-[rgba(199,211,234,0.06)] border border-[rgba(186,215,247,0.12)] p-4 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-[#b6d9fc] mx-auto" />
            <p className="text-sm text-[#d1e4fa]">Verification email sent</p>
            <p className="text-xs text-[#9da7ba]">
              We've sent a verification link to:
            </p>
            <p className="text-xs font-mono text-[#c7d3ea] break-all">user@example.com</p>
          </div>

          <div className="rounded-lg border border-[rgba(186,215,247,0.12)] bg-[rgba(186,214,247,0.03)] p-3 text-left text-xs text-[#c7d3ea] space-y-1">
            <span className="font-medium text-[#d1e4fa] block">What's next?</span>
            <p>1. Open your email inbox</p>
            <p>2. Click the verification link</p>
            <p>3. Return here to continue</p>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              size="md"
              onClick={() => navigate('/auth/login')}
              className="w-full"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Sign In
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                // Resend verification
              }}
              className="w-full"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Resend Email
            </Button>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
};