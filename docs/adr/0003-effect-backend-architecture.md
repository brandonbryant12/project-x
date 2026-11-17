# ADR 0003: Effect 4 for the backend: HttpApi, use cases, tagged errors, one layer graph

- Status: Accepted
- Date: 2026-11-16

## Context

Content Studio runs on Effect 4 (HttpApi, Schema, Layers, `@effect/sql-pg`).
Its most reusable ideas are:

- a use-case wrapper that resolves the current actor and opens a span;
- tagged errors that carry their HTTP mapping;
- one handler calling one use case, with serialization at the edge;
- one layer graph per process;
- environment configuration decoded with Schema.

Its regrets were redundant transaction plumbing, a hand-written client tree
layered over HttpApi, and media-specific registries. Effect 4.1.4 is current
as of this ADR.

## Decision

**The server is an Effect 4 application. Its HTTP contract is an `HttpApi`
defined in `packages/api`, implemented by handlers in `apps/server`. Each
handler calls exactly one use case.**

- **Features** live in `apps/server/src/features/<context>/`. Each feature has
  `use-cases/` (one exported use case per file), `repo.ts` (queries) and
  `serialize.ts` (domain → API).
- **Use cases** are defined with `defineUseCase({ name, run })`. The wrapper
  resolves `CurrentActor` (tenant, person, grants) and opens a span named
  `useCase.<name>`. A use case:
  - authorizes before it mutates;
  - returns domain data;
  - fails with tagged errors, never by throwing.
- **Errors** are `Schema.TaggedErrorClass` classes in `packages/api` with an
  HTTP status annotation, so `HttpApi` encodes them automatically. Missing and
  not-visible resources both return 404 to hide what exists. A broken
  invariant is a defect (500), not an expected error.
- **Services** are `Context.Service` classes. Per-request values, such as the
  current actor, are provided by middleware.
- **Transactions:** the shared `SqlClient` transaction is the only mechanism.
  Drizzle's Effect driver runs on the same client, so repositories called
  inside `Db.transaction` join the transaction automatically. Never hold a
  transaction open across a network call to an AI provider.
- **Configuration** is one Schema-decoded `Config` per app. Secrets are
  `Redacted`, and only the config module reads `process.env`.
- **Composition:** each process builds one `Layer` graph. The only
  `runPromise`/`runMain` calls are at entry points.

## Alternatives considered

- **NestJS or Fastify with Zod.** Familiar, but we lose typed errors,
  dependency injection that the type system checks, and a contract shared
  with the browser.
- **tRPC or oRPC.** Content Studio migrated _off_ oRPC to HttpApi. A single
  schema system (Effect Schema) used from the database to the browser is
  worth more.
- **Copy Content Studio's run/attempt/job/revision spine.** It solves paid,
  non-idempotent media generation. Coaching flows are plain transactional
  CRUD plus lifecycles.

## Consequences

- Agents can find any behavior from the URL: `HttpApi` group → handler →
  use case.
- Effect is the steepest learning curve in the stack. `AGENTS.md` keeps the
  idioms short and points at canonical examples.
- Effect 4 APIs are still moving. Before using a version-sensitive API, check
  the installed source under `node_modules/effect/src`.

## Amendment (2026-11-16): the use-case idiom as built

The code did not adopt two details above. This records what it does instead.

- There is no `defineUseCase` wrapper. A use case is
  `Effect.fn('useCase.<name>')(function* (...) { ... })` and reads the caller
  with `yield* CurrentActor`. The span name is the same.
- Features are not split into `repo.ts` and `serialize.ts`. Each feature has
  `handlers.ts`, its use cases (one file, or a `use-cases/` folder), and
  `views.ts` for reads. Queries use the `Db` service directly.
- The review found the feature layout inconsistent between features. Making it
  one layout is part of this build round. [`AGENTS.md`](../../AGENTS.md) is
  the current guide.
