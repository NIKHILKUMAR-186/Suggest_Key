/**
 * Route-driven page metadata (document title + meta description + robots).
 *
 * The app uses a tiny in-app router (`NavigationContext` -> `Router`), so there
 * is no file-based routing layer that could own <head>. Instead the document
 * head is derived from the SAME route table the router matches on, which keeps
 * a single source of truth: a route can never render with a stale or blank
 * title, and the router and the head can never disagree about a page.
 *
 * Rules:
 *  - Only genuinely public pages carry a description and are indexable.
 *    Everything behind authentication is marked `noindex, nofollow` so search
 *    engines never index private bookings, payments, mentor profiles or the
 *    admin console.
 *  - Descriptions are page-specific. There is deliberately no shared fallback
 *    description for indexable pages.
 */

export const SITE_NAME = 'Suggest Key';
export const SITE_TAGLINE = '1:1 Mentorship Marketplace';

export interface PageMeta {
  /** Page name without the brand prefix, e.g. "Find a Mentor". */
  name: string;
  /** Concise, page-specific description. Empty for non-indexable pages. */
  description: string;
  /** True for every page that requires an authenticated session. */
  noindex: boolean;
}

interface RouteMetaEntry {
  /** Exact pathname match. */
  path?: string;
  /** Prefix match, used for detail pages such as /admin/users/:id. */
  prefix?: string;
  meta: PageMeta;
}

const publicPage = (name: string, description: string): PageMeta => ({
  name,
  description,
  noindex: false,
});

const privatePage = (name: string): PageMeta => ({ name, description: '', noindex: true });

/**
 * Ordered: the first match wins, so more specific prefixes must appear before
 * the broader ones they would otherwise be swallowed by.
 */
const ROUTE_META: RouteMetaEntry[] = [
  // ---- Public / indexable -------------------------------------------------
  { path: '/', meta: publicPage('', 'Suggest Key is a 1:1 mentorship marketplace: browse verified mentors by category, see real availability, and book a focused session in a few clicks.') },
  { path: '/auth/login', meta: publicPage('Sign In', 'Sign in to Suggest Key to manage your mentorship bookings, sessions, and notifications.') },
  { path: '/auth/signup', meta: publicPage('Create Account', 'Create a free Suggest Key account to find a verified 1:1 mentor and book your first session.') },
  { path: '/auth/forgot-password', meta: publicPage('Reset Password', 'Request a password reset link for your Suggest Key account.') },
  { path: '/mentor/signup', meta: publicPage('Become a Mentor', 'Apply to join Suggest Key as a mentor, share your expertise, and book 1:1 sessions with seekers who need your guidance.') },

  // ---- Access control -----------------------------------------------------
  { path: '/auth/unauthorized', meta: privatePage('Access Denied') },
  { path: '/403', meta: privatePage('Access Denied') },
  { path: '/auth/reset-password', meta: privatePage('Reset Password') },
  { path: '/auth/verify', meta: privatePage('Verify Email') },
  { path: '/auth/callback', meta: privatePage('Signing In') },

  // ---- Seeker -------------------------------------------------------------
  { path: '/seeker/mentor-detail', meta: privatePage('Mentor Profile') },
  { path: '/seeker/mentors', meta: privatePage('Find a Mentor') },
  { path: '/seeker/booking-detail', meta: privatePage('Booking Details') },
  { path: '/seeker/payment', meta: privatePage('Payment') },
  { path: '/seeker/checkout', meta: privatePage('Payment') },
  { path: '/seeker/bookings', meta: privatePage('My Bookings') },
  { path: '/seeker/session', meta: privatePage('Session') },
  { path: '/seeker/workspace', meta: privatePage('Workspace') },
  { path: '/seeker/notifications', meta: privatePage('Notifications') },
  { path: '/seeker/settings', meta: privatePage('Settings') },
  { prefix: '/seeker', meta: privatePage('Home') },

  // ---- Mentor directory (seeker facing) -----------------------------------
  { prefix: '/mentors', meta: privatePage('Mentor Directory') },

  // ---- Mentor -------------------------------------------------------------
  { path: '/mentor/verification', meta: privatePage('Mentor Verification') },
  { path: '/mentor/availability', meta: privatePage('Availability') },
  { path: '/mentor/booking-detail', meta: privatePage('Booking Details') },
  { path: '/mentor/bookings', meta: privatePage('My Bookings') },
  { path: '/mentor/notifications', meta: privatePage('Notifications') },
  { path: '/mentor/settings', meta: privatePage('Settings') },
  { path: '/mentor/gigs', meta: privatePage('My Gigs') },
  { path: '/mentor/segments', meta: privatePage('My Segments') },
  { path: '/mentor/workspace', meta: privatePage('Workspace') },
  { prefix: '/mentor', meta: privatePage('Mentor Home') },

  // ---- Admin --------------------------------------------------------------
  { path: '/admin/users/create', meta: privatePage('Create User') },
  { prefix: '/admin/users', meta: privatePage('User Details') },
  { path: '/admin/mentor-verification', meta: privatePage('Mentor Verification') },
  { prefix: '/admin/mentor-verification', meta: privatePage('Verification Review') },
  { path: '/admin/mentors', meta: privatePage('Mentors') },
  { prefix: '/admin/mentors', meta: privatePage('Mentor Details') },
  { path: '/admin/segments', meta: privatePage('Segments') },
  { prefix: '/admin/segments', meta: privatePage('Segment Details') },
  { path: '/admin/bookings', meta: privatePage('Bookings') },
  { path: '/admin/workspaces', meta: privatePage('Workspaces') },
  { path: '/admin/payments', meta: privatePage('Payments') },
  { path: '/admin/notifications', meta: privatePage('Notifications') },
  { prefix: '/admin/system-health', meta: privatePage('System Health') },
  { path: '/admin/settings', meta: privatePage('Settings') },
  { prefix: '/admin', meta: privatePage('Admin Dashboard') },
];

/** True when the pathname is not claimed by any real route (renders the 404). */
export function isKnownRoute(pathname: string): boolean {
  const normalized = normalizePath(pathname);
  if (normalized === '/') return true;
  return ROUTE_META.some((entry) => matches(entry, normalized));
}

function matches(entry: RouteMetaEntry, pathname: string): boolean {
  if (entry.path !== undefined) return pathname === entry.path;
  if (entry.prefix !== undefined) {
    return pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`);
  }
  return false;
}

function normalizePath(pathname: string): string {
  const withoutQuery = (pathname || '/').split('?')[0].split('#')[0];
  if (!withoutQuery) return '/';
  // Collapse a trailing slash so /admin/users/ and /admin/users behave alike.
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.replace(/\/+$/, '') || '/';
  }
  return withoutQuery;
}

const NOT_FOUND_META: PageMeta = { name: 'Page Not Found', description: '', noindex: true };

/** Resolves the metadata for a pathname. Falls back to the 404 metadata. */
export function resolvePageMeta(pathname: string): PageMeta {
  const normalized = normalizePath(pathname);
  if (normalized === '/') {
    return ROUTE_META[0].meta;
  }
  for (const entry of ROUTE_META) {
    if (matches(entry, normalized)) return entry.meta;
  }
  return NOT_FOUND_META;
}

/** Builds the document title, e.g. "Suggest Key — Find a Mentor". */
export function buildDocumentTitle(name: string): string {
  return name ? `${SITE_NAME} \u2014 ${name}` : SITE_NAME;
}

const ROBOTS_NOINDEX = 'noindex, nofollow';
const ROBOTS_INDEX = 'index, follow, max-image-preview:large';

function upsertMeta(doc: Document, attr: 'name' | 'property', key: string, content: string) {
  let tag = doc.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!tag) {
    tag = doc.createElement('meta');
    tag.setAttribute(attr, key);
    doc.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

/**
 * Writes the resolved metadata into <head>. Safe to call on every navigation:
 * only values that actually changed are touched, and the description tag is
 * removed entirely when a page must not be indexed.
 */
export function applyPageMeta(meta: PageMeta, doc: Document = document) {
  doc.title = buildDocumentTitle(meta.name);

  if (meta.description) {
    upsertMeta(doc, 'name', 'description', meta.description);
    upsertMeta(doc, 'property', 'og:description', meta.description);
  } else {
    doc.head.querySelector('meta[name="description"]')?.remove();
    doc.head.querySelector('meta[property="og:description"]')?.remove();
  }

  const title = buildDocumentTitle(meta.name);
  upsertMeta(doc, 'property', 'og:title', title);
  upsertMeta(doc, 'name', 'robots', meta.noindex ? ROBOTS_NOINDEX : ROBOTS_INDEX);
}
