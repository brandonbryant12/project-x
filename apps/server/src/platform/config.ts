import { Config, Data, Effect, Option, Redacted } from 'effect';

/**
 * The only module that reads environment variables (lint bans `process.env`
 * elsewhere). Every value is decoded and defaulted here; secrets stay Redacted.
 * Documented in apps/server/.env.example.
 */
const AuthMode = Config.Literals(['dev', 'entra'], 'AUTH_MODE');
const DecisionsMode = Config.Literals(['disabled', 'mock', 'live'], 'DECISIONS_MODE');
const optionalRedacted = (name: string) =>
  Config.option(Config.Redacted(name)).pipe(Config.map(Option.getOrUndefined));
const optionalString = (name: string) =>
  Config.option(Config.String(name)).pipe(Config.map(Option.getOrUndefined));

export const AppConfig = Config.all({
  nodeEnv: Config.Literals(['development', 'test', 'production'], 'NODE_ENV').pipe(
    Config.withDefault('development' as const),
  ),
  port: Config.Port('PORT').pipe(Config.withDefault(4400)),
  /** Public origin of the app (web). Used for CSRF origin checks and redirects. */
  appOrigin: Config.String('APP_ORIGIN').pipe(Config.withDefault('http://localhost:5400')),
  /** `pglite:<dir>` (zero-infra dev) or a `postgres://` URL. */
  databaseUrl: Config.Redacted('DATABASE_URL').pipe(
    Config.withDefault(Redacted.make('postgres://app:app@localhost:5442/app')),
  ),
  migrateOnStart: Config.Boolean('DB_MIGRATE_ON_START').pipe(Config.withDefault(true)),
  /** Where the SQL migrations live in a bundled deployment (the image sets /app/drizzle). */
  migrationsDir: optionalString('DB_MIGRATIONS_DIR'),
  authMode: AuthMode.pipe(Config.withDefault('dev' as const)),
  entra: Config.all({
    tenantId: optionalString('ENTRA_TENANT_ID'),
    clientId: optionalString('ENTRA_CLIENT_ID'),
    clientSecret: optionalRedacted('ENTRA_CLIENT_SECRET'),
    /** HMAC key for the short-lived sign-in flow cookie (state, nonce, PKCE verifier). */
    flowSecret: optionalRedacted('AUTH_FLOW_SECRET'),
  }),
  decisions: Config.all({
    mode: DecisionsMode.pipe(Config.withDefault('mock' as const)),
    apiKey: optionalRedacted('DECISIONS_API_KEY'),
    paidTierConfirmed: Config.Boolean('DECISIONS_PAID_TIER_CONFIRMED').pipe(
      Config.withDefault(false),
    ),
  }),
  telemetry: Config.all({
    enabled: Config.Boolean('TELEMETRY_ENABLED').pipe(Config.withDefault(false)),
    otlpEndpoint: optionalString('OTEL_EXPORTER_OTLP_ENDPOINT'),
    serviceName: Config.String('OTEL_SERVICE_NAME').pipe(Config.withDefault('app-server')),
    serviceVersion: Config.String('OTEL_SERVICE_VERSION').pipe(Config.withDefault('dev')),
    environment: Config.String('OTEL_ENV').pipe(Config.withDefault('local')),
  }),
  logFormat: Config.Literals(['json', 'pretty'], 'LOG_FORMAT').pipe(
    Config.withDefault('pretty' as const),
  ),
  /** Built SPA to serve in production (ADR 0011). */
  webDistDir: optionalString('WEB_DIST_DIR'),
  schedulerEnabled: Config.Boolean('SCHEDULER_ENABLED').pipe(Config.withDefault(true)),
  /** Notification delivery (ADR 0018): `log` records sends; `smtp` emails through the firm's relay. */
  notify: Config.all({
    transport: Config.Literals(['log', 'smtp'], 'NOTIFY_TRANSPORT').pipe(
      Config.withDefault('log' as const),
    ),
    smtpHost: optionalString('SMTP_HOST'),
    smtpPort: Config.Port('SMTP_PORT').pipe(Config.withDefault(587)),
    /** true: implicit TLS (465). false: STARTTLS when the relay offers it. */
    smtpSecure: Config.Boolean('SMTP_SECURE').pipe(Config.withDefault(false)),
    smtpUser: optionalString('SMTP_USER'),
    smtpPassword: optionalRedacted('SMTP_PASSWORD'),
    from: optionalString('NOTIFY_FROM'),
  }),
});

export type AppConfig = Config.Success<typeof AppConfig>;

export class ConfigInvalid extends Data.TaggedError('ConfigInvalid')<{
  readonly message: string;
}> {}

/** Cross-field rules that a per-field decoder cannot express. */
export const validateConfig = (config: AppConfig): Effect.Effect<AppConfig, ConfigInvalid> => {
  const problems: Array<string> = [];
  if (config.nodeEnv === 'production' && config.authMode === 'dev') {
    problems.push('AUTH_MODE=dev cannot run with NODE_ENV=production.');
  }
  if (config.authMode === 'entra') {
    const { tenantId, clientId, clientSecret } = config.entra;
    if (!tenantId || !clientId || !clientSecret || !config.entra.flowSecret) {
      problems.push(
        'AUTH_MODE=entra needs ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET and AUTH_FLOW_SECRET.',
      );
    }
  }
  if (config.decisions.mode === 'live') {
    if (!config.decisions.apiKey) problems.push('DECISIONS_MODE=live needs DECISIONS_API_KEY.');
    if (!config.decisions.paidTierConfirmed) {
      problems.push(
        'DECISIONS_MODE=live needs DECISIONS_PAID_TIER_CONFIRMED=true (free tier may train on inputs).',
      );
    }
  }
  if (config.notify.transport === 'smtp' && (!config.notify.smtpHost || !config.notify.from)) {
    problems.push('NOTIFY_TRANSPORT=smtp needs SMTP_HOST and NOTIFY_FROM.');
  }
  if (config.telemetry.enabled && !config.telemetry.otlpEndpoint) {
    problems.push('TELEMETRY_ENABLED=true needs OTEL_EXPORTER_OTLP_ENDPOINT.');
  }
  return problems.length === 0
    ? Effect.succeed(config)
    : Effect.fail(new ConfigInvalid({ message: problems.join(' ') }));
};
