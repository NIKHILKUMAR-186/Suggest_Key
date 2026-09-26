/**
 * Segment display helpers (presentation only).
 *
 * The seeker marketplace must build its section titles from the REAL selected
 * segment row, so these helpers only reshape a name the backend already gave
 * us. No segment is ever invented, and no value is hardcoded.
 */

/**
 * Pluralises a segment name for headings.
 *
 * `fetchActiveSegments` returns singular labels such as "Autism Mentor",
 * "Career Mentor" or "Relationship Advisor". A section heading needs the
 * plural form, so the trailing word gets an "s" when it does not already end
 * in one. The rest of the name is preserved exactly as the backend wrote it.
 */
export function pluralizeSegmentName(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';

  const words = trimmed.split(/\s+/);
  const lastIndex = words.length - 1;
  const lastWord = words[lastIndex];

  if (/(s|x|z|ch|sh)$/i.test(lastWord)) {
    return trimmed;
  }

  words[lastIndex] = `${lastWord}s`;
  return words.join(' ');
}

/**
 * Builds the discovery section heading from the selected segment, e.g.
 * "Explore Autism Mentors". Returns a neutral fallback when no segment is
 * selected so the UI never renders an empty heading.
 */
export function buildSegmentExploreTitle(segmentName: string | null | undefined): string {
  if (!segmentName || !segmentName.trim()) return 'Explore mentors';
  return `Explore ${pluralizeSegmentName(segmentName)}`;
}

/** Real, unfabricated result count label, e.g. "1 mentor" / "4 mentors". */
export function buildMentorCountLabel(count: number, singular = 'mentor'): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}