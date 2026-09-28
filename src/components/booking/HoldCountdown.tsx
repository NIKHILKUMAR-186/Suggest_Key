import React from 'react';
import { Clock, TriangleAlert } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { InlineNotice } from '@/src/components/booking/StatePanel';
import { TONE_SURFACE, TONE_TEXT, TONE_DOT } from '@/src/components/booking/tokens';
import { formatCountdown } from '@/src/lib/bookingService';

export interface HoldCountdownProps {
  /** Seconds left on the hold. The database remains authoritative. */
  secondsRemaining: number;
  /** Total length of the hold, used only to draw the depletion bar. */
  totalSeconds: number;
  expired?: boolean;
  /** Renders the expired treatment instead of the live countdown. */
  expiredTitle?: string;
  expiredBody?: string;
  className?: string;
  /** Announce the minute marks only, so screen readers are not flooded each second. */
  label?: string;
}

/**
 * The hold countdown, shown wherever a slot is reserved and payment is pending.
 *
 * Two rules this component exists to enforce:
 *
 * 1. It shows the *remaining* time as a depleting bar, because a seeker who
 *    sees "15:00" and a full bar cannot tell whether anything is happening.
 * 2. It only escalates tone as the hold gets genuinely short. A countdown that
 *    turns red the instant it appears trains people to ignore red.
 *
 * It is a display of real server state, never a timer that pretends to extend a
 * hold: the authoritative expiry is `slot_holds.expires_at`.
 */
export const HoldCountdown: React.FC<HoldCountdownProps> = ({
  secondsRemaining,
  totalSeconds,
  expired = false,
  expiredTitle = 'Payment window expired',
  expiredBody,
  className,
  label = 'Time remaining',
}) => {
  if (expired) {
    return (
      <InlineNotice
        tone="danger"
        role="alert"
        icon={TriangleAlert}
        title={expiredTitle}
        className={className}
      >
        {expiredBody}
      </InlineNotice>
    );
  }

  const safeTotal = Math.max(1, totalSeconds);
  const remaining = Math.max(0, Math.min(secondsRemaining, safeTotal));
  const ratio = remaining / safeTotal;
  // Escalate only in the last fifth of the hold, and never in the final ten
  // seconds, where the warning colour would just be noise.
  const urgent = ratio <= 0.2 && remaining > 10;
  const tone = urgent ? 'danger' : 'warning';
  const roundedPercent = Math.round(ratio * 100);
  // Announced once a minute rather than once a second. Inside the last minute a
  // whole-minute reading would be "0 minutes", which tells the seeker nothing, so
  // the seconds are spoken directly for that final stretch.
  const wholeMinutes = Math.floor(remaining / 60);
  const announcement =
    remaining < 60
      ? `${remaining} second${remaining === 1 ? '' : 's'} remaining`
      : `${wholeMinutes} minute${wholeMinutes === 1 ? '' : 's'} remaining`;

  return (
    <div className={cn('rounded-xl border p-4', TONE_SURFACE[tone], className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]',
              TONE_TEXT[tone]
            )}
          >
            <Clock className="h-4 w-4" />
          </span>
          <div>
            <p className={cn('text-[13px] font-semibold', TONE_TEXT[tone])}>{label}</p>
            <p className="text-[11.5px] text-[var(--color-shell-text-muted)]">
              The slot is released automatically when this reaches zero.
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {announcement}
          </span>
          <span
            aria-hidden="true"
            className="block font-mono text-xl font-bold tabular-nums text-[var(--color-shell-text)]"
          >
            {formatCountdown(remaining)}
          </span>
        </div>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedPercent}
        aria-label="Payment window remaining"
        className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-shell-border)]"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500 ease-out', TONE_DOT[tone])}
          style={{ width: `${roundedPercent}%` }}
        />
      </div>
    </div>
  );
};

export interface LiveCountdownProps {
  secondsRemaining: number;
  label: string;
  className?: string;
}

/**
 * A compact clock for a session that is already running.
 *
 * Unlike the hold, a running session's clock is not a deadline the seeker can
 * influence, so it is presented as elapsed-state information rather than a
 * warning.
 */
export const LiveCountdown: React.FC<LiveCountdownProps> = ({ secondsRemaining, label, className }) => {
  const safe = Math.max(0, secondsRemaining);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border px-4 py-3',
        TONE_SURFACE.success,
        className
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', TONE_DOT.success, 'motion-safe:animate-pulse')} />
        <span className="text-[13px] font-semibold text-[var(--color-shell-text)]">{label}</span>
      </div>
      <span className="font-mono text-lg font-bold tabular-nums text-[var(--color-shell-text)]">
        <span className="sr-only">{Math.floor(safe / 60)} minutes and {s} seconds remaining</span>
        <span aria-hidden="true">{clock}</span>
      </span>
    </div>
  );
};
