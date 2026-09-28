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
import { StatusPill } from '@/src/components/booking/StatusPill';
import { ToneDot } from '@/src/components/booking/tokens';
import { TONE_SURFACE, TONE_TEXT } from '@/src/components/booking/tokens';
import type { StatusTone } from '@/src/components/booking/statusTone';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  formatRelativeTime,
  notificationActionLabel,
  resolveNotificationLink,
} from '@/src/lib/notificationService';
import type { Notification } from '@/src/types/database';

interface NotificationCardProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
  role?: 'seeker' | 'mentor' | 'admin';
}

interface NotificationPresentation {
  tone: StatusTone;
  /** Empty when the row carries no type at all, in which case no chip renders. */
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Turns a stored `event_type` into a human label.
 *
 * The database stores SCREAMING_SNAKE identifiers; those are never shown to a
 * user verbatim. This only reformats what is already there — an event type the
 * backend has not classified still appears, just in neutral styling, so nothing
 * is hidden from the list.
 */
function humaniseEventType(eventType: string): string {
  const words = eventType.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) return '';
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '');
}

/**
 * The single source of truth for how a notification looks.
 *
 * Both the icon and the chip are derived from one classification, so a card can
 * never show a "needs attention" icon beside a "success" chip. The tint comes
 * from the shared status tokens, which is what keeps these cards correct in
 * light mode, dark mode and under an active segment theme.
 */
function presentNotification(n: Notification): NotificationPresentation {
  const ev = (n.event_type || '').toUpperCase();
  const tp = (n.type || '').toUpperCase();
  const label = humaniseEventType(n.event_type || n.type || 'UPDATE');

  if (ev.includes('OVERDUE') || ev.includes('REJECTED') || ev.includes('INTERVENTION') || ev.includes('BREACH')) {
    return { tone: 'danger', label, icon: AlertTriangle };
  }
  if (ev.includes('APPROVED') || ev.includes('CONFIRMED') || ev.includes('COMPLETED') || ev.includes('VERIFIED')) {
    return { tone: 'success', label, icon: CheckCircle2 };
  }
  if (ev.includes('DEADLINE') || ev.includes('REMINDER') || ev.includes('SUBMITTED')) {
    return { tone: 'warning', label, icon: Clock };
  }
  if (ev.includes('PAYMENT') || tp === 'PAYMENT') {
    return { tone: 'info', label, icon: CreditCard };
  }
  if (ev.includes('MEETING') || ev.includes('SESSION') || tp === 'SESSION') {
    return { tone: 'info', label, icon: Video };
  }
  if (ev.includes('WORKSPACE') || tp === 'WORKSPACE') {
    return { tone: 'neutral', label: 'Workspace', icon: FileText };
  }
  if (ev.includes('BOOKING') || tp === 'BOOKING') {
    return { tone: 'neutral', label, icon: Calendar };
  }
  if (tp === 'ADMIN') {
    return { tone: 'warning', label, icon: ShieldAlert };
  }
  return { tone: 'neutral', label, icon: Bell };
}

export const NotificationCard: React.FC<NotificationCardProps> = ({
  notification: n,
  onMarkRead,
  role = 'seeker',
}) => {
  const { navigate } = useNavigation();

  // The destination is resolved for the role reading the notification, so an
  // admin is always sent to an admin route and never to a participant page. The
  // label is derived from that resolved route so the button wording matches the
  // page it actually opens.
  const targetLink = resolveNotificationLink(n.link, role, n.entity_id);
  const actionLabel = notificationActionLabel(targetLink);

  const { tone, label, icon: EventIcon } = presentNotification(n);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      id={`notification-${n.id}`}
      className={`group relative rounded-2xl border p-4 transition-colors shadow-2xs sm:p-5 ${
        !n.is_read
          ? 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-xs ring-1 ring-[var(--color-shell-primary)]/20'
          : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]/60 hover:border-[var(--color-shell-border-strong)] hover:bg-[var(--color-shell-surface)]'
      }`}
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 items-start gap-3.5">
          {/* The icon and the chip read from the same classification, so the
              icon's tint can never contradict the chip beside it. */}
          <span
            aria-hidden="true"
            className={`mt-0.5 shrink-0 rounded-xl border p-2.5 shadow-2xs ${TONE_SURFACE[tone]} ${TONE_TEXT[tone]}`}
          >
            <EventIcon className="h-4 w-4" />
          </span>

          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h4
                className={`font-display text-sm leading-snug tracking-tight ${
                  !n.is_read
                    ? 'font-bold text-[var(--color-shell-text)]'
                    : 'font-semibold text-[var(--color-shell-text-muted)]'
                }`}
              >
                {n.title}
              </h4>

              {!n.is_read && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[var(--color-shell-accent)]/30 bg-[var(--color-shell-primary-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-shell-accent)]">
                  <ToneDot tone="info" pulse />
                  New
                </span>
              )}

              {label && <StatusPill tone={tone} label={label} />}
            </div>

            <p className="max-w-2xl text-xs font-normal leading-relaxed text-[var(--color-shell-text-muted)]">
              {n.message}
            </p>

            <div className="flex flex-wrap items-center gap-2.5 pt-1 text-[11px] text-[var(--color-shell-text-subtle)]">
              <span className="flex items-center gap-1 font-medium text-[var(--color-shell-text-muted)]">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {formatRelativeTime(n.created_at)}
              </span>

              {n.entity_id && (
                <>
                  <span aria-hidden="true">•</span>
                  <span className="font-mono text-[10px] font-semibold text-[var(--color-shell-text-muted)]">
                    #{n.entity_id.toUpperCase()}
                  </span>
                </>
              )}

              {n.read_at && (
                <>
                  <span aria-hidden="true">•</span>
                  <span className="text-[10px] text-[var(--color-shell-text-subtle)]">
                    Read {formatRelativeTime(n.read_at)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-shell-border)] pt-2 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
          {actionLabel && targetLink && (
            <Button
              id={`action-btn-${n.id}`}
              onClick={() => {
                if (!n.is_read) onMarkRead(n.id);
                navigate(targetLink);
              }}
              size="sm"
              variant={!n.is_read ? 'default' : 'outline'}
              className="h-8 gap-1.5 px-3 text-xs font-semibold shadow-2xs"
            >
              <span>{actionLabel}</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}

          {!n.is_read ? (
            <button
              id={`mark-read-${n.id}`}
              onClick={() => onMarkRead(n.id)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-[var(--color-shell-text-muted)] transition-colors hover:bg-[var(--color-shell-surface-elevated)] hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              <span>Mark as read</span>
            </button>
          ) : (
            <span className="flex items-center gap-1 px-1 text-[11px] text-[var(--color-shell-text-subtle)]">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              <span>Read</span>
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
};

