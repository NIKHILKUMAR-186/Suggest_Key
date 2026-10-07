import React from 'react';
import { cn } from '@/src/lib/utils';
import { ArrowLeft, Calendar, Clock, User, Briefcase } from 'lucide-react';

export interface MentorPageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  eyebrow?: string;
  className?: string;
}

/**
 * Crisp, reusable page head for the mentor workspace.
 * Mirrors the briefing: one clear title, one optional supporting line,
 * one optional primary action. Nothing decorative.
 */
export const MentorPageHeader: React.FC<MentorPageHeaderProps> = ({
  title,
  description,
  action,
  backHref,
  backLabel = 'Back',
  eyebrow,
  className,
}) => {
  return (
    <div
      className={cn(
        'mentor-page header-layer',
        'mb-2',
        'sm:mb-4',
        'border-b border-[var(--color-shell-border)] pb-4 sm:pb-6',
        className
      )}
    >
      <div className="max-w-4xl mx-auto sm:max-w-6xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {backHref && (
              <a
                href={backHref}
                className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-shell-text)] hover:text-[var(--color-shell-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-primary)] focus-visible:ring-offset-2 rounded-lg"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {backLabel}
              </a>
            )}
            {!backHref && (
              <p className="sr-only">{backLabel}</p>
            )}
            {eyebrow && (
              <p className="mentor-section-eyebrow mt-1">{eyebrow}</p>
            )}
            <h1 className="mentor-section-head h1 mt-1">{title}</h1>
            {description && (
              <p className="mentor-section-head p mt-1.5 text-[var(--color-shell-text-muted)] text-sm leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      </div>
    </div>
  );
};

/**
 * Page headings should look calm, not monumentally empty. A single
 * refined scale keeps the workspace calm and readable.
 */
declare global {
  interface HTMLElementTagNameMap {
    'mentor-h1': HTMLHeadingElement;
  }
}
