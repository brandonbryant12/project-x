# ADR 0007: Credit is posted only by signing an observation, to an append-only ledger

- Status: Accepted (amended 2026-11-16 and 2026-11-17)
- Date: 2026-11-16

## Context

The product's central promise is "nothing posts on self-report". The research
behind it ([landscape research](../archive/research/2026-11-16-coaching-landscape.md))
found three things:

- Self-assessment is a poor proxy for observed competence (Davis et al.,
  _JAMA_ 2006).
- Single, friendly raters inflate.
- Expected, contingent rewards undermine intrinsic motivation unless they are
  informational.

Medical education's direct-observation and entrustment practice is the
closest proven model.

## Decision

_Points in this section were replaced by demonstrations on the same day; see
the first amendment below. On 2026-11-17 points returned in a different form,
as the weight of a signed credit; see
[the second amendment](#amendment-2026-11-17-weighted-signed-credit). The
text in this section and in the first amendment is kept as history._

**The only code path that creates `credit_entry` rows is the `SIGN`
transition of an Observation, executed in the same transaction as the status
change. The ledger is append-only. Points, progress and badges are
projections over it.**

- An observation rates up to 3 skills against the pinned skill version. For
  each skill it records the indicators seen and the level observed. Each
  rating either credits or is marked feedback-only.
- Points come from the level and mode table in
  `packages/domain/src/scoring`. At most one credit per skill per
  interaction, across all observers.
- Badges are awarded by a pure criteria function over the person's ledger,
  evaluated inside the signing transaction. Badge criteria use multiple
  observers, interactions and weeks, not a bare point threshold. The values
  are configurable per tenant; the structure is not.
- `VOID` posts reversal entries and re-evaluates badges. Nothing is ever
  deleted or updated in the ledger.
- Production metrics (AUM, retention, revenue) never feed points or badges,
  so incentives tied to production stay out of scope.
- No leaderboards, streaks or redeemable points exist anywhere in the API.

## Alternatives considered

- **Mutable `points` columns on a person-skill row.** Cheap to read, but it
  cannot be audited, corrected or explained.
- **Self-logged activities earning partial credit.** That contradicts the
  product's core promise.
- **"10 points earns the badge".** Kept as the visible progress bar, but not
  sufficient alone. One coach in one week could otherwise mint a badge.

## Consequences

- Every badge can show its receipts: which observations, by whom, and when.
- An architecture test asserts that only the signing use case writes to
  `credit_entry`.
- If people with a single eligible observer cannot earn badges, a tenant
  admin can waive the two-observer criterion. The waiver is audited.

## Amendment (2026-11-16): demonstrations replace points

The domain red-team showed that points measured volume, and that a debrief
plus an AI pre-read of the coachee's own reflection let self-report back in.
Changes:

- **Points are gone.** A credit is one _demonstration_: a skill, a level, a
  mode, an observer, an interaction.
- **Badge criteria** (levels 2 and 3):
  - at least 3 interactions at or above the level;
  - at least 2 observers;
  - at least half of them first-hand;
  - at least 28 days, measured on interaction dates.
- **Modes are named honestly** (`saw_it`, `reviewed_work`, `discussed`). Only
  the first two are first-hand.
- **One credit per (observation, skill).** A second observer of the same
  interaction writes their own row, so disagreement is preserved. Criteria
  count distinct interactions. This supersedes "one credit per skill per
  interaction across all observers".
- **Voids write `credit_reversal` rows** and revoke any badge whose criteria
  no longer hold. Badge receipts are a join table, `badge_award_credit`.
- **The subject may acknowledge** a signed observation, **or request a
  review** of it.

## Amendment (2026-11-17): weighted signed credit

The product owner decided that primary and secondary skills earn different
credit, set by domain experts, and that repeated secondary credit can earn a
badge for a skill that was never the main focus of any work. The business
partner wanted credit for the secondary skills people use in real work, and
wanted the values to stay flexible, including on an individual activity. The
numbers he gave (10 for a primary skill, 3 for a secondary one) were
illustrations, not approved values.

**A credit still comes only from a signed observation and still lives in an
append-only ledger. Each credit now also carries a role (primary or
secondary) and a number of points, resolved once at signing and frozen on the
row together with where the value came from. A badge needs a points total,
counted once per piece of work, plus every corroboration criterion that
existed before. All the numbers are tenant settings that program owners
change at run time; the values in the code are working defaults, not
decisions.**

### What stays

- Only `signObservation` writes `credit_entry`
  (`apps/server/src/features/observations/use-cases/sign.ts`). Nothing is
  self-reported, and the AI never grants credit.
- The ledger is append-only. A void writes `credit_reversal` rows.
- Every badge criterion is always evaluated: points, pieces of work, distinct
  observers, the first-hand share and the span of time. A tenant can change
  the numbers but cannot switch a criterion off.
- No leaderboards, no streaks, nothing redeemable, no link to pay, and
  production metrics never feed credit.

### Roles, points and where a value comes from

- **Role.** Each rated skill is `primary` or `secondary` in that piece of
  work, with at most one primary per activity and per observation. The rule
  is enforced in domain code and use cases, not by the database, because it
  may change (`SKILL_ROLES` in `packages/domain/src/vocabulary.ts`).
- **The observer owns the roles on an observation,** as the observer owns the
  mode (I15). When a request is made or "I saw this" is started, each rating
  takes its role from the activity; a skill the activity does not list is
  secondary; when no rated skill is primary on the activity, the first rated
  skill is primary. The observer may change the roles until signing; two
  primaries are refused; a subject can never set or change a role. The signed
  roles are recorded in the `SIGN` audit event, and a later edit to the
  activity never changes an observation that already exists
  (`resolveRatingRoles` in `packages/domain/src/scoring/values.ts`).
- **Points** are a whole number from 1 to 1000. They are resolved only inside
  the signing transaction by `resolveCreditValue`
  (`packages/domain/src/scoring/values.ts`), most specific first:
  1. the activity's own value for that skill (source `activity`), applied only
     to work done on or after the business date the value was set
     (`activity_skill.points_override_at`), so it never values work that had
     already happened, and only while the tenant allows individual values and
     the value lies inside the range in force at signing; otherwise it is
     ignored, never clamped;
  2. the template's value, copied onto the activity when the work was added,
     when the credit's role equals the skill's role on the activity (source
     `template`); the live template is never read at signing;
  3. the skill's own value for the role (source `skill`);
  4. the tenant's value for the role (source `tenant`).
- The credit row stores `role`, `points`, `points_source` and
  `policy_version` (`<scoring version>#<credit-policy version>`), so a later
  change to any setting never rewrites what was signed.

### How a badge is judged

`evaluateBadge` in `packages/domain/src/scoring/badges.ts` reads a person's
net credits (those not reversed) for one skill at or above the badge level:

- **One piece of work counts once per skill.** `projectWork` groups the
  credits by interaction. A piece of work is worth the highest points among
  its credits; its primary value is the highest points among its primary
  credits, computed separately; it is first-hand when any of its credits was.
  Badge evaluation, progress and the progress sentence all read points
  through this one projection, so a second observer of the same work adds an
  observer, not points.
- **The criteria**, all of which must hold:
  - points: the sum of the work's values reaches the badge total;
  - pieces of work: at least the minimum number of interactions;
  - observers: at least the minimum number of distinct observers;
  - first-hand: the number of pieces of work seen or reviewed first-hand
    reaches the share of the larger of the work observed and the minimum
    pieces of work, rounded up and never less than one. This is the rule from
    before points, unchanged, with the minimum pieces of work in place of the
    old minimum number of demonstrations. Points do not weigh in;
  - span: the days between the first and the last piece of work;
  - primary points, only when the minimum is above zero: the sum of the work's
    primary values reaches it. Off by default.
- A skill may set its own badge total and its own primary-points minimum
  (`badgeCriteriaFor`).

### The tenant's credit policy

- Stored as `tenant.settings.creditPolicy` (`CreditPolicy` in
  `packages/domain/src/scoring/policy.ts`): primary and secondary points, the
  badge total, the minimum pieces of work, observers, first-hand share and
  span, the primary-points minimum, the most skills one observation may rate,
  and whether individual activity values are allowed and within what range.
- **Stored complete, and read exactly as stored or not at all.**
  `readStoredCreditPolicy` returns the stored policy or its problems. Nothing
  is merged over defaults. A missing or invalid policy stops signing and every
  policy-dependent read with a configuration error that names the tenant and
  the fields, until a program owner saves a valid one.
- **Changed only by a deliberate save.** A save names the version it started
  from (compare and set; `Conflict` when someone saved first), needs a reason,
  stores every field, bumps the version and writes an audit event with every
  field before and after ([ADR 0023](./0023-program-owners-administer-credit-rules-and-catalog.md)).
- **Working defaults** (`DEFAULT_CREDIT_POLICY`): 10 points for a primary
  skill, 3 for a secondary one, 30 for a badge, 3 pieces of work, 2 observers,
  half of the work first-hand, 28 days, no primary-points minimum, 3 skills on
  one observation, and individual values allowed from 1 to 20. Every new
  tenant is written with them as version 1 (`initialCreditPolicy`). They exist
  so the product can run; they are not approved numbers.
  [Open questions](../product/open-questions.md) 26 to 35 track them.

### No new floors

The numbers belong to the experts, as they did before this change.
Validation requires only what a criterion can mean: at least one piece of
work, at least one observer, a span of zero days or more, and a
primary-points minimum no larger than the badge total. The upper bounds
(points up to 1000, a badge up to 100000, 50 pieces of work, 10 observers,
3650 days, 6 skills on one observation) are input sanity limits, not business
rules; the limit of 6 skills is also a database check that a migration can
raise. A secondary value above the primary value is allowed. The Credit rules
screen explains what each value means, and every save is reasoned and
audited. Whether the firm wants fixed minimums is open question 27.

### Legacy data

- Credits signed before this change carry role `unclassified`, source
  `legacy` and 10 points. The data never claims that primary development was
  observed. An unclassified credit counts its 10 points toward the total and
  never toward a primary-points minimum. Ratings signed before roles existed
  are `unclassified` too. New credits can only be `primary` or `secondary`
  with a real source: a database trigger refuses the rest.
- Old tenant settings (`settings.badgeCriteria`) convert exactly, with no
  clamping: N demonstrations become N pieces of work and N × 10 points;
  observers, first-hand share and span are copied; an absent key takes the
  value the old code used (3, 2, 0.5, 28). A value the new policy cannot
  represent fails the migration and names the tenant. The old key stays in
  place, unused, for one release.
- An award saved before this change is read as N pieces of work and N × 10
  points, with no primary-points requirement.
- Over a ledger that holds only legacy credits, every award and revocation
  decision is the same as before (`packages/db/src/migration-compat.test.ts`).
  Two things do change: revocation now uses the award's saved thresholds, and
  a ledger that mixes legacy and new credits can decide differently from the
  old count.

### Revocation and re-award

- A void reverses the observation's credits and judges each affected badge by
  the thresholds saved on its award, never by the policy of the day. A badge
  that no longer holds is revoked. The same transaction then judges that
  skill under the current policy and, if it is still met, awards it again as a
  new award with the current thresholds.
- A policy change never re-evaluates existing awards and never awards in
  bulk, so a mistaken loosening cannot mint badges that only reversals could
  remove. A badge that has become reachable is awarded at the person's next
  signed credit for that skill, and the progress sentence says so. This is a
  working default (open question 34).

### Individual activity values

- A plan agreer (the owner's engaged coach, or their leader when they have no
  coach) or a program owner may set or clear one skill's value on one piece of
  planned work. **The subject of the activity never may, whatever grants they
  hold.**
- It needs the tenant's switch to be on, a value inside the tenant's range,
  and a reason of at least 10 characters, kept as a note. It is audited with
  before and after.
- It is set when work is planned, not when it is observed: it is refused on ad
  hoc work, on closed work or plans, and once the work has an observation that
  is open or signed. Editing the work keeps it; removing the skill removes it.
- The credit records source `activity`, so the value stays visible afterwards.
- **Accepted residual risk:** the coach who sets a value may also be the
  person who signs the observation. The value is bounded by the experts'
  range, needs a reason, is audited and is recorded on the credit, and the
  badge still needs a second observer, several pieces of work and time. Open
  question 32 asks whether that is enough.

### Alternatives considered

- **Separate participation points beside the demonstration count** (the
  external reviewer's proposal). It adds a second currency, and it would
  permanently block the secondary-skill badge the business asked for.
- **Two fixed routes, such as "3 primary or N secondary".** Simpler to
  explain, but a mix of both earns nothing. A points total covers both
  routes, and a per-skill primary-points minimum can require focused work
  where experts want it.
- **Fractional demonstrations.** The same arithmetic as points, presented
  less naturally.
- **Weighting the first-hand share by points.** Proposed in the second
  revision of the specification and withdrawn. Neither form dominates: a
  count lets most points come from discussed work, while a share of points
  lets one high-value first-hand observation satisfy the rule alone. The
  existing count of pieces of work stays; open question 28 records both
  examples.
- **Structural floors** (at least two pieces of work, two observers and a day,
  whatever a tenant sets). Withdrawn in the third revision: they were new
  business rules nobody had chosen, and the old settings had no such floors.
  What stays fixed is that every criterion is evaluated.
- **Summing every credit row.** Two signatures on one meeting would double
  its points. Taking the highest value per piece of work keeps the old rule
  that one interaction counts once.

### How we would know this was wrong

- Coaches or leaders do not trust badges earned mostly from secondary credit,
  or the feedback-only share of secondary ratings stays near zero (observers
  tick secondary skills freely).
- Individual values are used often, mostly at the top of the range, or mostly
  by the person who then signs.
- People lobby for the values of their activities, or cannot predict what
  their next observation is worth.
- Experts cannot agree on values, so the working defaults are never
  replaced.

None of this has been measured yet: there has been no pilot.
