import { PersonId } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Forbidden, NotFound } from '../errors.ts';
import { Persona, SessionView } from '../models/index.ts';

/** Unauthenticated endpoints. Entra redirects are plain routes in the server. */
export class AuthGroup extends HttpApiGroup.make('auth')
  .add(
    HttpApiEndpoint.get('devPersonas', '/dev/personas', {
      success: Schema.Array(Persona),
      error: Forbidden,
    }),
    HttpApiEndpoint.post('devSignIn', '/dev/sign-in', {
      payload: Schema.Struct({ personId: PersonId }),
      success: HttpApiSchema.NoContent,
      error: [Forbidden, NotFound],
    }),
    HttpApiEndpoint.post('signOut', '/sign-out', { success: HttpApiSchema.NoContent }),
  )
  .prefix('/auth') {}

export class SessionGroup extends HttpApiGroup.make('session')
  .add(HttpApiEndpoint.get('me', '/session', { success: SessionView }))
  .middleware(Authenticated) {}
