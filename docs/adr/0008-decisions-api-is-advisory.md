# ADR 0008: The Gemini Decisions API is advisory: it may hold or nudge, never clear

- Status: Accepted
- Date: 2026-11-16

## Context

The Gemini Decisions API (`gemini-decision-1`) answers closed-set questions
(binary, choice and score/rubric) about multimodal input, returning
probabilities only. It costs about $0.10 per million input tokens.

Content Studio integrated it behind `DECISIONS_ENABLED` (its ADR 0029, on the unmerged `codex/gemini-decisions` branch, PR #1138) with
these principles:

- uncalibrated checks never clear anything on their own;
- missing or malformed answers are "unavailable", never a pass;
- only a 429 is retried;
- an unknown outcome is never re-sent automatically;
- the free tier may train on submitted data, so live mode requires a
  paid-tier confirmation.

The product owner wants Decisions to be a big part of this product. The
product's core promise is that credit comes only from human observation.

## Decision

**Decisions powers advisory checks that help humans decide faster and better.
A check may _hold_ (quarantine evidence, block a submit until acknowledged)
or _nudge_ (show a pre-read). It may never _clear_: post credit, award a
badge, release quarantined evidence or set a level.**

Every call is recorded as an `advisory_check` row with:

- the question-set id and version;
- the model;
- an input digest;
- the answers per question, with missing and malformed answers recorded
  separately;
- the cost and latency;
- the human **disposition** (agreed, overrode or ignored), which becomes the
  calibration dataset.

Initial question sets, in `apps/server/src/features/shared/advisory/question-sets.ts`:

| Question set        | When it runs                             | Questions                                                                                                                               | Effect                                                                               |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `privacy-screen`    | Evidence saved; narrative before signing | Binary: client full name? account number, SSN, DOB or address? a specific security recommendation? a complaint?                         | **Hold**: evidence is quarantined until the owner redacts it or an admin releases it |
| `evidence-pre-read` | The observer opens a sign form           | Binary per indicator of the targeted skills: "Does the evidence describe the person doing _X_?"                                         | **Nudge**: chips beside indicators labelled as an assistant check                    |
| `narrative-quality` | While drafting the narrative (debounced) | Score: generic, then names a behavior, then behavior + effect + next step. Binary: does each ticked indicator have a matching sentence? | **Nudge**                                                                            |
| `skill-suggest`     | Interaction logged                       | Choice: which catalog skills does this best demonstrate?                                                                                | **Nudge**: pre-selection that the human edits                                        |
| `plan-review`       | Plan proposed                            | Binary per activity: is this real job work, not coursework?                                                                             | **Nudge**                                                                            |

Other rules:

- The provider is a `Decisions` service in `packages/ai` with `disabled`,
  `mock` and `google` implementations, configured as follows:
  - `DECISIONS_MODE` is `disabled`, `mock` or `live`;
  - live mode requires `DECISIONS_API_KEY` and
    `DECISIONS_PAID_TIER_CONFIRMED=true`.
  - The mock gives deterministic answers that are plausible enough to demo.
- Requests are validated locally against the documented limits before
  sending. Answers are decoded per question.
- No provider call runs inside a database transaction. Provider inputs and
  outputs are never logged.
- The Decisions API is never used to:
  - rank or compare people;
  - feed HR or performance decisions;
  - judge clients;
  - draft an observer's narrative. A ghost-written attestation would destroy
    "observed".

## Alternatives considered

- **A generative LLM reviewer that writes feedback.** It produces text the
  observer would paste into an attestation, and it costs more.
- **Auto-crediting when the pre-read is confident.** This directly violates
  the product promise.
- **No AI.** We would lose the cheapest way to make observers faster and
  narratives more specific.

## Consequences

- The product works fully with Decisions disabled. Every check degrades to
  "assistant check unavailable".
- A check can be promoted from _nudge_ to _hold_ only after its recorded
  dispositions show acceptable agreement with humans. The promotion is
  recorded as a versioned change to the question set.
- Infosec and compliance must clear sending reflection text to Google before
  live mode is enabled for any tenant (open question 15).

## Amendment (2026-11-16): human first

- **Narrative checks run only on the observer's own note, after it is
  written.** `evidence-pre-read` (the AI pre-reading the coachee's reflection)
  is withdrawn, because it routed self-report into credit.
- **The question sets are now** `privacy-screen` (may hold _or escalate_),
  `narrative-indicators`, `narrative-quality`, `mode-consistency` and
  `skill-suggest`.
- `plan-review` is dropped: too few labels to calibrate it, and "is this real
  work" belongs to the template, decided once by a keeper.
- **A single `disposition` per check is replaced** by per-question labels,
  exposure records and a shadow arm. Explicit human decisions are recorded in
  `advisory_disposition`. See ADR 0016.
- **The privacy screen runs a deterministic local screen first** and fails
  closed. The model only handles fuzzy questions.

## Amendment (2026-11-16): the assistant is hold-only

The independent review found that a failed or clean assistant screen moved
evidence from `screening` to `available`. In effect the AI was clearing text.

- Evidence that passes the deterministic local screen is **available
  immediately**.
- The assistant screen then runs after commit. It may only **hold** or
  **escalate**, version-guarded so it acts only on the exact text it read.
- A failed or clean check changes nothing. It is still recorded on
  `advisory_check`.
- Trade-off: suspected PII that only the model would catch can be visible for
  the seconds before the check completes. The local screen is the fail-closed
  layer.
