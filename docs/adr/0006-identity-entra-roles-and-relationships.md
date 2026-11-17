# ADR 0006: Entra ID sign-in with app roles; leader, coach and coachee are relationships

- Status: Accepted
- Date: 2026-11-16

## Context

Identity comes from Microsoft Entra ID, and AD groups are a fixed
requirement.

Content Studio mapped group **display names** to roles by calling Graph
`transitiveMemberOf` on every sign-in and again every five minutes. That took
about 900 lines of token storage, refresh and retry code. Its own
recommendation for a future rewrite was Entra **app roles**, assigned to
groups, and read from the ID token's `roles` claim. App roles avoid the
group-overage limit of roughly 200 groups per token, and they survive group
renames.

The product owner's structural rules:

- only leaders have direct reports;
- a coach reports to a leader;
- coaches never report to coaches;
- any coach can coach anyone;
- coaching carries no reporting relationship.

HR data will sometimes violate these rules.

## Decision

**Sign-in uses Entra ID OpenID Connect. Capabilities come from app roles
(`Coach`, `CatalogKeeper`, `TenantAdmin`, `ComplianceReviewer`), which tenant
administrators assign to AD groups. The roles are read from the ID token's
`roles` claim and mirrored into effective-dated `role_grant` rows. Leader,
coachee and team are derived from relationships, never stored as roles.**

- `person` has no role column. Instead:
  - a person is a **leader** if they are the manager end of an active
    `reporting_line`;
  - a person is a **coach** if they hold an active `coach` grant;
  - a person is a **coachee** if they have a plan or an engagement.
- **Reporting lines** come from the directory: the Graph `manager` attribute
  through a scheduled delta sync, with a CSV or seed import until that exists.
  They are stored with `valid_from` and `valid_to`, so eligibility can be
  checked as of any date. The app never edits them.
- **Rule violations in directory data** ("a coach reports to a coach") are
  recorded as directory exceptions for a tenant admin to resolve in HR or
  acknowledge. They are never sync failures, because HR remains the truth.
  _Amended 2026-11-17:_ the stored exceptions queue (table, lifecycle and
  endpoints) is deferred. The import returns its findings, on a dry run and
  when applied, and the admin fixes them in HR; nothing is stored or
  acknowledged.
- **Fallback when app roles are unavailable:** map AD group **object IDs**
  (never display names) to grants through tenant configuration, read from the
  `groups` claim. If the token reports overage, fail closed with an
  actionable error.
- **Local development** uses a dev persona sign-in instead of Entra
  ([ADR 0014](./0014-session-auth-with-openid-client.md)).

## Alternatives considered

- **Graph group sync on every request** (the Content Studio approach). It
  needs stored refresh tokens, caching and retries, and it breaks when a
  group is renamed.
- **Roles as person attributes** (`person.role = 'coach'`). This cannot
  express "the same roles at every altitude". A leader who is also developing
  and has a coach would need multiple roles with special cases.
- **Stored teams.** These drift from HR within weeks. A team is derived from
  reporting lines.

## Consequences

- Tenant onboarding requires an Entra admin to create the app roles and
  assign groups. The setup steps are in `docs/architecture/identity-and-access.md` § 3.
- A grant change takes effect at the user's next sign-in, or at the next
  sync once directory sync exists.
- Eligibility and visibility queries join reporting lines and engagements
  with as-of predicates. Those predicates live in one module so they stay
  consistent.
