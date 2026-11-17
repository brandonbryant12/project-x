# ADR 0014: First-party cookie sessions; Entra via `openid-client`; a dev persona sign-in

- Status: Accepted
- Date: 2026-11-16
- Builds on: [ADR 0006](./0006-identity-entra-roles-and-relationships.md), [ADR 0011](./0011-single-deployable-with-in-process-scheduler.md)

## Context

Content Studio uses better-auth with a Microsoft provider. That works, but it
brings:

- a second database pool, because better-auth runs outside Effect;
- bearer-token plumbing for its cross-origin setup;
- hooks for role sync.

Coaching Catalyst is same-origin
([ADR 0011](./0011-single-deployable-with-in-process-scheduler.md)), needs
exactly one production identity provider (Entra), and needs an easy way for
developers and agents to sign in as each seeded persona.

## Decision

**The server owns sessions. Entra sign-in uses the OpenID-certified
`openid-client` library (authorization code with PKCE). Sessions are opaque
random tokens in an HttpOnly, Secure, SameSite=Lax cookie; only their SHA-256
hash is stored in `session`. In development and test, a dev persona sign-in
creates a session for any seeded person.**

- On callback:
  1. Validate the ID token (issuer `tid` → tenant, audience, nonce).
  2. Upsert `person` by Entra object ID (`oid`).
  3. Mirror the `roles` claim into `role_grant`.
  4. Create a session.
- Sessions expire after 12 hours idle and 7 days absolute. Signing out deletes
  the row.
- CSRF:
  - SameSite=Lax;
  - mutations must be JSON with an `x-requested-with` header;
  - the server rejects state-changing requests whose `Origin` is not the
    app's own origin.
- `AUTH_MODE` takes one of two values:
  - `entra` (production);
  - `dev`, which enables `POST /api/auth/dev/sign-in` and the persona picker on
    the sign-in page.

  `dev` mode cannot start when `NODE_ENV=production`.

- Authorization never trusts the session alone. `CurrentActor` is loaded
  from `person` and `role_grant` on each request.

## Alternatives considered

- **better-auth** (the Content Studio choice). It is a good library. Here it
  would add a second pool, an adapter layer and hooks just to read one claim.
  We would still need custom persona sign-in.
- **Bearer tokens in browser memory.** Only needed for cross-origin
  deployments.
- **An auth SaaS** (Auth0, Clerk). It adds another processor of employee data
  for a firm that already runs Entra.

## Consequences

- About 250 lines of auth code that we own. _Planned:_ it is to be covered by scenario tests (not yet written):
  sign-in, expiry, sign-out, tenant mismatch, role mirroring, CSRF rejection.
- Adding another identity provider later means another `openid-client`
  configuration, not a new auth framework.
