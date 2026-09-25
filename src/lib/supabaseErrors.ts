import type { Response } from 'express';
import { logApiError } from '@/src/lib/logger';

/**
 * Centralised, secret-safe handling of Supabase / PostgREST errors.
 *
 * Rules enforced here:
 *  - The FULL diagnostic (PostgREST error code, message, details, hint, stack)
 *    is written to the System Health log (system_logs) together with the
 *    request id, so an admin can debug the failure later.
 *  - The CLIENT only ever receives a stable, safe message plus the request id.
 *    Raw database internals (constraint names, SQL fragments, column names)
 *    are never returned to the browser.
 *  - No tokens, cookies or service-role keys are ever logged (logger sanitises
 *    header/body values; error objects never contain credentials).
 */

export interface SupabaseErrorInfo {
  /** PostgREST / GoTrue / Postgres error code, e.g. 'PGRST201' or '23505'. */
  code: string;
  /** Raw internal message - diagnostics only, never sent to the client. */
  message: string;
  details: unknown;
  hint: string | null;
  stack?: string;
  /** True for the "more than one relationship was found" ambiguity error. */
  isRelationshipAmbiguity: boolean;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return 'Unexpected error';
}

export function describeSupabaseError(error: unknown): SupabaseErrorInfo {
  const message = getErrorMessage(error);
  let code = 'UNKNOWN_ERROR';
  let details: unknown = null;
  let hint: string | null = null;
  let stack: string | undefined;

  if (error instanceof Error) {
    stack = error.stack;
  }

  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.code === 'string' && candidate.code.trim()) {
      code = candidate.code;
    } else if (typeof candidate.code === 'number') {
      code = String(candidate.code);
    }
    if (candidate.details !== undefined) details = candidate.details;
    if (typeof candidate.hint === 'string') hint = candidate.hint;
  }

  return {
    code,
    message,
    details,
    hint,
    stack,
    isRelationshipAmbiguity: code === 'PGRST201' || /more than one relationship/i.test(message),
  };
}

/**
 * Maps a Supabase/PostgREST error onto the HTTP status the admin API should
 * answer with. PostgREST answers relationship ambiguity with HTTP 300, which is
 * never a valid API status - it is a server-side query defect, so it becomes a
 * 500 and is recorded in System Health.
 */
export function resolveHttpStatusForSupabaseError(info: SupabaseErrorInfo): number {
  switch (info.code) {
    case '23505': // unique constraint violation (e.g. duplicate email / duplicate role)
      return 409;
    case '23503': // foreign key violation
    case '23502': // not null violation
    case '22P02': // invalid text representation (malformed uuid)
    case '23514': // check constraint violation
      return 400;
    case 'PGRST116': // 0 or multiple rows returned for .single()
      return 404;
    default:
      return 500;
  }
}

function primaryRole(roles: string[] | undefined): string | undefined {
  if (!roles || roles.length === 0) return undefined;
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('mentor')) return 'mentor';
  if (roles.includes('seeker')) return 'seeker';
  return roles[0];
}

/**
 * Structural subset of the express request used for diagnostics. `AuthRequest`
 * satisfies it, which keeps this helper free of route-level type coupling.
 */
export interface ServerErrorRequest {
  requestId?: string;
  method?: string;
  path?: string;
  auth?: { user?: { id?: string } | null; roles?: string[] } | null;
}

export interface RespondWithServerErrorOptions {
  req: ServerErrorRequest;
  res: Response;
  error: unknown;
  /** Safe, user facing message (never contains database internals). */
  clientMessage: string;
  /** Stable API error code returned to the client. */
  code?: string;
  /** Overrides the status derived from the Supabase error code. */
  status?: number;
  /** Short label describing the operation, used only in the server log. */
  context?: string;
}

/**
 * Logs the real error to System Health and answers the client with a safe
 * message + the request id. Never throws.
 */
export function respondWithServerError(options: RespondWithServerErrorOptions): Response {
  const { req, res, error, clientMessage, code = 'SERVER_ERROR', status, context } = options;
  const info = describeSupabaseError(error);
  const httpStatus = status ?? resolveHttpStatusForSupabaseError(info);
  const requestId = req.requestId ?? '';

  void logApiError({
    requestId,
    method: req.method ?? 'GET',
    path: req.path ?? '',
    statusCode: httpStatus,
    message: `${context ? `${context} - ` : ''}[${info.code}] ${info.message}`,
    error_code: info.code,
    userId: req.auth?.user?.id,
    role: primaryRole(req.auth?.roles),
    stack: info.stack,
  }).catch(() => {});

  return res.status(httpStatus).json({
    success: false,
    error: {
      code,
      message: clientMessage,
      requestId: requestId || null,
    },
  });
}
