import type { ErrorRequestHandler, Response } from 'express';
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
 *  - No tokens, cookies or service-role keys are ever logged: every field
 *    reaching system_logs / audit_logs is scrubbed by the log sanitizer at the
 *    single write chokepoint (see writeSystemLog in logger.ts).
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
 *
 * `42501 insufficient_privilege` maps to 403 rather than falling through to
 * 500. It means the caller asked for something their role is not allowed to do,
 * which is an authorization outcome and not a server fault. Reporting it as a
 * 500 misdirected a mentor-facing workflow failure into "our side is broken"
 * when the accurate answer was "not permitted", and it is exactly the code the
 * column-privilege work on `session_workspaces` / `mentor_applications` is
 * designed to raise. The client still only ever sees GENERIC_ERROR_MESSAGE, so
 * nothing about the schema leaks.
 */
export function resolveHttpStatusForSupabaseError(info: SupabaseErrorInfo): number {
  switch (info.code) {
    case '42501': // insufficient_privilege: the caller is not permitted to do this
      return 403;
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

/**
 * The single, user-facing message returned for ANY unexpected server failure.
 * Deliberately vague: it must never embed a stack trace, a PostgREST/Postgres
 * message, a constraint or column name, or any other internal detail.
 */
export const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred';

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

export interface InternalErrorOptions {
  req: ServerErrorRequest;
  res: Response;
  error: unknown;
  /** Short label describing the operation, used only in the server log. */
  context?: string;
}

/**
 * The catch-all for unexpected failures. Always answers 500 with
 * GENERIC_ERROR_MESSAGE and pushes the real diagnostic (code, message,
 * details, hint, stack) to the server-side log together with the request id.
 *
 * Use this in `catch` blocks. Use `respondWithServerError` instead when the
 * failure is an expected, user-correctable outcome that deserves a specific
 * message and a non-500 status (duplicate email -> 409, and so on).
 */
export function respondWithInternalError(options: InternalErrorOptions): Response {
  // A malformed identifier in a path segment reaches Postgres as
  // `22P02 invalid input syntax for type uuid`, which is a caller mistake, not
  // a server fault. Hard-coding 500 turned `GET /api/seeker/bookings/1' OR
  // 1=1--` into a 500 plus a logged error, which is both a misleading signal
  // and a cheap way to fill the admin error log. The mapping below only
  // produces statuses for errors that are unambiguously the caller's fault
  // (bad uuid, constraint violation, missing row); anything unrecognised still
  // answers 500, so this never masks a genuine internal failure.
  const mapped = resolveHttpStatusForSupabaseError(describeSupabaseError(options.error));
  const isCallerFault = mapped >= 400 && mapped < 500 && mapped !== 404;

  return respondWithServerError({
    ...options,
    clientMessage: GENERIC_ERROR_MESSAGE,
    code: isCallerFault ? 'VALIDATION_ERROR' : 'SERVER_ERROR',
    status: isCallerFault ? mapped : 500,
  });
}

/**
 * Body-parser and other request-shape failures raised by middleware before a
 * route handler runs. Express forwards these to the error handler with a
 * `type`/`status` pair; without this mapping a client that simply sent an
 * oversized or unparseable body got a 500 instead of the accurate 413/400.
 */
function resolveRequestShapeFailure(err: unknown): { status: number; code: string; message: string } | null {
  const candidate = err as { type?: string; status?: number; statusCode?: number };
  if (!candidate || typeof candidate !== 'object') return null;

  const status = candidate.status ?? candidate.statusCode;

  if (candidate.type === 'entity.too.large' || status === 413) {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' };
  }
  if (candidate.type === 'entity.parse.failed' || status === 400) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'The request body could not be parsed.' };
  }
  if (candidate.type === 'encoding.unsupported' || candidate.type === 'charset.unsupported' || status === 415) {
    return { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported content type or encoding.' };
  }
  return null;
}

/**
 * Backstop for anything the per-route try/catch blocks did not catch: a throw
 * from shared middleware, or from a route registered without try/catch. It
 * guarantees /api/* always answers with the standard JSON envelope and never
 * with a raw stack trace or database message, in any NODE_ENV.
 *
 * MUST be registered last, after every route.
 *
 * Note: Express 4 does NOT forward a rejected promise from an async handler, so
 * async routes must still catch their own errors - this handler only sees
 * errors that actually reach the stack.
 */
export const terminalErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const isApi = req.path.startsWith('/api/');
  if (!isApi && process.env.NODE_ENV !== 'production') {
    // Keep the Vite/SPA dev error overlay working for non-API routes.
    next(err);
    return;
  }
  if (res.headersSent) {
    next(err);
    return;
  }

  const shapeFailure = resolveRequestShapeFailure(err);
  if (shapeFailure) {
    const requestId = (req as { requestId?: string }).requestId ?? '';
    void logApiError({
      requestId,
      method: req.method ?? 'GET',
      path: req.path ?? '',
      statusCode: shapeFailure.status,
      message: `request shape rejected: ${(err as Error)?.message ?? 'unknown'}`,
      error_code: shapeFailure.code,
      userId: (req as { auth?: { user?: { id?: string } } }).auth?.user?.id,
    }).catch(() => {});
    res.status(shapeFailure.status).json({
      success: false,
      error: { code: shapeFailure.code, message: shapeFailure.message, requestId: requestId || null },
    });
    return;
  }

  respondWithInternalError({ req, res, error: err });
};
