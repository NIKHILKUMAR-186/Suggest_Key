import React, { useState } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { UserPlus, Shield, UserCheck, AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import type { UserRole } from '@/src/types/auth';

export const SignUpPage: React.FC = () => {
  const { signUp, error, clearError, isConfigured } = useAuth();
  const { navigate } = useNavigation();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('seeker');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !password) return;

    setIsSubmitting(true);
    setFeedback(null);
    clearError();

    const res = await signUp(email.trim(), password, fullName.trim(), role);
    setIsSubmitting(false);

    if (res.error) {
      setFeedback(res.error.message);
    } else {
      // Role-aware redirect
      if (role === 'mentor') {
        navigate('/mentor');
      } else {
        navigate('/seeker');
      }
    }
  };

  return (
    <div className="max-w-md mx-auto my-8 space-y-6">
      {/* Brand Header */}
      <div className="text-center space-y-1">
        <div className="h-12 w-12 rounded-xl bg-zinc-900 text-white flex items-center justify-center mx-auto mb-3 shadow-xs">
          <UserPlus className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Create an Account</h1>
        <p className="text-xs text-zinc-500">
          Join Suggest Key as a Seeker or Mentorship Specialist
        </p>
      </div>

      {/* Error Notice */}
      {(error || feedback) && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error || feedback}</span>
        </div>
      )}

      {/* Form Card */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Full Name"
            placeholder="e.g. Aman Kumar"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />

          <Input
            label="Email Address"
            type="email"
            placeholder="e.g. yourname@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Input
            label="Password"
            type="password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />

          {/* Role Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-700">Account Role</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole('seeker')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  role === 'seeker'
                    ? 'border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900'
                    : 'border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <div className="font-bold text-xs text-zinc-900">Seeker</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  Discover mentors & book 1:1 sessions
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRole('mentor')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  role === 'mentor'
                    ? 'border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900'
                    : 'border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <div className="font-bold text-xs text-zinc-900">Mentor</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  Offer gigs & conduct consultations
                </div>
              </button>
            </div>
            <p className="text-[10px] text-zinc-400 italic">
              * Note: Administrator roles cannot be self-selected. They are strictly assigned via database RLS and platform administrators.
            </p>
          </div>

          <Button
            type="submit"
            size="md"
            disabled={isSubmitting}
            className="w-full text-xs"
          >
            {isSubmitting ? 'Provisioning Account...' : 'Register & Continue'}
          </Button>
        </form>

        <div className="pt-2 text-center text-xs text-zinc-500">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => navigate('/auth/login')}
            className="font-semibold text-zinc-900 underline hover:text-zinc-700 cursor-pointer"
          >
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
};
