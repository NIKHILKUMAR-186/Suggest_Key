import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Clock, Globe, Star } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { DiscoverableMentor, Segment } from '@/src/types/database';
import { formatLocalTimeLabel } from '@/src/lib/slotEngine';

interface PremiumMentorCardProps {
  mentor: DiscoverableMentor;
  selectedSegment: Segment | null;
  selectedDate: string;
  navigate: (path: string) => void;
  isFeatured?: boolean;
}

export const PremiumMentorCard: React.FC<PremiumMentorCardProps> = ({
  mentor,
  selectedSegment,
  selectedDate,
  navigate,
  isFeatured = false,
}) => {
  const initials =
    mentor.full_name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase() || 'M';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`rounded-2xl border bg-[var(--color-shell-surface)] p-5 shadow-xs flex flex-col transition-all hover:shadow-md ${
        isFeatured
          ? 'border-[var(--color-shell-warning)]/40 ring-1 ring-[var(--color-shell-warning)]/20'
          : 'border-[var(--color-shell-border)] hover:border-[var(--color-shell-border-strong)]'
      }`}
    >
      <div className="space-y-4 flex-1">
        {/* Header: Avatar + Info */}
        <div className="flex items-start gap-3.5">
          {mentor.avatar_url ? (
            <img
              src={mentor.avatar_url}
              alt={mentor.full_name}
              className="h-12 w-12 rounded-full object-cover border border-[var(--color-shell-border)] shrink-0"
              loading="lazy"
            />
          ) : (
            <div className="h-12 w-12 rounded-full bg-[var(--color-shell-surface-elevated)] border border-[var(--color-shell-border)] flex items-center justify-center font-bold text-[var(--color-shell-text)] shrink-0">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="font-bold text-[var(--color-shell-text)] text-base leading-tight">{mentor.full_name}</h3>
              {isFeatured && (
                <Badge
                  variant="warning"
                  className="text-[9px] py-0 px-1.5 flex items-center gap-0.5"
                >
                  <Star className="h-2.5 w-2.5 fill-current" />
                  Featured
                </Badge>
              )}
              {mentor.is_approved && (
                <Badge variant="success" className="text-[10px] py-0">
                  Verified
                </Badge>
              )}
            </div>
            <p className="text-xs text-[var(--color-shell-text-muted)] line-clamp-1 mt-0.5">{mentor.headline}</p>
          </div>
        </div>

        {/* Gig title */}
        <h4 className="text-sm font-semibold text-[var(--color-shell-text)]">{mentor.gig.title}</h4>

        {/* Gig description */}
        <p className="text-xs text-[var(--color-shell-text-muted)] line-clamp-2 leading-relaxed">
          {mentor.gig.description}
        </p>

        {/* Meta row: Duration, Price, Timezone */}
        <div className="flex items-center justify-between text-xs pt-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1 text-[var(--color-shell-text-muted)]">
              <Clock className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
              {mentor.gig.duration_minutes} min
            </span>
            <span className="font-bold text-[var(--color-shell-text)]">₹{mentor.gig.price_inr}</span>
            <span className="flex items-center gap-1 text-[var(--color-shell-text-muted)]">
              <Globe className="h-3 w-3 text-[var(--color-shell-text-subtle)]" />
              {mentor.timezone}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[var(--color-shell-text-muted)]">
            {mentor.languages?.slice(0, 2).map((l) => (
              <span key={l} className="font-medium text-[var(--color-shell-text)]">{l}</span>
            ))}
            {mentor.languages?.length > 2 && (
              <span className="text-[var(--color-shell-text-subtle)]">+{mentor.languages.length - 2}</span>
            )}
          </div>
        </div>
      </div>

      {/* Footer: Next available slot + CTA */}
      <div className="mt-5 flex items-center justify-between pt-4 border-t border-[var(--color-shell-border)]">
        <div className="text-left">
          <span className="text-[10px] text-[var(--color-shell-text-subtle)] uppercase font-medium block mb-0.5">
            Next available
          </span>
          {mentor.next_available_slot ? (
            <span className="text-xs font-semibold text-[var(--color-shell-text)]">
              {formatLocalTimeLabel(mentor.next_available_slot.local_start_time)}
            </span>
          ) : (
            <span className="text-xs text-[var(--color-shell-text-subtle)]">—</span>
          )}
        </div>
        <Button
          onClick={() =>
            navigate(
              `/seeker/mentor-detail?mentorId=${mentor.id}&segmentId=${
                selectedSegment?.id || mentor.segment.id
              }&date=${selectedDate}`
            )
          }
          size="sm"
          className="gap-1.5 text-xs font-semibold"
        >
          <span>Book Session</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </motion.div>
  );
};
