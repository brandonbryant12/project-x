import { DecisionsDisabledLayer, DecisionsGoogleLayer, DecisionsMockLayer } from '@repo/ai';
import { layerFromUrl } from '@repo/db';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { FetchHttpClient, HttpRouter } from 'effect/http';
import { createServer } from 'node:http';
import { AuthenticatedLive } from './auth/authenticated.ts';
import { EntraRoutes } from './auth/entra.ts';
import { Sessions } from './auth/sessions.ts';
import { ALL_MOCK_RULES } from './features/shared/advisory/question-sets.ts';
import { apiRoutes } from './http/api-layer.ts';
import { HealthRoutes } from './http/health.ts';
import { SecurityMiddleware } from './http/security.ts';
import { staticSpaLayer } from './http/static.ts';
import { Background } from './platform/background.ts';
import { AppConfig, validateConfig, type AppConfig as Config } from './platform/config.ts';
import { ObservabilityLive } from './platform/observability.ts';
import { Settings } from './platform/settings.ts';
import { NotificationsLive } from './features/notifications/dispatcher.ts';
import { NotifierLog, NotifierSmtp } from './platform/notifier.ts';
import { SchedulerLive } from './scheduler/sweeps.ts';

/** The HTTP API: every group's handlers plus the session middleware. */
export const ApiLive = apiRoutes(AuthenticatedLive);

const decisionsLayer = (config: Config) => {
  switch (config.decisions.mode) {
    case 'disabled':
      return DecisionsDisabledLayer;
    case 'mock':
      return DecisionsMockLayer(ALL_MOCK_RULES);
    case 'live': {
      // validateConfig guarantees the key; fall back to disabled rather than guess.
      const apiKey = config.decisions.apiKey;
      return apiKey
        ? DecisionsGoogleLayer({ apiKey }).pipe(Layer.provide(FetchHttpClient.layer))
        : DecisionsDisabledLayer;
    }
  }
};

/** One layer graph per process (ADR 0003). */
export const makeServer = (config: Config) => {
  const services = Layer.mergeAll(
    Layer.succeed(Settings, config),
    layerFromUrl({
      url: config.databaseUrl,
      migrate: config.migrateOnStart,
      ...(config.migrationsDir && { migrationsFolder: config.migrationsDir }),
    }),
    decisionsLayer(config),
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
  // Email when configured (ADR 0018); otherwise the log transport records sends.
  const notifier =
    config.notify.transport === 'smtp' && config.notify.smtpHost && config.notify.from
      ? NotifierSmtp({
          host: config.notify.smtpHost,
          port: config.notify.smtpPort,
          secure: config.notify.smtpSecure,
          user: config.notify.smtpUser,
          password: config.notify.smtpPassword,
          from: config.notify.from,
        })
      : NotifierLog;
  const notifications = NotificationsLive.pipe(Layer.provide(notifier));
  return Layer.mergeAll(http, SchedulerLive, notifications).pipe(
    Layer.provide(Sessions.layer),
    Layer.provideMerge(services),
    Layer.provide(ObservabilityLive(config)),
  );
};

const main = Effect.gen(function* () {
  const config = yield* validateConfig(yield* AppConfig);
  yield* Effect.logInfo(
    `server starting on :${config.port} (auth=${config.authMode}, decisions=${config.decisions.mode})`,
  );
  return yield* Layer.launch(makeServer(config));
});

main.pipe(NodeRuntime.runMain);
