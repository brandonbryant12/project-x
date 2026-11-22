import { DecisionsDisabledLayer, DecisionsGoogleLayer, DecisionsMockLayer } from '@repo/ai';
import { layerFromUrl } from '@repo/db';
import { NodeHttpServer } from '@effect/platform-node';
import { Effect, Layer, Match, type Redacted } from 'effect';
import { FetchHttpClient, HttpRouter } from 'effect/http';
import { createServer } from 'node:http';
import { AuthenticatedLive } from '../auth/authenticated.ts';
import { EntraRoutes } from '../auth/entra.ts';
import { Sessions } from '../auth/sessions.ts';
import { NotificationsLive } from '../features/notifications/dispatcher.ts';
import { ALL_MOCK_RULES } from '../features/shared/advisory/question-sets.ts';
import { apiRoutes } from '../http/api-layer.ts';
import { HealthRoutes } from '../http/health.ts';
import { SecurityMiddleware } from '../http/security.ts';
import { staticSpaLayer } from '../http/static.ts';
import { SchedulerLive } from '../scheduler/sweeps.ts';
import { Background } from './background.ts';
import { ConfigInvalid, type AppConfig } from './config.ts';
import { NotifierLog, NotifierSmtp } from './notifier.ts';
import {
  ObservabilityLive,
  resolveTelemetryBinding,
  type TelemetryBinding,
} from './observability.ts';
import { Settings } from './settings.ts';

/**
 * Alchemy-inspired Infrastructure-as-Effects runtime plan.
 *
 * Cross-field config validation produces a strongly-typed discriminated union of
 * runtime resource bindings so every downstream Layer constructor exhaustively
 * matches guaranteed fields with zero defensive fallbacks.
 */
export type DecisionsBinding =
  | { readonly _tag: 'Disabled' }
  | { readonly _tag: 'Mock' }
  | { readonly _tag: 'GoogleLive'; readonly apiKey: Redacted.Redacted<string> };

export type NotifierBinding =
  | { readonly _tag: 'Log' }
  | {
      readonly _tag: 'Smtp';
      readonly host: string;
      readonly port: number;
      readonly secure: boolean;
      readonly user: string | undefined;
      readonly password: Redacted.Redacted<string> | undefined;
      readonly from: string;
    };

export type AuthBinding =
  | { readonly _tag: 'Dev' }
  | {
      readonly _tag: 'Entra';
      readonly tenantId: string;
      readonly clientId: string;
      readonly clientSecret: Redacted.Redacted<string>;
      readonly flowSecret: Redacted.Redacted<string>;
    };

export interface RuntimeStackPlan {
  readonly config: AppConfig;
  readonly auth: AuthBinding;
  readonly decisions: DecisionsBinding;
  readonly notifier: NotifierBinding;
  readonly telemetry: TelemetryBinding;
}

const resolveAuth = (config: AppConfig, problems: Array<string>): AuthBinding => {
  if (config.nodeEnv === 'production' && config.authMode === 'dev') {
    problems.push('AUTH_MODE=dev cannot run with NODE_ENV=production.');
  }
  if (config.authMode === 'dev') return { _tag: 'Dev' };
  const { tenantId, clientId, clientSecret, flowSecret } = config.entra;
  if (!tenantId || !clientId || !clientSecret || !flowSecret) {
    problems.push(
      'AUTH_MODE=entra needs ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET and AUTH_FLOW_SECRET.',
    );
    return { _tag: 'Dev' };
  }
  return { _tag: 'Entra', tenantId, clientId, clientSecret, flowSecret };
};

const resolveDecisions = (config: AppConfig, problems: Array<string>): DecisionsBinding => {
  if (config.decisions.mode === 'disabled') return { _tag: 'Disabled' };
  if (config.decisions.mode === 'mock') return { _tag: 'Mock' };
  if (!config.decisions.apiKey) problems.push('DECISIONS_MODE=live needs DECISIONS_API_KEY.');
  if (!config.decisions.paidTierConfirmed) {
    problems.push(
      'DECISIONS_MODE=live needs DECISIONS_PAID_TIER_CONFIRMED=true (free tier may train on inputs).',
    );
  }
  return config.decisions.apiKey
    ? { _tag: 'GoogleLive', apiKey: config.decisions.apiKey }
    : { _tag: 'Disabled' };
};

const resolveNotifier = (config: AppConfig, problems: Array<string>): NotifierBinding => {
  if (config.notify.transport === 'log') return { _tag: 'Log' };
  const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword, from } = config.notify;
  if (!smtpHost || !from) {
    problems.push('NOTIFY_TRANSPORT=smtp needs SMTP_HOST and NOTIFY_FROM.');
    return { _tag: 'Log' };
  }
  return {
    _tag: 'Smtp',
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    user: smtpUser,
    password: smtpPassword,
    from,
  };
};

/** Parse-don't-validate: resolves raw `AppConfig` into a sound `RuntimeStackPlan`. */
export const resolveRuntimePlan = (
  config: AppConfig,
): Effect.Effect<RuntimeStackPlan, ConfigInvalid> => {
  const problems: Array<string> = [];
  const auth = resolveAuth(config, problems);
  const decisions = resolveDecisions(config, problems);
  const notifier = resolveNotifier(config, problems);
  const telemetry = resolveTelemetryBinding(config, problems);
  return problems.length === 0
    ? Effect.succeed({ config, auth, decisions, notifier, telemetry })
    : Effect.fail(new ConfigInvalid({ message: problems.join(' ') }));
};

const decisionsLayerFromPlan = (binding: DecisionsBinding) =>
  Match.value(binding).pipe(
    Match.tag('Disabled', () => DecisionsDisabledLayer),
    Match.tag('Mock', () => DecisionsMockLayer(ALL_MOCK_RULES)),
    Match.tag('GoogleLive', ({ apiKey }) =>
      DecisionsGoogleLayer({ apiKey }).pipe(Layer.provide(FetchHttpClient.layer)),
    ),
    Match.exhaustive,
  );

const notifierLayerFromPlan = (binding: NotifierBinding) =>
  Match.value(binding).pipe(
    Match.tag('Log', () => NotifierLog),
    Match.tag('Smtp', (smtp) =>
      NotifierSmtp({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        user: smtp.user,
        password: smtp.password,
        from: smtp.from,
      }),
    ),
    Match.exhaustive,
  );

/** The HTTP API: every group's handlers plus the session middleware. */
const ApiLive = apiRoutes(AuthenticatedLive);

/** One declarative Effect Layer graph per process, built from the validated runtime plan. */
export const buildServerLayer = (plan: RuntimeStackPlan) => {
  const { config } = plan;
  const services = Layer.mergeAll(
    Layer.succeed(Settings, config),
    layerFromUrl({
      url: config.databaseUrl,
      migrate: config.migrateOnStart,
      ...(config.migrationsDir && { migrationsFolder: config.migrationsDir }),
    }),
    decisionsLayerFromPlan(plan.decisions),
    Background.layer,
  );
  const routes = Layer.mergeAll(
    ApiLive,
    HealthRoutes,
    EntraRoutes,
    staticSpaLayer(config.webDistDir),
    SecurityMiddleware,
  );
  const http = HttpRouter.serve(routes).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port: config.port })),
  );
  const notifications = NotificationsLive.pipe(Layer.provide(notifierLayerFromPlan(plan.notifier)));
  return Layer.mergeAll(http, SchedulerLive, notifications).pipe(
    Layer.provide(Sessions.layer),
    Layer.provideMerge(services),
    Layer.provide(ObservabilityLive(config, plan.telemetry)),
  );
};
