# ADR 0013: OpenTelemetry from Effect to the Datadog Agent over OTLP

- Status: Accepted
- Date: 2026-11-16

## Context

Datadog is a fixed requirement. Content Studio exports OpenTelemetry traces
over OTLP from `@effect/opentelemetry` to the Datadog Agent and does not use
`dd-trace`. Its logs are structured JSON carrying `dd.trace_id` and
`dd.span_id`, so Datadog can correlate logs with traces. It derives span
names from use cases (`useCase.<name>`).

## Decision

**The server exports traces and metrics with OpenTelemetry (OTLP/HTTP) through
`@effect/opentelemetry`. In deployed environments the destination is the
Datadog Agent's OTLP receiver. Logs are JSON on stdout with `trace_id`,
`span_id`, `dd.trace_id` and `dd.span_id`.**

- Span names follow these patterns:
  - `http.server <METHOD> <route>`;
  - `useCase.<name>`;
  - `db.<repo>.<method>`;
  - `decisions.evaluate`.
- Attributes are low-cardinality only. IDs are allowed as attributes but are
  never used as dashboard group-bys.
- Unified service tagging uses `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION` and
  `OTEL_ENV`, which Datadog maps to service, version and env.
- Telemetry is off unless `TELEMETRY_ENABLED=true`. When it is enabled, a
  missing endpoint fails startup.
- Two optional Compose profiles exist:
  - `otel` runs the Aspire Dashboard to view traces locally;
  - `datadog` runs `datadog/agent` with the OTLP receiver enabled.
- Product metrics such as time-to-signature and observation coverage are
  computed from Postgres in the app. They are not reconstructed from traces.

## Alternatives considered

- **`dd-trace`.** It is vendor-locked, and its auto-instrumentation overlaps
  with the Effect tracer.
- **Logs only.** Without traces, latency in the multi-step signing
  transaction is hard to diagnose.

## Consequences

- Dashboards and monitors are kept as JSON in `ops/datadog/` once they exist.
- Request bodies, narratives and provider payloads are never logged or put on
  spans ([ADR 0012](./0012-privacy-and-audit-by-design.md)).

## Amendment (2026-11-16)

- **We use Effect 4's native OTLP exporters** (`effect/observability/Otlp`)
  for traces, metrics **and logs**. There is no OpenTelemetry SDK and no
  `@effect/opentelemetry`.
- **Logs** exported over OTLP carry trace context, so Datadog correlates them
  without `dd.trace_id` fields in stdout.
- **The Compose profiles** are `otel` (the Aspire dashboard) and `datadog`
  (the Agent with OTLP intake, including logs).
