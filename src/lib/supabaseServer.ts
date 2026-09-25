import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '@/src/types/auth';
import { logger } from '@/src/lib/logger';

let supabaseAdmin: SupabaseClient | null = null;

export interface DemoTokenClaims {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

const DEMO_TOKEN_PREFIX = 'skdemo.';
const DEMO_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const DEMO_TOKEN_SECRET = process.env.DEMO_AUTH_SECRET || 'suggest-key-development-only';

const encodeBase64Url = (value: Buffer): string =>
  value.toString('base64url');

const decodeBase64Url = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function createDemoToken(claims: Omit<DemoTokenClaims, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: DemoTokenClaims = { ...claims, iat: now, exp: now + DEMO_TOKEN_TTL_SECONDS };
  const encodedPayload = encodeBase64Url(Buffer.from(JSON.stringify(payload)));
  const signature = encodeBase64Url(createHmac('sha256', DEMO_TOKEN_SECRET).update(encodedPayload).digest());
  return `${DEMO_TOKEN_PREFIX}${encodedPayload}.${signature}`;
}

export function verifyDemoToken(token: string): DemoTokenClaims | null {
  if (!token.startsWith(DEMO_TOKEN_PREFIX) || process.env.NODE_ENV === 'production') {
    return null;
  }

  const parts = token.slice(DEMO_TOKEN_PREFIX.length).split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, encodedSignature] = parts;
  const expectedSignature = createHmac('sha256', DEMO_TOKEN_SECRET).update(encodedPayload).digest();
  const actualSignature = decodeBase64Url(encodedSignature);
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8')) as Partial<DemoTokenClaims>;
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      !['seeker', 'mentor', 'admin'].includes(payload.role || '') ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload as DemoTokenClaims;
  } catch {
    return null;
  }
}

export function getSupabaseAdmin(): SupabaseClient | null {
  if (supabaseAdmin) return supabaseAdmin;

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  supabaseAdmin = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return supabaseAdmin;
}

interface AuthRequest extends Request {
  auth?: {
    user: User;
    roles: UserRole[];
  };
  requestId?: string;
  logStart?: number;
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'seeker' || value === 'mentor' || value === 'admin';
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const path = req.path || req.url || '';
  if (!token) {
    logger.auth('auth_missing_token', {
      requestId: req.requestId,
      path,
      result: 'failure',
      reason: 'AUTH_REQUIRED',
    });
    res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'A valid bearer token is required.' },
    });
    return;
  }

  const demoClaims = process.env.NODE_ENV !== 'production' ? verifyDemoToken(token) : null;
  if (demoClaims) {
    req.auth = {
      user: {
        id: demoClaims.sub,
        email: demoClaims.email,
        aud: 'authenticated',
      } as User,
      roles: [demoClaims.role],
    };
    logger.auth('login_success', {
      requestId: req.requestId,
      userId: demoClaims.sub,
      role: demoClaims.role,
      path,
      result: 'success',
    });
    next();
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    logger.auth('auth_service_unavailable', {
      requestId: req.requestId,
      path,
      result: 'failure',
      reason: 'AUTH_SERVICE_UNAVAILABLE',
    });
    res.status(503).json({
      success: false,
      error: { code: 'AUTH_SERVICE_UNAVAILABLE', message: 'Authentication is not configured.' },
    });
    return;
  }

  try {
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) {
      logger.auth('login_failure', {
        requestId: req.requestId,
        path,
        result: 'failure',
        reason: error?.code || 'AUTH_INVALID',
      });
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_INVALID', message: 'The provided token is invalid or expired.' },
      });
      return;
    }

    const { data: userRoles, error: rolesError } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (rolesError) {
      logger.auth('role_lookup_failed', {
        requestId: req.requestId,
        userId: user.id,
        path,
        result: 'failure',
        reason: 'ROLE_LOOKUP_FAILED',
      });
      console.error('[Auth] Failed to fetch user roles:', rolesError.message);
      res.status(500).json({
        success: false,
        error: { code: 'ROLE_LOOKUP_FAILED', message: 'Unable to verify user roles.' },
      });
      return;
    }

    const roles: UserRole[] = (userRoles || [])
      .map((r: { role: string }) => r.role)
      .filter(isUserRole);

    req.auth = { user, roles };
    logger.auth('login_success', {
      requestId: req.requestId,
      userId: user.id,
       role: roles.includes('admin') ? 'admin' : roles.includes('mentor') ? 'mentor' : roles.includes('seeker') ? 'seeker' : undefined,
      path,
      result: 'success',
    });
    next();
  } catch (error) {
    logger.auth('login_failure', {
      requestId: req.requestId,
      path,
      result: 'failure',
      reason: 'AUTH_INVALID',
    });
    console.error('[Auth] Authentication failed:', error);
    res.status(401).json({
      success: false,
      error: { code: 'AUTH_INVALID', message: 'The provided token is invalid or expired.' },
    });
  }
}

export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.auth) {
    logger.auth('auth_missing', {
      requestId: req.requestId,
      path: req.path || req.url || '',
      result: 'failure',
      reason: 'AUTH_REQUIRED',
    });
    res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' },
    });
    return;
  }

  if (!req.auth.roles.includes('admin')) {
    logger.auth('role_authorization_failure', {
      requestId: req.requestId,
      userId: req.auth.user.id,
      role: req.auth.roles.includes('mentor') ? 'mentor' : req.auth.roles.includes('seeker') ? 'seeker' : undefined,
      path: req.path || req.url || '',
      result: 'failure',
      reason: 'FORBIDDEN_ADMIN_REQUIRED',
    });
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Admin role required.' },
    });
    return;
  }

  next();
}

export function requireRole(role: UserRole): (req: AuthRequest, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    if (!req.auth) {
      logger.auth('auth_missing', {
        requestId: req.requestId,
        path: req.path || req.url || '',
        result: 'failure',
        reason: 'AUTH_REQUIRED',
      });
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' },
      });
      return;
    }

    if (!req.auth.roles.includes(role) && !req.auth.roles.includes('admin')) {
      logger.auth('role_authorization_failure', {
        requestId: req.requestId,
        userId: req.auth.user.id,
      role: req.auth.roles.includes('mentor') ? 'mentor' : req.auth.roles.includes('seeker') ? 'seeker' : undefined,
      path: req.path || req.url || '',
      result: 'failure',
      reason: `FORBIDDEN_ROLE_${role.toUpperCase()}`,
      });
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: `Role '${role}' required.` },
      });
      return;
    }

    next();
  };
}

export type { AuthRequest };
