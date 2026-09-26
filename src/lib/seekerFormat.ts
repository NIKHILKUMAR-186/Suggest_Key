/**
 * Seeker-facing display formatting.
 *
 * Presentation only: every helper reshapes a value the backend already
 * returned. Nothing here invents a price, a duration, a slot or a mentor.
 *
 * All non-ASCII characters are written as Unicode escapes on purpose. The
 * rupee sign and the en dash were previously stored as literal characters and
 * silently degraded to "?" and U+FFFD in a seeker page, which rendered live
 * prices as "?2499 INR". Escapes make the output independent of the file
 * encoding it is saved with.
 */

const RUPEE = '\u20B9'; // ₹
const MIDDOT = '\u00B7'; // ·
const ENDASH = '\u2013'; // –

/**
 * Formats an integer INR amount with Indian digit grouping, e.g. 2499 -> "₹2,499".
 * Returns an empty string for a missing amount so callers can omit the label
 * rather than render a fabricated zero.
 */
export function formatInr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return '';
  const value = Number(amount);
  if (value <= 0) return '';
  return `${RUPEE}${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/** Joins a time range, e.g. "1:00 PM – 2:00 PM". */
export function formatTimeRange(startTime: string, endTime: string): string {
  return `${startTime} ${ENDASH} ${endTime}`;
}

/**
 * Renders a calendar date as a short, unambiguous label, e.g. "Sat, 26 Sep".
 * Built from the 'YYYY-MM-DD' string with pure calendar arithmetic so no UTC
 * offset can shift the day.
 */
export function formatShortDate(dateStr: string): string {
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const month = date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${weekday}, ${d} ${month}`;
}

/** Whole-day difference between two 'YYYY-MM-DD' strings (b - a). */
export function daysBetweenDateStrings(a: string, b: string): number {
  const [ay, am, ad] = (a || '').split('-').map(Number);
  const [by, bm, bd] = (b || '').split('-').map(Number);
  if (!ay || !am || !ad || !by || !bm || !bd) return Number.NaN;
  const from = Date.UTC(ay, am - 1, ad);
  const to = Date.UTC(by, bm - 1, bd);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Turns a real slot into the "next available" label the cards show.
 *
 * `today` must come from the same timezone-aware helper the date pickers use
 * (see `getDateStringInTimezone` in slotEngine), so "Today" matches the
 * calendar the seeker is actually looking at.
 *
 * Returns null when there is no slot, so the caller can render an explicit
 * "no availability" state instead of a fabricated time.
 */
export function formatNextAvailableLabel(
  slotDate: string | null | undefined,
  slotTimeLabel: string | null | undefined,
  today: string
): string | null {
  if (!slotDate || !slotTimeLabel) return null;
  const offset = daysBetweenDateStrings(today, slotDate);
  if (Number.isNaN(offset)) return `${formatShortDate(slotDate)} ${MIDDOT} ${slotTimeLabel}`;
  if (offset === 0) return `Today ${MIDDOT} ${slotTimeLabel}`;
  if (offset === 1) return `Tomorrow ${MIDDOT} ${slotTimeLabel}`;
  return `${formatShortDate(slotDate)} ${MIDDOT} ${slotTimeLabel}`;
}

/** "1 mentor" / "4 mentors" — always pluralised from the real count. */
export function mentorCountLabel(count: number, singular = 'mentor'): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
