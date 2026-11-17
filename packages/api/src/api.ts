import { HttpApi, OpenApi } from 'effect/http-api';
import { AdminGroup } from './groups/admin.ts';
import { AuthGroup, SessionGroup } from './groups/auth.ts';
import { CatalogGroup } from './groups/catalog.ts';
import { DevelopmentGroup } from './groups/development.ts';
import { DirectoryGroup } from './groups/directory.ts';
import { HubGroup } from './groups/hub.ts';
import { ObservationsGroup } from './groups/observations.ts';
import { PeopleGroup } from './groups/people.ts';
import { RhythmGroup } from './groups/rhythm.ts';
import { SupportGroup } from './groups/support.ts';

/**
 * The HTTP contract, shared by the server (implementation) and the web app
 * (typed client). Served under `/api`. Browser-safe: no server imports.
 */
export class Api extends HttpApi.make('app')
  .add(AuthGroup)
  .add(SessionGroup)
  .add(SupportGroup)
  .add(CatalogGroup)
  .add(PeopleGroup)
  .add(DevelopmentGroup)
  .add(ObservationsGroup)
  .add(AdminGroup)
  .add(RhythmGroup)
  .add(HubGroup)
  .add(DirectoryGroup)
  .prefix('/api')
  .annotateMerge(OpenApi.annotations({ title: 'API' })) {}
