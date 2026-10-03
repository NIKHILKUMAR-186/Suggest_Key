import React from 'react';
import { TriangleAlert, Hourglass, RefreshCw } from 'lucide-react';
import {
  BLOCKED_WITHOUT_DEADLINE_MESSAGE,
  describeAttemptsRemaining,
  describeCountdownForAssistiveTech,
  formatEmailVerificationCountdown,
  type EmailVerificationPhase,
} from '@/src/lib/emailVerificationLimit';

export interface EmailVerificationNoticeProps {
  phase: EmailVerificationPhase;
  /** Milliseconds left on the cooldown, measured against the server clock. */
  msRemaining: number | null;
  /** Rendered after "Try again in", and associated with the disabled action. */
  id?: string;
  className?: string;
}

/**
 * The verification-email rate-limit status for the signup form.
 *
 * Four states, four treatments, all drawn from the existing auth surfaces so the
 * card's layout and spacing are untouched:
 *
 *   warning   the budget is nearly spent, the action still works, `role="status"`
 *   cooldown  the server refused and gave a deadline, `role="alert"` plus a clock
 *   blocked   the server refused with no deadline it is willing to share
 *   ready     the clock hit zero; the action unlocks and the server re-decides
 *
 * `unknown` renders nothing at all. That is the whole point: when the ledger
 * cannot be consulted the honest thing to show is nothing, not a guess.
 */
export const EmailVerificationNotice: React.FC<EmailVerificationNoticeProps> = ({
  phase,
  msRemaining,
  id,
  className = '',
}) => {
  if (phase.kind === 'unknown' || phase.kind === 'available') return null;

  if (phase.kind === 'ready') {
    return (
      <div
        id={id}
        className={`flex items-start gap-2 rounded-lg border border-[var(--color-shell-success)] bg-[var(--color-shell-success-soft)] px-3 py-2 text-xs text-[var(--color-shell-success)] ${className}`}
        role="status"
        aria-live="polite"
      >
        <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>You can try again now.</span>
      </div>
    );
  }

  if (phase.kind === 'warning') {
    return (
      <div
        id={id}
        className={`flex items-start gap-2 rounded-lg border border-[var(--color-shell-warning)] bg-[var(--color-shell-warning-soft)] px-3 py-2 text-xs text-[var(--color-shell-warning)] ${className}`}
        role="status"
        aria-live="polite"
      >
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{describeAttemptsRemaining(phase.remaining)}</span>
      </div>
    );
  }

  // A `blocked` phase arrives with no deadline at all, which is how the page
  // learns the server has nothing to count down to.
  const deadlineMs = phase.kind === 'cooldown' ? msRemaining : null;

  const countdownRow =
    deadlineMs === null ? (
      <p className="pl-[22px]">{BLOCKED_WITHOUT_DEADLINE_MESSAGE}</p>
    ) : (
      <div className="flex items-center gap-1.5 pl-[22px]">
        {/* Spoken at minute marks (seconds in the last minute) rather than every
            second. A live region re-read once a second is unusable, and the
            digits themselves are hidden from the accessibility tree so this
            quiet update is the only thing announced. */}
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {describeCountdownForAssistiveTech(deadlineMs)}
        </span>
        <span aria-hidden="true">Try again in</span>
        <Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span
          aria-hidden="true"
          className="font-mono font-semibold tabular-nums"
          data-testid="email-verification-countdown"
        >
          {formatEmailVerificationCountdown(deadlineMs)}
        </span>
      </div>
    );

  return (
    <div
      id={id}
      className={`space-y-1.5 rounded-lg border border-[var(--color-shell-error)] bg-[var(--color-shell-error-soft)] px-3 py-2 text-xs text-[var(--color-shell-error)] ${className}`}
      // An alert, because the user's next action was just refused. The ticking
      // clock lives outside it, in the polite region above, so the per-second
      // change never re-announces this node.
      role="alert"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p className="font-medium">Too many email verification attempts</p>
      </div>

      {countdownRow}
    </div>
  );
};