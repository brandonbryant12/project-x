# Architecture decision records

An ADR records a decision that is costly to reverse, together with the
reasoning behind it. Each ADR describes the situation on its decision date.
Numbers are never reused or renumbered. To change a decision, either amend the
ADR openly with a dated note or write a new ADR that supersedes it. Never
silently rewrite the history.

Start a new ADR from [`template.md`](./template.md). Write one when a change
does any of the following:

- adds or replaces a framework, datastore, provider or deployment unit;
- changes a domain invariant listed in `docs/product/domain-model.md`;
- changes a trust boundary, such as auth, tenancy, PII or AI data flow;
- deliberately goes against an existing ADR.

| ADR                                                                  | Decision                                                                                                                | Status                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| [0001](./0001-record-architecture-decisions.md)                      | Record architecture decisions as ADRs                                                                                   | Accepted                      |
| [0002](./0002-monorepo-layout-and-toolchain.md)                      | pnpm + Turborepo monorepo on Node 24 with a small, layered package set                                                  | Accepted (amended)            |
| [0003](./0003-effect-backend-architecture.md)                        | Effect 4 for the backend: HttpApi, use cases, tagged errors, one layer graph                                            | Accepted (amended)            |
| [0004](./0004-postgres-drizzle-effect-and-pglite-tests.md)           | PostgreSQL via Drizzle's Effect driver; PGlite runs tests in-process                                                    | Accepted (amended)            |
| [0005](./0005-explicit-lifecycles-with-xstate.md)                    | Every lifecycle is an explicit XState v5 machine, enforced on the server with pure transitions                          | Accepted (amended)            |
| [0006](./0006-identity-entra-roles-and-relationships.md)             | Entra ID sign-in with app roles; leader, coach and coachee are relationships                                            | Accepted (amended)            |
| [0007](./0007-credit-only-from-signed-observations.md)               | Credit is posted only by signing an observation, to an append-only ledger; each credit carries a frozen role and points | Accepted (amended)            |
| [0008](./0008-decisions-api-is-advisory.md)                          | The Gemini Decisions API is advisory: it may hold or nudge, never clear                                                 | Accepted (amended)            |
| [0009](./0009-row-level-tenancy.md)                                  | One database with a tenant ID on every row, enforced in the repositories                                                | Accepted (amended)            |
| [0010](./0010-frontend-stack.md)                                     | React + TanStack Router/Query, with a typed client derived from the HttpApi                                             | Accepted (amended)            |
| [0011](./0011-single-deployable-with-in-process-scheduler.md)        | One server process serves the API and the SPA; scheduled sweeps run in-process                                          | Accepted                      |
| [0012](./0012-privacy-and-audit-by-design.md)                        | No client PII, append-only audit events, explicit retention                                                             | Accepted (amended)            |
| [0013](./0013-observability-otel-to-datadog.md)                      | OpenTelemetry from Effect to the Datadog Agent over OTLP                                                                | Accepted (amended)            |
| [0014](./0014-session-auth-with-openid-client.md)                    | First-party cookie sessions; Entra via `openid-client`; a dev persona sign-in                                           | Accepted                      |
| [0015](./0015-audit-trail-and-ai-decision-records.md)                | Every human and AI decision leaves an explainable, append-only record                                                   | Accepted                      |
| [0016](./0016-learning-loop-ground-truth-and-langsmith.md)           | Ground truth comes from real actions; LangSmith is an optional, privacy-bounded workbench                               | **Deferred**                  |
| [0017](./0017-skill-profiles-and-position-history.md)                | A skill can mean different things in different roles: profiles, expectations by job family, position history            | **Deferred** (positions kept) |
| [0018](./0018-notifications-outbox-and-content-policy.md)            | Notifications go through a transactional outbox, under a content policy                                                 | Accepted (amended)            |
| [0019](./0019-coaching-conversations-and-commitments.md)             | Coaching conversations and commitments are first-class, and neither earns credit                                        | **Deferred** (pilot feedback) |
| [0020](./0020-designated-observers.md)                               | A leader or coach may designate a colleague to observe, for a bounded window                                            | Accepted (amended)            |
| [0021](./0021-program-owner-and-adoption-view.md)                    | A program owner sees adoption in aggregate only                                                                         | Accepted (amended)            |
| [0022](./0022-calendar-assisted-logging.md)                          | Calendar-assisted logging reads the calendar on demand and never stores it                                              | **Deferred** (never built)    |
| [0023](./0023-program-owners-administer-credit-rules-and-catalog.md) | Program owners change the credit rules and the catalog at run time, with an audit record                                | Accepted                      |
