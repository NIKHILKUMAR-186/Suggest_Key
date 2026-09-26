/**
 * System Health aggregation and anomaly detection.
 *
 * PURE FUNCTIONS ONLY — no database, no clock, no randomness. Every value is
 * derived from the rows it is given, so identical input always yields identical
 * output and the maths is unit testable without a server.
 *
 * THE KEY INVARIANT
 * -----------------
 * `system_logs` records a completed request as `api_request` and a failed one
 * as `api_error` ONLY (verified against the live table: a 404/400 request has no
 * `api_request` row for the same request_id). The two categories are DISJOINT
 * and together they form every HTTP response:
 *
 *   total   = api_request + api_error
 *   success = api_request where status_code < 400
 *   4xx     = api_error  where 400 <= status_code < 500
 *   5xx     = api_error  where status_code >= 500
 *
 * Deriving all four from ONE partition is what makes successRate and errorRate
 * agree. Counting total from `api_request` while counting errors from
 * `api_error` — as the previous implementation did — is exactly what let the
 * two displayed rates contradict each other.
 */
import type { ServiceStatus, TimelineBucket } from '@/src/types/systemLogs';

/** A request slower than this counts as "slow". Matches previous behaviour. */
export const SLOW_REQUEST_MS = 1000;

/** Selectable dashboard ranges, each with the bucket width it uses. */
export const DASHBOARD_RANGES = {
  '15m': { ms: 15 * 60_000, bucketMs: 60_000 },
  '1h': { ms: 60 * 60_000, bucketMs: 2 * 60_000 },
  '24h': { ms: 24 * 60 * 60_000, bucketMs: 30 * 60_000 },
  '7d': { ms: 7 * 24 * 60 * 60_000, bucketMs: 3 * 60 * 60_000 },
} as const;

export type DashboardRange = keyof typeof DASHBOARD_RANGES;

export const DEFAULT_RANGE: DashboardRange = '1h';

export function isDashboardRange(value: unknown): value is DashboardRange {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DASHBOARD_RANGES, value);
}

/** The minimal row shape the aggregation needs; matches the live table. */
export interface HealthRow {
  created_at: string;
  category: string;
  level?: string;
  status_code: number | null;
  duration_ms: number | null;
  path: string | null;
  error_code: string | null;
  request_id?: string;
}

export interface HealthOverview {
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
}

/** Rounds to 1dp, avoiding float noise like 33.33333333333333. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Nearest-rank percentile. Returns null for an empty sample — never 0. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * Splits HTTP responses into one consistent partition.
 *
 * `totalRequests` is success + 4xx + 5xx, so a caller can always trust that
 * the two rates agree and sum to ~100%.
 */
export function computeOverview(rows: HealthRow[], totalAuditEvents = 0): HealthOverview {
  let successfulRequests = 0;
  let error4xx = 0;
  let error5xx = 0;

  const durations: number[] = [];
  let slowRequests = 0;

  for (const row of rows) {
    if (row.category === 'api_request') {
      if (row.status_code == null || row.status_code < 400) successfulRequests += 1;
    } else if (row.category === 'api_error') {
      if (row.status_code != null && row.status_code >= 500) error5xx += 1;
      else if (row.status_code != null) error4xx += 1;
    }

    if (row.duration_ms != null && row.duration_ms > 0) {
      durations.push(row.duration_ms);
      if (row.duration_ms > SLOW_REQUEST_MS) slowRequests += 1;
    }
  }

  const totalRequests = successfulRequests + error4xx + error5xx;

  return {
    totalRequests,
    successfulRequests,
    error4xx,
    error5xx,
    successRate: totalRequests > 0 ? round1((successfulRequests / totalRequests) * 100) : 0,
    errorRate: totalRequests > 0 ? round1(((error4xx + error5xx) / totalRequests) * 100) : 0,
    averageLatencyMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    p95LatencyMs: percentile(durations, 95),
    slowRequests,
    totalAuditEvents,
  };
}

/**
 * Buckets every response into a fixed-width timeline.
 *
 * The window is always fully populated, including empty buckets, so the chart
 * shows real quiet periods instead of compressing them away. `now` is injected
 * rather than read from the clock, which keeps this deterministic and testable.
 */
export function buildTimeline(
  rows: HealthRow[],
  rangeMs: number,
  bucketMs: number,
  now: number,
): TimelineBucket[] {
  const windowStart = now - rangeMs;
  const bucketCount = Math.max(1, Math.ceil(rangeMs / bucketMs));

  const buckets: TimelineBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    bucket: new Date(windowStart + i * bucketMs).toISOString(),
    requests: 0,
    errors4xx: 0,
    errors5xx: 0,
    latencyMs: null,
  }));

  // Latency accumulators, kept out of the returned shape.
  const latencySum = new Array<number>(bucketCount).fill(0);
  const latencyCount = new Array<number>(bucketCount).fill(0);

  for (const row of rows) {
    const t = new Date(row.created_at).getTime();
    if (!Number.isFinite(t) || t < windowStart || t > now) continue;

    const index = Math.min(bucketCount - 1, Math.floor((t - windowStart) / bucketMs));
    if (index < 0) continue;

    if (row.category === 'api_request') {
      if (row.status_code == null || row.status_code < 400) buckets[index].requests += 1;
    } else if (row.category === 'api_error') {
      buckets[index].requests += 1;
      if (row.status_code != null && row.status_code >= 500) buckets[index].errors5xx += 1;
      else if (row.status_code != null) buckets[index].errors4xx += 1;
    }

    if (row.duration_ms != null && row.duration_ms > 0) {
      latencySum[index] += row.duration_ms;
      latencyCount[index] += 1;
    }
  }

  for (let i = 0; i < bucketCount; i += 1) {
    buckets[i].latencyMs = latencyCount[i] > 0 ? Math.round(latencySum[i] / latencyCount[i]) : null;
  }

  return buckets;
}

/**
 * Anomaly thresholds.
 *
 * Deliberately simple, relative and explainable: a spike is "this bucket is
 * meaningfully worse than this window's own typical bucket", nothing more.
 *
 * The baseline is the MEDIAN of the preceding buckets rather than the mean,
 * because a median is not dragged upwards by the very spike being measured,
 * which keeps the comparison stable and easy to state to an admin.
 */
const ANOMALY = {
  /** Buckets of history used to form the baseline. */
  baselineBuckets: 12,
  /** current / baseline at or above this ratio is flagged. */
  warningRatio: 2,
  /** current / baseline at or above this ratio is critical. */
  criticalRatio: 3,
  /**
   * A rise smaller than this is noise, not a spike. Without it a baseline of 1
   * rising to 2 would raise a 100% "critical" alert on a perfectly healthy API.
   */
  warningMinDelta: 3,
  /** Latency is compared in milliseconds. */
  latencyWarningMinDelta: 150,
  latencyCriticalMinDelta: 400,
} as const;

export type AnomalyMetricKey = 'errors5xx' | 'errors4xx' | 'requests' | 'latency';

export interface DetectedAnomaly {
  id: string;
  severity: 'critical' | 'warning';
  metric: string;
  metricKey: AnomalyMetricKey;
  currentValue: number;
  baselineValue: number;
  /** null when the baseline was zero and a ratio is undefined. */
  percentChange: number | null;
  firstDetected: string;
  /** Start of the offending bucket — the drill-down window start. */
  windowStart: string;
  /** End of the offending bucket — the drill-down window end. */
  windowEnd: string;
  affectedEndpoint: string | null;
  occurrenceCount: number;
}

/** Median of a numeric sample; 0 for an empty sample. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The endpoint with the most errors inside the offending bucket. */
function topErrorEndpoint(
  rows: HealthRow[],
  fromMs: number,
  toMs: number,
): { path: string | null; count: number } {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.category !== 'api_error') continue;
    const t = new Date(row.created_at).getTime();
    if (!Number.isFinite(t) || t < fromMs || t > toMs) continue;
    const key = row.path || row.error_code || 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bestPath: string | null = null;
  let bestCount = 0;
  for (const [path, count] of counts) {
    if (count > bestCount) {
      bestPath = path;
      bestCount = count;
    }
  }
  return { path: bestPath, count: bestCount };
}

/**
 * Compares the most recent bucket against its own recent history.
 *
 * Returns ONLY anomalies backed by real rows. On a flat, quiet series the
 * result is empty and the UI shows "no significant anomaly detected" — an
 * incident is never invented to fill the card.
 */
export function detectAnomalies(
  timeline: TimelineBucket[],
  rows: HealthRow[],
  bucketMs: number,
): DetectedAnomaly[] {
  if (timeline.length < 2) return [];

  const current = timeline[timeline.length - 1];
  const history = timeline.slice(Math.max(0, timeline.length - 1 - ANOMALY.baselineBuckets), timeline.length - 1);
  if (!history.length) return [];

  const windowStartMs = new Date(current.bucket).getTime();
  const windowEndMs = windowStartMs + bucketMs;
  const { path: affectedEndpoint } = topErrorEndpoint(rows, windowStartMs, windowEndMs);

  const specs: Array<{ key: AnomalyMetricKey; label: string; value: (b: TimelineBucket) => number; minDelta: number }> = [
    { key: 'errors5xx', label: '5xx error spike', value: (b) => b.errors5xx, minDelta: ANOMALY.warningMinDelta },
    { key: 'errors4xx', label: '4xx error spike', value: (b) => b.errors4xx, minDelta: ANOMALY.warningMinDelta },
    { key: 'requests', label: 'Request volume spike', value: (b) => b.requests, minDelta: ANOMALY.warningMinDelta },
    { key: 'latency', label: 'Latency spike', value: (b) => b.latencyMs ?? 0, minDelta: ANOMALY.latencyWarningMinDelta },
  ];

  const anomalies: DetectedAnomaly[] = [];

  for (const spec of specs) {
    const currentValue = spec.value(current);
    const baselineValue = round1(median(history.map(spec.value)));

    // A flat quiet series must stay quiet: never alert on a rise of 1-2 units.
    if (currentValue - baselineValue < spec.minDelta) continue;
    if (currentValue <= 0) continue;

    // The ratio is undefined against a zero baseline, so the absolute-delta test
    // above stands alone rather than reporting an infinite percentage.
    const ratio = baselineValue > 0 ? currentValue / baselineValue : Infinity;
    if (ratio < ANOMALY.warningRatio) continue;

    const isCritical =
      ratio >= ANOMALY.criticalRatio &&
      currentValue - baselineValue >= spec.minDelta * 2 &&
      (spec.key !== 'latency' || currentValue - baselineValue >= ANOMALY.latencyCriticalMinDelta);

    anomalies.push({
      id: `${spec.key}-${current.bucket}`,
      severity: isCritical ? 'critical' : 'warning',
      metric: spec.label,
      metricKey: spec.key,
      currentValue,
      baselineValue,
      percentChange: baselineValue > 0 ? round1(((currentValue - baselineValue) / baselineValue) * 100) : null,
      firstDetected: current.bucket,
      windowStart: current.bucket,
      windowEnd: new Date(windowEndMs).toISOString(),
      affectedEndpoint: affectedEndpoint ?? null,
      occurrenceCount: currentValue,
    });
  }

  // Most severe first, then largest absolute change.
  return anomalies.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.currentValue - a.currentValue;
  });
}


export interface AuthSummary {
  totalEvents: number;
  /** auth rows with level = info. */
  successful: number;
  /** auth rows with level = warn|error — denied, invalid or expired credentials. */
  failures: number;
  /** 401/403 responses, a different signal from auth-category rows. */
  unauthorizedRequests: number;
  topFailurePath: string | null;
  topFailureCount: number;
  /** True only when real logs show a run of failures on one endpoint. */
  repeatedFailuresDetected: boolean;
}

/**
 * Real authentication signal, from logged `auth` rows and 401/403 responses.
 *
 * Repeated-failure detection is a plain count of the worst offending path, so it
 * is explainable and only fires on evidence. Nothing here is simulated.
 */
export function summariseAuth(rows: HealthRow[]): AuthSummary {
  const authRows = rows.filter((r) => r.category === 'auth');
  const failures = authRows.filter((r) => r.level === 'warn' || r.level === 'error');
  const successful = authRows.length - failures.length;

  const unauthorizedRequests = rows.filter((r) => r.status_code === 401 || r.status_code === 403).length;

  const byPath = new Map<string, number>();
  for (const row of failures) {
    const key = row.path || 'unknown';
    byPath.set(key, (byPath.get(key) ?? 0) + 1);
  }
  let topFailurePath: string | null = null;
  let topFailureCount = 0;
  for (const [path, count] of byPath) {
    if (count > topFailureCount) {
      topFailurePath = path;
      topFailureCount = count;
    }
  }

  return {
    totalEvents: authRows.length,
    successful,
    failures: failures.length,
    unauthorizedRequests,
    topFailurePath,
    topFailureCount,
    // A real run means several failures concentrated on one endpoint.
    repeatedFailuresDetected: topFailureCount >= 3,
  };
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

/**
 * Groups real error rows by endpoint + status + error code.
 *
 * Entirely driven by the rows supplied; there are no built-in example errors.
 */
export function groupErrors(rows: HealthRow[], limit = 10): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();

  const errors = rows
    .filter((r) => r.category === 'api_error')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  for (const row of errors) {
    const key = `${row.path ?? 'unknown'}|${row.status_code ?? 'none'}|${row.error_code ?? 'none'}`;
    const existing = groups.get(key);
    if (existing) {
      existing.occurrences += 1;
      // Sorted newest-first, so only the oldest can lower first_seen.
      if (row.created_at < existing.first_seen) existing.first_seen = row.created_at;
      continue;
    }
    groups.set(key, {
      endpoint: row.path,
      status_code: row.status_code,
      error_type: row.error_code,
      occurrences: 1,
      first_seen: row.created_at,
      last_seen: row.created_at,
      request_id: row.request_id ?? '',
    });
  }

  return [...groups.values()]
    .sort((a, b) => b.occurrences - a.occurrences || b.last_seen.localeCompare(a.last_seen))
    .slice(0, limit);
}



/** Status from real counts. No traffic at all reports "unknown", never a guess. */
function statusFromCounts(
  total: number,
  critical: number,
  warn: number,
): { status: ServiceStatus; detail: string } {
  if (total === 0) return { status: 'unknown', detail: 'No requests in the selected window' };
  if (critical > 0) {
    return { status: 'critical', detail: `${critical} server error${critical === 1 ? '' : 's'} in the selected window` };
  }
  if (warn > 0) {
    return { status: 'degraded', detail: `${warn} client error${warn === 1 ? '' : 's'} in the selected window` };
  }
  return { status: 'operational', detail: `${total} requests, no errors` };
}

export interface ServiceHealth {
  api: { status: ServiceStatus; detail: string };
  database: { status: ServiceStatus; detail: string };
  authentication: { status: ServiceStatus; detail: string };
  storage: { status: ServiceStatus; detail: string };
  notifications: { status: ServiceStatus; detail: string };
}

/**
 * Service-level status derived from real log evidence only.
 *
 * Anything without evidence reports "unknown" — the dashboard never claims a
 * service is healthy merely because nobody logged about it.
 */
export function summariseServices(
  overview: HealthOverview,
  rows: HealthRow[],
  dbReachable: boolean,
  auth: AuthSummary,
): ServiceHealth {
  const dbErrors = rows.filter((r) => r.category === 'db' && r.level === 'error').length;

  // Storage problems surface as 5xx on storage-ish routes — real logged evidence.
  const storageErrors = rows.filter(
    (r) =>
      r.category === 'api_error' &&
      r.status_code != null &&
      r.status_code >= 500 &&
      /storage|bucket|proof|upload/i.test(`${r.path ?? ''} ${r.error_code ?? ''}`),
  ).length;

  const notifErrors = rows.filter(
    (r) => r.category === 'api_error' && /notification/i.test(`${r.path ?? ''} ${r.error_code ?? ''}`),
  ).length;

  return {
    api: statusFromCounts(overview.totalRequests, overview.error5xx, overview.error4xx),
    database: {
      status: !dbReachable
        ? 'critical'
        : dbErrors > 0
          ? 'degraded'
          : overview.totalRequests > 0
            ? 'operational'
            : 'unknown',
      detail: !dbReachable
        ? 'Database is not responding'
        : dbErrors > 0
          ? `${dbErrors} database error${dbErrors === 1 ? '' : 's'} logged`
          : overview.totalRequests > 0
            ? 'Serving traffic, no database errors logged'
            : 'No traffic in the selected window',
    },
    authentication: {
      status:
        auth.totalEvents === 0
          ? 'unknown'
          : auth.failures > 0 || auth.unauthorizedRequests > 0
            ? 'degraded'
            : 'operational',
      detail:
        auth.totalEvents === 0
          ? 'No authentication events in the selected window'
          : `${auth.failures} auth failure${auth.failures === 1 ? '' : 's'}, ${auth.unauthorizedRequests} unauthorized response${auth.unauthorizedRequests === 1 ? '' : 's'}`,
    },
    storage: {
      status: storageErrors > 0 ? 'critical' : overview.totalRequests > 0 ? 'operational' : 'unknown',
      detail:
        storageErrors > 0
          ? `${storageErrors} storage operation failure${storageErrors === 1 ? '' : 's'}`
          : overview.totalRequests > 0
            ? 'No storage failures logged'
            : 'No traffic in the selected window',
    },
    notifications: {
      status: notifErrors > 0 ? 'degraded' : overview.totalRequests > 0 ? 'operational' : 'unknown',
      detail:
        notifErrors > 0
          ? `${notifErrors} notification operation failure${notifErrors === 1 ? '' : 's'}`
          : overview.totalRequests > 0
            ? 'No notification failures logged'
            : 'No traffic in the selected window',
    },
  };
}


