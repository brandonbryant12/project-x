# ADR 0023: Event-Sourced Domain Model with `@alchemy.run/domain` and Formal Verification

- **Status**: Accepted
- **Date**: 2026-11-22

## Context

Coaching Catalyst operates in a regulated financial-advisory environment where observations, skill demonstrations, badge awards/revocations, privacy holds, and tenant rigor policy changes are inherently append-only facts. Previously, cross-entity reactions (signing → credit posting → badge evaluation → notification → audit) were coordinated imperatively across server use cases, and lifecycle diagrams required manual regeneration.

We also want future awarding, scoring, and badge-criteria changes to be safe and effortless: changing how badges or mastery credit are evaluated should not require brittle SQL backfills over mutated tables.

## Decision

1. **Adopt `@alchemy.run/domain` for the Core Bounded Context (`CoachingModel`)** in `packages/domain/src/model/Coaching.model.ts`:
   - **6 Aggregates**: `Observation`, `SkillLedger`, `TenantPolicy`, `SkillCatalog`, `DevelopmentPlan`, and `CoachingEngagement`.
   - **3 Live Views**: `PersonMasteryView`, `ObservationSummaryView`, and `TenantCatalogView`.
   - **2 Standing Policies**: `ObservationCreditPolicy` (posts/reverses credit and reconciles badges) and `CoachingNotificationPolicy` (dispatches content-free alerts through `NotificationGateway`).
   - **1 Idempotent Projection & Query**: `AuditTrailProjection` / `AuditTrailQuery`.
2. **Store Raw Business Facts, Keep Awarding Rules Pure & Swappable**:
   - Immutable events record raw historical facts (`ObservationSigned`, `DemonstrationRecorded`, `DemonstrationReversed`, `TenantPolicyUpdated`, `SkillPublished`) with **zero raw narrative PII** (only `contentDigest`, preserving [ADR 0015](./0015-audit-trail-and-ai-decision-records.md)).
   - Derived awarding rules (`evaluateBadge`, `TenantPolicy` rigor criteria) stay pure and replayable via `ReevaluateStanding` (supporting both grandfathering and retroactive recalculation).
3. **Keep Postgres/Drizzle as the Read-Model & Durable Fact Journal**:
   - Added tenant-scoped `domain_event` table (`packages/db/src/schema/domain-events.ts`) written atomically via `apps/server/src/features/shared/domain-journal.ts` alongside Drizzle read tables, preserving fast analytical SQL for Skill Catalog Discovery Atlas and single-deployable Postgres simplicity ([ADR 0004](./0004-postgres-drizzle-effect-and-pglite-tests.md), [ADR 0011](./0011-single-deployable-with-in-process-scheduler.md)).
4. **Three-Layer Formal Verification & Zero-Drift Diagrams**:
   - **Static graph verification**: `Domain.verify(CoachingModel) === []` enforced in both `@repo/domain` and server architecture invariant `I25` (`apps/server/src/architecture.test.ts`).
   - **Concurrent schedule exploration**: `Story.make` specifications (`packages/domain/src/model/Coaching.story.test.ts`) replay multi-aggregate policies and external systems across concurrent interleavings in memory.
   - **State-space & algebraic proofs**: exhaustive BFS over `ALL_LIFECYCLES` plus 250 randomized `SkillLedger` histories (`packages/domain/src/verification/formal.test.ts`) proving reachability, terminal absorption, deadlock freedom, privacy safety, credit conservation, idempotency, and policy monotonicity.
   - **Auto-generated Mermaid diagrams**: `pnpm docs:diagrams` generates `docs/architecture/domain-model.md` and `docs/architecture/lifecycles.md` directly from code; `pnpm docs:check` enforces zero drift in CI.

## Consequences

- Cross-entity causal wiring is statically checked and visible in an always-fresh topology diagram.
- Future scoring/badge changes can be simulated and backfilled cleanly against stored `DemonstrationRecorded` facts.
- `@alchemy.run/domain` is pinned to `2.0.0-beta.87` in `pnpm-workspace.yaml` and isolated behind `@repo/api` so `@repo/web` remains completely decoupled from domain runtime internals.
