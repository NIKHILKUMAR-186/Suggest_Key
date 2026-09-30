/**
 * The one place that decides whether a gig is legitimately the offer a seeker
 * selected.
 *
 * # Why this exists
 *
 * A gig belongs to exactly one segment through `gigs.segment_id`, and a mentor
 * may hold one active gig per segment. That makes `(gig.mentor_id,
 * gig.segment_id, gig.is_active)` a real invariant, not a display concern: if a
 * gig is displayed for a segment that is not its own, then the segment name, the
 * gig title, the duration, the price and the slot grid are all describing
 * different things at once, and a booking created from that screen writes an
 * `autism-mentor` segment against a "Relationship Guidance session" gig.
 *
 * The bug this module prevents is subtle because every individual step looks
 * correct. The seeker picks the Autism Mentor segment, the mentor card links
 * with `segmentSlug=autism-mentor`, the detail page resolves that segment to a
 * real UUID — and then the gig lookup, which matched on `mentor_id` alone,
 * returned whichever of the mentor's active gigs the database listed first.
 * Nothing errored. The UI simply showed the wrong offer with the right-looking
 * surroundings, and the mismatch was only visible to someone who knew the
 * mentor had two segments.
 *
 * # The rule
 *
 * `describeGigContextMismatch` returns a reason string when the gig must NOT be
 * shown, and `null` when it is exactly right. It is deliberately pure and
 * synchronous so the same function guards the browser render, the service-layer
 * resolution and the tests — there is no second, laxer copy to drift.
 *
 * There is no segment name, slug or id hardcoded here. The comparison is purely
 * on identity columns, so it works for every segment the platform ever adds.
 */

/** The subset of a resolved gig this check needs. */
export interface GigContext {
  id: string;
  mentor_id: string;
  segment_id: string;
  is_active: boolean;
}

export interface GigContextExpectation {
  /** The mentor the seeker is looking at. */
  mentorId: string;
  /** The segment the seeker selected, already resolved to its UUID. */
  segmentId: string;
  /**
   * The gig named by the route, when there was one. When present it is binding:
   * no other gig is an acceptable substitute, because the seeker chose it.
   */
  requestedGigId?: string | null;
}

export interface GigContextCheckInput extends GigContextExpectation {
  /** The gig the data layer actually resolved, or `null` if it resolved none. */
  gig: GigContext | null | undefined;
}

/**
 * Shown to the seeker when the context is stale. It describes the situation
 * rather than naming a segment, so it stays correct as segments are added.
 */
export const GIG_CONTEXT_ERROR_MESSAGE =
  'This session offer is no longer available for the segment you selected.';

/**
 * Returns `null` when `gig` is provably the offer the caller asked for, or a
 * short human-readable reason when it is not.
 *
 * The order of the checks is deliberate: the most specific signal (`gigId`) is
 * tested first, because a route that names a gig has already made the choice and
 * a segment-scoped fallback would silently undo it.
 */
export function describeGigContextMismatch(input: GigContextCheckInput): string | null {
  const { gig, mentorId, segmentId, requestedGigId } = input;

  if (!gig) {
    return 'no active gig was resolved for this mentor in this segment';
  }
  if (requestedGigId && gig.id !== requestedGigId) {
    return `resolved gig ${gig.id} but the selected gig was ${requestedGigId}`;
  }
  if (gig.mentor_id !== mentorId) {
    return `gig ${gig.id} belongs to mentor ${gig.mentor_id}, not ${mentorId}`;
  }
  if (gig.segment_id !== segmentId) {
    return `gig ${gig.id} belongs to segment ${gig.segment_id}, not the selected ${segmentId}`;
  }
  if (gig.is_active !== true) {
    return `gig ${gig.id} is no longer active`;
  }
  return null;
}

/**
 * The booking triple a seeker's action commits to.
 *
 * `POST /api/bookings/hold` writes exactly these three ids onto the booking
 * row, so they must all describe the same offer. Deriving any one of them from a
 * "default" or "primary" mentor segment is what lets a booking record
 * contradict the screen it was made from.
 */
export interface BookingContextTriple {
  mentorId: string;
  segmentId: string;
  gigId: string;
}

export interface BookingContextCheck extends BookingContextTriple {
  gig: GigContext | null | undefined;
}

/**
 * Returns `null` when the triple is internally consistent and may be committed,
 * or a reason string when it must be rejected.
 *
 * This is the guard the booking endpoint uses so an inconsistent triple is
 * refused up front rather than written and discovered later.
 */
export function describeBookingContextMismatch(
  input: BookingContextCheck
): string | null {
  const { gig, mentorId, segmentId, gigId } = input;

  if (!gig) return `gig ${gigId} does not exist`;
  if (gig.id !== gigId) return `gig ${gigId} was resolved as ${gig.id}`;
  if (gig.mentor_id !== mentorId) {
    return `gig ${gigId} belongs to mentor ${gig.mentor_id}, not ${mentorId}`;
  }
  if (gig.segment_id !== segmentId) {
    return `gig ${gigId} belongs to segment ${gig.segment_id}, not ${segmentId}`;
  }
  if (gig.is_active !== true) return `gig ${gigId} is no longer active`;
  return null;
}
