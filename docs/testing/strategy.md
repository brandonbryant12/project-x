# Testing strategy

Content Studio ended up with test bloat: duplicated suites, tests that pinned
copy or class names, and tests that mirrored implementation. Agents write
tests cheaply, so the risk here is **too many weak tests**, not too few. Every
test in this repository must protect a **named** invariant or user journey.
A test that would still pass if the behavior broke is noise, and should be
deleted.

## The layers, and what each is for

| Layer                                      | Runs on                                                   | Proves                                                                                                                                                                                              | Example                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Type & contract safety**                 | `tsc7` + Effect `Schema` + `HttpApi` + `oxlint`           | E2E client/server contracts, branded IDs, exhaustive `Match` / XState states, zero unsafe casts (~1.5s)                                                                                             | `pnpm typecheck`, `packages/api/src/api.test.ts`                                                                       |
| **Domain & UI state machines**             | Pure functions + XState 5 + Effect TEA (`pnpm test:fast`) | Rules (lifecycles, eligibility, visibility, badge criteria, privacy screen) and complex UI state (Give feedback flow, debounced autosave, StrictMode actor lifecycle, Ask for feedback TEA) (~0.5s) | `packages/domain/src/**/*.test.ts`, `apps/web/src/**/*.test.ts`                                                        |
| **Database integrity**                     | PGlite with the real migrations                           | Rules the database itself must refuse to break: provenance FKs, append-only triggers, frozen attestations, tenancy, non-overlap                                                                     | `packages/db/src/integrity.test.ts`, `integrity-hub.test.ts`                                                           |
| **API scenarios**                          | In-memory `HttpApiTest` client over PGlite with mock AI   | User journeys end to end through real handlers, use cases and SQL (no browser, no Docker)                                                                                                           | `apps/server/src/**/*.scenario.test.ts`                                                                                |
| **Architecture**                           | Source and schema metadata                                | Only signing writes credit; every table is tenant-scoped; a feature imports only itself and `features/shared` (a debt list records today's exceptions); every table has a writer or a stated reason | `apps/server/src/architecture.test.ts`                                                                                 |
| **Docs**                                   | Markdown and source                                       | Every cited path and link exists; no banned terms; the ADR index matches the directory                                                                                                              | `scripts/docs-check.mjs` (`pnpm docs:check`)                                                                           |
| **Agent-driven behavioral & visual QA**    | Running app + `.claude/skills/qa/SKILL.md`                | End-to-end interactive flows, copy clarity, layout, light/dark, and mobile ergonomics — verified by an agent using the QA skill rather than brittle deterministic Playwright E2E tests              | `.claude/skills/qa/SKILL.md`, `pnpm screenshots`                                                                       |
| **Postgres lane** (`pnpm test:pg`, CI job) | Real Postgres 18                                          | Concurrency (advisory locks, version conflicts) and anything PGlite can't model                                                                                                                     | `scripts/test-pg.mjs` runs the integrity and scenario suites against `TEST_DATABASE_URL`, each in a throwaway database |

Most verification happens at **compile time** (TypeScript 7 + Effect `Schema` +
`HttpApi` + XState 5) and in **sub-second pure tests** (`pnpm check:fast`).
We deliberately **avoid deterministic Playwright E2E test suites** — they couple
to copy/DOM structure and flake under UI iteration. Instead, interactive flows
and visual polish are verified by an agent running the [QA skill](../../.claude/skills/qa/SKILL.md)
against the live app. There are no DOM-rendered component tests; frontend tests
cover pure XState 5 state machines and Effect TEA reducers only.

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

## What "safe" means in an agentic codebase

Agents will refactor aggressively. The safety net that matters is the set of
tests that fail **when a rule breaks**, not when code moves. So:

- The rules that would hurt people (self-credit, ghost-written attestations,
  cross-tenant leaks, AI clearing anything, PII leaving) are enforced in
  **two places**: the domain or use case, _and_ the database or a scenario
  test. Either one stops a regression.
- Refactors should mostly touch no tests. If a refactor forces test changes,
  the tests were coupled to implementation, so fix the tests.
