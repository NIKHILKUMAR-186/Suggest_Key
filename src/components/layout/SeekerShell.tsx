import React from 'react';
import { SeekerHeader } from '@/src/components/navigation/SeekerHeader';

export interface SeekerShellProps {
  children: React.ReactNode;
}

/**
 * The seeker shell: the seeker header plus the page body.
 *
 * The header is the `SeekerHeader` — the Suggest Key plum bar carrying the
 * database-driven segment switcher, Home, and the account menu — rather than
 * the legacy role nav. The other seeker routes (bookings, payments, sessions,
 * settings) keep their existing page content and layout; only the chrome
 * changes.
 *
 * The seeker home renders its own warm marketplace canvas and footer inside
 * this shell, so the bar sits above it without any page needing to know about
 * the other.
 */
export const SeekerShell: React.FC<SeekerShellProps> = ({ children }) => {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--sk-brand-canvas)] text-[var(--sk-brand-text)] antialiased">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[var(--sk-brand-plum)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-xl"
      >
        Skip to main content
      </a>

      <SeekerHeader />

      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
    </div>
  );
};

export default SeekerShell;