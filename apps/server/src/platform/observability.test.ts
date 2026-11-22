import { Cause, Effect, Metric } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  advisoryChecksTotal,
  domainEventsTotal,
  httpRequestDurationMs,
  httpRequestsTotal,
  recordAdvisoryCheck,
  recordDomainEvent,
  recordHttpRequest,
  routeGroupOf,
} from './metrics.ts';
import {
  otelTraceCorrelationFromSpanContext,
  parseOtlpHeaders,
  sanitizeTelemetryCause,
  sanitizeTelemetryText,
  sanitizeTelemetryValue,
} from './observability.ts';

/**
 * Protects ADR 0012 (no client PII or secrets in telemetry/logs) and ADR 0013
 * (optional OTLP logs/metrics/traces extraction with Datadog correlation).
 */
describe('observability (OTLP + Datadog correlation + PII sanitization)', () => {
  it('converts 128-bit OTel trace/span IDs to Datadog 64-bit unsigned decimals', () => {
    const corr = otelTraceCorrelationFromSpanContext(
      '4bf92f3577b34da6a3ce929d0e0e4736',
      '00f067aa0ba902b7',
    );
    expect(corr).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      datadogTraceId: '11803532876627986230',
      datadogSpanId: '67667974448284343',
    });
    expect(otelTraceCorrelationFromSpanContext('short', '00f067aa0ba902b7')).toBeUndefined();
    expect(
      otelTraceCorrelationFromSpanContext('4bf92f3577b34da6a3ce929d0e0e4736', 'bad'),
    ).toBeUndefined();
  });

  it('redacts narratives, client fields, secrets, bearer tokens, and URL queries', () => {
    const sanitized = sanitizeTelemetryValue({
      requestId: 'req_123',
      narrativeSaw: 'Spoke with Mrs. Patterson about account 4417',
      narrativeNext: 'Follow up next week',
      clientRef: 'acct-999',
      email: 'advisor@northwind.example',
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret',
      nested: {
        password: 'hunter2',
        detail:
          'Failed calling https://user:pass@api.example.com/v1/check?token=xyz with Bearer abc123',
      },
    }) as Record<string, unknown>;

    expect(sanitized['requestId']).toBe('req_123');
    expect(sanitized['narrativeSaw']).toBe('[redacted]');
    expect(sanitized['narrativeNext']).toBe('[redacted]');
    expect(sanitized['clientRef']).toBe('[redacted]');
    expect(sanitized['email']).toBe('[redacted]');
    expect(sanitized['authorization']).toBe('[redacted]');
    expect(sanitized['nested']).toEqual({
      password: '[redacted]',
      detail: 'Failed calling https://api.example.com/v1/check with Bearer [redacted]',
    });

    expect(sanitizeTelemetryText('{"apiKey":"sk-live-123","status":"ok"}')).toBe(
      '{"apiKey":"[redacted]","status":"ok"}',
    );
  });

  it('handles circular structures and sanitizes Effect causes safely', () => {
    const circular: Record<string, unknown> = { ok: true, secret: 'top-secret' };
    circular['self'] = circular;
    expect(sanitizeTelemetryValue(circular)).toEqual({
      ok: true,
      secret: '[redacted]',
      self: '[circular]',
    });

    const sanitizedCause = sanitizeTelemetryCause(
      Cause.fail({ _tag: 'InternalError', token: 'secret-token', code: 'E_FAIL' }),
    );
    const rendered = JSON.stringify(sanitizedCause);
    expect(rendered).toContain('[redacted]');
    expect(rendered).not.toContain('secret-token');
  });

  it('parses OTLP headers and rejects malformed entries', () => {
    expect(parseOtlpHeaders(undefined)).toEqual({ ok: true, headers: undefined });
    expect(parseOtlpHeaders('dd-api-key=abc123, x-env=prod')).toEqual({
      ok: true,
      headers: { 'dd-api-key': 'abc123', 'x-env': 'prod' },
    });
    expect(parseOtlpHeaders('no-equals-sign').ok).toBe(false);
    expect(parseOtlpHeaders('empty-val=').ok).toBe(false);
  });

  it('records low-cardinality HTTP, domain event, and advisory Effect metrics', async () => {
    expect(routeGroupOf('/api/observations/obs_123/sign?foo=bar')).toBe('/api/observations');
    expect(routeGroupOf('/health')).toBe('/health');
    expect(routeGroupOf('/auth/callback?code=secret')).toBe('/auth');
    expect(routeGroupOf('/skills/client-discovery')).toBe('/static');

    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        yield* recordHttpRequest('post', '/api/observations/obs_123/sign', 200, 42);
        yield* recordDomainEvent('Observation', 'ObservationSigned');
        yield* recordAdvisoryCheck({
          questionSet: 'privacy_screen',
          provider: 'mock',
          status: 'completed',
          effect: 'none',
          latencyMs: 115,
        });
        const reqs = yield* Metric.value(
          Metric.withAttributes(httpRequestsTotal, {
            'http.method': 'POST',
            'http.route_group': '/api/observations',
            'http.status_class': '2xx',
          }),
        );
        const latency = yield* Metric.value(
          Metric.withAttributes(httpRequestDurationMs, {
            'http.method': 'POST',
            'http.route_group': '/api/observations',
            'http.status_class': '2xx',
          }),
        );
        const events = yield* Metric.value(
          Metric.withAttributes(domainEventsTotal, {
            aggregate: 'Observation',
            event_tag: 'ObservationSigned',
          }),
        );
        const checks = yield* Metric.value(
          Metric.withAttributes(advisoryChecksTotal, {
            question_set: 'privacy_screen',
            provider: 'mock',
            status: 'completed',
            effect: 'none',
          }),
        );
        return { reqs, latency, events, checks };
      }),
    );

    expect(snapshot.reqs.count).toBeGreaterThanOrEqual(1);
    expect(snapshot.latency.count).toBeGreaterThanOrEqual(1);
    expect(snapshot.events.count).toBeGreaterThanOrEqual(1);
    expect(snapshot.checks.count).toBeGreaterThanOrEqual(1);
  });
});
