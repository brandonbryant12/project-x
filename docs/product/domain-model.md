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
   interaction. Credits live in an append-only ledger.
3. **AI may hold or nudge, but never clear.** Assistant checks are advisory
   records kept alongside the human flow. They run on the observer's own
   note, after the observer has written it.

## Bounded contexts

| Context         | Owns                                                                                                                        | Notes                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Directory**   | Tenant, Person, ReportingLine, BusinessFunction, RoleGrant, JobFamily, PersonPosition                                       | Mirrors Entra ID. Effective-dated, never edited by product flows. See [identity and access](../architecture/identity-and-access.md). |
| **Catalog**     | Skill, SkillVersion (levels and indicators), SkillProfile, ActivityTemplate                                                 | Curated by catalog keepers. Published versions are immutable. Each indicator has a lineage key that stays stable across versions.    |
| **Coaching**    | CoachingEngagement, ObserverDesignation, CoachingConversation, Commitment                                                   | The mesh: any coach can engage anyone. Carries no reporting authority. Conversations and commitments never write credit (ADR 0019).  |
| **Development** | DevelopmentPlan (focus skills with **target levels**), Activity (with an **observation commitment**), Interaction, Evidence | The coachee's workspace. Logging an event is never credit.                                                                           |
| **Recognition** | Observation, Rating, CreditEntry, CreditReversal, BadgeAward, BadgeWaiver                                                   | The **only** context that writes credit.                                                                                             |
| **Advisory**    | AdvisoryCheck, Exposure, Label, SecondRead, QuestionSetRelease                                                              | Gemini Decisions wrapper and the learning loop (ADR 0016).                                                                           |
| **Compliance**  | AuditEvent, Note, LegalHold                                                                                                 | Append-only and exportable. Human reasons live in purgeable notes.                                                                   |
| **Hub**         | Notification, NotificationPreference; the adoption view (a read-only projection)                                            | Tells people what waits on them, and shows the program owner aggregates. Writes nothing in other contexts (ADR 0018, ADR 0021).      |

## From work to credit

| Term                       | Plain meaning                                                                                                  | Created by                              | Earns credit?                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| **Activity**               | "What I plan to do": real work in my plan, naming who will observe it and how                                  | Coachee, with their coach               | No                                                 |
| **Interaction**            | "A time I did it": a dated real-world event                                                                    | Coachee, or the observer ("I saw this") | No                                                 |
| **Evidence**               | "What I reflected": the coachee's own note on the interaction, screened for privacy                            | Coachee                                 | No, and the AI never pre-reads it for the observer |
| **Observation**            | "What my coach or leader saw": an eligible observer's account, with a level per skill and one specific comment | An eligible observer                    | Only when **signed**                               |
| **Demonstration (credit)** | One skill at one level, seen by one observer, in one interaction                                               | The system, at signing                  | It _is_ the credit                                 |
| **Badge**                  | Recognition that a level has been demonstrated enough, by enough people, over enough time                      | The system, by policy                   | n/a                                                |
| **Commitment**             | "What I agreed to do next": from an observer's next step or a conversation                                     | Observer at signing, or a conversation  | **Never**                                          |
| **Conversation**           | "When we talked": a scheduled meeting with a coach or leader                                                   | Either party                            | **Never**                                          |

Decisions behind this table:

- **Confirmation is the `SIGN` transition, not an entity.**
- **Minimum to sign** is a level for each rated skill (one to three skills)
  plus one specific comment of at least 40 characters. **Indicators are
  optional**: they serve as the level's reference card. A single rating plus a
  comment yields better feedback than long forms (micro-CEX).
- **Modes are named honestly:**
  - `saw_it`: the observer was there;
  - `reviewed_work`: the observer reviewed a recording or work product;
  - `discussed`: the coachee told the observer about it.

  Only the first two are first-hand. Badge criteria cap how much discussed
  work can count.

- **Two observers of one interaction each write their own row.** If they
  disagree, that disagreement is kept, because it is the best calibration
  signal we have. Criteria count distinct _interactions_, so one interaction
  never counts twice.
- **"Feedback only" is allowed.** A rating may be signed with no credit, so
  observers are not forced to choose between crediting and refusing.

## Invariants (never configurable)

Each one maps to its tests in [invariants.md](../testing/invariants.md).

- **I1.** Nobody observes or credits themselves.
- **I2.** Credit is created only by `SIGN`, and it agrees with the
  observation, rating and interaction that created it (enforced by database
  foreign keys).
- **I3.** The ledger, audit trail, labels and published catalog are
  append-only. Corrections are reversal rows.
- **I4.** Eligibility is evaluated as of the interaction date. The basis
  points at the exact reporting-line or engagement row.
- **I5.** A model result never clears, credits, awards or releases anything.
- **I6.** Every lifecycle transition is audited with actor, states, reason
  and policy version.
- **I7.** Development records never hold client-identifying data. The only
  client field is an opaque `client_ref`.
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

A badge exists for each skill at **levels 2 and 3**. The default criteria,
which a tenant can tune in number but not in structure, are:

- at least **3 interactions** demonstrating the skill at or above the badge
  level;
- at least **2 distinct observers**;
- at least **half** of those demonstrations first-hand (`saw_it` or
  `reviewed_work`);
- at least **28 days** between the first and latest demonstration. The span is
  measured on interaction dates, not signing dates.

Further rules:

- **There are no points.** Points measured volume, not development, and
  people stop trusting rules they cannot predict. Progress is shown as plain
  benchmarks, for example "One more observation from a second observer to earn
  Client discovery · Doing independently."
- **Level 4, "Teaching others"** cannot be shown in a client meeting. It will
  be earned by developing others: signed observations _given_ as a designated
  observer, plus calibration agreement. This is designed, not built.
- **Waivers.** A waiver of the observer criterion or the first-hand criterion,
  for example for someone with only one eligible observer, is an audited row.
  It is never a silent override.
- **Production metrics never feed recognition.** Assets, retention and
  revenue are studied only in aggregate, and only offline.

## Lifecycles

Each lifecycle is an XState v5 machine
([ADR 0005](../adr/0005-explicit-lifecycles-with-xstate.md)), and the
database CHECK constraints are generated from the same state lists. "H" marks
transitions that only a human can make.

| Entity                       | States                                                                                                                                                  | Key events and guards                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skill / ActivityTemplate** | draft → published → retired · discarded                                                                                                                 | `PUBLISH` (H, keeper), guarded by the definition being complete                                                                                                                                                                                                                                                      |
| **CoachingEngagement**       | proposed → active ⇄ paused → ended · declined · withdrawn · expired                                                                                     | `ACCEPT` / `DECLINE` (H, the other party). Guard: the coach grant is active. Expires after 14 days.                                                                                                                                                                                                                  |
| **DevelopmentPlan**          | draft → proposed → active ⇄ paused → completed · canceled · expired                                                                                     | `PROPOSE` needs 1–3 focus skills (each with a target level) and at least one activity. `AGREE` (H): the coach, or the leader if the coachee has no coach. `ENDORSE` (H): the leader chain, which can never block the plan. Expires after the period ends plus a grace period.                                        |
| **Activity**                 | planned → underway → done · canceled · expired                                                                                                          | Becomes underway on its first interaction                                                                                                                                                                                                                                                                            |
| **Evidence**                 | screening → available · held · escalated; held → screening (`REVISE`) · available (`RELEASE`, H admin); escalated → available (`RESOLVE`, H compliance) | The local screen holds immediately and fails closed. Text that passes it is available at once. The AI may then only `HOLD` (suspected PII) or `ESCALATE` (complaint or specific recommendation); it never clears anything. Escalated evidence is never edited away.                                                  |
| **Observation**              | requested → drafting → signed · declined · returned · withdrawn · expired; signed → under_review → signed (`UPHOLD`) · voided                           | `SIGN` (H, never automated). `ACKNOWLEDGE` / `REQUEST_REVIEW` (H, the subject, once). `VOID` / `UPHOLD` (H, **compliance reviewer** only; void appends reversals and revokes any badge whose criteria no longer hold). The observer sets the **mode** at signing, so first-hand status is never the coachee's claim. |
| **BadgeAward**               | awarded → revoked                                                                                                                                       | Awarded by policy from signed credit; revoked only by a reversal                                                                                                                                                                                                                                                     |
| **AdvisoryCheck**            | pending → completed · failed · skipped                                                                                                                  | Written once. Failures never count as a pass.                                                                                                                                                                                                                                                                        |
| **CoachingConversation**     | scheduled → held · missed · cancelled                                                                                                                   | `HOLD` / `MISS` (H) only once the scheduled time has arrived. `RESCHEDULE` keeps it scheduled. Marked missed if nobody closes it within 7 days. Built: `features/rhythm/`, journey `conversation-carries-commitments` (I27).                                                                                         |
| **Commitment**               | open → done · dropped; done · dropped → open (`REOPEN`)                                                                                                 | Owned by the coachee. Never earns credit. Built: `features/rhythm/`; journey `conversation-carries-commitments` (I27).                                                                                                                                                                                               |

These are deliberately **not** machines: `CreditEntry` and `CreditReversal`
(immutable facts), badge progress (a projection), labels (facts),
`ObserverDesignation` (a fact that may be ended once), and `Notification` (an
outbox row: `pending → sent · skipped · failed`, set only by the dispatcher).

## Visibility

| Data                                  | Who can see it                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Catalog, earned badges, directory     | Everyone in the tenant                                                                                                |
| Plans, progress, interactions, levels | The person, their active coaches, their whole leader chain                                                            |
| **Observation narratives**            | The person, the observer who wrote them, active coaches, and the **direct** leader. The wider chain sees levels only. |
| Held or escalated evidence            | Its author, plus tenant admins or compliance reviewers                                                                |
| Assistant checks                      | The observer (not the subject). Shadow-arm checks are visible to no one.                                              |
| Audit trail and AI usage              | Tenant admins and compliance reviewers. Reading them is itself audited.                                               |
| Designations for a person             | The person, the designee, the person's leader and coaches                                                             |
| Adoption view                         | Program owners. Aggregates only, no names, no cell under five people                                                  |
| Notifications                         | The recipient. A message carries names, a verb, counts, dates and a link only                                         |

## Designed next

- **Private coach notes** on a conversation, once compliance answers retention
  and access (open question 23).
- **Program and Cohort**: a template plan plus an enrollment backed by an AD
  group (for example, new-advisor cohorts).
- **Directory sync**: a scheduled Microsoft Graph sync of `manager` and app
  roles, which records directory exceptions instead of rejecting HR data. A
  CSV import with an exceptions queue comes first.
- **Profiles and expectations by job family** (ADR 0017, proposed). The
  columns exist; every credit is pinned to `core` until HR agrees.

## How we will know it works

- **Time to signature:** the median time from logging an interaction to a
  signed observation. This is the north star, because observer capacity is
  the constraint.
- **Coverage:** the share of people with an active plan who have a signed
  observation of work dated in the last 42 days.
- **Distinct observers** per person per quarter.
- **Subject acknowledgement rate**, and how often people ask for a review.
- **Second-read agreement** between observers.

We do not measure success with the model that nudges people. Exact
definitions are in [ADR 0021](../adr/0021-program-owner-and-adoption-view.md).
