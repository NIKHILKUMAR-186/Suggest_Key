import React from 'react';
import { cn } from '@/src/lib/utils';

export interface MentorSectionProps {
  eyebrow?: string;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
}

/**
 * Reusable content section for the mentor workspace.
 * Safe for a calm editorial rhythm: one eyebrow, one title, one action.
 */
export const MentorSection: React.FC<MentorSectionProps> = ({
  eyebrow,
  title,
  description,
  action,
  children,
  className,
  containerClassName,
}) => {
  const hasHead = eyebrow || title || description;
  return (
    <section
      className={cn(
        'mentor-section',
        'space-y-4',
        hasHead ? 'mentor-section-head' : undefined,
        className
      )}
    >
      {hasHead && (
        <div className="mentor-section-head">
          {eyebrow && (
            <p className="mentor-section-eyebrow">{eyebrow}</p>
          )}
          {title && <h2>{title}</h2>}
          {description && <p>{description}</p>}
        </div>
      )}
      {action && (
        <div className="mentor-section-head">
          <div className="mentor-action-banner__actions">{action}</div>
        </div>
      )}
      <div className={cn('mentor-section-body', containerClassName)}>{children}</div>
    </section>
  );
};
