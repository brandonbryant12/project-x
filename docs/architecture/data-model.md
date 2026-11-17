# Data model

The schema is the longest-lived artifact in this system. Code gets rewritten;
data from 2026 must still be explainable to an auditor in 2032. These are the
rules every table follows. The code lives in `packages/db/src/schema/`.

## 1. Three kinds of table

| Kind                  | Examples                                                                                                       | Mutability              | Rules                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Directory mirrors** | `person`, `reporting_line`, `role_grant`, `person_position`                                                    | Synced from Entra or HR | Effective-dated (`valid_from`, `valid_to`). Never edited by product flows. History is kept so eligibility can be evaluated _as of_ any date.                                    |
| **Workflow entities** | `plan`, `activity`, `observation`, `engagement`, `evidence`                                                    | Current state changes   | One `status` column, constrained to the lifecycle's states. A `version` integer for optimistic concurrency. Every transition also writes `audit_event` in the same transaction. |
| **Facts and ledgers** | `credit_entry`, `audit_event`, `advisory_check`, `advisory_disposition`, `badge_award`, `observer_designation` | **Append-only**         | Never `UPDATE`d to erase history; corrections are new rows that point at the old ones. Denormalized on purpose: each row explains itself without joins to mutable data.         |
| **Operational**       | `session`, `notification`, `notification_preference`                                                           | Plumbing                | Hold no content and explain nothing to an auditor. Deleted 90 days after last use (`operational` class). A `notification` row's status changes only in the dispatcher.          |

`observer_designation` is a fact with one permitted change: it may be ended
early, once, by setting `ended_on` (enforced by a trigger).

Do not mix kinds. If a workflow entity needs history, the history belongs in
`audit_event` or a ledger, not in extra columns.

## 2. Conventions

- **Identity.** IDs are prefixed, branded strings (`per_…`, `obs_…`) generated
  by the application. The prefix makes logs and support tickets
  self-describing.
- **Tenancy is structural.** Every table except `tenant` has `tenant_id`.
  Parents expose a unique `(tenant_id, id)`, and children reference parents
  with **composite foreign keys** `(tenant_id, parent_id)`. A cross-tenant
  reference is therefore impossible at the database level, not merely
  filtered out in code (ADR 0009).
- **Dates and instants.**
  - `*_on` is a calendar `date` (`IsoDate`): when something happened in
    business terms, such as `occurred_on` or `valid_from`.
  - `*_at` is `timestamptz`: when the system recorded it.
  - Never mix the two meanings.
- **Status columns.**
  - Stored as `text`, with a `CHECK (status IN (...))` generated from the
    XState lifecycle's `states`.
  - Adding a state is a lifecycle edit plus a generated migration, and the
    database can never hold a state the machine does not know.
- **Concurrency.**
  - Workflow entities carry `version integer`.
  - Updates use `WHERE id = $1 AND version = $2` and increment it. A miss
    returns `Conflict`, so two people acting at once cannot silently
    overwrite each other.
- **Relationships with integrity get join tables. Snapshots may be arrays.**
  - Plan focus skills, activity skills and template skills are join tables
    with foreign keys, an order and attributes such as a target level, a role
    (`primary` or `secondary`) and an optional value.
  - Arrays are acceptable only for immutable snapshots inside append-only
    rows.
- **Catalog content is relational and versioned.**
  - `skill_version` has `skill_level` and `skill_indicator` rows.
  - Each indicator has an id unique to its version and a `lineage_key` that is
    stable across versions.
  - Observations reference indicator ids, so the indicator a person actually
    saw is pinned forever.
  - Analytics can follow an indicator across versions through `lineage_key`,
    for example to find indicators that are never ticked.
- **Content is separate from facts.**
  - Free text (reflections, narratives, notes) lives in a small
    number of columns. `packages/db/src/retention.ts` gives every table a
    retention class and lists every free-text column, and
    `packages/db/src/retention.test.ts` fails if a new one is unclassified.
    The periods are provisional until compliance answers question D2. Purge
    jobs are _planned_.
  - Facts such as levels, modes and dates never depend on that text, so
    purging text never breaks the audit trail.
- **No client PII.** The only client-related field is an opaque `client_ref`
  (ADR 0012).
- **Names.**
  - `snake_case`, singular table names.
  - Foreign keys are named `<entity>_id`.
  - Booleans read as facts (`credit`, `is_first_hand`).
  - Index names start with the table name.
- **Indexes follow access patterns.** Each index is justified by a query such
  as the inbox (`observer_id`, `status`), a person's logged work (`owner_id`,
  `occurred_on`) or the ledger (`person_id`, `skill_id`). `tenant_id` comes
  first in composite indexes.

## 3. Entity map

```
tenant ─┬─ (settings.creditPolicy: the versioned credit policy)
        ├─ business_function
        ├─ job_family
        ├─ person ─┬─ reporting_line (manager → report, dated)
        │          ├─ role_grant (coach | tenant_admin | compliance_reviewer | program_owner, dated)
        │          ├─ person_position (job family, title, function, dated)
        │          ├─ notification_preference (email or off, weekly digest)
        │          └─ session
        ├─ skill (own values, optional) ── skill_version ─┬─ skill_level
        │                          └─ skill_indicator (lineage_key)
        ├─ activity_template ── activity_template_skill (role, optional value)
        ├─ engagement (coach ↔ coachee, mesh)
        ├─ observer_designation (designator names an observer for a subject, ≤ 90 days)
        ├─ plan ─┬─ plan_skill (focus skill, target level, closing outcome)
        │        │            (plan also holds the closing review: summary, recorded by, confirmed by)
        │        └─ activity ─┬─ activity_skill (role, individual value, copied template value)
        │                     └─ interaction ─┬─ evidence (screened text)
        │                                     └─ observation ─┬─ observation_rating (skill, pinned version, level, credit, role)
        │                                                     └─ observation_indicator (indicator ticked)
        ├─ credit_entry      (append-only ledger: one demonstration, with its role, points, points source and the subject's position)
        ├─ badge_award       (awarded/revoked; receipt snapshot)
        ├─ advisory_check    (one AI evaluation: digests, probabilities, thresholds, effect, rationale)
        ├─ notification      (outbox: one message to one person, no free text)
        └─ audit_event       (append-only: who, what, from → to, why, under which policy)
```

## 4. State of the newer tables

| Table                                                                                                  | Schema | Behavior                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observer_designation`, `observation.basis_designation_id`                                             | Built  | Built (`designated-observer-signs`); the web app hides it behind `FEATURE_DESIGNATED_OBSERVERS`, off by default                                                                                                     |
| `notification_preference`                                                                              | Built  | Built                                                                                                                                                                                                               |
| `notification`                                                                                         | Built  | Rows written in the transition's transaction. The dispatcher claims a row in a short transaction, sends with no transaction open and acknowledges with a fenced update: delivery is at least once (ADR 0018)        |
| `job_family`, `person_position`, `subject_position_id`                                                 | Built  | Each new credit pins the subject's position on the interaction date (null when the directory does not know it); credits signed before 2026-11-17 have none. Skill profiles and expectations are deferred (ADR 0017) |
| `credit_entry.role`, `.points`, `.points_source`; `observation_rating.role`                            | Built  | Resolved and frozen at signing (ADR 0007). A trigger refuses a new credit whose role differs from its rating's, or that claims role `unclassified` or source `legacy`                                               |
| `skill.primary_points`, `.secondary_points`, `.badge_points`, `.min_primary_points`                    | Built  | A skill's own values over the tenant's policy; null uses the policy. Set by program owners with a reason (ADR 0023)                                                                                                 |
| `activity_template_skill.role`, `.points`                                                              | Built  | Copied onto an activity when work is added; never read at signing                                                                                                                                                   |
| `activity_skill.role`, `.points_override`, `.points_override_by_id`, `.template_points`                | Built  | Roles are defaults for observations. An individual value and who set it are set together or not at all. `template_points` is the template's value for the same role, copied once                                    |
| `plan.review_recorded_by_id`, `.review_recorded_at`, `.review_confirmed_by_id`, `.review_confirmed_at` | Built  | The closing review. Checks: each pair set together, confirmed only after recorded, never confirmed by the owner                                                                                                     |
| `tenant.settings.creditPolicy`                                                                         | Built  | A complete, versioned policy, read exactly as stored. The old `settings.badgeCriteria` key is kept, unused, for one release                                                                                         |

Designed, not built:

| Entity              | Purpose                                                                             | Fits as                        |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| `role_expectation`  | The expected level of a skill for a job family (ADR 0017, deferred)                 | Keyed by job family and skill  |
| `program`, `cohort` | A template plan (skills, templates, cadence) and an enrolment backed by an AD group | Plans can reference a program. |

## 5. Weighted credit: how legacy rows were migrated (2026-11-17)

`packages/db/drizzle/20261117125514_credit_points/migration.sql` and
`packages/db/drizzle/20261117125515_credit_integrity/migration.sql` follow the
two original migrations, which were not edited. drizzle-kit generated the
first; it was edited by hand because the generated `ADD COLUMN ... NOT NULL`
fails on any table that already has rows.

- **No ledger row is updated.** The new `credit_entry` and signed
  `observation_rating` columns were added with a default (`unclassified`, 10
  points, source `legacy`), which fills existing rows without firing the
  append-only and frozen-rating triggers; the defaults were then dropped, so
  every new row must state its values.
- **Unsigned ratings** were updated to the one-primary rule (the lowest
  position primary, the rest secondary); the frozen-ratings trigger allows it
  because their observations are not signed.
- **Activity and template skills** were given roles by
  `row_number() over (partition by … order by position, skill_id)`: the first
  is primary.
- **Every tenant** got a complete credit policy, version 1, with the old
  badge criteria converted exactly (no clamping) and absent keys taking the
  values the old code used. A value the policy cannot represent stops the
  migration with an error naming the tenant.
- **The integrity migration** replaces `credit_matches_signature()`: a new
  credit must carry its rating's role, and can never be `unclassified` or
  `legacy`. The trigger fires on insert only, so legacy rows are not
  re-validated.
- The observation rating position check was widened from 0..2 to 0..5 (six
  skills at most), and the note kinds and audit reason codes gained the
  values the new reasons need.

`packages/db/src/migration-compat.test.ts` builds a database at the two
original migrations, writes legacy rows (including non-default settings and
award snapshots), applies the new migrations, and proves that history is
unchanged and that award and revocation decisions over a legacy-only ledger
are the same as before. It also runs on Postgres 18 in the CI `test-pg` job.

## 6. Review checklist for schema changes

1. Which **kind** is this table? Does it follow that kind's rules?
2. Can a cross-tenant reference be written? It must not be possible.
3. Is every relationship that needs integrity a foreign key, not an array?
4. Is every status column constrained to its lifecycle?
5. Does each new index correspond to a real query?
6. Does each free-text column have a retention class? Can it hold PII?
7. Can an auditor explain every row in 2032 without the code from 2026?
8. Is the migration forward-only, with expand and contract steps for breaking
   changes?
