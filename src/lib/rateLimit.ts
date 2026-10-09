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
    return Math.max(1, remainingSec);
  }
  // Fallback: estimate from window
  return Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
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

/**
 * Applied to the expensive routes. Register it AFTER `requireAuth` so the
 * limiter can key on the real user id instead of a shared IP.
 */
export const expensiveRouteLimiter = buildLimiter(EXPENSIVE_RATE_LIMIT);
