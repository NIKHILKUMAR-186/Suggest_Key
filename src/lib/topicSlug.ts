/**
 * TOPIC SLUG — the one rule for turning a topic label into a link segment.
 *
 * This lives in its own module because BOTH sides need it and they have
 * opposite dependency graphs: the browser imports it through
 * `segmentTopics` (which also needs the API client), while `server.ts`
 * imports it directly and must never pull a browser-only module into the Node
 * bundle. One implementation, one place that can disagree with the database
 * CHECK constraint.
 */

/**
 * Turn free text into a URL-safe topic slug.
 *
 * Mirrors the `CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')` constraint on
 * `public.segment_topics`, so a value that passes here is accepted by the
 * database and the client never submits a slug the server has to reject.
 *
 * Deterministic: the same label always produces the same slug, which is what
 * makes a rename in the admin CMS keep the topic bar and the shareable URL in
 * agreement.
 */
export function slugifyTopicName(name: string): string {
  return (name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** A slug is usable only when it is non-empty and matches the DB constraint. */
export function isValidTopicSlug(slug: string): boolean {
  return typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
