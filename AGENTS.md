# Agent guide

This is a TypeScript monorepo for an internal skills-development product for a
financial-services firm. Leaders, coaches and coachees develop skills through
real work. Credit is posted **only** when an eligible observer signs an
observation. Read [CONTEXT.md](CONTEXT.md) for the vocabulary before you name
anything.

## How to work here

- Carry a request through to working, verified code. Decide routine things
  yourself and escalate per the [decision framework](docs/engineering/decision-making.md).
  It covers what needs an ADR, what needs a human, and what needs a domain
  expert.
- Read the owning code and docs first. Prefer Effect, `@alchemy.run/domain`,
  Drizzle, XState and the platform over new abstractions.
- Keep changes focused, and preserve unrelated edits.
- Report outcomes plainly, including what you did **not** verify.

## Where things live

| Concern                                                                                       | Location                                                               |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Event-sourced domain model (`CoachingModel`: aggregates, views, policies, projections)        | `packages/domain/src/model/` (pure, browser-safe, ADR 0023)            |
| Domain rules: lifecycles (XState), eligibility, visibility, scoring, catalog insights, screen | `packages/domain/src/` (pure, browser-safe, no I/O)                    |
| Formal verification: `Domain.verify`, `Story.make`, exhaustive BFS & ledger proofs            | `packages/domain/src/verification/formal.test.ts`                      |
| HTTP contract (HttpApi groups, models, errors)                                                | `packages/api/src` (browser-safe)                                      |
| Schema, 2-file baseline migrations (`init` + `integrity`), retention, test DB                 | `packages/db` (see [data model](docs/architecture/data-model.md))      |
| AI providers (Gemini Decisions: google/mock/disabled)                                         | `packages/ai`                                                          |
| Use cases, domain journal (`features/shared/domain-journal.ts`), views, handlers, auth, seed  | `apps/server/src` (`features/<context>/`)                              |
| Design system                                                                                 | `packages/ui` and [`apps/web/DESIGN.md`](apps/web/DESIGN.md)           |
| Web app (decoupled from `@alchemy.run/domain` behind `@repo/api`)                             | `apps/web/src` (routes, features, `lib/api.ts`)                        |
| Auto-generated architecture diagrams (enforced zero-drift in `pnpm docs:check`)               | `docs/architecture/domain-model.md`, `docs/architecture/lifecycles.md` |
| Deployment Helm chart, Vault secrets matrix, and Jenkins SCM/YAML templates                   | `helm/`, `jenkins/`                                                    |
| Decisions and their reasons                                                                   | `docs/adr/`                                                            |

Dependency direction: `web → api → domain` and `server → api, db, ai, domain`.
`domain` imports nothing from the workspace.

## Rules that are not negotiable

These come from the [domain model](docs/product/domain-model.md) and the ADRs.
The database enforces most of them, and so do tests.

1. **Credit only from SIGN.** Only `signObservation` writes `credit_entry`. The
   ledger, `audit_event`, `domain_event`, and published catalog versions are
   append-only (enforced by database triggers).
2. **Raw facts are separate from derived awarding rules (ADR 0023).** Emit
   immutable, zero-PII domain facts through `CoachingModel` and journal them
   atomically via `apps/server/src/features/shared/domain-journal.ts`. Badge
   and credit criteria stay pure and configurable per tenant so future rule
   changes never require destructive rewrites.
3. **Lifecycles are XState machines** in `packages/domain/src/lifecycles`.
   Change state only through `decide()`, which combines policy (_who_) with
   the machine (_whether_), and write an audit event in the same transaction.
   The UI renders buttons only from a view's `actions` array.
4. **Tenancy is structural.** Every query filters by `actor.tenantId`.
   Composite foreign keys make cross-tenant rows impossible; keep it that way.
5. **AI may hold or nudge, never clear.** Every check writes an explainable
   `advisory_check`. Never send client identifiers to a model, and never log
   provider inputs or outputs (ADR 0008, 0012, 0015). Voice-to-note dictation
   runs strictly on-device in the browser and never sends audio off-device
   (ADR 0024).
6. **No client PII.** Only opaque `client_ref` values. Narratives and reasons
   are purgeable content; facts, `audit_event`, and `domain_event` rows are
   never allowed to carry narrative prose or PII.
7. **Config is read only in `apps/server/src/platform/config.ts`.** Secrets stay
   `Redacted`.

## Effect idioms used here

- Write a use case as `Effect.fn('useCase.name')(function* (...) { ... })`. Get
  the caller from `yield* CurrentActor`. Fail with the tagged errors in
  `@repo/api` and never throw.
- Handlers call one use case or view, then `.pipe(apiErrorsOnly)`. Declared API
  errors pass through; anything else becomes a 500.
- Wrap multi-row writes in `transactionally(...)`. Repositories using `Db` join
  the transaction automatically. Never call an AI provider inside a
  transaction; use `afterCommit(...)`.
- For version-sensitive APIs, read the installed source in
  `node_modules/effect/src`, `node_modules/@alchemy.run/domain/src`, and the
  guides in `node_modules/effect/ai-docs`.

## Commands

Install pnpm 12 globally first (`npm i -g pnpm@12`); Node 24 is set in `.nvmrc`.

```bash
pnpm install
pnpm db:up                 # Postgres 18 in Docker on :5442
cp apps/server/.env.example apps/server/.env
pnpm db:reset              # migrate + seed the fictional Northwind tenant
pnpm dev                   # API :4400, web :5400 (sign in as any persona)
pnpm docs:diagrams         # regenerate Mermaid diagrams from lifecycles & CoachingModel
pnpm check                 # format, lint, typecheck, test, knip, docs:check (incl. diagram drift)
pnpm --filter @repo/web screenshots   # visual review (API + web running)
```

## Verifying your change

Follow the [testing strategy](docs/testing/strategy.md):

- Prove behavior through `@alchemy.run/domain` verification (`Domain.verify`,
  `Story.make`, `formal.test.ts`), domain tables, PGlite scenario tests, or a
  database integrity test.
- Name the invariant a new test protects in
  [invariants](docs/testing/invariants.md). If it protects nothing new, do not
  add it.
- After any lifecycle or `CoachingModel` edit, run `pnpm docs:diagrams` so the
  checked-in Mermaid diagrams stay in sync (`pnpm docs:check` enforces this).
- For UI work, run the screenshot loop and look at the images.
- For a flow, run the [QA skill](.claude/skills/qa/SKILL.md) and file its
  report.
