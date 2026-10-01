/**
 * Support / Help & Support — the single configuration source for the shared
 * support form (seeker, mentor and admin all render the same component).
 *
 * Architecture:
 *
 *     user -> shared Support UI -> Formspree -> support email
 *
 * There is deliberately no support table, no support API route and no ticket
 * queue. Nothing here touches Supabase, so it cannot weaken RLS, and the
 * payload is built from an explicit allow-list below, so a token, a payment
 * secret or an internal UUID has no path into it.
 *
 * The Formspree endpoint is client-visible on purpose: the browser POSTs to
 * Formspree directly, so there is nothing to keep secret and no server round
 * trip. Only a VITE_-prefixed value is inlined into the bundle, and no secret
 * key (Supabase service-role, Razorpay key secret, webhook secret) belongs
 * behind this name.
 */

import type { UserRole } from '@/src/types/navigation';

/**
 * Formspree's own spam trap. Formspree accepts a field named `_gotcha` and
 * silently discards any submission that arrives with it filled in. It is a real
 * Formspree mechanism, not a frontend-only illusion of one.
 */
export const HONEYPOT_FIELD = '_gotcha';

/** Read defensively: the test runner has no `import.meta.env`, the browser does. */
const readEnv = (key: string): string | undefined => {
  try {
    const value = (import.meta as unknown as { env?: Record<string, string> }).env?.[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The Formspree form endpoint, e.g. `https://formspree.io/f/abcdwxyz`.
 *
 * Missing endpoint is a supported state: the form renders a configuration
 * notice instead of pretending to send, rather than failing silently.
 */
export const FORMSPREE_SUPPORT_ENDPOINT = readEnv('VITE_FORMSPREE_SUPPORT_ENDPOINT');

/* --------------------------------------------------------------------------- */
/* Limits                                                                      */
/* --------------------------------------------------------------------------- */

export const SUPPORT_SUBJECT_MAX = 120;
export const SUPPORT_MESSAGE_MIN = 20;
export const SUPPORT_MESSAGE_MAX = 4000;
export const SUPPORT_BOOKING_CODE_MAX = 40;

/* --------------------------------------------------------------------------- */
/* Role-aware categories                                                       */
/* --------------------------------------------------------------------------- */

/**
 * The category list per role. Derived from the authenticated role, never from
 * anything the form submitted — the role is contextual labelling for the support
 * team, not an authorization input.
 */
export const SUPPORT_CATEGORIES: Record<UserRole, readonly string[]> = {
  seeker: ['Booking', 'Payment', 'Session', 'Mentor', 'Account', 'Technical Issue', 'Other'],
  mentor: ['Booking', 'Availability', 'Payment', 'Session', 'Profile', 'Technical Issue', 'Other'],
  admin: [
    'User Issue',
    'Mentor Issue',
    'Booking Issue',
    'Payment Issue',
    'System Issue',
    'Technical Issue',
    'Other',
  ],
};

/**
 * Categories where a booking reference is worth asking for. The field is
 * optional in every case, so this only decides whether to SHOW it.
 */
export const isBookingRelatedCategory = (category: string): boolean =>
  /booking|payment|session|availability/i.test(category);

/**
 * Only a human-facing booking reference is accepted (the platform generates
 * upper-case `BK-…` codes; input is matched leniently and normalised). An
 * internal row UUID therefore cannot be pre-filled or typed in, which keeps
 * internal identifiers out of the submission.
 */
export const isValidBookingReference = (value: string): boolean =>
  /^BK-[A-Za-z0-9-]{1,32}$/i.test(value.trim());

/* --------------------------------------------------------------------------- */
/* Validation                                                                  */
/* --------------------------------------------------------------------------- */

export interface SupportFormValues {
  subject: string;
  message: string;
  bookingCode: string;
}

export interface SupportFormErrors {
  subject?: string;
  message?: string;
  bookingCode?: string;
}

/**
 * Client-side validation of the three fields the user can actually get wrong.
 *
 * It runs only for message quality, never for access: a support message grants
 * nothing, and the platform's own authorization is decided server-side from the
 * verified session.
 */
export const validateSupportForm = (values: SupportFormValues): SupportFormErrors => {
  const errors: SupportFormErrors = {};

  const subject = values.subject.trim();
  if (subject.length < 4) {
    errors.subject = 'Add a subject of at least 4 characters.';
  } else if (subject.length > SUPPORT_SUBJECT_MAX) {
    errors.subject = `Keep the subject to ${SUPPORT_SUBJECT_MAX} characters or fewer.`;
  }

  const message = values.message.trim();
  if (message.length < SUPPORT_MESSAGE_MIN) {
    errors.message = `Describe the issue in at least ${SUPPORT_MESSAGE_MIN} characters so we can help.`;
  } else if (message.length > SUPPORT_MESSAGE_MAX) {
    errors.message = `Keep the message to ${SUPPORT_MESSAGE_MAX} characters or fewer.`;
  }

  const bookingCode = values.bookingCode.trim();
  if (bookingCode && !isValidBookingReference(bookingCode)) {
    errors.bookingCode = 'Use the booking code from your booking, for example BK-1234.';
  }

  return errors;
};

/* --------------------------------------------------------------------------- */
/* Payload                                                                     */
/* --------------------------------------------------------------------------- */

export interface SupportMessageInput {
  name: string;
  email: string;
  role: UserRole;
  category: string;
  subject: string;
  message: string;
  /** Optional; omitted from the payload when blank. */
  bookingCode: string;
  /** The route the user was on. Advisory only — see the comment in the builder. */
  currentPage: string;
  /** Honeypot value. Always empty for a human, so it is always sent as ''. */
  website?: string;
}

/**
 * The exact keys a submission may carry. Anything not built here — an access
 * token, a Razorpay secret, a private document, an admin note — cannot be sent.
 */
export const SUPPORT_PAYLOAD_FIELDS = [
  'name',
  'email',
  'role',
  'category',
  'subject',
  'message',
  'booking_code',
  'current_page',
  HONEYPOT_FIELD,
] as const;

/**
 * Builds the POST body from an explicit allow-list.
 *
 * `current_page` is the pathname only. The query string is dropped so internal
 * ids (`?bookingId=<uuid>`) are never forwarded, and the value is advisory
 * context for the support team — it authorizes nothing and is never trusted.
 */
export const buildSupportPayload = (input: SupportMessageInput): Record<string, string> => {
  const bookingCode = input.bookingCode.trim();

  return {
    name: input.name.trim(),
    email: input.email.trim(),
    role: input.role,
    category: input.category,
    subject: input.subject.trim(),
    message: input.message.trim(),
    ...(bookingCode ? { booking_code: bookingCode.toUpperCase() } : {}),
    current_page: input.currentPage.split('?')[0].slice(0, 200),
    [HONEYPOT_FIELD]: input.website ?? '',
  };
};
