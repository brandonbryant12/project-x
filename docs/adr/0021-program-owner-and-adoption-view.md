# ADR 0021: A program owner sees adoption in aggregate only

- Status: Accepted (amended)
- Date: 2026-11-16
- Builds on: [ADR 0006](./0006-identity-entra-roles-and-relationships.md), [ADR 0012](./0012-privacy-and-audit-by-design.md)

> **Amended, 2026-11-17.** The view shows four numbers: people with an active
> plan, how many were observed in the last 42 days, the median days from
> logging to signature, and the expiry rate (over the last four complete
> weeks). The other metrics below are not built, and second-read agreement
> was dropped with the unwritten `second_read` table. The text below is the
> original decision.

> **Amended, 2026-11-17: suppression counts people.** A figure is withheld
> unless at least five distinct people stand behind it, and the person behind
> an observation is its subject, never the number of observations or
> requests. "With a plan" (people with an active or paused plan) is withheld
> under five like every other figure. "Observed recently" is also withheld
> when subtracting it from "with a plan" would reveal a group under five,
> including an empty one, and whenever "with a plan" is withheld. Voided
> observations count for nothing: coverage and median days to sign read only
> signatures that stand (signed or under review), and the expiry rate leaves
> voided requests out. The screen says "withheld" in place of a figure. The
> code is `apps/server/src/features/shared/program.ts` and
> `apps/server/src/features/hub/adoption.ts`; the tests are
> `apps/server/src/features/hub/adoption.test.ts` and
> `apps/server/src/journeys/honest-aggregates.scenario.test.ts`. Team
> coverage for a leader ignores reversed credit in the same way
> (`apps/server/src/features/support/team.ts`). Still open: the expiry rate
> counts every non-voided observation created since the window began, with a
> closed signing window, including an
> observer's own "I saw this" drafts and withdrawn or declined requests (see
> the [backlog](../backlog.md)).

## Context

The vision lists how we will know the product works: time to signature,
coverage, distinct observers, acknowledgement and second-read agreement.
Nothing computes them today. The owner cannot steer the program, and the
review asked for an adoption view.

The person who runs the program is usually not a tenant admin or a
compliance reviewer. Giving them either grant would show them the audit trail
or narratives they do not need. The review also asked for duties to be
separated across grants.

Per-person activity numbers are the fastest way to turn a development tool
into surveillance. The principles forbid ranks, totals and streaks.

## Decision

**A new Entra app role, `ProgramOwner`, maps to a `program_owner` grant. It
shows an adoption view of aggregates only. No cell is shown when fewer than
five people contribute to it. The view shows no names and no per-person
figures, and the product does not track individual page views.**

### Metrics

Each is computed per tenant and per ISO week unless stated. "Signed" means
the observation reached `signed`, including any later `under_review` or
`voided` state.

| Metric                                | Definition                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Time to signature**                 | For each observation signed in the week: `signed_at` minus the time its interaction was logged. Shown as the median and p90.                                |
| **Coverage**                          | Of people with an active plan, the share with at least one signed observation of an interaction dated in the last 42 days.                                  |
| **Expiry rate, by request cohort**    | Of observations requested in a week, the share that ended `expired`. A cohort is reported once its signing window has closed.                               |
| **Distinct observers per person**     | For each person with an active plan, the number of distinct observers who signed about them in the last 90 days. Shown as a distribution, never per person. |
| **Acknowledgement rate**              | Of observations signed in the week, the share the subject acknowledged.                                                                                     |
| **Review-request rate**               | Of observations signed in the week, the share where the subject requested a review.                                                                         |
| **First-hand share**                  | Of credited demonstrations signed in the week, the share with mode `saw_it` or `reviewed_work`.                                                             |
| **Feedback-only share**               | Of ratings signed in the week, the share signed as feedback only. A share near zero suggests inflation.                                                     |
| **Observer load**                     | Signed observations per observer in the week, as a histogram. Never a ranking, never names.                                                                 |
| **Notification-to-action conversion** | Of immediate notifications sent in the week, the share whose entity received the awaited action within 7 days (ADR 0018).                                   |

There is **no daily-active number for advisors**, anywhere. Weekly use is the
right goal for advisors; chasing daily use would need the engagement mechanics
the principles forbid.

### Rules

- Suppression: a cell computed from fewer than five people shows "fewer than
  5" and no figure. This applies to every breakdown, including by business
  function.
- `program_owner` grants nothing else: no narratives, no levels per person,
  no audit trail, no holds.
- The view reads the ledger, observations and the notification outbox. It
  writes nothing.

## Alternatives considered

- **Give the program owner `tenant_admin`.** Too broad, and it breaks the
  separation of duties the review asked for.
- **Per-person drill-down for program owners.** Rejected. That is performance
  management, which the product is not.
- **A BI export.** Moves the suppression rule out of our control.
- **Page-view analytics.** They measure attention, not development, and they
  would track individuals.

## Consequences

- The owner can steer from the same numbers the vision names.
- Small pilots will show many suppressed cells. That is correct.
- The view needs a seed with 12 weeks of history to be reviewable before a
  pilot.
- Coverage is measured over **42 days**, replacing the earlier "30 days" in
  the vision and the domain model.
- An app role must be created in Entra and assigned to a group (open
  question 25).
- **This decision was wrong if** program owners ask for names to act on the
  numbers. Then the right response is a conversation with HR, not a
  drill-down.
