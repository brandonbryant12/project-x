# ADR 0005: Every lifecycle is an explicit XState v5 machine, enforced on the server with pure transitions

- Status: Accepted (amended)
- Date: 2026-11-16

## Context

The product depends on robust lifecycles. Requests expire, plans are agreed,
and observations are signed, declined, returned or voided. Content Studio
models states as Schema unions but checks transitions by hand in each use
case, and its own documentation calls that a weakness.

The product owner asked for XState for every state machine, including small
ones. `@xstate/fsm` is deprecated. XState v5 (5.33 as of this ADR) offers
`setup()`, typed events and guards, and the pure functions
`initialTransition`, `transition` and `machine.resolveState`. A spike
confirmed that `snapshot.can(event)` evaluates guards without side effects.

## Decision

**Each stateful entity has exactly one XState v5 machine in
`packages/domain/src/lifecycles/<entity>.ts`. The machine is the single source
of truth for the entity's states, events and transition guards.**

- **Server enforcement is pure:**
  1. The use case loads the row.
  2. It calls `resolveState({ value: row.status, context })`.
  3. It applies `transition(machine, snapshot, event)`.
  4. If the state did not change, it fails with `InvalidTransition`.
  5. Otherwise it persists the new status and an audit event in the same
     transaction.

  No interpreted actors run on the server. Persistence is a plain `status`
  column.

- **Guards are invariants, not permissions.** A guard such as "a plan needs
  1–3 focus skills" belongs in the machine. _Who_ may send an event (the
  observer, the owner, an admin) is decided by `packages/domain/src/policy`.
- **Available actions:** the server returns an `actions` array with each
  resource. It contains events where `snapshot.can(event)` holds _and_ the
  policy allows the actor. The UI renders buttons from that array and never
  re-derives permissions.
- **Timers** such as expiry are not XState `after` delays. A scheduled sweep
  ([ADR 0011](./0011-single-deployable-with-in-process-scheduler.md)) sends an
  `EXPIRE` event to rows past their deadline, and the machine decides whether
  it applies.
- **Machine tests** cover every state and event through a table-driven test
  (`lifecycles.test.ts`), plus a check that every terminal state is final.
- Lifecycle diagrams in the docs are generated from the machines, never drawn
  by hand.

## Alternatives considered

- **Transition tables in plain TypeScript.** Simple, but it is exactly what
  the owner asked us not to hand-roll, and it misses XState's tooling:
  inspection, visualization and `can`.
- **Interpreted actors persisted with `getPersistedSnapshot`.** Too heavy for
  a request/response server, and persisted snapshots couple the database to
  XState internals.
- **`@xstate/store`.** That library is for client state, not lifecycles.

## Consequences

- Adding a state or event is a one-file change to the machine, plus the table
  test and the copy for its UI pill.
- Statuses stored in the database must remain valid machine states. Renaming
  a state needs a data migration.
- `immutable once terminal` holds by construction: terminal states are
  `type: 'final'` and accept no events, except `VOID` on `signed`, which is
  modelled explicitly.

## Amendment (2026-11-17): plan revision, draft expiry, catalog versions and facts beside a machine

The machines changed in four places; the generated
[lifecycles](../architecture/lifecycles.md) page shows them.

- **Plan `REVISE`** goes from `proposed` or `active` back to `draft`, sent by
  the owner or a plan agreer, so an agreed plan can be changed and agreed
  again. It is guarded by the fact `reviewConfirmed`: once a closing review is
  confirmed, the plan cannot be revised. The use case clears the agreement,
  the endorsement and any closing review that is recorded but not confirmed,
  and audits what it cleared (`planEvent` in
  `apps/server/src/features/development/use-cases.ts`). `REVISE` from
  `paused` is not allowed (open question 38).
- **Plan `EXPIRE` from `draft`.** The expiry sweep now expires every
  unfinished plan past its period plus the grace days, drafts included, so a
  plan revised late can never block the owner's next one. A recorded closing
  review no longer exempts a plan from expiry.
- **Observation `RESUBMIT` is guarded** by the fact `reflectionHeld`: a
  returned request is resent only once the requester's reflection is no longer
  held for privacy, so held text never goes to an observer. The requester may
  still withdraw it, and signing is never blocked by the reflection.
- **Catalog item `PUBLISH` on a published item** publishes its draft as the
  next immutable skill version, guarded by a complete draft (ADR 0023).

**A fact recorded beside an entity is not a lifecycle.** The closing review of
a plan (an outcome per focus skill, a summary, who recorded it and who
confirmed it) is stored on `plan` and `plan_skill` with its own audit events,
`REVIEW_RECORDED`, `REVIEW_CONFIRMED` and `REVIEW_CLEARED`. It has no machine:
the owner may record it while the plan is `active`, `paused`, `completed` or
`expired` and may record it again until an agreer confirms it, after which it
is fixed. Capabilities that are not lifecycle events (edit the plan, add work,
edit work, set a value, record or confirm the review) reach the UI as explicit
flags on the view, computed by the same functions the use cases refuse with
(`apps/server/src/features/development/permissions.ts`). The `actions` array
still carries only lifecycle events.
