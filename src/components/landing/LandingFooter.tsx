import React from 'react';
import { FOOTER_GROUPS } from '@/src/components/landing/landingContent';

export interface LandingFooterProps {
  /** The app's own navigate(); anchors are scrolled, routes are pushed. */
  onNavigate: (href: string) => void;
}

/**
 * FOOTER.
 *
 * Links only to what exists: on-page anchors, the sign-in and sign-up routes,
 * and mentor signup. This app has no About, Privacy or Terms page, so none is
 * listed rather than linking somewhere that would 404.
 */
export const LandingFooter: React.FC<LandingFooterProps> = ({ onNavigate }) => (
  <footer className="border-t border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] px-4 py-14 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1240px]">
      <div className="grid grid-cols-2 gap-10 sm:grid-cols-4 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="col-span-2 sm:col-span-4 lg:col-span-1">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="h-9 w-9 rounded-xl object-cover" width={36} height={36} />
            <img src="/name.png" alt="Suggest Key" className="h-5 w-auto" />
          </div>
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-[var(--sk-brand-text-muted)]">
            A curated 1:1 mentorship marketplace. Find an approved mentor, book a time that works, and leave with
            clarity.
          </p>
        </div>

        {FOOTER_GROUPS.map((group) => (
          <nav key={group.title} aria-label={`Footer: ${group.title}`}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--sk-brand-text-muted)]">
              {group.title}
            </h2>
            <ul className="mt-4 space-y-1">
              {group.links.map((link) => (
                <li key={link.label}>
                  <button
                    type="button"
                    onClick={() => onNavigate(link.href)}
                    className="min-h-[36px] cursor-pointer rounded px-1 py-1.5 text-left text-[13px] text-[var(--sk-brand-text-muted)] transition-colors hover:text-[var(--sk-brand-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="mt-12 border-t border-[var(--sk-brand-border)] pt-6">
        <p className="text-[12px] text-[var(--sk-brand-text-muted)]">
          &copy; {new Date().getFullYear()} Suggest Key. All rights reserved.
        </p>
      </div>
    </div>
  </footer>
);