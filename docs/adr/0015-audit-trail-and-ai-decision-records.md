# ADR 0015: Every human and AI decision leaves an explainable, append-only record

- Status: Accepted
- Date: 2026-11-16
- Builds on: [ADR 0008](./0008-decisions-api-is-advisory.md), [ADR 0012](./0012-privacy-and-audit-by-design.md)

## Context

Coaching Catalyst will go before the firm's AI governance board and its
enterprise and SOC 2 control reviews. Reviewers will ask two kinds of question.

About people:

- _Who_ did _what_, _when_, _why_, and _under which rules_?
- Why did this person earn this badge?

About the AI:

- _What exactly_ was the AI asked, about _which_ input?
- _What_ did it answer?
- _How_ was the answer turned into an effect?
- _Who_ overrode it, and why?

Logs cannot answer these questions. They are not durable or queryable enough,
and must never contain narrative text ([ADR 0013](./0013-observability-otel-to-datadog.md)).

## Decision

**Decisions are product data, stored append-only in Postgres alongside the
change they explain, inside the same transaction.**

1. **Human decisions → `audit_event`.** Every lifecycle transition and every
   sensitive action writes a row with these fields:
   - actor and tenant;
   - entity type and id;
   - event;
   - from and to states;
   - `reason`: the human's words, such as a decline, return or void note;
   - `policy_version`: the machine, scoring policy or question set in force;
   - non-sensitive `data`, such as the observer's basis.

   It never contains narratives, evidence text or PII.

2. **AI decisions → `advisory_check`.** Each check records:
   - the question-set id and version;
   - `questions_digest`, a hash of the exact questions sent, which can be
     reproduced from the versioned registry in
     `apps/server/src/features/shared/advisory/question-sets.ts`;
   - the provider and model;
   - `input_digest`, a hash of the input text (the text itself stays in its
     source record);
   - the raw per-question probabilities, with missing and malformed keys
     recorded explicitly;
   - `thresholds`, the operating points applied;
   - the interpreted result and its `effect` (hold, nudge or none);
   - a plain-language `rationale`;
   - cost and latency;
   - the human `disposition` (agreed, overrode or ignored) with its actor,
     reason and time.
3. **Credit explains itself.** Each `credit_entry` points to its observation,
   its observer and its scoring policy version. Each `badge_award.receipt`
   snapshots the observations, observers and criteria that earned it.
4. **Nothing is updated in place to erase history.** Corrections append rows:
   reversal credits, superseding checks, and new audit events.
5. **Read access to the audit trail is itself audited.** Exports are limited to
   tenant admins and compliance reviewers.

## Alternatives considered

- **Traces or logs as the audit trail.** Retention is short, the data cannot be
  queried per entity, and it would have to exclude exactly the context
  reviewers need.
- **Storing the AI's full input with the check.** Doing so would duplicate PII
  exposure. A digest and a pointer to the source record give
  reproducibility without a second copy.
- **Event sourcing.** It is heavier than we need. Append-only audit, ledger
  and check tables give the same evidentiary guarantees.

## Consequences

- An AI board question such as "show every time the privacy screen held text,
  and how often humans overrode it" is a single SQL query.
- Question sets carry versions, and a change to their wording requires a
  version bump. The `questions_digest` detects any drift.
- Tests named in `docs/testing/invariants.md` prove that the records are
  written.
