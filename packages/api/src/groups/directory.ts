import { DirectoryExceptionId, PersonId } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Conflict, Forbidden, InvalidTransition, NotFound, Unprocessable } from '../errors.ts';
import {
  DepartInput,
  DepartureResult,
  DirectoryExceptionView,
  DirectoryImportInput,
  DirectoryImportResult,
} from '../models/index.ts';

/**
 * The HR directory (ADR 0006): CSV import with a dry-run diff, the exceptions
 * queue, and deprovisioning a leaver. Tenant admins only; every applied change
 * is audited.
 */
export class DirectoryGroup extends HttpApiGroup.make('directory')
  .add(
    HttpApiEndpoint.post('importDirectory', '/admin/directory/import', {
      payload: DirectoryImportInput,
      success: DirectoryImportResult,
      error: [Forbidden, Unprocessable, Conflict, InvalidTransition],
    }),
    HttpApiEndpoint.get('exceptions', '/admin/directory/exceptions', {
      query: {
        status: Schema.optional(Schema.Literals(['open', 'acknowledged', 'resolved', 'all'])),
      },
      success: Schema.Array(DirectoryExceptionView),
      error: Forbidden,
    }),
    HttpApiEndpoint.post('acknowledgeException', '/admin/directory/exceptions/:id/acknowledge', {
      params: { id: DirectoryExceptionId },
      success: DirectoryExceptionView,
      error: [Forbidden, NotFound, InvalidTransition, Conflict],
    }),
    HttpApiEndpoint.post('departPerson', '/admin/people/:id/depart', {
      params: { id: PersonId },
      payload: DepartInput,
      success: DepartureResult,
      error: [Forbidden, NotFound, Conflict, Unprocessable, InvalidTransition],
    }),
  )
  .middleware(Authenticated) {}
