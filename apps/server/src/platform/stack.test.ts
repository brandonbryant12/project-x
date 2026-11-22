import { Effect, Exit, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from './config.ts';
import { resolveRuntimePlan } from './stack.ts';

const baseConfig = (): AppConfig => ({
  nodeEnv: 'development',
  port: 4400,
  appOrigin: 'http://localhost:5400',
  databaseUrl: Redacted.make('postgres://app:app@localhost:5442/app'),
  migrateOnStart: true,
  migrationsDir: undefined,
  authMode: 'dev',
  entra: {
    tenantId: undefined,
    clientId: undefined,
    clientSecret: undefined,
    flowSecret: undefined,
  },
  decisions: {
    mode: 'mock',
    apiKey: undefined,
    paidTierConfirmed: false,
  },
  telemetry: {
    enabled: false,
    otlpEndpoint: undefined,
    otlpTracesEndpoint: undefined,
    otlpMetricsEndpoint: undefined,
    otlpLogsEndpoint: undefined,
    otlpHeaders: undefined,
    otlpProtocol: 'json',
    metricsTemporality: 'delta',
    serviceName: 'app-server',
    serviceVersion: 'dev',
    environment: 'local',
  },
  logLevel: 'info',
  logFormat: 'pretty',
  webDistDir: undefined,
  schedulerEnabled: true,
  notify: {
    transport: 'log',
    smtpHost: undefined,
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: undefined,
    smtpPassword: undefined,
    from: undefined,
  },
  features: {
    designatedObservers: false,
  },
});

describe('resolveRuntimePlan (Alchemy-style Effect stack)', () => {
  it('resolves valid dev defaults into typed bindings', async () => {
    const plan = await Effect.runPromise(resolveRuntimePlan(baseConfig()));
    expect(plan.auth._tag).toBe('Dev');
    expect(plan.decisions._tag).toBe('Mock');
    expect(plan.notifier._tag).toBe('Log');
    expect(plan.telemetry._tag).toBe('Disabled');
  });

  it('resolves live Google decisions, SMTP, and OTLP Datadog bindings with guaranteed secrets', async () => {
    const config: AppConfig = {
      ...baseConfig(),
      decisions: {
        mode: 'live',
        apiKey: Redacted.make('secret-key'),
        paidTierConfirmed: true,
      },
      notify: {
        ...baseConfig().notify,
        transport: 'smtp',
        smtpHost: 'smtp.firm.example',
        from: 'coaching@firm.example',
      },
      telemetry: {
        ...baseConfig().telemetry,
        enabled: true,
        otlpEndpoint: 'http://127.0.0.1:4318/',
        otlpHeaders: Redacted.make('dd-api-key=abc123, x-tenant=northwind'),
        otlpProtocol: 'protobuf',
        metricsTemporality: 'delta',
      },
    };
    const plan = await Effect.runPromise(resolveRuntimePlan(config));
    expect(plan.decisions._tag).toBe('GoogleLive');
    expect(plan.notifier._tag).toBe('Smtp');
    expect(plan.telemetry).toMatchObject({
      _tag: 'Enabled',
      tracesUrl: 'http://127.0.0.1:4318/v1/traces',
      metricsUrl: 'http://127.0.0.1:4318/v1/metrics',
      logsUrl: 'http://127.0.0.1:4318/v1/logs',
      protocol: 'protobuf',
      metricsTemporality: 'delta',
      headers: { 'dd-api-key': 'abc123', 'x-tenant': 'northwind' },
    });
  });

  it('supports per-signal OTLP endpoints without a base endpoint', async () => {
    const config: AppConfig = {
      ...baseConfig(),
      telemetry: {
        ...baseConfig().telemetry,
        enabled: true,
        otlpMetricsEndpoint: 'http://dd-agent:4318/v1/metrics',
        otlpLogsEndpoint: 'http://dd-agent:4318/v1/logs',
      },
    };
    const plan = await Effect.runPromise(resolveRuntimePlan(config));
    expect(plan.telemetry).toMatchObject({
      _tag: 'Enabled',
      tracesUrl: undefined,
      metricsUrl: 'http://dd-agent:4318/v1/metrics',
      logsUrl: 'http://dd-agent:4318/v1/logs',
    });
  });

  it('fails with ConfigInvalid when cross-field or OTLP invariants are violated', async () => {
    const bad: AppConfig = {
      ...baseConfig(),
      nodeEnv: 'production',
      authMode: 'dev',
      decisions: { mode: 'live', apiKey: undefined, paidTierConfirmed: false },
      telemetry: {
        ...baseConfig().telemetry,
        enabled: true,
        otlpEndpoint: 'http://localhost:4318',
        otlpHeaders: Redacted.make('malformed-header-without-equals'),
      },
    };
    const exit = await Effect.runPromiseExit(resolveRuntimePlan(bad));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
