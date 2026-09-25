import React from 'react';
import { cn } from '@/src/lib/utils';

interface BrandPanelProps {
  className?: string;
}

export const BrandPanel: React.FC<BrandPanelProps> = ({ className }) => {
  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Logo */}
      <div className="flex items-center gap-3 mb-16">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-shell-primary)] text-white shadow-sm">
          <svg
            className="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          
        </div>
        <div>
          <span
            className="text-lg font-bold tracking-tight text-[var(--color-shell-text)] block leading-tight"
            style={{ fontFamily: 'var(--font-aeonikpro)' }}
          >
            Suggest Key
          </span>
        </div>
      </div>

      {/* Headline + Body */}
      <div className="space-y-6 mb-10">
        <h2
          className="brand-headline"
          style={{ fontFamily: 'var(--font-aeonikpro)' }}
        >
          Guidance that moves you forward.
        </h2>
        <p className="brand-body">
          Connect with the right mentor for focused, one-to-one conversations that help you take your next step.
        </p>
      </div>

      {/* Feature list */}
      <ul className="brand-feature-list space-y-4">
        <li className="flex items-start gap-3">
          <svg
            className="h-5 w-5 text-[var(--color-shell-accent)] shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>Personal mentorship tailored to your goals</span>
        </li>
        <li className="flex items-start gap-3">
          <svg
            className="h-5 w-5 text-[var(--color-shell-accent)] shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>Focused 1:1 sessions at times that work for you</span>
        </li>
        <li className="flex items-start gap-3">
          <svg
            className="h-5 w-5 text-[var(--color-shell-accent)] shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Real human guidance from verified mentors</span>
        </li>
      </ul>

      {/* Decorative abstract motif */}
      <div className="mt-auto pt-10">
        <div className="flex items-end gap-2 opacity-40" aria-hidden="true">
          <div className="w-16 h-3 rounded-full bg-[var(--color-shell-accent)]/60" />
          <div className="w-24 h-5 rounded-full bg-[var(--color-shell-accent)]/40" />
          <div className="w-12 h-2 rounded-full bg-[var(--color-shell-accent)]/30" />
          <div className="w-20 h-4 rounded-full bg-[var(--color-shell-accent)]/50" />
          <div className="w-14 h-3 rounded-full bg-[var(--color-shell-accent)]/35" />
        </div>
        <p className="mt-3 text-[11px] text-[var(--color-shell-text-subtle)]">
          Seeker → Mentor → Conversation → Growth
        </p>
      </div>
    </div>
  );
};

export default BrandPanel;