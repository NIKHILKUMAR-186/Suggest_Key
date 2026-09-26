import { createHmac, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/src/lib/supabaseServer';
import { logSanitizer } from '@/src/lib/logSanitizer';

export const LOGIN_FAILURE_ALERT_THRESHOLD = 5;

const IDENTIFIER_SALT =
  process.env.LOGIN_ALERT_SALT ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.DEMO_AUTH_SECRET ||
  randomBytes(32).toString('hex');

const FALLBACK_THRESHOLD = LOGIN_FAILURE_ALERT_THRESHOLD;
const FALLBACK_WINDOW_MINUTES = 15;

export interface LoginFailureResult {
  consecutiveFailures: number;
  shouldAlert: boolean;
  alertRaised: boolean;
}

const NOOP_RESULT: LoginFailureResult = {
  consecutiveFailures: 0,
  shouldAlert: false,
  alertRaised: false,
};

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function normalizeIp(ip: unknown): string {
  return typeof ip === 'string' ? ip.trim().slice(0, 64) : '';
}

export function buildIdentifierKey(email: unknown, ip: unknown): string {
  return createHmac('sha256', IDENTIFIER_SALT)
    .update(`${normalizeEmail(email)}|${normalizeIp(ip)}`)
    .digest('hex');
}

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null;
}

export async function recordLoginFailure(params: {
  email?: unknown;
  ip?: unknown;
  reason?: unknown;
}): Promise<LoginFailureResult> {
  const admin: SupabaseClient | null = getSupabaseAdmin();
  if (!admin) return NOOP_RESULT;

  const identifierKey = buildIdentifierKey(params.email, params.ip);
  if (!identifierKey) return NOOP_RESULT;

  const reason = logSanitizer.safeMessage(
    typeof params.reason === 'string' ? params.reason : 'INVALID_CREDENTIALS',
  );

  try {
    const { data, error } = await admin.rpc('record_login_failure', {
      p_identifier_key: identifierKey,
      p_failure_reason: reason.slice(0, 120),
    });

    if (error) {
      console.error('[login-alert] record_login_failure failed:', error.message);
      return NOOP_RESULT;
    }

    const row = firstRow<{ consecutive_failures: number; should_alert: boolean; alert_raised: boolean }>(data);
    if (!row) return NOOP_RESULT;

    if (row.alert_raised) {
      console.error(
        `[login-alert] LOGIN_BRUTE_FORCE_SUSPECTED consecutive_failures=${row.consecutive_failures} ` +
        `threshold=${FALLBACK_THRESHOLD} window_minutes=${FALLBACK_WINDOW_MINUTES} identity=${identifierKey.slice(0, 12)}`,
      );
    }

    return {
      consecutiveFailures: row.consecutive_failures ?? 0,
      shouldAlert: Boolean(row.should_alert),
      alertRaised: Boolean(row.alert_raised),
    };
  } catch (error) {
    console.error('[login-alert] record_login_failure threw:', logSanitizer.safeMessage(error));
    return NOOP_RESULT;
  }
}

export async function resetLoginFailures(params: { email?: unknown; ip?: unknown }): Promise<number> {
  const admin = getSupabaseAdmin();
  if (!admin) return 0;

  const identifierKey = buildIdentifierKey(params.email, params.ip);
  if (!identifierKey) return 0;

  try {
    const { data, error } = await admin.rpc('reset_login_failures', {
      p_identifier_key: identifierKey,
    });
    if (error) {
      console.error('[login-alert] reset_login_failures failed:', error.message);
      return 0;
    }
    return typeof data === 'number' ? data : 0;
  } catch (error) {
    console.error('[login-alert] reset_login_failures threw:', logSanitizer.safeMessage(error));
    return 0;
  }
}
