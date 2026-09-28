import React from 'react';
import { cn } from '@/src/lib/utils';
import { TONE_CHIP, TONE_DOT } from '@/src/components/booking/tokens';
import type { StatusDescriptor, StatusTone } from '@/src/components/booking/statusTone';

export interface StatusPillProps {
  tone: StatusTone;
  label: string;
  /** Renders a leading dot; useful for "live" states. */
  dot?: boolean;
  pulse?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  /** Announced to assistive tech as the status, not just its colour. */
  srPrefix?: string;
}

/**
 * The one status chip used by every booking, payment and session surface.
 *
 * It always pairs a word with a colour, so status is never communicated by hue
 * alone, and it is a plain span rather than a div so it is valid wherever it is
 * placed (inside headings, table cells, list items).
 */
export const StatusPill: React.FC<StatusPillProps> = ({
  tone,
  label,
  dot = false,
  pulse = false,
  size = 'sm',
  className,
  srPrefix,
}) => (
  <span
    className={cn(
      'inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap',
      size === 'sm' ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
      TONE_CHIP[tone],
      className
    )}
  >
    {srPrefix && <span className="sr-only">{srPrefix}: </span>}
    {dot && (
      <span
        aria-hidden="true"
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone], pulse && 'motion-safe:animate-pulse')}
      />
    )}
    <span className="truncate">{label}</span>
  </span>
);

export interface StatusCalloutProps {
  descriptor: StatusDescriptor;
  className?: string;
  children?: React.ReactNode;
}

/**
 * A status with an explanation attached.
 *
 * The copy is written out in full under the label rather than hidden behind a
 * tooltip, because on a payment screen the difference between "Rejected" and
 * "Rejected — your reference did not match" is the whole point of the screen.
 */
export const StatusCallout: React.FC<StatusCalloutProps> = ({ descriptor, className, children }) => (
  <div role="status" className={cn('space-y-1.5', className)}>
    <StatusPill tone={descriptor.tone} label={descriptor.label} size="md" />
    {descriptor.hint && (
      <p className="text-[13px] leading-relaxed text-[var(--color-shell-text-muted)]">{descriptor.hint}</p>
    )}
    {children}
  </div>
);
