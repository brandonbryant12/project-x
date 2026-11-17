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
  - Plan focus skills, activity target skills and template suggestions are
    join tables with foreign keys, an order and attributes such as a target
    level.
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
  as the inbox (`observer_id`, `status`), a timeline (`subject_id`,
  `occurred_on`) or the ledger (`person_id`, `skill_id`). `tenant_id` comes
  first in composite indexes.

## 3. Entity map

```
tenant ─┬─ business_function
        ├─ job_family
        ├─ person ─┬─ reporting_line (manager → report, dated)
        │          ├─ role_grant (coach | tenant_admin | compliance_reviewer | program_owner, dated)
        │          ├─ person_position (job family, title, function, dated)
        │          ├─ notification_preference (email or off, weekly digest)
        │          └─ session
        ├─ skill ── skill_version ─┬─ skill_level
        │                          └─ skill_indicator (lineage_key)
        ├─ activity_template ── activity_template_skill
        ├─ engagement (coach ↔ coachee, mesh)
        ├─ observer_designation (designator names an observer for a subject, ≤ 90 days)
        ├─ plan ─┬─ plan_skill (focus skill, target level, closing outcome)
        │        └─ activity ─┬─ activity_skill
        │                     └─ interaction ─┬─ evidence (screened text)
        │                                     └─ observation ─┬─ observation_rating (skill, pinned version, level, credit)
        │                                                     └─ observation_indicator (indicator ticked)
        ├─ credit_entry      (append-only ledger: one demonstration, with the subject's position)
        ├─ badge_award       (awarded/revoked; receipt snapshot)
        ├─ advisory_check    (one AI evaluation: digests, probabilities, thresholds, effect, rationale)
        ├─ notification      (outbox: one message to one person, no free text)
        └─ audit_event       (append-only: who, what, from → to, why, under which policy)
```

## 4. State of the hub-round tables

The schema for this round landed before the behavior, so that credits are
pinned correctly from the first real row.

| Table                                                      | Schema | Behavior                                                                                                                          |
| ---------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `observer_designation`, `observation.basis_designation_id` | Built  | Designating, ending, and observing on the `designated` basis are built; the journey test `designated-observer-signs` is _planned_ |
| `notification_preference`                                  | Built  | Built                                                                                                                             |
| `notification`                                             | Built  | Rows written in the transition's transaction; dispatcher with staleness check (`notification-carries-no-content`)                 |
| `job_family`, `person_position`, `subject_position_id`     | Built  | Positions are pinned on credit; skill profiles and expectations are deferred (ADR 0017)                                           |

Designed, not built:

| Entity              | Purpose                                                                             | Fits as                        |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| `role_expectation`  | The expected level of a skill for a job family (ADR 0017, proposed)                 | Keyed by job family and skill  |
| `program`, `cohort` | A template plan (skills, templates, cadence) and an enrolment backed by an AD group | Plans can reference a program. |

## 5. Review checklist for schema changes

1. Which **kind** is this table? Does it follow that kind's rules?
2. Can a cross-tenant reference be written? It must not be possible.
3. Is every relationship that needs integrity a foreign key, not an array?
4. Is every status column constrained to its lifecycle?
5. Does each new index correspond to a real query?
6. Does each free-text column have a retention class? Can it hold PII?
7. Can an auditor explain every row in 2032 without the code from 2026?
8. Is the migration forward-only, with expand and contract steps for breaking
   changes?
