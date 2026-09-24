import React from 'react';
import { cn } from '@/src/lib/utils';

interface AuthLayoutProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'centered' | 'split';
  brandPanel?: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children, className, variant = 'split', brandPanel }) => {
  const isSplit = variant === 'split' && !!brandPanel;

  return (
    <div className={cn('auth-background min-h-screen relative', className)}>
      {isSplit && (
        <div className="hidden lg:block lg:absolute lg:inset-y-0 lg:left-0 lg:w-1/2 lg:max-w-none lg:px-12 lg:py-16 lg:flex lg:items-center lg:z-0">
          {brandPanel}
        </div>
      )}
      <div className={cn(
        'relative z-10 flex w-full min-h-screen items-center justify-center px-4 py-12 sm:px-6',
        isSplit ? 'lg:ml-[50%] lg:w-1/2' : ''
      )}>
        <div className="w-full max-w-md">
          {children}
        </div>
      </div>
    </div>
  );
};

export const AuthEyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center justify-center gap-4 mb-6">
    <div className="h-px flex-1 max-w-[80px] bg-gradient-to-r from-transparent to-[var(--color-shell-border-strong)]" />
    <span className="text-[15px] font-normal tracking-[0.10em] text-[var(--color-shell-text-muted)] uppercase whitespace-nowrap" style={{ fontFamily: 'var(--font-dotdigital)' }}>
      {children}
    </span>
    <div className="h-px flex-1 max-w-[80px] bg-gradient-to-l from-transparent to-[var(--color-shell-border-strong)]" />
  </div>
);

export const AuthHeading: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <h1 className={cn(
    'text-[28px] sm:text-[32px] font-medium tracking-tight text-[var(--color-shell-text)] text-center leading-[1.14] mb-3',
    className
  )} style={{ fontFamily: 'var(--font-aeonikpro)' }}>
    {children}
  </h1>
);

export const AuthBody: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <p className={cn('text-[16px] text-[var(--color-shell-text-muted)] text-center leading-[1.5] mb-8', className)} style={{ fontFamily: 'var(--font-untitled-sans)' }}>
    {children}
  </p>
);