import React from 'react';
import { cn } from '@/src/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export interface MentorTabNavProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
  variant?: 'default' | 'pills' | 'underline';
}

export const MentorTabNav: React.FC<MentorTabNavProps> = ({
  tabs,
  activeTab,
  onChange,
  className,
  variant = 'underline',
}) => (
  <div
    className={cn(
      'flex gap-2 overflow-x-auto',
      variant === 'underline' && 'border-b border-zinc-200',
      className
    )}
    role="tablist"
  >
    {tabs.map((tab) => (
      <button
        key={tab.id}
        onClick={() => onChange(tab.id)}
        role="tab"
        aria-selected={activeTab === tab.id}
        className={cn(
          'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap cursor-pointer',
          activeTab === tab.id
            ? variant === 'pills'
              ? 'bg-zinc-950 text-white shadow-xs'
              : variant === 'underline'
              ? 'border-b-2 border-zinc-950 text-zinc-950 font-bold -mb-px'
              : 'bg-zinc-100 text-zinc-950'
            : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50'
        )}
      >
        {tab.icon && <span className="flex-shrink-0">{tab.icon}</span>}
        <span>{tab.label}</span>
        {tab.count !== undefined && tab.count > 0 && (
          <span
            className={cn(
              'px-1.5 py-0.5 text-[10px] font-semibold rounded-full',
              activeTab === tab.id
                ? variant === 'pills'
                  ? 'bg-zinc-800 text-white'
                  : 'bg-zinc-950 text-white'
                : 'bg-zinc-100 text-zinc-600'
            )}
          >
            {tab.count}
          </span>
        )}
      </button>
    ))}
  </div>
);