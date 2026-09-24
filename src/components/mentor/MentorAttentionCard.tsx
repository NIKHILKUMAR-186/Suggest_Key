import React from 'react';
import { cn } from '@/src/lib/utils';
import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

export interface AttentionItem {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone?: 'warning' | 'error' | 'info' | 'urgent';
  actionLabel: string;
  onAction: () => void;
  secondaryAction?: { label: string; onClick: () => void };
  meta?: string;
}

const toneStyles: Record<NonNullable<AttentionItem['tone']>, string> = {
  warning: 'border-amber-200 bg-amber-50/40',
  error: 'border-rose-200 bg-rose-50/40',
  info: 'border-zinc-200 bg-white',
  urgent: 'border-amber-400 bg-amber-50/60',
};

export const MentorAttentionCard: React.FC<{ item: AttentionItem; className?: string }> = ({
  item,
  className,
}) => {
  const Icon = item.icon;
  const tone = item.tone || 'info';
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-xl border p-4 sm:p-5 shadow-xs space-y-3',
        toneStyles[tone],
        className
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={cn(
              'p-2 rounded-lg border shrink-0',
              tone === 'warning' && 'bg-amber-100 text-amber-800 border-amber-200',
              tone === 'error' && 'bg-rose-100 text-rose-700 border-rose-200',
              tone === 'info' && 'bg-zinc-100 text-zinc-700 border-zinc-200',
              tone === 'urgent' && 'bg-amber-100 text-amber-900 border-amber-300'
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-bold text-zinc-950 tracking-tight">{item.title}</h4>
              {tone === 'urgent' && (
                <Badge variant="warning" className="text-[10px] uppercase tracking-wider">
                  Urgent
                </Badge>
              )}
              {tone === 'error' && (
                <Badge variant="destructive" className="text-[10px] uppercase tracking-wider">
                  Action Required
                </Badge>
              )}
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">{item.description}</p>
            {item.meta && <p className="text-[11px] text-zinc-400 font-medium">{item.meta}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={item.onAction} className="text-xs gap-1.5">
            {item.actionLabel}
          </Button>
          {item.secondaryAction && (
            <Button
              size="sm"
              variant="outline"
              onClick={item.secondaryAction}
              className="text-xs"
            >
              {item.secondaryAction.label}
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
};