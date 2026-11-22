# ADR 0007: Credit is posted only by signing an observation, to an append-only ledger

- Status: Accepted
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
the amendment below._

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

## Amendment (2026-11-22): tenant-configurable rigor & fact/rule separation

- **Tenant policy controls (`/admin/policy`):** Tenant admins can configure
  badge rigor (`minDemonstrations`, `minObservers`, `minFirstHandShare`,
  `minSpanDays`, with `poc` / `balanced` / `strict` presets) and
  `observationWindowDays` via `TenantPolicy` (`UpdateTenantPolicy`), audited
  and journaled as `TenantPolicyUpdated`.
- **Immutable facts separated from derived rules (ADR 0023):** Raw
  demonstration facts (`DemonstrationRecorded` / `DemonstrationReversed`) are
  stored independently of badge evaluation rules in `SkillLedger`. Tightening
  a tenant's rigor never silently revokes existing earned badges unless an
  admin explicitly invokes `ReevaluateStanding`, and adding a new non-first-hand
  (`discussed`) observation can never penalize or revoke an already-earned badge
  (forward no-penalty monotonicity).
