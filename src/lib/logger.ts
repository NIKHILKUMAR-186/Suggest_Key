import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { SystemLog, SystemLogLevel, SystemLogCategory } from '@/src/types/systemLogs';

const REQUEST_ID_PREFIX = 'req_';
const REQUEST_ID_BYTES = 3;

let _adminClient: SupabaseClient | null = null;
let _clientErrorEmitted = false;

function getAdminClient(): SupabaseClient | null {
  if (_adminClient) return _adminClient;
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!_clientErrorEmitted) {
      _clientErrorEmitted = true;
    }
    return null;
  }
  _adminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminClient;
}

export function generateRequestId(): string {
  const hex = randomBytes(REQUEST_ID_BYTES).toString('hex');
  return `${REQUEST_ID_PREFIX}${hex}`;
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-service-role-key',
  'apikey',
  'supabase-apikey',
]);

const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'access_token',
  'refresh_token',
  'token',
  'secret',
  'api_key',
  'apikey',
  'service_role_key',
  'cardNumber',
  'cvv',
  'ssn',
  'proof_base64',
  'proof_data',
]);

function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lower)) {
      result[lower] = value ? '***present***' : '***absent***';
    } else {
      result[lower] = value;
    }
  }
  return result;
}

function sanitizeBody(body: any): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_BODY_KEYS.has(lower)) {
      result[lower] = value ? '***redacted***' : undefined;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n');
  const cleaned = lines.map((line) => {
    return line.replace(/\.js:\d+:\d+/, '.js:xxx:xxx');
  });
  return cleaned.join('\n');
}

interface LogEntryInput {
  requestId: string;
  level: SystemLogLevel;
  category: SystemLogCategory;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
  user_id?: string;
  role?: string;
  error_code?: string;
  message?: string;
  metadata?: Record<string, any>;
}

async function writeSystemLog(input: LogEntryInput): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;

  try {
    await admin.rpc('insert_system_log', {
      p_request_id: input.requestId,
      p_level: input.level,
      p_category: input.category,
      p_method: input.method || null,
      p_path: input.path || null,
      p_status_code: input.status_code || null,
      p_duration_ms: input.duration_ms || null,
      p_user_id: input.user_id || null,
      p_role: input.role || null,
      p_error_code: input.error_code || null,
      p_message: input.message || null,
      p_metadata: input.metadata || {},
    });
  } catch {
    // Silently fail — logging must never break request flow
  }
}

export async function logApiRequest(params: {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userId?: string;
  role?: string;
  error_code?: string;
  error_message?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  const { requestId, method, path, statusCode, durationMs, userId, role, error_code, error_message, metadata } = params;

  const isError = statusCode >= 400;
  const level: SystemLogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  const category: SystemLogCategory = isError ? 'api_error' : 'api_request';

  let message: string | undefined;
  if (error_code) {
    message = error_code;
  } else if (isError) {
    message = `Error ${statusCode}`;
  }

  const logMetadata: Record<string, any> = {
    ...(metadata || {}),
    ...(error_message ? { error_message } : {}),
  };

  await writeSystemLog({
    requestId,
    level,
    category,
    method,
    path,
    status_code: statusCode,
    duration_ms: durationMs,
    user_id: userId,
    role,
    error_code,
    message,
    metadata: logMetadata,
  });
}

export async function logAuthEvent(params: {
  requestId: string;
  event: string;
  userId?: string;
  role?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  metadata?: Record<string, any>;
}): Promise<void> {
  const { requestId, event, userId, role, path, method, statusCode, metadata } = params;

  let level: SystemLogLevel = 'info';
  if (event.includes('failure') || event.includes('invalid') || event.includes('missing') || event.includes('expired')) {
    level = 'warn';
  }

  await writeSystemLog({
    requestId,
    level,
    category: 'auth',
    method,
    path,
    status_code: statusCode,
    user_id: userId,
    role,
    message: event,
    metadata,
  });
}

export async function logAuditEvent(params: {
  actorUserId?: string;
  actorRole?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  requestId?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;

  try {
    await admin.rpc('insert_audit_log', {
      p_actor_user_id: params.actorUserId || null,
      p_actor_role: params.actorRole || null,
      p_action: params.action,
      p_entity_type: params.entityType || null,
      p_entity_id: params.entityId || null,
      p_request_id: params.requestId || null,
      p_metadata: params.metadata || {},
    });
  } catch {
  }
}

export async function logSystemError(params: {
  requestId: string;
  message: string;
  path?: string;
  method?: string;
  userId?: string;
  role?: string;
  error_code?: string;
  stack?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  await writeSystemLog({
    requestId: params.requestId,
    level: 'error',
    category: 'system',
    method: params.method,
    path: params.path,
    user_id: params.userId,
    role: params.role,
    error_code: params.error_code,
    message: params.message,
    metadata: {
      ...(params.metadata || {}),
      ...(params.stack ? { stack: sanitizeStack(params.stack) } : {}),
    },
  });
}

export async function logApiError(params: {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  message: string;
  error_code?: string;
  userId?: string;
  role?: string;
  stack?: string;
}): Promise<void> {
  await writeSystemLog({
    requestId: params.requestId,
    level: params.statusCode >= 500 ? 'error' : 'warn',
    category: 'api_error',
    method: params.method,
    path: params.path,
    status_code: params.statusCode,
    user_id: params.userId,
    role: params.role,
    error_code: params.error_code,
    message: params.message,
    metadata: params.stack ? { stack: sanitizeStack(params.stack) } : {},
  });
}

export function sanitizeHeadersForLog(headers: Record<string, any>): Record<string, any> {
  return sanitizeHeaders(headers);
}

export function sanitizeBodyForLog(body: any): Record<string, any> {
  return sanitizeBody(body);
}

export interface RequestWithId extends Request {
  id?: string;
  auth?: {
    user: { id: string; email: string; aud?: string };
    roles: string[];
  };
}

interface SystemLogRow {
  id: string;
  request_id: string;
  created_at: string;
  level: string;
  category: string;
  method: string | null;
  path: string | null;
  status_code: number | null;
  duration_ms: number | null;
  user_id: string | null;
  role: string | null;
  error_code: string | null;
  message: string | null;
  metadata: Record<string, any>;
}

export async function fetchSystemLogs(options: {
  category?: string;
  level?: string;
  status_code?: number;
  limit?: number;
  offset?: number;
  search?: string;
  request_id?: string;
  user_id?: string;
  path?: string;
  method?: string;
  timeRangeHours?: number;
}): Promise<SystemLog[]> {
  const admin = getAdminClient();
  if (!admin) return [];

  try {
    let query = admin.from('system_logs').select('*');

    if (options.category) query = query.eq('category', options.category);
    if (options.level) query = query.eq('level', options.level);
    if (options.status_code !== undefined) query = query.eq('status_code', options.status_code);
    if (options.request_id) query = query.eq('request_id', options.request_id);
    if (options.user_id) query = query.eq('user_id', options.user_id);
    if (options.path) query = query.ilike('path', `%${options.path}%`);
    if (options.method) query = query.eq('method', options.method);
    if (options.search) {
      query = query.or(`message.ilike.%${options.search}%,error_code.ilike.%${options.search}%,request_id.ilike.%${options.search}%`);
    }
    if (options.timeRangeHours) {
      const cutoff = new Date(Date.now() - options.timeRangeHours * 3600 * 1000).toISOString();
      query = query.gte('created_at', cutoff);
    }

    query = query.order('created_at', { ascending: false });
    if (options.limit) query = query.limit(options.limit);
    if (options.offset) query = query.offset(options.offset);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []) as unknown as SystemLog[];
  } catch {
    return [];
  }
}

export async function fetchAuditLogs(options: {
  actor_user_id?: string;
  action?: string;
  entity_type?: string;
  request_id?: string;
  limit?: number;
  offset?: number;
  timeRangeHours?: number;
  search?: string;
}): Promise<AuditLog[]> {
  const admin = getAdminClient();
  if (!admin) return [];

  try {
    let query = admin.from('audit_logs').select('*');

    if (options.actor_user_id) query = query.eq('actor_user_id', options.actor_user_id);
    if (options.action) query = query.ilike('action', `%${options.action}%`);
    if (options.entity_type) query = query.eq('entity_type', options.entity_type);
    if (options.request_id) query = query.eq('request_id', options.request_id);
    if (options.timeRangeHours) {
      const cutoff = new Date(Date.now() - options.timeRangeHours * 3600 * 1000).toISOString();
      query = query.gte('created_at', cutoff);
    }
    if (options.search) {
      query = query.or(`action.ilike.%${options.search}%,metadata::text.ilike.%${options.search}%`);
    }

    query = query.order('created_at', { ascending: false });
    if (options.limit) query = query.limit(options.limit);
    if (options.offset) query = query.offset(options.offset);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []) as unknown as AuditLog[];
  } catch {
    return [];
  }
}

export async function fetchSystemHealthMetrics(): Promise<{
  total_requests: number;
  successful_requests: number;
  error_4xx: number;
  error_5xx: number;
  average_latency_ms: number;
  slow_requests: number;
  error_rate: number;
  total_audit_events: number;
  error_groups: Array<{
    endpoint: string | null;
    status_code: number | null;
    error_type: string | null;
    occurrences: number;
    first_seen: string;
    last_seen: string;
    request_id: string;
  }>;
}> {
  const admin = getAdminClient();
  if (!admin) {
    return {
      total_requests: 0,
      successful_requests: 0,
      error_4xx: 0,
      error_5xx: 0,
      average_latency_ms: 0,
      slow_requests: 0,
      error_rate: 0,
      total_audit_events: 0,
      error_groups: [],
    };
  }

  try {
    const [{ count: total }, { count: successful }, { count: err4xx }, { count: err5xx }, { data: latencyData }, { count: auditCount }, { data: errorGroups }] = await Promise.all([
      admin.from('system_logs').select('*', { count: 'exact', head: true }).eq('category', 'api_request'),
      admin.from('system_logs').select('*', { count: 'exact', head: true }).eq('category', 'api_request').not('status_code', 'is', null).lt('status_code', 400),
      admin.from('system_logs').select('*', { count: 'exact', head: true }).eq('category', 'api_error').not('status_code', 'is', null).gte('status_code', 400).lt('status_code', 500),
      admin.from('system_logs').select('*', { count: 'exact', head: true }).eq('category', 'api_error').not('status_code', 'is', null).gte('status_code', 500),
      admin.from('system_logs').select('duration_ms').not('duration_ms', 'is', null).eq('category', 'api_request'),
      admin.from('audit_logs').select('*', { count: 'exact', head: true }),
      admin
        .from('system_logs')
        .select(`
          path,
          status_code,
          error_code,
          created_at,
          request_id
        `)
        .eq('category', 'api_error')
        .not('status_code', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    const durations = (latencyData || []).map((d) => d.duration_ms).filter((d) => d != null && d > 0);
    const averageLatency = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const slowRequests = durations.filter((d) => d > 1000).length;

    const totalRequests = total || 0;
    const allErrors = (err4xx || 0) + (err5xx || 0);
    const errorRate = totalRequests > 0 ? Number(((allErrors / totalRequests) * 100).toFixed(1)) : 0;

    const groups = new Map<string, {
      endpoint: string | null;
      status_code: number | null;
      error_type: string | null;
      occurrences: number;
      first_seen: string;
      last_seen: string;
      request_id: string;
    }>();

    for (const row of errorGroups || []) {
      const key = `${row.path || 'unknown'}|${row.status_code || 0}|${row.error_code || 'unknown'}`;
      const existing = groups.get(key);
      if (existing) {
        existing.occurrences += 1;
        if (new Date(row.created_at).getTime() < new Date(existing.first_seen).getTime()) {
          existing.first_seen = row.created_at;
          existing.request_id = row.request_id;
        }
        if (new Date(row.created_at).getTime() > new Date(existing.last_seen).getTime()) {
          existing.last_seen = row.created_at;
        }
      } else {
        groups.set(key, {
          endpoint: row.path,
          status_code: row.status_code,
          error_type: row.error_code,
          occurrences: 1,
          first_seen: row.created_at,
          last_seen: row.created_at,
          request_id: row.request_id,
        });
      }
    }

    return {
      total_requests: totalRequests,
      successful_requests: successful || 0,
      error_4xx: err4xx || 0,
      error_5xx: err5xx || 0,
      average_latency_ms: averageLatency,
      slow_requests: slowRequests,
      error_rate: errorRate,
      total_audit_events: auditCount || 0,
      error_groups: Array.from(groups.values()).sort((a, b) => b.occurrences - a.occurrences),
    };
  } catch {
    return {
      total_requests: 0,
      successful_requests: 0,
      error_4xx: 0,
      error_5xx: 0,
      average_latency_ms: 0,
      slow_requests: 0,
      error_rate: 0,
      total_audit_events: 0,
      error_groups: [],
    };
  }
}

let _requestIdInitialized = false;

export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  if (!req.id) {
    req.id = generateRequestId();
  }
  res.setHeader('X-Request-ID', req.id);
  next();
}

export function requestLoggerMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const requestId = req.id || generateRequestId();
  req.id = requestId;

  const originalEnd = res.end.bind(res);

  res.end = function (...args: any[]) {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;
    const method = req.method;
    const path = req.path || req.url;

    const userId = req.auth?.user?.id;
    const role = req.auth?.roles?.join(',') || undefined;

    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    if (statusCode >= 400) {
      const body = (res as any)._loggedBody;
      if (body) {
        errorCode = body?.error?.code;
        errorMessage = body?.error?.message;
      }
    }

    logApiRequest({
      requestId,
      method,
      path,
      statusCode,
      durationMs,
      userId,
      role,
      error_code: errorCode,
      error_message: errorMessage,
      metadata: {
        source: 'middleware',
      },
    }).catch(() => {});

    originalEnd(...args);
  };

  next();
}
