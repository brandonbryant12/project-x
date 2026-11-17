# ADR 0010: React + TanStack Router/Query, with a typed client derived from the HttpApi

- Status: Accepted
- Date: 2026-11-16

## Context

Content Studio's web app works well with React, TanStack Router, TanStack
Query, Tailwind v4 and shadcn/Radix. Its regrets were:

- a hand-written client tree that duplicates each HttpApi endpoint;
- a 5,500-line global CSS file;
- hand-maintained Vitest aliases;
- no visual review loop.

The owner wants Effect and TanStack Query to work together on the front end.

## Decision

**The web app is a Vite + React 19 SPA using TanStack Router (file-based
routes) and TanStack Query. The API client is `HttpApiClient.make(Api)` from
`packages/api`, wrapped by a generic helper that derives TanStack Query
options and keys from the group and endpoint names. Nothing is hand-mapped
per endpoint.**

- `apps/web/src/lib/api.ts` exports `api.query(group, endpoint, request)` and
  `api.mutation(group, endpoint)`. The query key is
  `[group, endpoint, request]`. Errors arrive as the tagged errors declared
  in `packages/api`.
- Effect runs on the client for the HttpApi client, Schema decoding and form
  validation (`Schema.toStandardSchemaV1` with TanStack Form). Components do
  not use Effect for UI orchestration.
- Route files stay thin: search-param schema, loader prefetch, component.
  Features live in `apps/web/src/features/<area>/`.
- Styling:
  - Tailwind v4 with semantic tokens defined once in
    `packages/ui/src/styles/tokens.css`. That file holds tokens only, never
    feature classes.
  - Components come from `packages/ui` (shadcn on Radix, `cva`).
  - The design contract for agents is `apps/web/DESIGN.md`.
- Lifecycle buttons render from the `actions` array the server returns
  ([ADR 0005](./0005-explicit-lifecycles-with-xstate.md)). Status labels and
  tones come from one `lifecycle-presentation.ts` map per entity.
- Visual review: `pnpm --filter web screenshots` runs Playwright through the
  key screens as each seeded persona, in light and dark themes and at desktop
  and phone widths. Agents look at the output before declaring UI work done.

## Alternatives considered

- **`@effect/atom-react`** (Effect-native reactive state). Promising, but
  TanStack Query's cache, devtools and agent familiarity win today. The
  generic adapter keeps a migration cheap later.
- **The third-party `effect-query` adapter.** It is small, but our adapter is
  about 60 lines that we own.
- **Next.js / React Server Components.** This is an authenticated, internal,
  interaction-heavy app. An SPA served by the API server is simpler to run
  and secure.

## Consequences

- The browser bundle includes the API schemas, which is acceptable at this
  size. Watch the bundle budget.
- Renaming an endpoint changes its query key automatically. Cache
  invalidation targets group-level prefixes.

## Amendment (2026-11-16)

- The workspace scope is `@repo/*`, and the API class is `Api`. Product names
  appear only in configuration and copy, so a rename is cheap.
