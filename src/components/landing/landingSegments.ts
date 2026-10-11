/**
 * LANDING-PAGE SEGMENTS — local editorial configuration.
 *
 * These three cards are fixed landing copy, not database rows. The landing page
 * must render them without waiting on any network request, so nothing in this
 * module queries anything.
 *
 * Mentors keep using the real catalogue (useMentorDirectory), the seeker header
 * keeps using the real catalogue (useActiveSegments), and admin segment tools
 * keep writing real rows. Only this section's CARD CONTENT is local.
 *
 * `id` doubles as the destination's segment filter: the values match the public
 * segment slugs used by mentorDirectoryPath, so a card still lands on the right
 * filtered directory. The slug is never validated against the database here —
 * it is a link, not a lookup.
 */

export interface LandingSegment {
  /** Stable identifier, and the segment filter applied on navigation. */
  id: string;
  title: string;
  description: string;
}

/** Exactly three, in this order. No database, no ordering query. */
export const LANDING_SEGMENTS: readonly LandingSegment[] = [
  {
    id: 'autism',
    title: 'Autism Mentorship',
    description:
      'Personalized support for neurodivergent individuals and their families, focusing on sensory needs, everyday challenges, and individual growth.',
  },
  {
    id: 'relationship',
    title: 'Relationship Guidance',
    description:
      'Build healthier relationships through better communication, clear boundaries, and a deeper understanding of one another.',
  },
  {
    id: 'career',
    title: 'Career Mentorship',
    description:
      'Discover career opportunities, strengthen professional skills, and make confident decisions about your future.',
  },
];
