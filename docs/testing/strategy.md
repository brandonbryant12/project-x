# Testing strategy

Content Studio ended up with test bloat: duplicated suites, tests that pinned
copy or class names, and tests that mirrored implementation. Agents write
tests cheaply, so the risk here is **too many weak tests**, not too few. Every
test in this repository must protect a **named** invariant or user journey.
A test that would still pass if the behavior broke is noise, and should be
deleted.

## The layers, and what each is for

| Layer                                      | Runs on                                                                                               | Proves                                                                                                                                                                                              | Example                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Domain tables**                          | Pure functions                                                                                        | Rules: lifecycles, eligibility, visibility, badge criteria, privacy screen                                                                                                                          | `packages/domain/src/**/*.test.ts`                                                                                     |
| **Database integrity**                     | PGlite with the real migrations                                                                       | Rules the database itself must refuse to break: provenance FKs, append-only triggers, frozen attestations, tenancy, non-overlap                                                                     | `packages/db/src/integrity.test.ts`, `integrity-hub.test.ts`                                                           |
| **API scenarios**                          | In-memory `HttpApiTest` client over PGlite with mock AI                                               | User journeys end to end through real handlers, use cases and SQL                                                                                                                                   | `apps/server/src/**/*.scenario.test.ts`                                                                                |
| **Architecture**                           | Source and schema metadata                                                                            | Only signing writes credit; every table is tenant-scoped; a feature imports only itself and `features/shared` (a debt list records today's exceptions); every table has a writer or a stated reason | `apps/server/src/architecture.test.ts`                                                                                 |
| **Docs**                                   | Markdown and source                                                                                   | Every cited path and link exists; no banned terms; the ADR index matches the directory                                                                                                              | `scripts/docs-check.mjs` (`pnpm docs:check`)                                                                           |
| **Contract**                               | OpenAPI generation                                                                                    | The HTTP contract is well-formed and unique                                                                                                                                                         | `packages/api/src/api.test.ts`                                                                                         |
| **Feature map**                            | `docs/feature-map/features.json` and the repository                                                   | Every feature's cited code, endpoints, tests, playbooks and commands exist, and every route, endpoint, test file and journey check is claimed by a feature                                          | `tools/verify/lib/check.mjs` (`pnpm verify check`, in `pnpm check` and CI)                                             |
| **API journey checks**                     | The real server and its PGlite database in the isolated QA environment (`pnpm verify env`), over HTTP | A changed journey works against a running server with seeded personas, refusals included; evidence is written per run                                                                               | `tools/verify/journeys/*.mjs` (`pnpm verify run <id> --kind api`)                                                      |
| **Visual and QA**                          | Real app (Postgres + Vite)                                                                            | UI quality and flows, judged by an agent looking at screenshots                                                                                                                                     | `pnpm --filter @repo/web screenshots`; the QA skill                                                                    |
| **Postgres lane** (`pnpm test:pg`, CI job) | Real Postgres 18                                                                                      | Concurrency (advisory locks, version conflicts) and anything PGlite can't model                                                                                                                     | `scripts/test-pg.mjs` runs the integrity and scenario suites against `TEST_DATABASE_URL`, each in a throwaway database |

Most tests are domain tables, plus a small number of scenario tests that each
cover a whole journey. There are few component tests. A component test is
justified only when it encodes interaction logic that isn't visible in a
screenshot, such as autosave debounce or keyboard shortcuts.

## Rules

1. **Name the invariant.** Every test file starts with a comment naming what
   it protects. Invariants live in [invariants.md](invariants.md), and each
   one maps to one primary test.
2. **Extend, don't add.** Prefer adding a step or assertion to an existing
   scenario over writing a new file. Write a new scenario only for a new
   journey or a new failure mode.
3. **Test behavior at the boundary that owns it.**
   - Eligibility is tested in the domain, not again through HTTP.
   - The HTTP test checks that a refusal arrives as the right tagged error,
     once.
4. **No mirrors.** Don't assert copy, class names, query keys, or the exact
   SQL. Don't mock what you own; use PGlite and the mock AI layer.
5. **Real data shapes.** Scenario tests start from the seed's world or a small
   fixture built through the use cases, never hand-assembled rows that bypass
   the rules. `integrity.test.ts` is the one place that writes raw rows,
   because it tests the database's refusals.
6. **Delete superseded tests in the same change.** When a broader test
   replaces a narrow one, remove the narrow one.
7. **Deterministic.** Time comes from the Effect `Clock` (use `TestClock`),
   IDs are random but never asserted, and the AI is the deterministic mock.
8. **Fast by default.** The default suite needs no Docker and no network.
   Slow or environment-dependent lanes are opt-in and named as such.
9. **Never switch off an integrity control.** No test disables or drops a
   trigger or constraint to build a state the rules forbid. Build legacy rows
   by migrating, as `packages/db/src/migration-compat.test.ts` does, or test
   the logic as a pure function over the facts.

## What "safe" means in an agentic codebase

Agents will refactor aggressively. The safety net that matters is the set of
tests that fail **when a rule breaks**, not when code moves. So:

- The rules that would hurt people (self-credit, ghost-written attestations,
  cross-tenant leaks, AI clearing anything, PII leaving) are enforced in
  **two places**: the domain or use case, _and_ the database or a scenario
  test. Either one stops a regression.
- Refactors should mostly touch no tests. If a refactor forces test changes,
  the tests were coupled to implementation, so fix the tests.
