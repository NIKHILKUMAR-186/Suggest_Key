import React from 'react';
import { cn } from '@/src/lib/utils';
import { TONE_SURFACE, TONE_TEXT, TONE_DOT } from '@/src/components/booking/tokens';
import type { StatusTone } from '@/src/components/booking/statusTone';
import type { LucideIcon } from 'lucide-react';

export interface StatePanelProps {
  tone: StatusTone;
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Small supporting facts (booking code, amount, reference) — real values only. */
  facts?: Array<{ label: string; value: React.ReactNode }>;
  actions?: React.ReactNode;
  /** Spins the icon — reserved for genuinely in-flight work. */
  busy?: boolean;
  className?: string;
  /**
   * How the panel announces itself.
   * `assertive` interrupts for a failure, `polite` waits its turn for progress,
   * and `undefined` leaves the panel silent (it is then referenced by the
   * surrounding region's own labelling instead).
   */
  live?: 'assertive' | 'polite' | 'region';
  children?: React.ReactNode;
}

/**
 * The single panel used for every non-happy transactional state: waiting,
 * processing, success, failure, expiry and unavailability.
 *
 * One component means one layout, so a failed payment on the payment page and
 * a failed payment inside the Razorpay card are visually identical, and both
 * follow the same keyboard and screen-reader contract.
 */
export const StatePanel: React.FC<StatePanelProps> = ({
  tone,
  icon: Icon,
  title,
  description,
  facts,
  actions,
  busy = false,
  className,
  live = 'region',
  children,
}) => (
  <section
    aria-live={live === 'region' ? undefined : live === 'assertive' ? 'assertive' : 'polite'}
    aria-busy={busy || undefined}
    className={cn(
      'rounded-2xl border p-6 text-center sm:p-8',
      TONE_SURFACE[tone],
      className
    )}
  >
    <div
      aria-hidden="true"
      className={cn(
        'mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-xs',
        TONE_TEXT[tone]
      )}
    >
      <Icon className={cn('h-7 w-7', busy && 'motion-safe:animate-spin')} />
    </div>

    <h3 className={cn('mt-4 text-lg font-bold tracking-tight sm:text-xl', TONE_TEXT[tone])}>{title}</h3>

    {description && (
      <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-[var(--color-shell-text-muted)]">
        {description}
      </p>
    )}

    {children}

    {facts && facts.length > 0 && (
      <dl className="mx-auto mt-5 max-w-sm space-y-2 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 text-left text-[13px]">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-center justify-between gap-4">
            <dt className="shrink-0 text-[var(--color-shell-text-muted)]">{fact.label}</dt>
            <dd className="min-w-0 truncate text-right font-semibold text-[var(--color-shell-text)]">{fact.value}</dd>
          </div>
        ))}
      </dl>
    )}

    {actions && <div className="mt-5 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:items-center">{actions}</div>}
  </section>
);

export interface InlineNoticeProps {
  tone: StatusTone;
  title?: string;
  children: React.ReactNode;
  icon?: LucideIcon;
  role?: 'alert' | 'status';
  className?: string;
  actions?: React.ReactNode;
}

/** A compact, inline alternative to `StatePanel` for warnings inside a form. */
export const InlineNotice: React.FC<InlineNoticeProps> = ({
  tone,
  title,
  children,
  icon: Icon,
  role = 'status',
  className,
  actions,
}) => (
  <div role={role} className={cn('rounded-xl border p-4', TONE_SURFACE[tone], className)}>
    <div className="flex items-start gap-3">
      {Icon && (
        <span aria-hidden="true" className={cn('mt-0.5 shrink-0', TONE_TEXT[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className={cn('text-[13px] font-semibold', TONE_TEXT[tone])}>{title}</p>}
        <div className="text-[13px] leading-relaxed text-[var(--color-shell-text-muted)]">{children}</div>
        {actions && <div className="pt-1.5">{actions}</div>}
      </div>
    </div>
  </div>
);

export interface SectionCardProps {
  title?: string;
  description?: string;
  /** Small right-aligned control rendered beside the title. */
  aside?: React.ReactNode;
  icon?: LucideIcon;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  /** Heading level, so a page keeps a sane outline. */
  as?: 'h2' | 'h3';
  'aria-label'?: string;
}

/**
 * A titled panel with consistent padding, heading and divider treatment.
 *
 * Transactional pages previously each invented their own wrapper, which is why
 * their titles, borders and gutters never lined up. This one is the wrapper the
 * whole account area uses.
 */
export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  description,
  aside,
  icon: Icon,
  footer,
  className,
  bodyClassName,
  children,
  as = 'h2',
  'aria-label': ariaLabel,
}) => {
  const Heading = as;
  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        'rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-xs',
        className
      )}
    >
      {(title || aside) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-shell-border)] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {title && (
              <Heading className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-[var(--color-shell-text)]">
                {Icon && <Icon className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />}
                <span className="truncate">{title}</span>
              </Heading>
            )}
            {description && (
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-shell-text-muted)]">{description}</p>
            )}
          </div>
          {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
        </header>
      )}
      <div className={cn('p-5 sm:p-6', bodyClassName)}>{children}</div>
      {footer && (
        <footer className="border-t border-[var(--color-shell-border)] px-5 py-3.5 sm:px-6">{footer}</footer>
      )}
    </section>
  );
};

export interface DetailListProps {
  children: React.ReactNode;
  className?: string;
  /** Single column of label/value pairs. */
  columns?: 1 | 2;
}

/** A `<dl>` wrapper that gives definition rows consistent spacing and wrapping. */
export const DetailList: React.FC<DetailListProps> = ({ children, className, columns = 1 }) => (
  <dl
    className={cn(
      'grid gap-x-6 gap-y-3',
      columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1',
      className
    )}
  >
    {children}
  </dl>
);

export interface DetailItemProps {
  label: string;
  children: React.ReactNode;
  /** Mono treatment for codes, references and identifiers. */
  mono?: boolean;
  className?: string;
  icon?: LucideIcon;
  emphasis?: boolean;
}

export const DetailItem: React.FC<DetailItemProps> = ({
  label,
  children,
  mono = false,
  className,
  icon: Icon,
  emphasis = false,
}) => (
  <div className={cn('min-w-0', className)}>
    <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {label}
    </dt>
    <dd
      className={cn(
        'mt-1 break-words text-[14px]',
        mono && 'font-mono text-[13px]',
        emphasis ? 'font-bold text-[var(--color-shell-text)]' : 'font-medium text-[var(--color-shell-text)]'
      )}
    >
      {children}
    </dd>
  </div>
);

/** A one-line money row used in every summary/total block. */
export const TotalRow: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-[var(--color-shell-border)] pt-3.5">
    <span className="text-[13px] font-semibold text-[var(--color-shell-text)]">{label}</span>
    <span className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5">
      <span className="text-xl font-bold tabular-nums text-[var(--color-shell-text)]">{value}</span>
      {note && <span className="text-[11px] text-[var(--color-shell-text-subtle)]">{note}</span>}
    </span>
  </div>
);

export { TONE_DOT };
