import React from 'react';
import { cn } from '@/src/lib/utils';

export interface ControlTab {
  id: string;
  label: string;
  count?: number;
}

/**
 * Tab strip for the Admin Control Center.
 *
 * Uses the project's shell CSS custom properties exclusively, so it inherits
 * the active Light/Dark theme instead of hardcoding zinc colours.
 */
export const ControlTabs: React.FC<{
  tabs: ControlTab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}> = ({ tabs, activeTab, onChange, className }) => (
  <div
    role="tablist"
    aria-label="Mentor control sections"
    className={cn(
      'flex gap-1 overflow-x-auto border-b border-[var(--color-shell-border)]',
      className,
    )}
  >
    {tabs.map((tab) => {
      const isActive = activeTab === tab.id;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]',
            isActive
              ? '-mb-px border-[var(--color-shell-primary)] text-[var(--color-shell-primary)]'
              : 'border-transparent text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]',
          )}
        >
          <span>{tab.label}</span>
          {tab.count !== undefined && tab.count > 0 && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                isActive
                  ? 'bg-[var(--color-shell-primary)] text-[var(--color-shell-text-contrast)]'
                  : 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]',
              )}
            >
              {tab.count}
            </span>
          )}
        </button>
      );
    })}
  </div>
);
