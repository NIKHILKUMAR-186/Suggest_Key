import React from 'react';
import { cn } from '@/src/lib/utils';

interface AuthLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children, className }) => {
  return (
    <div className={cn('auth-background min-h-screen flex items-center justify-center px-4 py-12 relative', className)}>
      <div className="relative z-10 w-full max-w-md">
        {children}
      </div>
    </div>
  );
};

export const AuthEyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center justify-center gap-4 mb-6">
    <div className="h-px flex-1 max-w-[80px] bg-gradient-to-r from-transparent to-[rgba(186,215,247,0.12)]" />
    <span className="text-[15px] font-normal tracking-[0.10em] text-[#c7d3ea] uppercase whitespace-nowrap" style={{ fontFamily: 'var(--font-dotdigital)' }}>
      {children}
    </span>
    <div className="h-px flex-1 max-w-[80px] bg-gradient-to-l from-transparent to-[rgba(186,215,247,0.12)]" />
  </div>
);

export const AuthHeading: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <h1 className={cn(
    'text-[28px] sm:text-[32px] font-medium tracking-tight text-white text-center leading-[1.14] mb-3',
    'bg-gradient-to-b from-[#d8ecf8] to-[#98c0ef] bg-clip-text text-transparent',
    className
  )} style={{ fontFamily: 'var(--font-aeonikpro)' }}>
    {children}
  </h1>
);

export const AuthBody: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <p className={cn('text-[16px] text-[#c7d3ea] text-center leading-[1.5] mb-8', className)} style={{ fontFamily: 'var(--font-untitled-sans)' }}>
    {children}
  </p>
);