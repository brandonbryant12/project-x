# ADR 0020: A leader or coach may designate a colleague to observe, for a bounded window

- Status: Accepted
- Date: 2026-11-16
- Builds on: [ADR 0006](./0006-identity-entra-roles-and-relationships.md), [ADR 0007](./0007-credit-only-from-signed-observations.md)

## Context

Observer capacity is the binding constraint on the product. Only the direct
leader or an engaged coach may observe today. Coaches rarely sit in client
meetings, and leaders have 8 to 15 reports. Meanwhile senior advisors and
specialists are in the room for the work that matters.

Open question 16 asked whether such people should be able to observe. The
working default was a `designated` basis: delegated, time-boxed and audited.
The review ranked it third among the highest-leverage changes.

The risk is collusion. Two peers who may credit each other could mint badges
without either leader or coach seeing the work.

## Decision

**On the subject's behalf, their leader (manager on the start date) or a
coach engaged with them may designate a colleague as an observer for a window
of at most 90 days. Observation eligibility gains a third basis,
`designated`, which points at the designation row.**

- `observer_designation` holds `subject_id`, `observer_id`,
  `designated_by_id`, `designator_basis` (`leader` or `coach`), `valid_from`,
  `valid_to` and `ended_on`. The database refuses a window longer than 90 days
  and a designator who is the observer or the subject.
- `observation.basis_designation_id` references the designation through a
  composite foreign key that includes the observer and the subject, like the
  `leader` and `coach` bases. A `CHECK` requires exactly one basis.
- Eligibility is still evaluated as of the interaction date: the window must
  cover it.
- The designator must be S's leader or an engaged coach on the start date.
  The designee may not be:
  - the subject;
  - the designator (they can already observe);
  - someone who reports to the subject, directly or up the chain.
- **Anti-collusion:** a designation is refused if any designation between the
  same two people, in either direction, overlaps its window. A cannot be
  designated for B while B is designated for A. A Postgres exclusion
  constraint enforces this, not only the application.
- A designation is a fact. It can be ended early, once, by setting `ended_on`;
  nothing else about it changes, and it is never deleted.
- Designations are audited, and the subject can see who is designated for
  them, by whom, and until when.
- A designated observer's signed observation counts like any other toward the
  distinct-observer criterion. The mode rules are unchanged.
- Restricting a designation to named skills is part of the decision but not
  in the first schema. It is _planned_; until then a designation covers every
  skill.

## Alternatives considered

- **Peer witness notes with no credit.** Cheap and safe, but they leave the
  capacity problem where it is. Still planned as a separate feature.
- **Any colleague may observe.** Collusion becomes trivial.
- **Skip-level leaders observe by default.** It adds capacity only at the top
  and none from the people in the room (domain-expert question B5).
- **Require the subject to approve each designation.** Possible. It is open
  question 22; the default is visibility without approval.

## Consequences

- Observer supply grows without diluting "someone who saw it signs".
- Eligibility has a third branch. The domain eligibility tables, the
  integrity test for the basis foreign key, and a journey test
  (`designated-observer-signs`) must cover it.
- The reciprocal-pair exclusion on badge credit (open question 17) is a
  separate rule. This ADR refuses reciprocal _designations_ only.
- Level 4, "Teaching others", can later be earned from observations given as
  a designated observer.
- **This decision was wrong if** designated observers become the main source
  of credit for a person, or if their feedback-only share is far below that
  of leaders and coaches. Both can be computed in aggregate from the ledger,
  by basis.
