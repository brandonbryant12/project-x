# ADR 0002: pnpm + Turborepo monorepo on Node 24 with a small, layered package set

- Status: Accepted
- Date: 2026-11-16

## Context

Content Studio's pnpm and Turborepo monorepo has worked well. It also grew
packages whose boundaries had to be retrofitted later, chiefly the
contracts/db split in its ADR 0016. A new product can start with the boundary
in the right place and with fewer packages.

Facts checked on 2026-11-16:

- Node 24 is the active LTS line.
- pnpm 12 supports catalogs and `allowBuilds`.
- TypeScript 7.0 (the native Go compiler) ships only `tsc` and no JS compiler
  API, so editor plugins and AST tools still need TypeScript 6.

## Decision

**The repository is a pnpm 12 workspace orchestrated by Turborepo on Node 24
LTS. Packages are layered so that browser code never depends on server
code.**

```
packages/domain   Pure domain: Effect Schemas, branded IDs, lifecycles (XState),
                  policies (eligibility, visibility), scoring. Browser-safe. No I/O.
packages/api      HttpApi contract: endpoints, payload/response schemas, API errors.
                  Browser-safe. Depends only on domain.
packages/db       Drizzle tables, migrations, Db service, test database helpers.
packages/ai       Provider services: Decisions API and LLM, plus mock layers.
packages/ui       Design system: tokens, shadcn/Radix primitives, shared components.
apps/server       Effect HTTP server: features (use cases + repos), auth, handlers,
                  scheduler, runtime composition. Serves the built SPA in production.
apps/web          React SPA.
tools/*           Shared tsconfig and similar configuration.
```

Dependency direction: `web → api → domain` and `server → api, db, ai, domain`.
Nothing imports from `apps/*`. `packages/domain` imports nothing from the
workspace.

Toolchain:

- **TypeScript:** `typescript` is TS 6 (`@typescript/typescript6`), for the
  editor, the Effect language service and AST tools. `typescript-7`
  (`typescript@7`) provides a fast native `tsc` for `pnpm typecheck`.
- **Linting and formatting:** oxlint and oxfmt, plus knip for dead code.
- **Tests:** Vitest 4 with `@effect/vitest`.
- **Shared dependency versions** live in the `pnpm-workspace.yaml` catalog.
- **Workspace package imports:** internal packages export their TypeScript
  sources directly (`exports` → `./src/*.ts`). There is no build step between
  workspace packages; only the apps build.

## Alternatives considered

- **Bun workspaces.** Faster installs, but the Effect, Vitest and Drizzle
  tooling and our Docker and CI knowledge are all centred on Node and pnpm.
- **Nx.** More power than we need, and more configuration for agents to learn.
- **Copy Content Studio's package set** (`contracts`, `studio`, `platform`,
  `queue`, `storage`, ...). Those packages solve media-generation problems we
  do not have.
- **Build every package to `dist`.** That costs a build step and stale-output
  bugs for no benefit in a private monorepo.

## Consequences

- One `pnpm check` runs format, lint, knip, typecheck and tests.
- Because packages export source, both app bundlers (Vite and tsdown) compile
  workspace TypeScript.
- If `apps/server/src/features` grows large enough to be needed by a second
  process, such as a worker, move features into a `packages/core` package.
  Do not add a package before there is a second consumer.

## Amendment (2026-11-16)

- The workspace scope is `@repo/*`, not product-specific.
- There are **no file-length lint caps**. Organization follows reasons to
  change. See [decision-making § 4](../engineering/decision-making.md).
- A supply-chain gate, `minimumReleaseAge: 4320` (3 days), applies to every
  resolved version.
