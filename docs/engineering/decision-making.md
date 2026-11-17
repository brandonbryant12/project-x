# How decisions are made here

Most code in this repository is written by coding agents and reviewed by
humans. Agents should move fast on what is reversible and stop at what is
not. This document says which is which, who decides, how to get an
independent view, and how to record a decision so the next agent doesn't
re-argue it.

## 1. Sort the decision by reversibility and blast radius

| Tier                             | Examples                                                                                                                                                                      | Who decides                                       | Record                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **0: Routine**                   | Naming inside a feature, a refactor with tests, a new view field, copy that follows the brief                                                                                 | The agent                                         | The commit message                                                                 |
| **1: Local design**              | A new endpoint, a new component, a new index, a new question in an existing question set (version bump)                                                                       | The agent, following existing patterns            | Commit message plus a doc update where a doc owns the topic                        |
| **2: Architecture**              | A new package or dependency, a new datastore or provider, a change to a lifecycle's states, a schema change to a _fact_ table, a new trust boundary (auth, PII, AI data flow) | The agent proposes; a human approves before merge | **ADR** (`docs/adr/`)                                                              |
| **3: Product or domain rule**    | Who can observe, what earns a badge, what is visible to whom, what counts as "observed", anything touching pay or performance                                                 | **The product owner, with domain experts**        | `docs/product/domain-model.md`, plus an entry in `open-questions.md` until decided |
| **4: Regulatory or contractual** | Retention periods, books-and-records classification, sending data to a new processor, AI board approvals                                                                      | **Compliance, legal or the AI board**             | A controls-matrix row and an ADR that cites the approval                           |

Rules of thumb:

- **When in doubt, go one tier up.** Asking costs minutes; reversing a
  tier-3 rule after data exists costs weeks.
- **Never encode a tier-3 or tier-4 guess as a hard invariant.** Use a
  working default that is configurable and documented in
  `open-questions.md`. The badge criteria numbers and the signing window are
  examples.
- **Append-only data makes schema decisions one-way doors.** Treat any change
  to a ledger, audit or label table as tier 2.

## 2. Get an independent view before a one-way door

For tier-2 and tier-3 work, get a second reading that is **not anchored on
yours**. Give a separate agent the artifacts (files, schema, docs), not your
conclusion. Then adopt or reject each finding explicitly. The first week of
this repository did this four times:

| Review                                                | What it caught                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Domain model (independent review)                     | Roles are edges; confirmation is a transition, not an entity; the AI must never clear                                                     |
| Domain red-team                                       | `debrief` and pre-reading the coachee's text let self-report back in; points measured volume; dispositions could not produce ground truth |
| Schema review (verified by running violating inserts) | The database accepted credits that disagreed with their own observation, cross-tenant reversals, and ledger updates                       |
| UX brief                                              | The two-pane sign screen, the non-optimistic sign, expiry without anxiety                                                                 |

Prefer reviews that **verify** (run the migration, try the violating insert,
render the screen) over reviews that only reason.

## 3. Evidence standards for "done"

| Change           | Minimum evidence                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| Domain rule      | A table-driven test in `packages/domain`, named after the rule                                                 |
| Integrity rule   | A database test showing the violating write is rejected (`integrity.test.ts`)                                  |
| Use case or flow | A scenario test through the in-memory API on PGlite, or the QA skill's report for UI flows                     |
| UI               | Screenshots in light and dark, desktop and phone, actually looked at                                           |
| AI question set  | A version bump, its `question_set_release` row, and labels or an evaluation note before its effect is promoted |
| Anything         | `pnpm check` passes. The report says what was **not** verified.                                                |

## 4. Code organization: intent over budgets

**Decision (2026-11-16): no file-length caps. Organize by reason to change.**

We started with Content Studio's `max-lines: 400` and "one use case per file".
In practice the cap produced artificial splits: observation use cases were
scattered across files to satisfy a number, not a seam. What the budget was
really meant to protect:

| Intent                                            | What protects it now                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A reader or agent can hold the unit in their head | One file per **cohesive capability** (for example "signing": draft, sign, credit, badges, labels), named for that capability |
| Functions stay understandable                     | `max-depth` is an error; `max-lines-per-function` (150) is a **warning**, so splitting is a judgment call, not a reflex      |
| Features don't tangle                             | Dependency direction (`domain` ← `api` ← `web`; `server` → packages) and features importing only `shared/`                   |
| Traceability                                      | `Effect.fn('useCase.<name>')` names every use case in traces, whichever file it lives in                                     |

Split a file when it has **two reasons to change**, such as reads versus
writes or two lifecycles, not when it reaches a line number. If this turns
out wrong, for example because agents start losing context in large files,
change it here with the evidence.

## 5. When an agent must stop and ask

- The request conflicts with a rule in `AGENTS.md`, the domain model or an
  ADR.
- The change is tier 3 or 4, or would make a working default permanent.
- A test that protects a named invariant fails, and the fix would weaken it.
- The work would send new data to an external service, or change what is
  logged.
- A destructive operation (dropping data, resetting a non-local database,
  force-pushing) is needed.

Otherwise, make the call, record it at the right tier, and keep going.

## 6. Recording a decision

- **ADR** (tier 2 and above): use `docs/adr/template.md`. State the decision
  in bold in one paragraph. Include the alternatives considered, and how we
  would know it was wrong. Amend with a dated note; never rewrite history.
- **Domain decision:** update `docs/product/domain-model.md` and move the
  question from `open-questions.md` to "Decided", with the date and who
  decided.
- **Domain-expert input:** record the answer next to its question in
  `docs/product/domain-expert-questions.md`, with who answered.
