import React from 'react';
import { AdminSidebar } from '@/src/components/navigation/AdminSidebar';

export interface AdminShellProps {
  children: React.ReactNode;
}

export const AdminShell: React.FC<AdminShellProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-zinc-100/40 text-zinc-900 antialiased selection:bg-zinc-900 selection:text-white">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-zinc-950 focus:text-white focus:rounded-lg focus:shadow-xl focus:outline-none focus:ring-2 focus:ring-rose-500 font-semibold text-xs"
      >
        Skip to main content
      </a>
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main id="main-content" tabIndex={-1} className="flex-1 w-full px-4 sm:px-8 py-6 sm:py-8 focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
};
