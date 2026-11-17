# ADR 0019: Coaching conversations and commitments are first-class, and neither earns credit

- Status: Accepted
- Date: 2026-11-16
- Builds on: [ADR 0005](./0005-explicit-lifecycles-with-xstate.md), [ADR 0007](./0007-credit-only-from-signed-observations.md), [ADR 0012](./0012-privacy-and-audit-by-design.md)

## Context

The owner's goal is a hub that coaches open daily and leaders and advisors
open weekly. A coach's week is a series of conversations. A leader's week has
1:1s. Today neither exists in the product, so the app is something people
visit after the real work, not where they do it.

The domain model already named both entities as "designed next":

- a **coaching conversation**, the meeting where debriefs are batched;
- a **commitment**, "what next" made concrete and followed up.

Constraints:

- Credit comes only from a signed observation (ADR 0007). A conversation is
  where people _talk about_ work, which is the `discussed` mode at best.
- Free text is purgeable content and must pass the privacy screen (ADR 0012).
- Compliance has not said how long private coach notes would be kept, or
  whether they are books and records (domain-expert question D2).

## Decision

**A `coaching_conversation` is a scheduled meeting between a coachee and one
host. It hangs off exactly one basis: an engagement (the host is the coach) or
a reporting line (the host is the leader). A leader's 1:1 and a coaching
session are the same object. A `commitment` is something the coachee agreed
to do next. The coachee owns it. Neither ever earns credit.**

### Conversation

- Lifecycle: `scheduled → held · missed · cancelled`. `RESCHEDULE` keeps it
  `scheduled`. `HOLD` and `MISS` are allowed only once the scheduled time has
  arrived. A conversation nobody closes is marked `missed` after 7 days.
- The row holds `coachee_id`, `host_id`, `basis` (`coach` or `leader`),
  `scheduled_for`, and `held_on` once held. Either party may schedule it.
- The basis is a composite foreign key to the exact engagement or reporting
  line row between the host and the coachee, like an observation's basis. A
  `CHECK` requires exactly one.
- **The agenda is assembled, not stored.** When the conversation opens, the
  server builds it from facts:
  - observations of the coachee signed since the last held conversation on
    the same basis;
  - the coachee's interactions not yet observed;
  - open commitments that are due;
  - the next-step benchmark toward a badge.
- Transitions go through `decide()` and write an audit event, like every
  lifecycle.

### Commitment

- Lifecycle: `open → done · dropped`, with `REOPEN` back to `open`.
- Created from an observer's "next step" when they sign
  (`source_observation_id`), or during a conversation (`conversation_id`).
  Both foreign keys include the owner, so a commitment always belongs to the
  observation's subject or the conversation's coachee. It may have a `due_on`.
- Owned by the coachee. The coachee marks it done or dropped.
- The text is at most 280 characters. It is purgeable content and passes the
  deterministic local privacy screen before it is saved.
- `done` is the coachee's own word. That is acceptable only because a
  commitment never feeds credit, badges or progress toward a badge.

### Deferred

**Private coach notes** wait until compliance answers how long they are kept
and who may read them ([open question 23](../product/open-questions.md)). Until
then a conversation has no free-text field of its own.

## Alternatives considered

- **Separate objects for a 1:1 and a coaching session.** Two inboxes and two
  agendas for the same act. The basis already says which relationship it is.
- **Store the agenda.** It goes stale the moment someone signs an observation,
  and it duplicates facts.
- **Let a held conversation post `discussed` credit.** That would turn a
  meeting into self-report. The observer can still sign an observation from
  the conversation, through the normal flow.
- **Ship coach notes now with a short default retention.** Retention is a
  compliance decision, not ours.
- **Calendar sync to create conversations.** See ADR 0022 (proposed).

## Consequences

- Coaches get a reason to open the app daily: today's conversations and their
  agendas.
- The "Today" band on Home can list conversations without a calendar.
- An architecture test must keep showing that only signing writes
  `credit_entry`; conversations and commitments are outside the Recognition
  context.
- **This decision was wrong if** coaches keep their real agenda elsewhere,
  measured by conversations held per coach per week staying near zero in a
  pilot.
