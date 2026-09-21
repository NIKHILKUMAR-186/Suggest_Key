import React from 'react';
import { TopNavigation } from '@/src/components/navigation/TopNavigation';

export interface MentorShellProps {
  children: React.ReactNode;
}

export const MentorShell: React.FC<MentorShellProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-50/40 text-zinc-900 antialiased selection:bg-zinc-900 selection:text-white">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-zinc-950 focus:text-white focus:rounded-lg focus:shadow-xl focus:outline-none focus:ring-2 focus:ring-amber-400 font-semibold text-xs"
      >
        Skip to main content
      </a>
      <TopNavigation />
      <main id="main-content" tabIndex={-1} className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 focus:outline-none">
        {children}
      </main>
    </div>
  );
};
