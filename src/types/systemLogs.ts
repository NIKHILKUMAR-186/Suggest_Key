export type SystemLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type SystemLogCategory =
  | 'api_request'
  | 'api_error'
  | 'auth'
  | 'db'
  | 'business'
  | 'system';

export type AuthEventType =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'session_failure'
  | 'token_missing'
  | 'token_invalid'
  | 'role_authorization_failure'
  | 'expired_session';

export interface SystemLog {
  id: string;
  request_id: string;
  created_at: string;
  level: SystemLogLevel;
  category: SystemLogCategory;
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

export interface AuditLog {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  request_id: string | null;
  metadata: Record<string, any>;
}

export interface LogFilter {
  timeRange?: string;
  status?: string;
  method?: string;
  endpoint?: string;
  category?: string;
  level?: string;
  user_id?: string;
  request_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SystemHealthMetrics {
  total_requests: number;
  successful_requests: number;
  error_4xx: number;
  error_5xx: number;
  average_latency_ms: number;
  slow_requests: number;
  error_rate: number;
  total_audit_events: number;
  error_groups: ErrorGroup[];
}

export interface ErrorGroup {
  endpoint: string | null;
  status_code: number | null;
  error_type: string | null;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  request_id: string;
}

export interface RequestDetail {
  log: SystemLog | null;
  auth_log: SystemLog | null;
  audit_log: AuditLog | null;
}

export type ServiceStatus = 'operational' | 'degraded' | 'critical' | 'unknown';

export interface TimelineBucket {
  bucket: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  latencyMs: number | null;
}

export interface Anomaly {
  id: string;
  severity: 'critical' | 'warning';
  metric: string;
  metricKey: 'errors5xx' | 'errors4xx' | 'requests' | 'latency';
  currentValue: number;
  baselineValue: number;
  /** null when the baseline was zero and a ratio is undefined. */
  percentChange: number | null;
  firstDetected: string;
  /** Drill-down window for this anomaly. */
  windowStart: string;
  windowEnd: string;
  affectedEndpoint: string | null;
  occurrenceCount: number;
}

export interface AuthHealthSummary {
  totalEvents: number;
  successful: number;
  failures: number;
  unauthorizedRequests: number;
  topFailurePath: string | null;
  topFailureCount: number;
  repeatedFailuresDetected: boolean;
}

export interface SystemHealthDashboard {
  overview: {
    totalRequests: number;
    successfulRequests: number;
    error4xx: number;
    error5xx: number;
    successRate: number;
    errorRate: number;
    averageLatencyMs: number | null;
    p95LatencyMs: number | null;
    slowRequests: number;
    totalAuditEvents: number;
  };
  timeline: TimelineBucket[];
  anomalies: Anomaly[];
  topErrors: ErrorGroup[];
  services: {
    api: { status: ServiceStatus; detail: string };
    database: { status: ServiceStatus; detail: string };
    authentication: { status: ServiceStatus; detail: string };
    storage: { status: ServiceStatus; detail: string };
    notifications: { status: ServiceStatus; detail: string };
  };
  auth: AuthHealthSummary;
  range: string;
  bucketMs: number;
  /** True when more rows existed in range than could be read. */
  truncated: boolean;
  window: { start: string; end: string };
  lastUpdated: string;
}
