import React from 'react';
import {
  Calendar,
  CreditCard,
  Video,
  FileText,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Bell,
  ArrowRight,
  Check,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { useNavigation } from '@/src/context/NavigationContext';
import { formatRelativeTime } from '@/src/lib/notificationService';
import type { Notification } from '@/src/types/database';

interface NotificationCardProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
  role?: 'seeker' | 'mentor' | 'admin';
}

export const NotificationCard: React.FC<NotificationCardProps> = ({
  notification: n,
  onMarkRead,
  role = 'seeker',
}) => {
  const { navigate } = useNavigation();

  const getEventIcon = () => {
    const ev = (n.event_type || '').toUpperCase();
    const tp = (n.type || '').toUpperCase();

    if (ev.includes('PAYMENT') || tp === 'PAYMENT') {
      return <CreditCard className="h-4 w-4" />;
    }
    if (ev.includes('MEETING') || ev.includes('SESSION') || tp === 'SESSION') {
      return <Video className="h-4 w-4" />;
    }
    if (ev.includes('WORKSPACE') || tp === 'WORKSPACE') {
      return <FileText className="h-4 w-4" />;
    }
    if (ev.includes('DEADLINE') || ev.includes('REMINDER') || tp === 'REMINDER') {
      return <Clock className="h-4 w-4" />;
    }
    if (ev.includes('OVERDUE') || ev.includes('INTERVENTION') || ev.includes('BREACH')) {
      return <AlertTriangle className="h-4 w-4" />;
    }
    if (ev.includes('BOOKING') || tp === 'BOOKING') {
      return <Calendar className="h-4 w-4" />;
    }
    if (tp === 'ADMIN') {
      return <ShieldAlert className="h-4 w-4" />;
    }
    return <Bell className="h-4 w-4" />;
  };

  const getBadgeStyle = () => {
    const ev = (n.event_type || '').toUpperCase();
    const tp = (n.type || '').toUpperCase();

    if (ev.includes('OVERDUE') || ev.includes('REJECTED') || ev.includes('INTERVENTION')) {
      return {
        variant: 'destructive' as const,
        label: n.event_type?.replace(/_/g, ' ') || 'Action Required',
        iconBg: 'bg-rose-100 text-rose-700 border-rose-200',
      };
    }
    if (ev.includes('APPROVED') || ev.includes('CONFIRMED') || ev.includes('COMPLETED')) {
      return {
        variant: 'default' as const,
        label: n.event_type?.replace(/_/g, ' ') || 'Success',
        iconBg: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      };
    }
    if (ev.includes('DEADLINE') || ev.includes('REMINDER') || ev.includes('SUBMITTED')) {
      return {
        variant: 'warning' as const,
        label: n.event_type?.replace(/_/g, ' ') || 'Notice',
        iconBg: 'bg-amber-100 text-amber-800 border-amber-200',
      };
    }
    if (tp === 'WORKSPACE') {
      return {
        variant: 'secondary' as const,
        label: 'Workspace',
        iconBg: 'bg-blue-100 text-blue-800 border-blue-200',
      };
    }
    return {
      variant: 'outline' as const,
      label: n.type,
      iconBg: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    };
  };

  const getActionLabel = () => {
    if (!n.link) return null;
    const path = n.link.toLowerCase();
    if (path.includes('session')) return 'Join Prep Room';
    if (path.includes('workspace')) return 'Open Workspace';
    if (path.includes('payment')) return 'Review Payment';
    if (path.includes('booking')) return 'View Booking';
    return 'View Details';
  };

  const badgeStyle = getBadgeStyle();
  const actionLabel = getActionLabel();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      id={`notification-${n.id}`}
      className={`group relative rounded-2xl border p-4 sm:p-5 transition-all shadow-2xs ${
        !n.is_read
          ? 'bg-white border-zinc-300 ring-1 ring-zinc-950/5 shadow-xs'
          : 'bg-zinc-50/60 border-zinc-200 hover:bg-white hover:border-zinc-300'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          {/* Icon with status border */}
          <div
            className={`p-2.5 rounded-xl border shrink-0 mt-0.5 shadow-2xs ${badgeStyle.iconBg}`}
          >
            {getEventIcon()}
          </div>

          <div className="space-y-1.5 min-w-0">
            {/* Title & Unread Indicator */}
            <div className="flex items-center gap-2 flex-wrap">
              <h4
                className={`text-sm tracking-tight leading-snug ${
                  !n.is_read ? 'font-bold text-zinc-950 font-display' : 'font-semibold text-zinc-800'
                }`}
              >
                {n.title}
              </h4>

              {!n.is_read && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
                  New
                </span>
              )}

              {n.event_type && (
                <Badge variant={badgeStyle.variant} className="text-[10px] uppercase font-mono tracking-wider">
                  {badgeStyle.label}
                </Badge>
              )}
            </div>

            {/* Message Body */}
            <p className="text-xs text-zinc-600 leading-relaxed max-w-2xl font-normal">
              {n.message}
            </p>

            {/* Metadata and Timestamp */}
            <div className="flex items-center gap-2.5 pt-1 text-[11px] text-zinc-400">
              <span className="flex items-center gap-1 font-medium text-zinc-500">
                <Clock className="h-3 w-3 text-zinc-400" />
                {formatRelativeTime(n.created_at)}
              </span>

              {n.entity_id && (
                <>
                  <span>•</span>
                  <span className="font-mono text-zinc-600 font-semibold text-[10px]">
                    #{n.entity_id.toUpperCase()}
                  </span>
                </>
              )}

              {n.read_at && (
                <>
                  <span>•</span>
                  <span className="text-zinc-400 text-[10px]">
                    Read {formatRelativeTime(n.read_at)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center sm:flex-col sm:items-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-100">
          {actionLabel && n.link && (
            <Button
              id={`action-btn-${n.id}`}
              onClick={() => {
                if (!n.is_read) onMarkRead(n.id);
                navigate(n.link!);
              }}
              size="sm"
              variant={!n.is_read ? 'default' : 'outline'}
              className="text-xs gap-1.5 h-8 px-3 font-semibold shadow-2xs"
            >
              <span>{actionLabel}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}

          {!n.is_read ? (
            <button
              id={`mark-read-${n.id}`}
              onClick={() => onMarkRead(n.id)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 hover:text-zinc-950 px-2.5 py-1 rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
            >
              <Check className="h-3 w-3" />
              <span>Mark as read</span>
            </button>
          ) : (
            <span className="text-[11px] text-zinc-400 flex items-center gap-1 px-1">
              <CheckCircle2 className="h-3 w-3 text-zinc-400" />
              <span>Read</span>
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};

