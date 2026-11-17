# ADR 0009: One database with a tenant ID on every row, enforced in the repositories

- Status: Accepted
- Date: 2026-11-16

## Context

The owner expects multiple tenants. Our working definition is one firm per
tenant, mapped to one Entra tenant. Business functions inside a firm are a
taxonomy, not tenants. We expect a small number of tenants, each with a few
thousand people.

## Decision

**All tenant-owned tables carry `tenant_id`. The tenant always comes from the
authenticated session (`CurrentActor.tenantId`), never from request input.
Every repository method takes the tenant ID and filters by it.**

- Composite foreign keys `(tenant_id, id)` are used where a cross-tenant
  reference would be a real risk, such as the observation subject and
  observer.
- An architecture test asserts that every table except `tenant` itself has a
  `tenant_id` column.
- Unique constraints are scoped per tenant, for example `(tenant_id, slug)`.
- Each tenant's catalog starts as a copy of a starter library. Catalogs are
  never shared live across tenants.

## Alternatives considered

- **Postgres row-level security.** Strong isolation, but it needs a session
  variable per transaction, which complicates pooling and PGlite tests. We can
  add RLS later as defense in depth without changing the schema.
- **Schema-per-tenant or database-per-tenant.** Migrations and operations
  multiply for no benefit at our scale.

## Consequences

- A missing tenant filter is the main isolation risk. Code review, the
  planned `TenantScoped` repository helper (not built) and the architecture and integrity tests (built) guard
  against it.
- If a regulator or customer demands physical isolation, deploy a separate
  instance per tenant. The code already supports that.

## Amendment (2026-11-16)

Composite `(tenant_id, …)` foreign keys are used **for every** tenant-owned
reference, not only where a cross-tenant reference "would be a real risk". The
schema review showed several unguarded paths. `integrity.test.ts` proves a
cross-tenant reference is rejected.
