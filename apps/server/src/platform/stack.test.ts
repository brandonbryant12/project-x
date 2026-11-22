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
    serviceName: 'app-server',
    serviceVersion: 'dev',
    environment: 'local',
  },
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
  });

  it('resolves live Google decisions and SMTP bindings with guaranteed secrets', async () => {
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
    };
    const plan = await Effect.runPromise(resolveRuntimePlan(config));
    expect(plan.decisions._tag).toBe('GoogleLive');
    expect(plan.notifier._tag).toBe('Smtp');
  });

  it('fails with ConfigInvalid when cross-field invariants are violated', async () => {
    const bad: AppConfig = {
      ...baseConfig(),
      nodeEnv: 'production',
      authMode: 'dev',
      decisions: { mode: 'live', apiKey: undefined, paidTierConfirmed: false },
    };
    const exit = await Effect.runPromiseExit(resolveRuntimePlan(bad));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
