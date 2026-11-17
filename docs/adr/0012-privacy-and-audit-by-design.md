# ADR 0012: No client PII, append-only audit events, explicit retention

- Status: Accepted
- Date: 2026-11-16

## Context

The users are registered financial professionals. The rules in play are:

- FINRA 3110 (supervision) wants reviews _evidenced_;
- FINRA 4511 and SEA 17a-4 want immutable records;
- Reg S-P covers systems that hold customer information.

Coaching notes about client meetings could drift into being supervisory
records or client communications. The research and the domain advisor both
recommend keeping client PII out by default.

## Decision

**Development records never store client-identifying data. Every lifecycle
transition and every sensitive read or export writes an append-only
`audit_event`. Records are corrected with new entries, not edits.**

- Interactions reference a client only by an optional, opaque CRM reference.
  The UI says so wherever text is entered.
- Reflections, evidence notes and observer narratives pass the
  `privacy-screen` advisory check
  ([ADR 0008](./0008-decisions-api-is-advisory.md)). Flagged evidence is
  quarantined: visible only to its owner and tenant admins until it is
  redacted or released.
- A deterministic local screen for things like account-number and SSN
  patterns runs as well, whether or not Decisions is enabled.
- `audit_event` records:
  - tenant;
  - actor;
  - entity type and id;
  - event;
  - from and to states;
  - policy or machine version;
  - non-sensitive data.

  Nothing updates or deletes it. The application's database role should be
  granted INSERT/SELECT only on this table in production.

- An observation attests to the person's **behavior**. It is not a
  supervisory review of the client interaction. The product copy says so,
  and compliance should confirm it.
- Retention:
  - _planned:_ each table declares a retention class in `packages/db/src/retention.ts` (not yet written);
  - purging is a tenant-configured job, added later;
  - a legal hold blocks purging.

## Alternatives considered

- **Free-text client names with a later cleanup pass.** The data is
  irreversibly in backups, logs and model inputs by then.
- **Event sourcing for everything.** Audit events plus an append-only credit
  ledger give the needed guarantees without that complexity.

## Consequences

- Reflections are less specific about clients. That is the right trade, and
  the UI coaches people to describe their own behavior.
- Compliance can export the evidence trail per person or per observer from
  `audit_event` and the ledger.

## Amendment (2026-11-16)

- **Evidence gains an `escalated` state.** A complaint or specific
  recommendation goes to a compliance reviewer and is never edited away.
- **Free-text reasons move to a purgeable `note` table.** `audit_event` keeps
  a reason code and a link, so audit rows never hold human-written text.
- **Content columns are nullable.** Each has a `content_digest` and a
  `purged_at`, so a purge is an explicit fact. A `legal_hold` table blocks
  purges.

## Amendment (2026-11-16): retention classes are written

- `packages/db/src/retention.ts` now gives every table a retention class and
  lists every free-text column. `packages/db/src/retention.test.ts` fails when
  a table or a free-text column has none.
- The periods in it are provisional until compliance answers domain-expert
  question D2. Purge jobs are still _planned_.
- Notifications carry no content at all (ADR 0018), so the outbox is
  `operational`, not `narrative`.

## Amendment (2026-11-17): no `legal_hold` table

The `legal_hold` table was removed unwritten. Until purge jobs exist there is
nothing for a hold to block, so a legal hold is recorded in the incident or
deprovisioning ticket (see the runbooks). Model it again with the purge jobs.
