import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Briefcase, Globe, Star, UserCheck } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { DirectoryMentor } from '@/src/types/database';

interface MentorDirectoryCardProps {
  mentor: DirectoryMentor;
  /** 'YYYY-MM-DD' used to seed the mentor detail page's date picker. */
  date: string;
  navigate: (path: string) => void;
}

/**
 * Directory card for the "View All Mentors" page.
 *
 * Every value rendered here comes from the database row. Fields that are empty
 * in the database are omitted rather than replaced with placeholder content.
 */
export const MentorDirectoryCard: React.FC<MentorDirectoryCardProps> = ({
  mentor,
  date,
  navigate,
}) => {
  const initials =
    (mentor.full_name || '')
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .toUpperCase() || 'M';

  // The detail route is segment-scoped, so link to the mentor's first segment.
  // A mentor with no segment has nothing bookable and gets no CTA.
  const primarySegment = mentor.segments[0] || null;
  const bioSummary = (mentor.about || '').trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 shadow-xs flex flex-col transition-all hover:shadow-md hover:border-[var(--color-shell-border-strong)]"
    >
      <div className="space-y-4 flex-1">
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
              <h3 className="font-bold text-[var(--color-shell-text)] text-base leading-tight">
                {mentor.full_name}
              </h3>
              <Badge variant="success" className="text-[10px] py-0">
                <UserCheck className="h-2.5 w-2.5 mr-0.5" />
                Verified
              </Badge>
              {mentor.is_featured && (
                <Badge variant="warning" className="text-[9px] py-0 px-1.5 flex items-center gap-0.5">
                  <Star className="h-2.5 w-2.5 fill-current" />
                  Featured
                </Badge>
              )}
            </div>
            {mentor.headline && (
              <p className="text-xs text-[var(--color-shell-text-muted)] line-clamp-1 mt-0.5">
                {mentor.headline}
              </p>
            )}
          </div>
        </div>

        {bioSummary && (
          <p className="text-xs text-[var(--color-shell-text-muted)] line-clamp-3 leading-relaxed">
            {bioSummary}
          </p>
        )}

        {mentor.segments.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {mentor.segments.map((s) => (
              <Badge key={s.id} variant="secondary" className="text-[10px] py-0">
                {s.name}
              </Badge>
            ))}
          </div>
        )}

        {mentor.expertise && mentor.expertise.length > 0 && (
          <p className="text-[11px] text-[var(--color-shell-text-subtle)] line-clamp-1">
            {mentor.expertise.join(' · ')}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 text-xs flex-wrap">
          <div className="flex items-center gap-3 flex-wrap text-[var(--color-shell-text-muted)]">
            {mentor.experience_years > 0 && (
              <span className="flex items-center gap-1">
                <Briefcase className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
                {mentor.experience_years} yr{mentor.experience_years === 1 ? '' : 's'}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Globe className="h-3 w-3 text-[var(--color-shell-text-subtle)]" />
              {mentor.timezone}
            </span>
          </div>
          {mentor.starting_price_inr !== null && (
            <span className="font-bold text-[var(--color-shell-text)]">
              from ₹{mentor.starting_price_inr}
            </span>
          )}
        </div>

        {mentor.languages.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {mentor.languages.map((l) => (
              <span key={l} className="text-[11px] font-medium text-[var(--color-shell-text)]">
                {l}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 pt-4 border-t border-[var(--color-shell-border)] flex items-center justify-end">
        {primarySegment && (
          <Button
            onClick={() =>
              navigate(
                `/seeker/mentor-detail?mentorId=${mentor.id}&segmentId=${primarySegment.id}&date=${date}`
              )
            }
            size="sm"
            className="gap-1.5 text-xs font-semibold"
          >
            <span>View Profile</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </motion.div>
  );
};
