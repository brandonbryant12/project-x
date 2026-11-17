import { Layer, Logger } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { Otlp, OtlpSerialization } from 'effect/observability';
import type { AppConfig } from './config.ts';

/**
 * Telemetry (ADR 0013): Effect's native OTLP exporters send traces, metrics and
 * logs to the Datadog Agent's OTLP receiver (or any collector). Logs exported
 * over OTLP carry trace context, so Datadog correlates them with traces.
 * Stdout logs are JSON in production, pretty locally.
 */
export const ObservabilityLive = (config: AppConfig) => {
  const logger = Logger.layer([
    config.logFormat === 'json' ? Logger.consoleJson : Logger.consolePretty(),
  ]);
  if (!config.telemetry.enabled || !config.telemetry.otlpEndpoint) return logger;
  const otlp = Otlp.layer({
    baseUrl: config.telemetry.otlpEndpoint,
    resource: {
      serviceName: config.telemetry.serviceName,
      serviceVersion: config.telemetry.serviceVersion,
      attributes: { 'deployment.environment.name': config.telemetry.environment },
    },
    loggerMergeWithExisting: true,
  }).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));
  return Layer.merge(logger, otlp);
};
