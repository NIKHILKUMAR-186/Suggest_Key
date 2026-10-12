import React from 'react';
import { cn } from '@/src/lib/utils';
import '../../pages/auth/AuthPages.css';

interface AuthLayoutProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'centered' | 'split';
  brandPanel?: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children, className, variant = 'split', brandPanel }) => {
  const isSplit = variant === 'split' && !!brandPanel;

  if (isSplit) {
    return (
      <div className={cn('auth-pages auth-background auth-split-layout', className)}>
        <div className="auth-brand-panel" aria-hidden="true">
          {brandPanel}
        </div>
        <div className="auth-form-panel relative z-10">
          <div className="auth-card-wrapper">
            <div className="w-full">
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('auth-pages auth-background min-h-screen relative', className)}>
      <div className={cn(
        'auth-form-panel relative z-10 flex w-full min-h-screen flex-col',
      )}>
        <div className="flex-1 flex items-center justify-center w-full">
          <div className="w-full">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export const AuthEyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="auth-eyebrow">{children}</p>
);

export const AuthHeading: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <h1 className={cn('auth-heading', className)}>{children}</h1>
);

export const AuthHeadingSm: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <h2 className={cn('auth-heading-sm', className)}>{children}</h2>
);

export const AuthBody: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <p className={cn('auth-body', className)}>{children}</p>
);

export const AuthBodySm: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <p className={cn('auth-body-sm', className)}>{children}</p>
);