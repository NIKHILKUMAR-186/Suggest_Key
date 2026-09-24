import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { LoadingState } from '@/src/components/shared/LoadingState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { cn } from '@/src/lib/utils';

export interface MentorLoadingStateProps {
  message?: string;
  description?: string;
  className?: string;
}

export const MentorLoadingState: React.FC<MentorLoadingStateProps> = ({
  message = 'Loading mentor data...',
  description,
  className,
}) => (
  <LoadingState
    message={message}
    description={description}
    className={cn('min-h-[200px]', className)}
  />
);

export interface MentorErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export const MentorErrorState: React.FC<MentorErrorStateProps> = ({
  title = 'Unable to load',
  message = 'Something went wrong while fetching data. Please try again.',
  onRetry,
  className,
}) => (
  <ErrorState title={title} message={message} onRetry={onRetry} className={cn('min-h-[200px]', className)} />
);

export interface MentorEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const MentorEmptyState: React.FC<MentorEmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}) => (
  <EmptyState
    icon={icon}
    title={title}
    description={description}
    actionLabel={actionLabel}
    onAction={onAction}
    className={cn('min-h-[250px]', className)}
  />
);