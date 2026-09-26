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

const buildLimiter = (limit: number) =>
  rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: clientRateLimitKey,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: RATE_LIMIT_MESSAGE },
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
