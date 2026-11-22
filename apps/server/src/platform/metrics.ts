import { Effect, Metric } from 'effect';

/**
 * Low-cardinality operational and domain metrics (ADR 0013).
 *
 * All metrics are Effect-native (`Metric.counter` / `Metric.histogram`) and
 * export automatically via `OtlpMetrics` when `TELEMETRY_ENABLED=true` (using
 * `delta` temporality by default for Datadog compatibility). Zero overhead when
 * telemetry is disabled.
 *
 * Attribute rule: strictly low-cardinality strings only — never person IDs,
 * observation IDs, tenant names, or narrative text.
 */
const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;

export const httpRequestsTotal = Metric.counter('http_server_requests_total', {
  description: 'Total HTTP requests served, grouped by method, route group, and status class.',
  incremental: true,
});

export const httpRequestDurationMs = Metric.histogram('http_server_request_duration_ms', {
  description: 'HTTP request latency in milliseconds.',
  boundaries: LATENCY_BUCKETS_MS,
});

export const domainEventsTotal = Metric.counter('coaching_domain_events_total', {
  description: 'Immutable @alchemy.run/domain fact events appended to domain_event.',
  incremental: true,
});

export const advisoryChecksTotal = Metric.counter('coaching_advisory_checks_total', {
  description:
    'Advisory AI privacy checks executed, grouped by question set, provider, and result.',
  incremental: true,
});

export const advisoryLatencyMs = Metric.histogram('coaching_advisory_latency_ms', {
  description: 'Advisory AI check round-trip latency in milliseconds.',
  boundaries: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

/**
 * Collapse dynamic path segments into a low-cardinality route group so Datadog
 * metric series stay bounded regardless of entity or tenant count.
 */
export const routeGroupOf = (rawUrl: string): string => {
  const path = rawUrl.split('?')[0] ?? '/';
  if (path === '/health' || path === '/ready' || path.startsWith('/health/')) return '/health';
  if (path.startsWith('/auth/')) return '/auth';
  if (path.startsWith('/api/')) {
    const [, , group] = path.split('/');
    return group ? `/api/${group}` : '/api';
  }
  return '/static';
};

export const statusClassOf = (status: number): '2xx' | '3xx' | '4xx' | '5xx' | 'other' => {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
};

export const recordHttpRequest = (
  method: string,
  url: string,
  status: number,
  durationMs: number,
): Effect.Effect<void> => {
  const attributes = {
    'http.method': method.toUpperCase(),
    'http.route_group': routeGroupOf(url),
    'http.status_class': statusClassOf(status),
  };
  return Effect.all([
    Metric.update(Metric.withAttributes(httpRequestsTotal, attributes), 1),
    Metric.update(
      Metric.withAttributes(httpRequestDurationMs, attributes),
      Math.max(0, durationMs),
    ),
  ]).pipe(Effect.asVoid);
};

export const recordDomainEvent = (aggregate: string, eventTag: string): Effect.Effect<void> =>
  Metric.update(Metric.withAttributes(domainEventsTotal, { aggregate, event_tag: eventTag }), 1);

export const recordAdvisoryCheck = (input: {
  readonly questionSet: string;
  readonly provider: string;
  readonly status: 'completed' | 'failed' | 'skipped';
  readonly effect: string;
  readonly latencyMs?: number | undefined;
}): Effect.Effect<void> => {
  const countEffect = Metric.update(
    Metric.withAttributes(advisoryChecksTotal, {
      question_set: input.questionSet,
      provider: input.provider,
      status: input.status,
      effect: input.effect,
    }),
    1,
  );
  if (typeof input.latencyMs !== 'number' || !Number.isFinite(input.latencyMs)) return countEffect;
  return countEffect.pipe(
    Effect.andThen(
      Metric.update(
        Metric.withAttributes(advisoryLatencyMs, {
          question_set: input.questionSet,
          provider: input.provider,
        }),
        Math.max(0, input.latencyMs),
      ),
    ),
  );
};
