import { PersonId } from '@repo/domain';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Conflict, Forbidden, InvalidTransition, NotFound, Unprocessable } from '../errors.ts';
import {
  DepartInput,
  DepartureResult,
  DirectoryImportInput,
  DirectoryImportResult,
} from '../models/index.ts';

/**
 * The HR directory (ADR 0006): CSV import with a dry-run diff and findings,
 * and deprovisioning a leaver. Tenant admins only; every applied change
 * is audited.
 */
export class DirectoryGroup extends HttpApiGroup.make('directory')
  .add(
    HttpApiEndpoint.post('importDirectory', '/admin/directory/import', {
      payload: DirectoryImportInput,
      success: DirectoryImportResult,
      error: [Forbidden, Unprocessable, Conflict, InvalidTransition],
    }),
    HttpApiEndpoint.post('departPerson', '/admin/people/:id/depart', {
      params: { id: PersonId },
      payload: DepartInput,
      success: DepartureResult,
      error: [Forbidden, NotFound, Conflict, Unprocessable, InvalidTransition],
    }),
  )
  .middleware(Authenticated) {}
