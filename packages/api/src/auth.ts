import type { GrantRole, PersonId, TenantId } from '@repo/domain';
import { Context } from 'effect';
import { HttpApiMiddleware, HttpApiSecurity } from 'effect/http-api';
import { Unauthorized } from './errors.ts';

export const SESSION_COOKIE = 'session';

/** The authenticated person behind a request. Loaded fresh per request (ADR 0014). */
export interface Actor {
  readonly tenantId: TenantId;
  readonly personId: PersonId;
  readonly displayName: string;
  readonly grants: ReadonlyArray<GrantRole>;
}

export class CurrentActor extends Context.Service<CurrentActor, Actor>()(
  '@repo/api/CurrentActor',
) {}

/**
 * Session-cookie authentication. Browsers send the cookie automatically, so the
 * client needs no middleware implementation.
 */
/** The session cookie as an HttpApi security scheme (also used to set the cookie). */
export const sessionSecurity = HttpApiSecurity.apiKey({ key: SESSION_COOKIE, in: 'cookie' });

export class Authenticated extends HttpApiMiddleware.Service<
  Authenticated,
  { provides: CurrentActor; requires: never }
>()('@repo/api/Authenticated', {
  security: { session: sessionSecurity },
  error: Unauthorized,
}) {}
