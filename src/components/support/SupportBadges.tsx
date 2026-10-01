import React from 'react';
import { cn } from '@/src/lib/utils';
import {
  supportPriorityPresentation,
  supportStatusPresentation,
  type BadgeTone,
} from '@/src/lib/supportDomain';

/**
 * Status and priority badges.
 *
 * Status is never signalled by colour alone: every badge carries a text label,
 * and the status badge also carries a glyph. Two statuses that share a tone in
 * one palette are still distinguishable, and the whole thing is legible in
 * monochrome or to a screen reader.
 */

const TONE_CLASSES: Record<BadgeTone, string> = {
  info: 'bg-[var(--color-shell-info-soft,var(--color-shell-surface-elevated))] text-[var(--color-shell-info,var(--color-shell-text))] border-[var(--color-shell-info,var(--color-shell-border))]/30',
  progress: 'bg-[var(--color-shell-accent-soft,var(--color-shell-surface-elevated))] text-[var(--color-shell-accent,var(--color-shell-text))] border-[var(--color-shell-accent,var(--color-shell-border))]/30',
  waiting: 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-warning)] border-[var(--color-shell-warning)]/30',
  success: 'bg-[var(--color-shell-success-soft)] text-[var(--color-shell-success)] border-[var(--color-shell-success)]/30',
  urgent: 'bg-[var(--color-shell-error-soft)] text-[var(--color-shell-error)] border-[var(--color-shell-error)]/30',
  neutral: 'bg-[var(--color-shell-bg)] text-[var(--color-shell-text-muted)] border-[var(--color-shell-border)]',
};

const BadgeShell: React.FC<{ tone: BadgeTone; title?: string; className?: string; children: React.ReactNode }> = ({
  tone,
  title,
  className,
  children,
}) => (
  <span
    title={title}
    className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
      TONE_CLASSES[tone],
      className
    )}
  >
    {children}
  </span>
);

/** `◐ In Progress`. The label is the accessible name; the glyph is decorative. */
export const SupportStatusBadge: React.FC<{ status: string; className?: string }> = ({ status, className }) => {
  const { label, icon, tone } = supportStatusPresentation(status);
  return (
    <BadgeShell tone={tone} className={className}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </BadgeShell>
  );
};

/** `↑ High`. Urgent additionally gets a non-colour word, so it is unmistakable. */
export const SupportPriorityBadge: React.FC<{ priority: string; className?: string }> = ({
  priority,
  className,
}) => {
  const { label, icon } = supportPriorityPresentation(priority);
  return (
    <BadgeShell tone={priority === 'URGENT' ? 'urgent' : 'neutral'} className={className}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </BadgeShell>
  );
};

/**
 * The ticket code as a monospace chip.
 *
 * This is the public identifier. `support_tickets.id` is a UUID and is never
 * shown to a user, so a screenshot of a ticket can be quoted without leaking
 * anything internal.
 */
export const TicketCodeChip: React.FC<{ code: string; className?: string }> = ({ code, className }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-md border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--color-shell-text-muted)]',
      className
    )}
  >
    #{code}
  </span>
);