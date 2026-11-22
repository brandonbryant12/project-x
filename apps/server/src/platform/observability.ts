import { NodeHttpClient } from '@effect/platform-node';
import type { LogLevel } from 'effect';
import { Cause, Context, Effect, Layer, Logger, Redacted, References, Tracer } from 'effect';
import {
  OtlpExporter,
  OtlpLogger,
  OtlpMetrics,
  OtlpSerialization,
  OtlpTracer,
} from 'effect/observability';
import type { AppConfig } from './config.ts';

/**
 * Observability (ADR 0013):
 *
 * 1. **Sanitized structured logging** with automatic OpenTelemetry + Datadog
 *    trace correlation (`trace_id`, `span_id`, `dd.trace_id`, `dd.span_id`) on
 *    every stdout log line and active span event.
 * 2. **Optional native OTLP/HTTP export** for traces, metrics (`delta`
 *    temporality by default for Datadog), and sanitized logs via Effect 4's
 *    `effect/observability` — supporting either a single base endpoint
 *    (`OTEL_EXPORTER_OTLP_ENDPOINT`) or per-signal overrides
 *    (`OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT`), optional
 *    `OTEL_EXPORTER_OTLP_HEADERS`, and `json` or `protobuf` wire format.
 * 3. **Zero PII / secret leakage** (ADR 0012): sensitive fields, narrative
 *    bodies, bearer tokens, and URL credentials/queries are redacted before
 *    writing to stdout OR exporting via OTLP.
 */

const TRACE_ID_HEX_LENGTH = 32;
const SPAN_ID_HEX_LENGTH = 16;
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/i;
const MAX_SANITIZED_TEXT_LENGTH = 2_000;
const MAX_SANITIZED_DEPTH = 8;

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const TRAILING_URL_PUNCTUATION = /[),.;:!?]+$/;
const AUTH_BEARER_PATTERN = /\bauthorization\s*[:=]\s*bearer\s+[^\s,;]+/gi;
const BEARER_PATTERN = /\bbearer\s+[^\s,;]+/gi;
const JSON_SENSITIVE_PATTERN = /"([A-Za-z][A-Za-z0-9_-]*)"\s*:\s*"(?:\\.|[^"\\])*"/g;

const SENSITIVE_FIELD_FRAGMENTS = [
  'apikey',
  'authorization',
  'body',
  'clientref',
  'content',
  'cookie',
  'credential',
  'email',
  'narrative',
  'password',
  'payload',
  'phone',
  'prompt',
  'reflection',
  'secret',
  'session',
  'ssn',
  'token',
] as const;

const TOKEN_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`\b(api[-_]?key|authorization|cookie|credential|password|secret|session|token)\b\s*[:=]\s*[^&\s,;]+`,
  'gi',
);

export interface OtelTraceCorrelation {
  readonly traceId: string;
  readonly spanId: string;
  readonly datadogTraceId: string;
  readonly datadogSpanId: string;
}

export type TelemetryBinding =
  | { readonly _tag: 'Disabled' }
  | {
      readonly _tag: 'Enabled';
      readonly tracesUrl: string | undefined;
      readonly metricsUrl: string | undefined;
      readonly logsUrl: string | undefined;
      readonly headers: Readonly<Record<string, string>> | undefined;
      readonly protocol: 'json' | 'protobuf';
      readonly metricsTemporality: 'delta' | 'cumulative';
      readonly resource: {
        readonly serviceName: string;
        readonly serviceVersion: string;
        readonly attributes: Readonly<Record<string, string>>;
      };
    };

const unsignedHexToDecimal = (hex: string): string => BigInt(`0x${hex}`).toString(10);

/**
 * Convert a 128-bit W3C/OTel trace ID + 64-bit span ID into both standard
 * OTel hex fields and Datadog's 64-bit unsigned decimal correlation IDs.
 */
export const otelTraceCorrelationFromSpanContext = (
  traceId: string,
  spanId: string,
): OtelTraceCorrelation | undefined => {
  const normalizedTrace = traceId.toLowerCase();
  const normalizedSpan = spanId.toLowerCase();
  if (!TRACE_ID_PATTERN.test(normalizedTrace) || !SPAN_ID_PATTERN.test(normalizedSpan)) {
    return undefined;
  }
  const datadogTraceHex = normalizedTrace.slice(TRACE_ID_HEX_LENGTH - SPAN_ID_HEX_LENGTH);
  return {
    traceId: normalizedTrace,
    spanId: normalizedSpan,
    datadogTraceId: unsignedHexToDecimal(datadogTraceHex),
    datadogSpanId: unsignedHexToDecimal(normalizedSpan),
  };
};

const normalizeFieldName = (field: string): string => field.replaceAll(/[-_]/g, '').toLowerCase();

export const isSensitiveTelemetryField = (field: string): boolean => {
  const normalized = normalizeFieldName(field);
  return SENSITIVE_FIELD_FRAGMENTS.some((fragment) => normalized.includes(fragment));
};

const stripUrlSensitiveParts = (rawUrl: string): string => {
  const suffix = rawUrl.match(TRAILING_URL_PUNCTUATION)?.[0] ?? '';
  const candidate = suffix ? rawUrl.slice(0, -suffix.length) : rawUrl;
  try {
    const url = new URL(candidate);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return `${url.toString()}${suffix}`;
  } catch {
    return rawUrl;
  }
};

export const sanitizeTelemetryText = (value: string): string => {
  const cleaned = value
    .replaceAll(URL_PATTERN, stripUrlSensitiveParts)
    .replaceAll(JSON_SENSITIVE_PATTERN, (match, key: string) =>
      isSensitiveTelemetryField(key) ? `"${key}":"[redacted]"` : match,
    )
    .replaceAll(AUTH_BEARER_PATTERN, 'authorization=[redacted]')
    .replaceAll(BEARER_PATTERN, 'Bearer [redacted]')
    .replaceAll(TOKEN_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=[redacted]`);
  return cleaned.length > MAX_SANITIZED_TEXT_LENGTH
    ? `${cleaned.slice(0, MAX_SANITIZED_TEXT_LENGTH)}...`
    : cleaned;
};

type SafeTelemetryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<SafeTelemetryValue>
  | { readonly [key: string]: SafeTelemetryValue };

/** Recursively sanitize arbitrary values before logging or OTLP export. */
export const sanitizeTelemetryValue = (
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): SafeTelemetryValue => {
  if (typeof value === 'string') return sanitizeTelemetryText(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value !== 'object') return String(value);
  if (depth >= MAX_SANITIZED_DEPTH) return '[truncated]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const fields: Record<string, unknown> =
    value instanceof Error
      ? {
          ...value,
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
        }
      : (value as Record<string, unknown>);
  const sanitized: SafeTelemetryValue = Array.isArray(value)
    ? value.map((entry) => sanitizeTelemetryValue(entry, seen, depth + 1))
    : Object.fromEntries(
        Object.entries(fields).map(([key, entry]) => [
          key,
          isSensitiveTelemetryField(key)
            ? '[redacted]'
            : sanitizeTelemetryValue(entry, seen, depth + 1),
        ]),
      );
  seen.delete(value);
  return sanitized;
};

export const sanitizeTelemetryCause = (cause: Cause.Cause<unknown>): Cause.Cause<unknown> =>
  Cause.fromReasons(
    cause.reasons.map((reason) => {
      switch (reason._tag) {
        case 'Fail':
          return Cause.makeFailReason(sanitizeTelemetryValue(reason.error)).annotate(
            Cause.reasonAnnotations(reason),
          );
        case 'Die':
          return Cause.makeDieReason(sanitizeTelemetryValue(reason.defect)).annotate(
            Cause.reasonAnnotations(reason),
          );
        case 'Interrupt':
          return reason;
      }
    }),
  );

export type ParsedHeadersResult =
  | { readonly ok: true; readonly headers: Readonly<Record<string, string>> | undefined }
  | { readonly ok: false; readonly message: string };

/** Parse standard `OTEL_EXPORTER_OTLP_HEADERS` (`key=value,key2=value2`). */
export const parseOtlpHeaders = (raw?: string): ParsedHeadersResult => {
  if (!raw || raw.trim().length === 0) return { ok: true, headers: undefined };
  const malformed: Array<string> = [];
  const entries: Array<[string, string]> = [];
  for (const [index, part] of raw.split(',').entries()) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0 || eqIdx === trimmed.length - 1) {
      malformed.push(`entry ${index + 1}`);
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!key || !val) {
      malformed.push(`entry ${index + 1}`);
      continue;
    }
    entries.push([key, val]);
  }
  if (malformed.length > 0) {
    return {
      ok: false,
      message: `Malformed OTEL_EXPORTER_OTLP_HEADERS (${malformed.join(', ')}).`,
    };
  }
  return { ok: true, headers: entries.length === 0 ? undefined : Object.fromEntries(entries) };
};

const joinOtlpSignalUrl = (baseUrl: string, signalPath: string): string =>
  `${baseUrl.trim().replace(/\/+$/, '')}${signalPath}`;

/** Resolve typed OTLP telemetry bindings from `AppConfig`, collecting validation problems. */
export const resolveTelemetryBinding = (
  config: AppConfig,
  problems: Array<string>,
): TelemetryBinding => {
  const { telemetry } = config;
  if (!telemetry.enabled) return { _tag: 'Disabled' };

  const base = telemetry.otlpEndpoint?.trim();
  const tracesUrl =
    telemetry.otlpTracesEndpoint?.trim() ||
    (base ? joinOtlpSignalUrl(base, '/v1/traces') : undefined);
  const metricsUrl =
    telemetry.otlpMetricsEndpoint?.trim() ||
    (base ? joinOtlpSignalUrl(base, '/v1/metrics') : undefined);
  const logsUrl =
    telemetry.otlpLogsEndpoint?.trim() || (base ? joinOtlpSignalUrl(base, '/v1/logs') : undefined);

  if (!tracesUrl && !metricsUrl && !logsUrl) {
    problems.push(
      'TELEMETRY_ENABLED=true needs OTEL_EXPORTER_OTLP_ENDPOINT or at least one per-signal OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT.',
    );
    return { _tag: 'Disabled' };
  }

  const parsedHeaders = parseOtlpHeaders(
    telemetry.otlpHeaders ? Redacted.value(telemetry.otlpHeaders) : undefined,
  );
  if (!parsedHeaders.ok) {
    problems.push(parsedHeaders.message);
    return { _tag: 'Disabled' };
  }

  return {
    _tag: 'Enabled',
    tracesUrl,
    metricsUrl,
    logsUrl,
    headers: parsedHeaders.headers,
    protocol: telemetry.otlpProtocol,
    metricsTemporality: telemetry.metricsTemporality,
    resource: {
      serviceName: telemetry.serviceName,
      serviceVersion: telemetry.serviceVersion,
      attributes: {
        'deployment.environment.name': telemetry.environment,
        env: telemetry.environment,
      },
    },
  };
};

const responseSeverity = (statusCode: unknown, level: LogLevel.LogLevel): string => {
  if (typeof statusCode !== 'number') return level.toLowerCase();
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
};

const mapLogLevel = (level: AppConfig['logLevel']): LogLevel.LogLevel => {
  switch (level) {
    case 'debug':
      return 'Debug';
    case 'info':
      return 'Info';
    case 'warn':
      return 'Warn';
    case 'error':
      return 'Error';
  }
};

const applicationLogger = (format: AppConfig['logFormat']): Logger.Logger<unknown, void> =>
  Logger.make<unknown, void>((options) => {
    const sanitizedCause = sanitizeTelemetryCause(options.cause);
    const formatted = Logger.formatStructured.log({ ...options, cause: sanitizedCause });
    const annotations = formatted.annotations;
    const statusCode = annotations['http.status_code'] ?? annotations['http.status'];
    const span = Context.getOrUndefined(options.fiber.context, Tracer.ParentSpan);
    const correlation = span
      ? otelTraceCorrelationFromSpanContext(span.traceId, span.spanId)
      : undefined;
    const severity = responseSeverity(statusCode, options.logLevel);
    const sanitizedMessage = sanitizeTelemetryValue(formatted.message);
    const sanitizedAnnotations = sanitizeTelemetryValue(annotations);
    const output = {
      ...formatted,
      message: sanitizedMessage,
      cause: sanitizeTelemetryValue(formatted.cause),
      annotations: sanitizedAnnotations,
      status: severity,
      ...(correlation
        ? {
            trace_id: correlation.traceId,
            span_id: correlation.spanId,
            'dd.trace_id': correlation.datadogTraceId,
            'dd.span_id': correlation.datadogSpanId,
          }
        : {}),
    };
    const line = JSON.stringify(output);
    if (format === 'pretty') {
      const causePart = output.cause ? ` ${String(output.cause)}` : '';
      const tracePart = correlation ? ` trace=${correlation.traceId.slice(0, 8)}` : '';
      process.stdout.write(
        `${formatted.timestamp} ${severity.toUpperCase()}${tracePart} ${JSON.stringify(sanitizedMessage)}${causePart} ${JSON.stringify(sanitizedAnnotations)}\n`,
      );
    } else {
      process.stdout.write(`${line}\n`);
    }

    if (span?._tag === 'Span') {
      span.event(JSON.stringify(sanitizedMessage), BigInt(options.date.getTime()) * 1_000_000n, {
        'effect.logLevel': severity.toUpperCase(),
        'effect.fiberId': options.fiber.id,
        'effect.log': line,
      });
    }
  });

const sanitizedOtlpLoggerLayer = (
  url: string,
  binding: Extract<TelemetryBinding, { readonly _tag: 'Enabled' }>,
) =>
  Logger.layer(
    [
      Effect.map(
        OtlpLogger.make({
          url,
          headers: binding.headers,
          resource: binding.resource,
        }),
        (inner) =>
          Logger.make<unknown, void>((options) =>
            inner.log({
              ...options,
              message: sanitizeTelemetryValue(options.message),
              cause: sanitizeTelemetryCause(options.cause),
            }),
          ),
      ),
    ],
    { mergeWithExisting: true },
  ).pipe(Layer.provide(OtlpExporter.layerFlusher));

/**
 * Full observability layer:
 * - Always installs sanitized structured console logging with Datadog trace
 *   correlation and `LOG_LEVEL` filtering.
 * - Optionally adds Effect 4 native OTLP traces, metrics (`delta` temporality
 *   for Datadog), and sanitized OTLP logs when `TELEMETRY_ENABLED=true`.
 */
export const ObservabilityLive = (
  config: AppConfig,
  binding: TelemetryBinding,
): Layer.Layer<OtlpExporter.Flusher> => {
  const baseLogger = Logger.layer([applicationLogger(config.logFormat)]).pipe(
    Layer.provideMerge(Layer.succeed(References.MinimumLogLevel)(mapLogLevel(config.logLevel))),
  );
  if (binding._tag === 'Disabled') return Layer.merge(baseLogger, OtlpExporter.layerFlusher);

  const serialization =
    binding.protocol === 'protobuf' ? OtlpSerialization.layerProtobuf : OtlpSerialization.layerJson;

  const tracesLayer = binding.tracesUrl
    ? OtlpTracer.layer({
        url: binding.tracesUrl,
        headers: binding.headers,
        resource: binding.resource,
      })
    : OtlpExporter.layerFlusher;

  const metricsLayer = binding.metricsUrl
    ? OtlpMetrics.layer({
        url: binding.metricsUrl,
        headers: binding.headers,
        resource: binding.resource,
        temporality: binding.metricsTemporality,
      })
    : OtlpExporter.layerFlusher;

  const logsLayer = binding.logsUrl
    ? sanitizedOtlpLoggerLayer(binding.logsUrl, binding)
    : OtlpExporter.layerFlusher;

  const otlp = Layer.mergeAll(tracesLayer, metricsLayer, logsLayer).pipe(
    Layer.provide(serialization),
    Layer.provide(NodeHttpClient.layerNodeHttp),
  );

  return Layer.merge(baseLogger, otlp);
};
