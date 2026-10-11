import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response } from 'express';

/**
 * Rate limiting for the Express API.
 *
 * Two tiers, both keyed per user when the caller is authenticated and per IP
 * otherwise, so one abusive client cannot spend the budget of everyone behind
 * the same NAT and a single user cannot evade the limit by rotating addresses.
 *
 * The default MemoryStore keeps counters in this process. That is correct for
 * a single instance; on a multi-instance / serverless deployment (Vercel) the
 * counters are per instance, so the effective limit multiplies by the instance
 * count. Swap in a shared store when that becomes a problem.
 */

/** Message returned to the client on every 429, in the app's error envelope. */
export const RATE_LIMIT_MESSAGE = 'Too many requests, please wait a moment.';

export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Ceiling for ordinary API traffic. High enough for polling SPAs. */
export const API_RATE_LIMIT = 120;

/** Ceiling for expensive routes: auth, AI generation, row-locking writes. */
export const EXPENSIVE_RATE_LIMIT = 10;

/** Ceiling for upload URL issuance per user per minute. */
export const UPLOAD_RATE_LIMIT = 20;

/** Per-flow upload rate limit overrides (more restrictive for sensitive flows). */
export const UPLOAD_RATE_LIMITS: Record<string, number> = {
  'mentor/document/upload-url': 10,      // Mentor verification docs
  'payment-proof': 10,                    // Payment proofs
  'support/attachments/upload-url': 15,   // Support attachments
  'segment/hero-upload-url': 5,           // Segment hero (admin only)
  'platform-config/qr-upload-url': 5,     // Payment QR (admin only)
  'profile-photo': 10,                    // Profile photos
} as const;

/** Minimal shape needed to identify an authenticated caller. */
interface MaybeAuthenticatedRequest extends Request {
  auth?: { user?: { id?: string } };
}

/**
 * Authenticated user id when we have one, otherwise the client IP.
 *
 * `ipKeyGenerator` masks IPv6 to a /56 subnet: a residential IPv6 prefix hands
 * an attacker billions of addresses, so counting them individually would make
 * the limiter useless for exactly the clients most likely to abuse it.
 */
export function clientRateLimitKey(req: Request, _res: Response): string {
  const userId = (req as MaybeAuthenticatedRequest).auth?.user?.id;
  if (typeof userId === 'string' && userId) return `user:${userId}`;
  return `ip:${ipKeyGenerator(req.ip || '')}`;
}

/**
 * Calculates the remaining seconds until the rate limit window resets.
 * Uses the standard draft-8 headers that express-rate-limit sets.
 * Adds jitter (±10%) to prevent thundering herd.
 */
function getRetryAfterSeconds(req: Request): number {
  // express-rate-limit sets `req.rateLimit` at runtime with `standardHeaders:
  // 'draft-8'`. The package does not ship a global Request augmentation, so we
  // reach the field through a narrow typed view. `resetTime` is a Date (v8).
  const rateLimitInfo = (
    req as unknown as { rateLimit?: { resetTime?: Date | number | string | null } }
  ).rateLimit;
  const resetHeader = rateLimitInfo?.resetTime;
  if (resetHeader) {
    const resetMs =
      typeof resetHeader === 'number'
        ? resetHeader
        : new Date(resetHeader).getTime();
    const remainingSec = Math.ceil((resetMs - Date.now()) / 1000);
    const base = Math.max(1, remainingSec);
    // Add jitter ±10% to prevent thundering herd, then round to integer
    const jitter = Math.floor(base * 0.1);
    const withJitter = base + (Math.random() * 2 - 1) * jitter;
    return Math.max(1, Math.round(withJitter));
  }
  // Fallback: estimate from window
  const base = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
  const jitter = Math.floor(base * 0.1);
  const withJitter = base + (Math.random() * 2 - 1) * jitter;
  return Math.max(1, Math.round(withJitter));
}

const buildLimiter = (limit: number) =>
  rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: clientRateLimitKey,
    handler: (req, res) => {
      const retryAfter = getRetryAfterSeconds(req);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: RATE_LIMIT_MESSAGE,
          retryAfterSeconds: retryAfter,
        },
      });
    },
  });

/** Applied to every /api route. */
export const apiRateLimiter = buildLimiter(API_RATE_LIMIT);

/** Applied to the expensive routes. Register it AFTER `requireAuth` so the
 * limiter can key on the real user id instead of a shared IP.
 */
export const expensiveRouteLimiter = buildLimiter(EXPENSIVE_RATE_LIMIT);

/**
 * Builds a rate limiter for upload URL issuance.
 * Uses the same key generator (user ID when authenticated, IP otherwise).
 */
export function buildUploadRateLimiter(flowName: keyof typeof UPLOAD_RATE_LIMITS): ReturnType<typeof buildLimiter> {
  const limit = UPLOAD_RATE_LIMITS[flowName] ?? UPLOAD_RATE_LIMIT;
  return buildLimiter(limit);
}

/**
 * Pre-built upload rate limiters for each flow.
 * These should be applied AFTER `requireAuth` so they key on user ID.
 */
export const mentorDocumentUploadLimiter = buildUploadRateLimiter('mentor/document/upload-url');
export const paymentProofUploadLimiter = buildUploadRateLimiter('payment-proof');
export const supportAttachmentUploadLimiter = buildUploadRateLimiter('support/attachments/upload-url');
export const segmentHeroUploadLimiter = buildUploadRateLimiter('segment/hero-upload-url');
export const paymentQrUploadLimiter = buildUploadRateLimiter('platform-config/qr-upload-url');
export const profilePhotoUploadLimiter = buildUploadRateLimiter('profile-photo');
