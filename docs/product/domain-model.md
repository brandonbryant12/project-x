# Domain model

This document covers the business domain: its bounded contexts, the entities
each one owns, the rules that always hold, and every lifecycle. For
vocabulary, see the [glossary](../../CONTEXT.md). Tables and constraints are
in the [data model](../architecture/data-model.md). The lifecycle machines
live in `packages/domain/src/lifecycles/`. When this document and the code
disagree, the code is the truth and this document must be fixed.

**Fixed with the client:** the coach / coachee / leader triangle, skills as
the unit of development, and the term "development plan". Everything else
here is our best current design and is open to domain experts (see
[domain-expert questions](domain-expert-questions.md)).

## Three core positions

1. **Roles are edges, not attributes.** A person is a _leader_, _coach_ or
   _coachee_ with respect to someone else. Only the professional **coach**
   grant and the administrative roles are stored on the person.
2. **Credit is a signed human attestation about a real event.** A credit is
   one _demonstration_: a skill shown at a level, seen by one observer, in one
   interaction. It also carries the skill's **role** in that work (primary or
   secondary) and its **points**, both fixed when the observation is signed.
   Credits live in an append-only ledger.
3. **AI may hold or nudge, but never clear.** Assistant checks are advisory
   records kept alongside the human flow. They run on the observer's own
   note, after the observer has written it.

## Bounded contexts

| Context         | Owns                                                                                                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Directory**   | Tenant, Person, ReportingLine, BusinessFunction, RoleGrant, JobFamily, PersonPosition                                                                                                   | Mirrors Entra ID. Effective-dated, never edited by product flows. See [identity and access](../architecture/identity-and-access.md).                                                                                                                                                                                                       |
| **Catalog**     | Skill (with optional values of its own), SkillVersion (levels and indicators), ActivityTemplate (skills with roles and optional values)                                                 | Built: program owners and tenant admins create, edit, publish and retire skills and templates at run time, with an audit record (ADR 0023). Published skill versions are immutable. Each indicator has a lineage key that stays stable across versions. Templates are not versioned: an edit applies to work added afterwards.             |
| **Coaching**    | CoachingEngagement, ObserverDesignation                                                                                                                                                 | The mesh: either person may propose that a coach coaches someone, in either direction, if the coach holds the coach grant, is not that person's direct leader, and the pair has no live engagement in either direction (`checkEngagementProposal`). Carries no reporting authority. Conversations and commitments are deferred (ADR 0019). |
| **Development** | DevelopmentPlan (focus skills with **target levels**, a closing review), Activity (skills with roles, an **observation commitment**, optional individual values), Interaction, Evidence | The coachee's workspace. Logging an event is never credit. Work added from a published template copies the template's roles and values.                                                                                                                                                                                                    |
| **Recognition** | Observation, Rating (with its role), CreditEntry (role, points, source), CreditReversal, BadgeAward; the tenant's credit policy                                                         | The **only** context that writes credit. A credit's value is resolved only at signing.                                                                                                                                                                                                                                                     |
| **Advisory**    | AdvisoryCheck, AdvisoryDisposition                                                                                                                                                      | Gemini Decisions wrapper: the privacy screen only. The learning loop is deferred (ADR 0016).                                                                                                                                                                                                                                               |
| **Compliance**  | AuditEvent, Note                                                                                                                                                                        | Append-only and exportable. Human reasons live in purgeable notes.                                                                                                                                                                                                                                                                         |
| **Hub**         | Notification, NotificationPreference; the adoption view (a read-only projection)                                                                                                        | Tells people what waits on them, and shows the program owner aggregates. Writes nothing in other contexts (ADR 0018, ADR 0021).                                                                                                                                                                                                            |

## From work to credit

| Term                       | Plain meaning                                                                                                      | Created by                              | Earns credit?                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------- |
| **Activity**               | "What I plan to do": real work in my plan, naming who will observe it and how                                      | Coachee, with their coach               | No                                                 |
| **Interaction**            | "A time I did it": a dated real-world event                                                                        | Coachee, or the observer ("I saw this") | No                                                 |
| **Evidence**               | "What I reflected": the coachee's own note on the interaction, screened for privacy                                | Coachee                                 | No, and the AI never pre-reads it for the observer |
| **Observation**            | "What my coach or leader saw": an eligible observer's account, with a level per skill and one specific comment     | An eligible observer                    | Only when **signed**                               |
| **Demonstration (credit)** | One skill at one level, seen by one observer, in one interaction, with its role and points                         | The system, at signing                  | It _is_ the credit                                 |
| **Badge**                  | Recognition that a level was shown in enough work to reach a points total, seen by enough people, over enough time | The system, by policy                   | n/a                                                |

Decisions behind this table:

- **Confirmation is the `SIGN` transition, not an entity.**
- **Minimum to sign** is a level for each rated skill plus one specific
  comment of at least 40 characters. An observation rates from one skill up
  to the tenant's maximum (working default 3; the database allows at most 6). **Indicators are
  optional**: they serve as the level's reference card. A single rating plus a
  comment yields better feedback than long forms (micro-CEX).
- **Modes are named honestly:**
  - `saw_it`: the observer was there;
  - `reviewed_work`: the observer reviewed a recording or work product;
  - `discussed`: the coachee told the observer about it.

  Only the first two are first-hand. Badge criteria cap how much discussed
  work can count.

- **Each rated skill has a role,** primary or secondary, with at most one
  primary. The observer owns the roles on an observation, as they own the
  mode: the activity only suggests them, the observer may change them until
  signing, and the subject never can. The signed roles are kept on the
  ratings and in the `SIGN` audit event.
- **Two observers of one interaction each write their own row.** If they
  disagree, that disagreement is kept, because it is the best calibration
  signal we have. One piece of work counts once per skill: badge criteria
  count distinct _interactions_, and a piece of work adds the highest points
  among its credits, never their sum.
- **The same work is recorded once.** "I saw this" first offers the work the
  subject already logged for the chosen day, and an observation attached to it
  takes that work's date and kind instead of creating a second interaction.
  The server accepts only the subject's own work, inside the observe window,
  and never a second open or signed observation of one piece of work by the
  same observer. Logged work is development data: it is offered only to the
  subject's coaches and leader chain, and only work the observer was eligible
  for on its date. The subject's reflection reaches an observer only when the
  subject asked them, or the observer may see the subject's development. Two people deliberately logging one event as two pieces of
  work is still possible (see the [backlog](../backlog.md)).
- **A returned request is revised, then resent.** The subject reads the
  return note, revises the reflection from the same screen, may write a new
  note to the observer (an empty note keeps the earlier one) and resends; the
  observer is notified again. The due date does not move. A reflection held
  for privacy is never sent to an observer: asking for an observation and
  resending are both refused until it clears. Escalated text does not block
  either, because it is a compliance matter the author cannot revise.
- **"Feedback only" is allowed.** A rating may be signed with no credit, so
  observers are not forced to choose between crediting and refusing.

## Invariants (never configurable)

Each one maps to its tests in [invariants.md](../testing/invariants.md).

- **I1.** Nobody observes or credits themselves.
- **I2.** Credit is created only by `SIGN`, and it agrees with the
  observation, rating (including the rating's role) and interaction that
  created it (enforced by database foreign keys and a trigger). Its points
  are resolved once, at signing, and never change.
- **I3.** The ledger, audit trail and published catalog are
  append-only. Corrections are reversal rows.
- **I4.** Eligibility is evaluated as of the interaction date. The basis
  points at the exact reporting-line or engagement row.
- **I5.** A model result never clears, credits, awards or releases anything.
- **I6.** Every lifecycle transition is audited with actor, states, reason
  and policy version.
- **I7.** Development records never hold client-identifying data. The only
  client field is an opaque `client_ref`. Text the local screen holds never
  reaches a model or an observer.
- **I8.** A signed attestation is immutable.

Added in the hub round. The numbers are shared with
[invariants.md](../testing/invariants.md):

- **I15.** The observer sets the mode at signing. First-hand status is never
  the coachee's claim.
- **I16.** Logging is bounded in the past: 30 days for an interaction, 14 days
  for "I saw this".
- **I17.** Until it is signed, only its observer sees a draft's level and
  narrative.
- **I20.** A notification carries no content: no narrative, reflection,
  level, hold reason or `client_ref` (ADR 0018).

Added with weighted signed credit and run-time administration (2026-11-17):

- **I33.** One piece of work counts once per skill, at the highest value
  among its credits. Credit from before roles existed never counts as
  primary.
- **I34.** The observer owns the roles on an observation. At most one skill is
  primary, and the subject can never set a role.
- **I35.** A stored credit policy is read exactly as stored or reported as
  broken, never filled from defaults. It changes only by a reasoned,
  version-checked, audited save, and a save never awards or revokes a badge.
- **I36.** A void is judged by the thresholds saved on each award; the skill
  is then judged again under the current policy.
- **I38.** An individual value is never set by the person whose work it is,
  never after the work has been observed, and never applies to work done
  before the day it was set or logged before the moment it was set.
- **I39.** A closed plan is never edited, and a closing review never writes
  credit or a badge.
- **I46.** One piece of work is observed at most once by each observer, and
  "I saw this" attaches only to the subject's own work.
- **I47.** "I saw this" never shows a person's logged work or reflection to
  someone who may not see their development.

## Eligible observer

Person **O** may sign an observation of person **S** for an interaction on
date **D** only if all of the following hold:

1. O ≠ S.
2. On D, O was S's **direct leader**, **or** O held an active coach grant and
   an **accepted** engagement with S, **or** O was **designated** for S by S's
   leader or engaged coach, for a window covering D (ADR 0020).
3. O does not report to S, directly or up the chain, on D.
4. The observation was requested within the signing window, which defaults to
   14 days. After that it expires.

**Designations.** A designation lasts at most 90 days. The designee is never
the subject, the designator, or someone who reports to the subject. Two
designations between the same two people may not overlap, in either
direction, so peers cannot be designated to credit each other. The database
enforces this with an exclusion constraint. A designation can be ended early,
once, and is otherwise never changed. Designations are audited and visible to
the subject. Restricting one to named skills is _planned_.

**Designed, not built:** reciprocal-pair exclusion on badge credit. If A and B
credit each other within 90 days, only one of them would count toward the
distinct-observer criterion (open question 17).

## Recognition

A badge exists for each skill at **levels 2 and 3**. Every criterion below is
always evaluated; a tenant changes the numbers, at run time, on the Credit
rules screen (ADR 0007, ADR 0023). The numbers shown are **working
defaults**, not decided values ([open questions](open-questions.md) 26 to 35):

- **Points.** Each credit is worth points, fixed at signing. The working
  defaults are 10 when the skill was primary in the work and 3 when it was
  secondary. A badge needs **30 points** at or above the badge level. A piece
  of work counts once per skill, at the highest value among its credits, so a
  second observer of the same meeting adds an observer, not points.
- **Pieces of work.** At least **3 interactions** at or above the badge level.
- **Observers.** At least **2 distinct observers**.
- **First-hand.** At least **half** of the pieces of work seen or reviewed
  first-hand (`saw_it` or `reviewed_work`), counted against the larger of the
  work so far and the minimum pieces of work, and never fewer than one. Points
  do not weigh in.
- **Time.** At least **28 days** between the first and latest piece of work,
  measured on interaction dates, not signing dates.
- **Primary points** (off by default). A tenant or a skill may require that
  some of the badge's points come from work where the skill was primary.

Where a credit's value comes from, most specific first: the value set on that
piece of planned work, then the template's value copied onto the work when it
was added, then the skill's own value, then the tenant's. The credit records
which one applied (`points_source`).

Further rules:

- **Secondary credit can earn a badge.** A skill that was secondary in many
  pieces of work earns its badge once the points total and every other
  criterion are met. This was the business partner's request.
- **Credit from before roles existed** (signed before the
  `20261117125514_credit_points` migration) is stored as
  `unclassified`, worth 10 points, and never counts as primary.
- **Changing the rules never changes what was signed** and never awards or
  revokes a badge by itself. A badge that a change has made reachable is
  awarded at the person's next signed credit for that skill, and the progress
  sentence says so.
- **A void** reverses the observation's credits. Each affected badge is judged
  by the thresholds saved on its award; if it no longer holds it is revoked,
  and the skill is judged again under the current rules, which may award it
  again as a new award.
- **Progress is shown as plain benchmarks,** for example "One more observation from a
  second observer to earn Client discovery · Doing independently." Points are shown to the person and to those who may see
  their progress; there are no totals across people and no rankings.
- **Individual values.** A plan agreer or a program owner may give one skill
  on one piece of planned work its own value, inside the tenant's range, with
  a reason, before the work is observed. It applies only to work logged from
  the moment it is set and done that day or later, so work already logged
  never gets it, even earlier the same day. Changing or clearing it sends work
  logged under the old value back to the template, skill or tenant value. The
  person whose work it is never may (I38).
- **Level 4, "Teaching others"** cannot be shown in a client meeting. It will
  be earned by developing others: signed observations _given_ as a designated
  observer. This is designed, not built. A plan may still target level 4: a
  plan target is judged by people in the closing review, not by a badge.
- **Waivers** of the observer or first-hand criterion are designed, not built
  (the `badge_waiver` table was removed unused). When built, a waiver is an
  audited row, never a silent override.
- **Production metrics never feed recognition.** Assets, retention and
  revenue are studied only in aggregate, and only offline.

## Closing review

When a plan ends, its owner records what became of each focus skill
(`achieved`, `partly`, `carried_over` or `not_pursued`) and a closing summary.
The owner may record it while the plan is active, paused, completed or
expired, and may change it until an agreer (the coach, or the leader when
there is no coach) confirms it; after that it is fixed. It is a person's
judgment, informed by the signed observations, never computed from badges,
and it never writes credit or a badge. It is a fact beside the plan with its
own audit events, not a lifecycle. Revising the plan clears a review that is
not yet confirmed; a confirmed review stops the plan being revised. Built
(`apps/server/src/features/development/plan-review.ts`).

## Lifecycles

Each lifecycle is an XState v5 machine
([ADR 0005](../adr/0005-explicit-lifecycles-with-xstate.md)), and the
database CHECK constraints are generated from the same state lists. "H" marks
transitions that only a human can make.

| Entity                       | States                                                                                                                                                           | Key events and guards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skill / ActivityTemplate** | draft → published → retired · discarded; published → published (next version)                                                                                    | `PUBLISH` (H, program owner or tenant admin), guarded by a complete definition: four levels with a summary and an indicator each for a skill, at least one published skill for a template. `PUBLISH` on a published skill writes its draft as the next immutable version. `RETIRE` stops new use.                                                                                                                                                                                                                                                                                                                          |
| **CoachingEngagement**       | proposed → active ⇄ paused → ended · declined · withdrawn · expired                                                                                              | Either person may propose, in either direction, when the coach holds the coach grant, is not the coachee's direct leader, and the pair has no live engagement either way. `ACCEPT` / `DECLINE` (H, the other party). Guard: the coach grant is active. Expires after 14 days.                                                                                                                                                                                                                                                                                                                                              |
| **DevelopmentPlan**          | draft → proposed → active ⇄ paused → completed · canceled · expired; proposed · active → draft (`REVISE`)                                                        | `PROPOSE` needs 1–3 focus skills (each with a target level) and at least one activity. `AGREE` (H): the coach, or the leader if the coachee has no coach. `ENDORSE` (H): the leader chain, which can never block the plan. `REVISE` (H, the owner or an agreer) returns the plan to a draft and clears the agreement, the endorsement and an unconfirmed closing review; it is refused once the review is confirmed. Every unfinished plan, drafts included, expires after the period ends plus a grace period. The owner edits title, intent and end date while the plan is not closed, and focus skills only in a draft. |
| **Activity**                 | planned → underway → done · canceled · expired                                                                                                                   | Becomes underway on its first interaction. The owner or an agreer adds work while the plan is open, and edits planned work (skills with roles, at most one primary) while it is planned or underway.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Evidence**                 | screening → available · held · escalated; held → screening (`REVISE`) · available (`RELEASE`, H admin); escalated → available (`RESOLVE`, H compliance)          | The local screen holds immediately and fails closed. Text that passes it is available at once. The AI may then only `HOLD` (suspected PII) or `ESCALATE` (complaint or specific recommendation); it never clears anything. Escalated evidence is never edited away.                                                                                                                                                                                                                                                                                                                                                        |
| **Observation**              | requested → drafting → signed · declined · returned · withdrawn · expired; returned → requested (`RESUBMIT`); signed → under_review → signed (`UPHOLD`) · voided | `SIGN` (H, never automated). `RESUBMIT` (H, the requester) only while their reflection is not held for privacy. `ACKNOWLEDGE` / `REQUEST_REVIEW` (H, the subject, once). `VOID` / `UPHOLD` (H, **compliance reviewer** only; void appends reversals, revokes any badge whose saved criteria no longer hold, then judges the skill again under the current rules). The observer sets the **mode** and the **roles** at signing, so neither first-hand status nor primary focus is the coachee's claim.                                                                                                                      |
| **BadgeAward**               | awarded → revoked                                                                                                                                                | Awarded by policy from signed credit, saving the criteria it was judged by; revoked only by a reversal, judged by those saved criteria. A badge earned again after a revocation is a new award.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **AdvisoryCheck**            | pending → completed · failed · skipped                                                                                                                           | Written once. Failures never count as a pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

These are deliberately **not** machines: `CreditEntry` and `CreditReversal`
(immutable facts), badge progress (a projection),
`ObserverDesignation` (a fact that may be ended once), the closing review of
a plan (a fact recorded beside the plan, with its own audit events), the
tenant's credit policy (a versioned setting changed only by an audited save),
and `Notification` (an outbox row: `pending → sent · skipped · failed`, set
only by the dispatcher).

## Visibility

| Data                                                                                                                        | Who can see it                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Catalog (including a skill's own values and a template's roles and values), earned badges with their plain facts, directory | Everyone in the tenant                                                                                                |
| Plans, progress (including points, and how a badge was earned credit by credit), interactions, levels, roles                | The person, their active coaches, their whole leader chain                                                            |
| **Observation narratives**                                                                                                  | The person, the observer who wrote them, active coaches, and the **direct** leader. The wider chain sees levels only. |
| Held or escalated evidence                                                                                                  | Its author, plus tenant admins or compliance reviewers                                                                |
| Assistant checks                                                                                                            | The observer (not the subject).                                                                                       |
| Audit trail and AI usage                                                                                                    | Tenant admins and compliance reviewers. Reading them is itself audited.                                               |
| Designations for a person                                                                                                   | The person, the designee, the person's leader and coaches                                                             |
| Adoption view                                                                                                               | Program owners. Aggregates only, no names, no cell under five people                                                  |
| Credit rules, catalog administration and their change history                                                               | Program owners and tenant admins. Nothing per person                                                                  |
| Notifications                                                                                                               | The recipient. A message carries names, a verb, counts, dates and a link only                                         |

## Designed next

Cohorts, Graph directory sync, skill profiles (ADR 0017) and coaching
conversations (ADR 0019) are designed but deferred. See the
[backlog](../backlog.md) and the [open questions](open-questions.md).

## How we will know it works

The adoption view shows four aggregate numbers: people with a plan, coverage
(observed for work dated in the last 42 days), median days from logging to
signature, and the expiry rate. See the
[product overview](overview.md#how-we-will-know-it-works) and
[ADR 0021](../adr/0021-program-owner-and-adoption-view.md).
