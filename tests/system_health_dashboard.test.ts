import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_RANGES,
  buildTimeline,
  computeOverview,
  detectAnomalies,
  groupErrors,
  isDashboardRange,
  percentile,
  summariseAuth,
  summariseServices,
  type HealthRow,
} from '../src/lib/systemHealth';
import type { TimelineBucket } from '../src/types/systemLogs';

const NOW = Date.parse('2026-01-01T12:00:00.000Z');

const row = (over: Partial<HealthRow> = {}): HealthRow => ({
  created_at: new Date(NOW - 60_000).toISOString(),
  category: 'api_request',
  level: 'info',
  status_code: 200,
  duration_ms: 100,
  path: '/api/x',
  error_code: null,
  ...over,
});

const ok = (n: number, at = 0) =>
  Array.from({ length: n }, () =>
    row({ created_at: new Date(NOW - at).toISOString() }),
  );

describe('percentile', () => {
  it('returns null for an empty sample rather than a fabricated 0', () => {
    assert.equal(percentile([], 95), null);
  });

  it('computes nearest-rank p95', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(values, 95), 95);
  });
});

describe('computeOverview — consistent partition', () => {
  it('counts a failed request only once, and the rates always reconcile', () => {
    // A failed request produces an api_error row and NO api_request row.
    const rows = [...ok(90), row({ category: 'api_error', status_code: 500 }), row({ category: 'api_error', status_code: 404 })];
    const o = computeOverview(rows);
    assert.equal(o.totalRequests, 92);
    assert.equal(o.successfulRequests, 90);
    assert.equal(o.error5xx, 1);
    assert.equal(o.error4xx, 1);
    // The regression this fixes: these two used to be derived from different
    // log categories and could not be reconciled.
    assert.equal(o.successRate + o.errorRate, 100);
    assert.equal(o.totalRequests, o.successfulRequests + o.error4xx + o.error5xx);
  });

  it('reports 0 rates for a window with no traffic', () => {
    const o = computeOverview([]);
    assert.equal(o.totalRequests, 0);
    assert.equal(o.successRate, 0);
    assert.equal(o.errorRate, 0);
    assert.equal(o.averageLatencyMs, null, 'no latency must be null, not 0');
    assert.equal(o.p95LatencyMs, null);
  });

  it('counts 3xx as a success', () => {
    const o = computeOverview([row({ status_code: 304 })]);
    assert.equal(o.successfulRequests, 1);
    assert.equal(o.errorRate, 0);
  });

  it('p95 is never below the average', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000].map((ms) => row({ duration_ms: ms }));
    const o = computeOverview(rows);
    assert.ok(o.p95LatencyMs! >= o.averageLatencyMs!);
  });

  it('counts slow requests above the 1s threshold', () => {
    const o = computeOverview([row({ duration_ms: 1500 }), row({ duration_ms: 999 })]);
    assert.equal(o.slowRequests, 1);
  });
});

describe('buildTimeline', () => {
  it('produces a fully populated window including empty buckets', () => {
    const t = buildTimeline(ok(3), DASHBOARD_RANGES['1h'].ms, DASHBOARD_RANGES['1h'].bucketMs, NOW);
    assert.equal(t.length, 30);
    assert.equal(t.filter((b) => b.requests > 0).length, 1, 'only the bucket holding the rows is non-empty');
  });

  it('excludes rows outside the window', () => {
    const old = row({ created_at: new Date(NOW - 10 * 60 * 60_000).toISOString() });
    const t = buildTimeline([old], 60 * 60_000, 60_000, NOW);
    assert.equal(t.reduce((a, b) => a + b.requests, 0), 0);
  });

  it('separates 4xx and 5xx into their own series', () => {
    const rows = [
      ...ok(5),
      row({ category: 'api_error', status_code: 404, created_at: new Date(NOW - 1000).toISOString() }),
      row({ category: 'api_error', status_code: 503, created_at: new Date(NOW - 1000).toISOString() }),
    ];
    const t = buildTimeline(rows, 60 * 60_000, 60_000, NOW);
    const last = t[t.length - 1];
    assert.equal(last.errors4xx, 1);
    assert.equal(last.errors5xx, 1);
    assert.equal(last.requests, 7, 'errors are requests too');
  });

  it('leaves latency null for a bucket with no timings', () => {
    const t = buildTimeline([], 60 * 60_000, 60_000, NOW);
    assert.ok(t.every((b) => b.latencyMs === null));
  });

describe('detectAnomalies', () => {
  const BUCKET = 60_000;

  /** Builds a timeline directly, for isolating detection from bucketing. */
  const timelineOf = (reqs: number[], lat: (number | null)[] = []): TimelineBucket[] =>
    reqs.map((r, i) => ({
      bucket: new Date(NOW - (reqs.length - 1 - i) * BUCKET).toISOString(),
      requests: r,
      errors4xx: 0,
      errors5xx: 0,
      latencyMs: lat[i] ?? null,
    }));

  it('stays silent on a flat, healthy series', () => {
    assert.deepEqual(detectAnomalies(timelineOf(Array(30).fill(20)), [], BUCKET), []);
  });

  it('stays silent on an empty window', () => {
    assert.deepEqual(detectAnomalies([], [], BUCKET), []);
  });

  it('flags a 5xx spike as critical and names the offending endpoint', () => {
    const flat = timelineOf(Array(29).fill(20));
    const spiking: TimelineBucket = {
      bucket: new Date(NOW).toISOString(),
      requests: 20,
      errors4xx: 0,
      errors5xx: 60,
      latencyMs: null,
    };
    // The offending bucket runs from NOW to NOW+BUCKET, so the error rows that
    // explain it must fall inside that window.
    const rows = Array.from({ length: 60 }, () =>
      row({ category: 'api_error', status_code: 500, path: '/api/payments', created_at: new Date(NOW + 1000).toISOString() }),
    );
    const found = detectAnomalies([...flat, spiking], rows, BUCKET);
    const spike = found.find((a) => a.metricKey === 'errors5xx');
    assert.ok(spike, 'a 5xx spike should be detected');
    assert.equal(spike!.severity, 'critical');
    assert.equal(spike!.currentValue, 60);
    assert.equal(spike!.baselineValue, 0);
    assert.equal(spike!.affectedEndpoint, '/api/payments');
    assert.ok(spike!.windowStart < spike!.windowEnd, 'carries a usable drill-down window');
  });

  it('flags a 4xx spike', () => {
    const flat = timelineOf(Array(29).fill(20));
    const spiking: TimelineBucket = { ...flat[flat.length - 1], errors4xx: 40 };
    assert.ok(detectAnomalies([...flat, spiking], [], BUCKET).some((a) => a.metricKey === 'errors4xx'));
  });

  it('flags a latency spike', () => {
    const flat = timelineOf(Array(29).fill(20), Array(29).fill(100));
    const spiking: TimelineBucket = { ...flat[flat.length - 1], latencyMs: 2000 };
    const spike = detectAnomalies([...flat, spiking], [], BUCKET).find((a) => a.metricKey === 'latency');
    assert.ok(spike, 'a latency spike should be detected');
    assert.equal(spike!.currentValue, 2000);
  });

  it('does not alert on a trivial change from a tiny baseline', () => {
    // 1 -> 2 is +100% but is noise, and must never read as "critical".
    const flat = timelineOf(Array(29).fill(1));
    const nudged: TimelineBucket = { ...flat[flat.length - 1], errors5xx: 2 };
    assert.deepEqual(detectAnomalies([...flat, nudged], [], BUCKET), []);
  });

  it('reports a null percentChange when the baseline is zero', () => {
    const flat = timelineOf(Array(29).fill(5));
    const spiking: TimelineBucket = { ...flat[flat.length - 1], errors5xx: 9 };
    assert.equal(detectAnomalies([...flat, spiking], [], BUCKET)[0].percentChange, null);
  });

  it('needs history before it will call anything a spike', () => {
    assert.deepEqual(detectAnomalies(timelineOf([9999]), [], BUCKET), []);
  });
});


describe('groupErrors', () => {
  it('groups by endpoint, status and error code with first/last seen', () => {
    const rows = [
      row({ category: 'api_error', status_code: 404, path: '/a', error_code: 'NOT_FOUND', created_at: new Date(NOW - 1000).toISOString() }),
      row({ category: 'api_error', status_code: 404, path: '/a', error_code: 'NOT_FOUND', created_at: new Date(NOW - 5000).toISOString() }),
      row({ category: 'api_error', status_code: 500, path: '/a', error_code: null, created_at: new Date(NOW - 2000).toISOString() }),
    ];
    const g = groupErrors(rows);
    assert.equal(g.length, 2, 'status code must split the groups');
    assert.equal(g[0].occurrences, 2);
    assert.ok(Date.parse(g[0].first_seen) < Date.parse(g[0].last_seen));
  });

  it('returns an empty list when there were no errors', () => {
    assert.deepEqual(groupErrors(ok(5)), []);
  });
});

describe('summariseAuth', () => {
  it('splits successes from failures and only flags real repeated failures', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row({ category: 'auth', level: 'info' })),
      ...Array.from({ length: 4 }, () => row({ category: 'auth', level: 'warn', path: '/api/admin/x' })),
    ];
    const a = summariseAuth(rows);
    assert.equal(a.successful, 5);
    assert.equal(a.failures, 4);
    assert.equal(a.repeatedFailuresDetected, true);
    assert.equal(a.topFailurePath, '/api/admin/x');
  });

  it('does not claim repeated failures from a single one', () => {
    assert.equal(summariseAuth([row({ category: 'auth', level: 'warn', path: '/a' })]).repeatedFailuresDetected, false);
  });

  it('counts 401 and 403 as unauthorised', () => {
    const a = summariseAuth([
      row({ category: 'api_error', status_code: 401 }),
      row({ category: 'api_error', status_code: 403 }),
      row({ category: 'api_error', status_code: 500 }),
    ]);
    assert.equal(a.unauthorizedRequests, 2);
  });
});

describe('summariseServices', () => {
  it('reports unknown when there is no traffic at all', () => {
    assert.equal(summariseServices(computeOverview([]), [], true, summariseAuth([])).api.status, 'unknown');
  });

  it('is critical on server errors and operational when clean', () => {
    assert.equal(summariseServices(computeOverview([row({ category: 'api_error', status_code: 500 })]), [], true, summariseAuth([])).api.status, 'critical');
    assert.equal(summariseServices(computeOverview(ok(5)), [], true, summariseAuth([])).api.status, 'operational');
  });

  it('is critical when the database does not answer', () => {
    assert.equal(summariseServices(computeOverview(ok(5)), [], false, summariseAuth([])).database.status, 'critical');
  });
});

describe('range validation', () => {
  it('accepts only the supported ranges', () => {
    assert.equal(isDashboardRange('15m'), true);
    assert.equal(isDashboardRange('7d'), true);
    assert.equal(isDashboardRange('banana'), false);
    assert.equal(isDashboardRange(undefined), false);
  });
});

});
