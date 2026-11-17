# Glossary

Use these words in code, UI copy and docs. If a concept needs a new word,
add it here first. The model behind the terms is described in
[docs/product/domain-model.md](docs/product/domain-model.md).

## People and structure

| Term                    | Meaning                                                                                                                                        | Not to be confused with                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Tenant**              | One firm, mapped to one Entra ID tenant. Every row belongs to exactly one tenant.                                                              | Business function                          |
| **Person**              | Someone in the tenant directory, mirrored from Entra ID.                                                                                       | "User" (use only in auth code)             |
| **Business function**   | A tenant taxonomy entry (Advisory, Client Service, …). It is a facet of a person, not a container.                                             | Team                                       |
| **Reporting line**      | An effective-dated _manager → report_ edge synced from the directory.                                                                          | Coaching engagement                        |
| **Leader**              | Anyone on the manager end of an active reporting line. Derived, never stored.                                                                  | Coach                                      |
| **Team**                | A leader plus their current direct reports. Derived, never stored.                                                                             | Cohort                                     |
| **Coach**               | A person holding the `coach` role grant (from the Entra app role).                                                                             | Leader                                     |
| **Coaching engagement** | A _coach ↔ coachee_ relationship in the mesh, proposed then accepted. Carries no reporting authority.                                          | Reporting line                             |
| **Coachee**             | Anyone with a development plan or an engagement. Everyone can be one.                                                                          | Advisor (a job title)                      |
| **Role grant**          | A dated capability from an Entra app role: `coach`, `catalog_keeper`, `tenant_admin`, `compliance_reviewer` or `program_owner`.                | Leader or coachee, which are relationships |
| **Program owner**       | A person holding the `program_owner` grant. Runs the program and sees the adoption view, nothing per person (ADR 0021).                        | Tenant admin                               |
| **Job family**          | A tenant taxonomy of jobs from the HR feed, such as _Financial advisor_. Used for skill profiles and, later, expectations (ADR 0017).          | Business function, Title                   |
| **Position**            | An effective-dated record of a person's job family, title and business function. A credit pins the subject's position on the interaction date. | Person, which is not dated                 |

## Development

| Term                  | Meaning                                                                                                                                                 | Not to be confused with                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Skill**             | A named capability that matters to the business, e.g. _Client discovery_.                                                                               | Badge                                               |
| **Skill version**     | An immutable published definition: four levels, each with observable indicators.                                                                        |                                                     |
| **Level**             | One step on a skill's ladder: 1 Learning, 2 Doing with support, 3 Doing independently, 4 Teaching others.                                               |                                                     |
| **Indicator**         | An observable behavior at a level. Optional for the observer to tick. It carries a `lineage_key` that stays stable across versions.                     | Trait                                               |
| **Activity template** | A reusable piece of real work, e.g. _Discovery meeting with a new client_, with suggested skills and a tip for observers.                               | Activity                                            |
| **Development plan**  | A coachee's plan for a period: one to three focus skills, each with a **target level**, plus the activities that will develop them.                     |                                                     |
| **Activity**          | One item of planned real work, with an **observation commitment** (who will see it, and how). It is either `planned` or `ad_hoc`.                       | Interaction                                         |
| **Interaction**       | One dated occurrence of doing the work.                                                                                                                 | Observation                                         |
| **Client reference**  | An opaque CRM ID. Never a name.                                                                                                                         |                                                     |
| **Evidence**          | The coachee's reflection on an interaction, screened for privacy.                                                                                       | Observation                                         |
| **Skill profile**     | A named variant of a skill's level descriptors for a capacity, such as "as a leader". Every skill has `core`; others wait for HR (ADR 0017).            | A separate skill                                    |
| **Try next time**     | The latest signed observation's "What next", shown on the coachee's plan. Not stored separately; conversations and commitments are deferred (ADR 0019). | Activity                                            |
| **Quick capture**     | The one-screen "I saw this": an observer records who, when, mode, skills, level and comment, and signs or saves to finish later.                        | Logging an interaction, which is the coachee\'s act |

## Recognition

| Term                                  | Meaning                                                                                                                                                                   | Not to be confused with                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Observation**                       | An eligible observer's account of an interaction: a level per skill plus one specific comment. It counts only once **signed**.                                            | Confirmation, which is the `SIGN` step |
| **Observer**                          | The person writing the observation: the subject's direct leader, an engaged coach, or a designated observer, as of the interaction date.                                  | Witness                                |
| **Designation / designated observer** | A colleague named by the subject's leader or engaged coach to observe them for a window of at most 90 days. Audited and visible to the subject (ADR 0020).                | Delegation of any other right          |
| **Basis**                             | Why the observer was eligible (`leader`, `coach` or `designated`), pointing at the exact edge or designation row.                                                         |                                        |
| **Mode**                              | How the observer knows. `saw_it` (was there), `reviewed_work` (recording or work product), or `discussed` (the coachee's account). Only the first two are **first-hand**. |                                        |
| **Demonstration**                     | One credit: a skill shown at a level, by one observer, in one interaction. Append-only.                                                                                   | Points, which no longer exist          |
| **Reversal**                          | The record that cancels one demonstration, written when its observation is voided.                                                                                        | Deletion, which never happens          |
| **Badge**                             | Recognition that a level was demonstrated in enough interactions, by enough observers, first-hand, over time. Levels 2 and 3 are awarded automatically.                   | Demonstration                          |
| **Waiver**                            | An audited exception to one badge criterion.                                                                                                                              |                                        |
| **Acknowledge / request review**      | The subject's response to a signed observation.                                                                                                                           |                                        |

## Assistant and governance

| Term                | Meaning                                                                                                                                                | Not to be confused with |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| **Assistant check** | One Decisions API evaluation, recorded with digests, probabilities, thresholds, effect and rationale. It may hold, escalate or nudge. It never clears. |                         |
| **Question set**    | A versioned set of closed questions with thresholds, e.g. `privacy-screen` v1. Changing the wording bumps the version.                                 | Prompt                  |
| **Hold / escalate** | Hold: suspected client PII, so the text is hidden until revised or released. Escalate: a complaint or specific recommendation, routed to compliance.   |                         |
| **Disposition**     | A human's explicit decision on a check (agreed or overrode), recorded with who and why.                                                                | Audit event             |
| **Note**            | A human-written reason (return note, void reason, …). It is purgeable content, linked from the audit event.                                            | Audit event             |
| **Audit event**     | An immutable record of who did what, when, why (reason code and note) and under which policy version.                                                  | Activity                |

## Hub and notifications

| Term              | Meaning                                                                                                                                                     | Not to be confused with    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Today**         | The Home band listing what happens today: planned work naming you as observer or due from you. Needs no calendar.                                           | Needs you                  |
| **This week**     | The Home band listing who to observe this week (each with a reason) and the next-step benchmark. Never a ranking.                                           | Digest                     |
| **Notification**  | One outbox row telling one person that something waits on them. Carries names, a verb, counts, dates and a link, never content (ADR 0018).                  | Audit event                |
| **Digest**        | The Monday 07:30 message (tenant time zone) summarizing what waits, in counts and dates. Not sent when empty. No comparisons.                               | Notification for one event |
| **Adoption view** | The program owner's aggregate page: time to signature, coverage, expiry, observers, acknowledgement and more. No names; cells under five people are hidden. | Team view                  |
