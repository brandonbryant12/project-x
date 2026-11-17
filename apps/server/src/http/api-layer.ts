import { Api, type Authenticated } from '@repo/api';
import { Layer } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { AdminHandlers } from '../features/admin/handlers.ts';
import { CatalogHandlers } from '../features/catalog/handlers.ts';
import { DevelopmentHandlers } from '../features/development/handlers.ts';
import { DirectoryHandlers } from '../features/directory/handlers.ts';
import { HubHandlers } from '../features/hub/handlers.ts';
import { ObservationsHandlers } from '../features/observations/handlers.ts';
import { PeopleHandlers } from '../features/people/handlers.ts';
import { RhythmHandlers } from '../features/rhythm/handlers.ts';
import { SupportHandlers } from '../features/support/handlers.ts';
import { AuthHandlers, SessionHandlers } from './auth-handlers.ts';

/** Every HttpApi group's handlers (without the auth middleware implementation). */
export const ApiHandlers = Layer.mergeAll(
  AuthHandlers,
  SessionHandlers,
  SupportHandlers,
  CatalogHandlers,
  PeopleHandlers,
  DevelopmentHandlers,
  ObservationsHandlers,
  AdminHandlers,
  RhythmHandlers,
  HubHandlers,
  DirectoryHandlers,
);

/** The served API: routes + handlers + the given auth middleware. */
export const apiRoutes = <E, R>(authenticated: Layer.Layer<Authenticated, E, R>) =>
  HttpApiBuilder.layer(Api, { openapiPath: '/api/openapi.json' }).pipe(
    Layer.provide(ApiHandlers),
    Layer.provide(authenticated),
  );
