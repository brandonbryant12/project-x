# Glossary

Use these words in code, UI copy and docs. If a concept needs a new word,
add it here first. The model behind the terms is described in
[docs/product/domain-model.md](docs/product/domain-model.md).

## People and structure

| Term                    | Meaning                                                                                                                                               | Not to be confused with                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Tenant**              | One firm, mapped to one Entra ID tenant. Every row belongs to exactly one tenant.                                                                     | Business function                          |
| **Person**              | Someone in the tenant directory, mirrored from Entra ID.                                                                                              | "User" (use only in auth code)             |
| **Business function**   | A tenant taxonomy entry (Advisory, Client Service, …). It is a facet of a person, not a container.                                                    | Team                                       |
| **Reporting line**      | An effective-dated _manager → report_ edge synced from the directory.                                                                                 | Coaching engagement                        |
| **Leader**              | Anyone on the manager end of an active reporting line. Derived, never stored.                                                                         | Coach                                      |
| **Team**                | A leader plus their current direct reports. Derived, never stored.                                                                                    | Cohort                                     |
| **Coach**               | A person holding the `coach` role grant (from the Entra app role).                                                                                    | Leader                                     |
| **Coaching engagement** | A _coach ↔ coachee_ relationship in the mesh, proposed then accepted. Carries no reporting authority.                                                 | Reporting line                             |
| **Coachee**             | Anyone with a development plan or an engagement. Everyone can be one.                                                                                 | Advisor (a job title)                      |
| **Role grant**          | A dated capability from an Entra app role: `coach`, `tenant_admin`, `compliance_reviewer` or `program_owner`.                                         | Leader or coachee, which are relationships |
| **Program owner**       | A person holding the `program_owner` grant. Runs the program and sees the adoption view, nothing per person (ADR 0021).                               | Tenant admin                               |
| **Job family**          | A tenant taxonomy of jobs from the HR feed, such as _Financial advisor_. Pinned on credit through the position; expectations are deferred (ADR 0017). | Business function, Title                   |
| **Position**            | An effective-dated record of a person's job family, title and business function. A credit pins the subject's position on the interaction date.        | Person, which is not dated                 |

## Development

| Term                  | Meaning                                                                                                                                                                                   | Not to be confused with                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Skill**             | A named capability that matters to the business, e.g. _Client discovery_.                                                                                                                 | Badge                                           |
| **Skill version**     | An immutable published definition: four levels, each with observable indicators.                                                                                                          |                                                 |
| **Level**             | One step on a skill's ladder: 1 Learning, 2 Doing with support, 3 Doing independently, 4 Teaching others.                                                                                 |                                                 |
| **Indicator**         | An observable behavior at a level. Optional for the observer to tick. It carries a `lineage_key` that stays stable across versions.                                                       | Trait                                           |
| **Activity template** | A reusable piece of real work, e.g. _Discovery meeting with a new client_, with suggested skills and a tip for observers.                                                                 | Activity                                        |
| **Development plan**  | A coachee's active focus skills (one to three skills, each with a **target level**) plus optional practice activities. Starts active immediately by default; coach agreement is optional. |                                                 |
| **Activity**          | One item of planned real work, with an **observation commitment** (who will see it, and how). It is either `planned` or `ad_hoc`.                                                         | Interaction                                     |
| **Interaction**       | One dated occurrence of doing the work.                                                                                                                                                   | Observation                                     |
| **Client reference**  | An opaque CRM ID. Never a name.                                                                                                                                                           |                                                 |
| **Evidence**          | The coachee's reflection on an interaction, screened for privacy.                                                                                                                         | Observation                                     |
| **Try next time**     | The latest published observation's "What next", shown on the coachee's My skills screen. Not stored separately.                                                                           | Activity                                        |
| **Quick capture**     | The one-screen "Give feedback": an observer records who, when, mode, skills, level and comment, and publishes or saves a draft.                                                           | Asking for feedback, which is the coachee's act |

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

## Home and notifications

| Term               | Meaning                                                                                                                                                                                | Not to be confused with    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Waiting on you** | The first Home section: one queue of what needs the viewer, plus up to three people worth observing this week, each with a reason. Never a ranking.                                    | Inbox ("To sign")          |
| **Notification**   | One outbox row telling one person by email that something waits on them. Carries names, a verb, counts, dates and a link, never content (ADR 0018).                                    | Audit event                |
| **Digest**         | The Monday 07:30 email (tenant time zone) summarizing what waits, in counts and dates. Not sent when empty. No comparisons.                                                            | Notification for one event |
| **Adoption view**  | The program owner's page of four aggregate numbers: people with a plan, observed recently, median days to sign, expiry rate. No names; figures from fewer than five people are hidden. | Team view                  |

## What we say to users

Code and docs use the terms above. The UI uses plain words:

| Internal term                    | In the UI                                                       |
| -------------------------------- | --------------------------------------------------------------- |
| Interaction + observation ask    | "Ask for feedback"                                              |
| Observation (quick capture)      | "Give feedback"; its narrative is "What did they do well?"      |
| Development plan                 | "My skills" / "Focus skills"                                    |
| Coaching engagement              | coaching ("People I coach", "Stop coaching")                    |
| Demonstration                    | "times observed"                                                |
| Badge receipt                    | "How this was earned"                                           |
| Designation / designated basis   | "Asked to observe"                                              |
| Assistant check (privacy screen) | "Automated privacy check"; the admin page is "Assistant checks" |
| Inbox                            | "Feedback requests"                                             |
