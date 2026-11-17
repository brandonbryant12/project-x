# Coaching Catalyst: vision and principles

## Why

The firm's current coaching tool counts logged CRM activity, depends on the
coachee asking for feedback, and has no real model of skills. People stop
using it once the mandate fades. See the
[landscape research](../research/2026-11-16-coaching-landscape.md).

## What

Coaching Catalyst is a development program for a financial-services firm.

- **The skills that matter to the business are named and visible** in a
  shared catalog that everyone can see.
- **Development happens through real work**: client meetings, book reviews,
  team conversations. It is the job itself, not coursework.
- **Credit comes from observation, never self-report.** A coach or leader who
  saw the work happen signs an Observation against the skill's behavioral
  indicators. Only then does anything post.
- **Everyone can be developing.** Advisors, coaches and leaders all take part.
  The same roles apply at every level of the organization.

Recognition is deliberate but grounded. Badges carry information about
competence. They are a by-product of signed observations, never a target in
themselves.

## Product principles

1. **Observed evidence is the only currency.** No self-attested completion, no
   credit for logging activity, and no AI-granted credit.
2. **Make the observer fast.** The observer's time is the scarce resource. A
   level plus one specific comment is enough to sign, and indicators are
   optional. An observer can do it in under a minute on a phone.
3. **Specific beats generic.** The product nudges narratives toward "the
   behavior I saw, its effect, the next step" and quotes them back in
   recognition.
4. **Many observations from many observers.** A badge requires several
   interactions, more than one observer, first-hand evidence and time. No
   single friendly signature can earn one. There are no points.
5. **Personal trajectory, not rank.** There are no leaderboards, streaks or
   rewards. Team views show coverage and momentum, never totals or
   rankings.
6. **Roles are relationships.** A person is a leader, coach or coachee _with
   respect to someone_. One app adapts to the relationships a person has.
7. **Explicit lifecycles.** Every stateful thing has a named, tested state
   machine. Nothing is in an ambiguous state, and nothing waits forever:
   requests expire.
8. **AI may hold or advise, never clear.** The Decisions API reads the
   observer's own note after it is written, nudges narrative quality, and
   screens reflections for client PII. Humans
   decide, and their decisions are recorded so the checks can be calibrated.
9. **Compliance by design.** No client PII in development records, only opaque
   client references. Records are append-only, every transition is audited,
   and retention is explicit.
10. **Private where it should be.** The catalog and earned badges are visible
    to the whole tenant. Progress is visible only to the person, their
    coaches and their leader chain. Narratives are narrower: the person, the
    observer, their coaches and their direct leader.

## How we will know it works

- **Median time from logging an interaction to a signed observation.** This is
  the north star, because observer capacity limits the whole product.
- **Expiry rate:** the share of observation requests that expire unsigned.
- **Observation coverage:** the share of people with an active plan who have a
  signed observation of work dated in the last 42 days.
- **Distinct observers per person** per quarter.
- **How often the subject acknowledges a signed observation**, and how often
  they request a review.
- **Second-read agreement** between observers. We never judge success with
  the same model that nudges people.

The program owner sees these in aggregate, with exact definitions, on the
adoption view ([ADR 0021](../adr/0021-program-owner-and-adoption-view.md),
built). Nobody sees a per-person activity count, and there
is no daily-active number for advisors.

Business outcomes such as client trust and retained books are studied
**in aggregate** and offline. They never feed recognition.
