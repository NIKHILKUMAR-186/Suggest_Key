import React from 'react';
import { cn } from '@/src/lib/utils';
import { ChevronRight, CheckCircle2 } from 'lucide-react';

export type MentorLifecycleStep = {
  label: string;
  detail?: string;
  icon?: React.ReactNode;
  state?: 'pending' | 'active' | 'completed' | 'waiting';
};

export interface MentorLifecycleProps {
  steps: MentorLifecycleStep[];
  className?: string;
}

/**
 * Compact vertical progress for a booking's lifecycle.
 * Mirrors the briefing: Payment → Verified → Awaiting confirmation →
 * Confirmed → Completed. States derive from real backend values only.
 */
export const MentorLifecycle: React.FC<MentorLifecycleProps> = ({ steps, className }) => {
  const rendered = steps.map((step, index) => {
    const state = step.state ?? 'pending';
    return (
      <div
        key={index}
        className={cn(
          'mentor-lifecycle__step',
          step.state === 'active' && 'mentor-lifecycle__step--active',
          step.state === 'completed' && 'mentor-lifecycle__step--completed',
          step.state === 'waiting' && 'mentor-lifecycle__step--waiting'
        )}
      >
        <div
          className={cn(
            'mentor-lifecycle__num',
            step.state === 'active' && 'mentor-lifecycle__num--active',
            step.state === 'completed' && 'mentor-lifecycle__num--completed',
            step.state === 'waiting' && 'mentor-lifecycle__num--waiting'
          )}
        >
          {step.state === 'active' ? (
            <span className="h-2 w-2 rounded-full bg-current" />
          ) : step.state === 'completed' ? (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            index + 1
          )}
        </div>
        <div className="mentor-lifecycle__body">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className={cn(
                'mentor-lifecycle__label',
                step.state === 'active' && 'mentor-lifecycle__label--active'
              )}
            >
              {step.label}
            </span>
            {step.detail && (
              <span className="mentor-lifecycle__detail">{step.detail}</span>
            )}
          </div>
          {step.icon && (
            <div className="mt-1">{step.icon}</div>
          )}
        </div>
        {index < steps.length - 1 && (
          <div className="mentor-lifecycle__connector" aria-hidden="true">
            <ChevronRight className="h-4 w-4 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
          </div>
        )}
      </div>
    );
  });

  return <div className={cn('mentor-lifecycle', className)}>{rendered}</div>;
};
