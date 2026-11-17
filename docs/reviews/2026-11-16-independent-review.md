# Independent review: 2026-11-16

An adversarial review by an independent reviewer. The reviewer read every
document and ADR, the domain, schema, server, AI and web code, probed the
live API as six personas, and inspected about 14 screenshots. The owner
asked for genuine challenge and grades. The table at the end records what we
adopted and what we deferred.

## Grades

| Area                       | Grade               | One line                                                                                                                                                                                   |
| -------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product idea & usefulness  | **B-**              | The thesis is sharp, but the loop depends on observers remembering to open an inbox. There are no notifications, observer capacity is not relieved, and adoption metrics are not computed. |
| Product decisions & domain | **B+ / B as built** | Demonstrations, eligibility as of the date, and feedback-only are right calls. Several holes let self-report back in.                                                                      |
| Roles & org                | **B-**              | Roles as edges is right. There is no real directory sync, no position history, and admin powers are too broad.                                                                             |
| Data model                 | **A-**              | The best part: composite-key provenance, triggers, exclusion constraints, tested by violation. Parts of the schema are ahead of any behavior that uses them.                               |
| Code design                | **B+**              | A pure domain, `decide()` + `actions`, one-transaction signing. The feature layout is inconsistent, and tests have gaps in void, auth and tenancy.                                         |
| UX / visual                | **B+**              | Meets the "not AI slop" bar. The sign screen hides each level's descriptors, and there is mobile overflow.                                                                                 |
| Tech stack                 | **B+**              | Deviations from Content Studio are mostly justified. First-party auth needs tests, and a Postgres CI lane is needed.                                                                       |
| Docs & governance          | **B**               | Very clear, but some claims point at controls and tests that do not exist.                                                                                                                 |
| **Overall**                | **B+**              | **B+** as a foundation, **C+** as a v1 people would use weekly                                                                                                                             |

## Highest-leverage changes, as ranked by the reviewer

1. Close the self-report holes:
   - the observer owns the mode;
   - a bound on backdating;
   - drafts hidden until signed.
2. Make the docs true (controls, ADR claims, the UX brief), with a CI check
   for cited paths.
3. Notifications, plus the designated-observer basis.
4. Position history and skill profiles in the schema, before real data exists.
5. Catalog-keeper management.
6. Directory import and sync, deprovisioning, and coach-reports-to-coach
   exceptions.
7. AI:
   - hold-only semantics;
   - re-drive stuck checks;
   - a test for I5;
   - a live calibration;
   - cost metrics;
   - extend the AI to calibration and catalog quality.
8. A Postgres CI lane, about six journey tests, and three architecture tests.
9. Separation of admin duties, and audited reads of narratives.
10. Calibration content on the sign screen, mobile fixes, and an adoption
    view for program owners.

## Keep as is

- Credit only from SIGN, in one transaction, under a per-person lock.
- Reversals instead of deletes.
- Composite tenant and basis foreign keys, the integrity migration, and
  testing by attempted violation.
- `decide()` and the `actions` array.
- Demonstrations, feedback-only ratings, honest modes, and receipts.
- The pure domain package and the contract-derived client.
- The AI posture: human first, a shadow arm, labels from actions, digests.
- The Quiet Ledger visual language.
- Open questions with defaults, decision tiers, "name the invariant", and the
  release-age gate.

## Skills across roles

The recommendation is recorded as a proposal in
[ADR 0017](../adr/0017-skill-profiles-and-position-history.md). A skill keeps
one identity and gets optional _profiles_, such as "as a leader" or "as a
peer mentor". Profiles carry their own level descriptors. Expectations are
set per job family. Every credit pins the profile and the person's
effective-dated position, so history stays valid after a promotion.

## What we did with it

| #           | Finding                                                                               | Decision                                                                                                                                               | Where                                                          |
| ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1a          | The coachee sets mode, so first-hand status is self-asserted                          | **Fixed.** The observer sets or confirms mode at signing, and it freezes then.                                                                         | `ObservationDraftInput.mode`, `sign.ts`                        |
| 1b          | Unbounded backdating                                                                  | **Fixed.** Logging is limited to 30 days back; "I saw this" to 14                                                                                      | `development/use-cases.ts`, `observations/use-cases/create.ts` |
| 1c          | Unsigned drafts are readable by the subject and leaders                               | **Fixed.** Only the observer sees a draft's level and narrative until it is signed                                                                     | `observations/views.ts`                                        |
| 1d          | "First-hand share" was a fixed floor                                                  | **Fixed.** It is now a true share of at-level demonstrations                                                                                           | `scoring/badges.ts`                                            |
| 1e          | Levels 2 and 3 both announced at once                                                 | **Fixed.** The feed shows only the highest level earned                                                                                                | `support/home.ts`                                              |
| 2           | Docs overclaim                                                                        | **Fixed.** False claims removed or marked _planned_; the UX brief is updated for demonstrations                                                        | `docs/`                                                        |
| 7a          | AI "clears" evidence on failure                                                       | **Fixed.** The AI is hold-only. Evidence that passes the local screen is available at once; the assistant may then hold or escalate it, never clear it | `evidence-screening.ts`, ADR 0008                              |
| 9           | Admins read every narrative, unaudited                                                | **Fixed.** Tenant admins see levels only. Compliance reviewers may read narratives, and each read is audited. Only compliance can void or uphold.      | `observations/views.ts`                                        |
| 8           | Missing architecture tests                                                            | **Added.** Only signing writes credit, and every table carries a tenant                                                                                | `apps/server/src/architecture.test.ts`                         |
| 3, 5, 6, 10 | Notifications, designated observers, keeper management, directory sync, adoption view | **Deferred to the next build round.** Recorded in the backlog                                                                                          | `docs/product/open-questions.md`                               |
| 4           | Position history and skill profiles                                                   | **Proposed** (ADR 0017). It needs owner and HR input, because expectations by job family edge toward performance management.                           | ADR 0017                                                       |
