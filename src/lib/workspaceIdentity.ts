import { isSafeBookingIdentifier } from './sessionAccess';

/**
 * Booking <-> workspace identity rules, as pure functions.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Three separate defects shared one root cause: nothing ever checked that the
 * booking a page was asked for is the booking it actually loaded, and nothing
 * checked that the workspace it read belongs to that booking.
 *
 *   1. `booking.segment_id` and `booking.gig_id` could describe two different
 *      offers, so the same gig rendered under two different segment names on
 *      two different bookings and the pair looked like a workspace that had
 *      been published against the wrong session.
 *   2. `session_workspaces.mentor_id` / `seeker_id` are denormalised copies of
 *      the booking's participants, and RLS keys seeker visibility on the ROW's
 *      `seeker_id` rather than on `bookings.seeker_id`. A drifted row therefore
 *      makes the wrong seeker able to read someone else's published notes, and
 *      makes the rightful seeker see "Awaiting Mentor Notes" forever while the
 *      mentor correctly sees PUBLISHED.
 *   3. `fetchBookingDetail` had a `data.bookings[0]` branch, so a response that
 *      carried a list resolved to the FIRST booking in it, whatever was asked
 *      for.
 *
 * The rules live here so the mentor editor, the seeker reader, the server write
 * path and the tests all apply the identical predicate. None of them is an
 * authorization decision on its own - the database is still the enforcement
 * layer (see `supabase/migrations/*_phase37_*`). These are the checks that stop
 * a wrong-but-authorised row from being rendered as a coherent-looking session.
 *
 * Nothing here ever repairs a value. A mismatch is reported, never silently
 * corrected, which is the same posture `create_booking_with_hold` takes when a
 * gig and a segment disagree: an inconsistent row means stale client context,
 * and overwriting it would destroy the evidence.
 */

/** The minimum booking shape these rules need. Identity columns only. */
export interface BookingIdentity {
  id: string;
  booking_code: string;
  mentor_id: string;
  seeker_id: string;
  gig_id: string | null;
  segment_id: string;
  /** Present when the booking was loaded with its gig joined. */
  gig?: { id: string; mentor_id: string; segment_id: string } | null;
}

/** The minimum workspace shape these rules need. Identity columns only. */
export interface WorkspaceIdentity {
  id: string;
  booking_id: string;
  mentor_id: string;
  seeker_id: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Requested-booking resolution
// ---------------------------------------------------------------------------

/**
 * Reads the requested booking id out of a workspace URL.
 *
 * The value is a booking UUID or a booking code - both are matched by the
 * server's `.or('id.eq.X,booking_code.eq.X')` filter - so it is shape-checked
 * here before it can reach a filter at all.
 *
 * `currentPath` is the router's tracked path, which is the authority for what
 * the application believes it is showing. `window.location.search` is read only
 * as a fallback for the first paint, because `NavigationContext` mutates history
 * with `pushState`, which fires no `popstate` of its own. Reading the router's
 * value means a `navigate()` between two workspace URLs that differ only in
 * `bookingId` is observed as the identity change it is, instead of leaving the
 * mounted component holding the previous booking's state.
 *
 * Returns `''` for an absent or malformed value. Callers must treat `''` as
 * "render the unavailable state", never as "fall back to something else".
 */
export function resolveRequestedBookingId(
  currentPath: string | undefined,
  locationSearch?: string
): string {
  const fromPath = readBookingIdParam(currentPath);
  if (fromPath) return fromPath;

  const fromSearch =
    typeof locationSearch === 'string' ? readBookingIdParam(locationSearch) : '';
  return fromSearch;
}

function readBookingIdParam(value: string | undefined): string {
  if (!value) return '';
  const queryStart = value.indexOf('?');
  const query = queryStart >= 0 ? value.slice(queryStart + 1) : value;
  if (!query) return '';
  const raw = new URLSearchParams(query).get('bookingId') || '';
  return isSafeBookingIdentifier(raw) ? raw.trim() : '';
}

/**
 * Whether a loaded booking is the booking that was requested.
 *
 * Both the UUID and the booking code are accepted because the URL carries
 * either, and a request for one must never resolve to the other.
 */
export function bookingMatchesRequestedId(
  booking: Pick<BookingIdentity, 'id' | 'booking_code'> | null | undefined,
  requestedId: string
): boolean {
  if (!booking || !requestedId) return false;
  const wanted = requestedId.trim().toUpperCase();
  return booking.id === requestedId || (booking.booking_code || '').toUpperCase() === wanted;
}

// ---------------------------------------------------------------------------
// Offer identity: mentor + segment + gig must agree
// ---------------------------------------------------------------------------

export interface OfferIdentityVerdict {
  /** `booking.gig_id` and `booking.segment_id` both describe one offer. */
  segmentConsistent: boolean;
  /** `booking.gig_id` belongs to `booking.mentor_id`. */
  mentorConsistent: boolean;
  /** Nothing could be checked because the gig was not joined. */
  unverified: boolean;
}

/**
 * Checks that a booking still names one coherent offer.
 *
 * The gig is the authority: `gigs.segment_id` is the only thing that decides
 * which segment a gig belongs to, and `gigs.mentor_id` is the only thing that
 * decides who offers it. A booking that disagrees with its own gig is the
 * defect that made one gig render under two segment names on two bookings.
 *
 * The gig must actually be joined to answer this. When it is not, the verdict
 * is `unverified` rather than a false alarm - callers must not present an
 * unverified booking as broken, and must not present it as verified either.
 */
export function evaluateBookingOfferIdentity(booking: BookingIdentity): OfferIdentityVerdict {
  if (!booking.gig) {
    return { segmentConsistent: false, mentorConsistent: false, unverified: true };
  }
  const gigMentorOk = booking.gig.mentor_id === booking.mentor_id;
  // A booking with no gig at all is a different defect (a booking for a deleted
  // offer) and must not be reported as a segment mismatch.
  const gigMatches = booking.gig.id === booking.gig_id;
  return {
    segmentConsistent: gigMatches ? booking.gig.segment_id === booking.segment_id : false,
    mentorConsistent: gigMatches ? gigMentorOk : false,
    unverified: false,
  };
}

// ---------------------------------------------------------------------------
// Workspace identity
// ---------------------------------------------------------------------------

/**
 * Whether a workspace row is the workspace OF that booking.
 *
 * `booking_id` must match, and the row's denormalised participants must be the
 * booking's participants. The second check is the one RLS cannot make: the
 * seeker SELECT policy keys on the ROW's `seeker_id`, so a row whose
 * `seeker_id` drifted is both invisible to the rightful seeker and readable by
 * somebody else. `booking_id` alone would pass.
 */
export function workspaceBelongsToBooking(
  workspace: WorkspaceIdentity | null | undefined,
  booking: BookingIdentity | null | undefined
): boolean {
  if (!workspace || !booking) return false;
  return (
    workspace.booking_id === booking.id &&
    workspace.mentor_id === booking.mentor_id &&
    workspace.seeker_id === booking.seeker_id
  );
}

/**
 * Whether one party may read a workspace's content.
 *
 * Mirrors the database predicate
 * `(seeker_id = auth.uid() AND status = 'PUBLISHED') OR mentor_id = auth.uid() OR is_admin()`
 * so the client never renders content the database would withhold, and so the
 * seeker path can never be talked into showing an unpublished draft.
 */
export function isWorkspaceVisibleTo(
  workspace: WorkspaceIdentity,
  viewer: { userId: string; role: 'mentor' | 'seeker' | 'admin' }
): boolean {
  if (viewer.role === 'admin') return true;
  if (viewer.role === 'mentor') return workspace.mentor_id === viewer.userId;
  return workspace.seeker_id === viewer.userId && workspace.status === 'PUBLISHED';
}

// ---------------------------------------------------------------------------
// One verdict for the workspace pages
// ---------------------------------------------------------------------------

export type WorkspaceViewVerdict =
  /** Everything agrees: render the workspace. */
  | 'OK'
  /** No workspace row exists yet for this booking: render the pending state. */
  | 'NOT_STARTED'
  /** The row exists but is not yet published and the viewer is the seeker. */
  | 'PENDING'
  /** A row exists for this booking but belongs to a different pair of participants. */
  | 'WORKSPACE_PARTICIPANT_MISMATCH'
  /** The booking's gig and segment disagree: the screen cannot be trusted. */
  | 'OFFER_MISMATCH'
  /** The loaded booking is not the booking the URL asked for. */
  | 'BOOKING_MISMATCH';

/**
 * The single decision the mentor and seeker workspace pages render from.
 *
 * Ordering matters. A workspace whose participants disagree with the booking is
 * reported BEFORE any status is considered, because its `status` describes a
 * session other people are a party to. Returning `PENDING` for such a row is
 * what produced the reported symptom pair: the mentor saw PUBLISHED and the
 * seeker saw "Awaiting Mentor Notes" for one session that no longer had a
 * single coherent owner.
 */
export function resolveWorkspaceView(params: {
  requestedId: string;
  booking: BookingIdentity | null | undefined;
  workspace: WorkspaceIdentity | null | undefined;
  viewer: { userId: string; role: 'mentor' | 'seeker' | 'admin' };
  /** Set when the caller already knows the booking itself failed to verify. */
  bookingMismatch?: boolean;
}): WorkspaceViewVerdict {
  const { requestedId, booking, workspace, viewer } = params;

  if (params.bookingMismatch || !bookingMatchesRequestedId(booking, requestedId)) {
    return 'BOOKING_MISMATCH';
  }
  if (!booking) return 'BOOKING_MISMATCH';

  const offer = evaluateBookingOfferIdentity(booking);
  if (!offer.unverified && !(offer.segmentConsistent && offer.mentorConsistent)) {
    return 'OFFER_MISMATCH';
  }

  if (!workspace) return 'NOT_STARTED';
  if (!workspaceBelongsToBooking(workspace, booking)) {
    return 'WORKSPACE_PARTICIPANT_MISMATCH';
  }
  return isWorkspaceVisibleTo(workspace, viewer) ? 'OK' : 'PENDING';
}