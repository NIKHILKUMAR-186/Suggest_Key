import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/Button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message = 'An error occurred while communicating with the server. Please try again.',
  onRetry,
  className,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      role="alert"
      aria-live="assertive"
      className={cn(
        'flex min-h-[260px] w-full flex-col items-center justify-center rounded-2xl border border-rose-200/80 bg-rose-50/40 p-8 sm:p-10 text-center',
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 mb-3.5 border border-rose-200 shadow-xs">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h3 className="text-base sm:text-lg font-bold text-zinc-950 tracking-tight">{title}</h3>
      <p className="mt-1.5 text-xs sm:text-sm text-zinc-600 max-w-md leading-relaxed">{message}</p>
      {onRetry && (
        <Button
          onClick={onRetry}
          variant="outline"
          size="sm"
          className="mt-5 border-rose-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300 gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Try Again</span>
        </Button>
      )}
    </motion.div>
  );
};

