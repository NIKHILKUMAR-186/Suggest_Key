/**
 * MENTOR CARD META — presentation only.
 *
 * Every string is reshaped from a value the data layer already returned; nothing
 * here invents a rating, a review count, a session count or an availability. A
 * missing value is dropped from the list rather than rendered as a fabricated
 * placeholder, so a card can never claim something the database did not say.
 */

import type { MentorDirectoryItem } from '@/src/hooks/useMentorDirectory';
import { formatInr, formatNextAvailableLabel } from '@/src/lib/seekerFormat';
import { getDateStringInTimezone } from '@/src/lib/slotEngine';

export function mentorMeta(item: MentorDirectoryItem): string[] {
  const mentor = item.mentor;
  const duration = mentor.gigs[0]?.duration_minutes;
  // The slot time is expressed in the mentor's timezone, so the day it belongs
  // to is read in the same timezone rather than the visitor's.
  const today = getDateStringInTimezone(new Date(), mentor.timezone || 'Asia/Kolkata');
  const next = item.availability?.nextLocalStartTime;

  return [
    mentor.segments[0]?.name || mentor.expertise?.[0] || null,
    duration ? `${duration} min` : null,
    mentor.starting_price_inr == null ? null : `From ${formatInr(mentor.starting_price_inr)}`,
    next ? formatNextAvailableLabel(today, next, today) : null,
  ].filter((value): value is string => Boolean(value));
}

/** The first line of the name-label sticker: the mentor's real segment. */
export function mentorSegmentLabel(item: MentorDirectoryItem): string {
  return item.mentor.segments[0]?.name || item.mentor.expertise?.[0] || 'Mentorship';
}

/** The session line of the name-label sticker: real duration and price. */
export function mentorSessionLabel(item: MentorDirectoryItem): string {
  const parts: string[] = [];
  const duration = item.mentor.gigs[0]?.duration_minutes;
  if (duration) parts.push(`${duration} min`);
  if (item.mentor.starting_price_inr != null) parts.push(`From ${formatInr(item.mentor.starting_price_inr)}`);
  return parts.join(' · ') || '1:1 session';
}
