# AI system card: assistant checks

**Status:** draft for AI governance board review. The owner and compliance
sign-off are pending (domain-expert question G3). The structure follows the
NIST AI RMF (Govern, Map, Measure, Manage).

## 1. What it is

The product uses a single model capability: **closed-set judgments**
(yes/no, choice, or a rubric score, each returned as probabilities) from the
Google **Gemini Decisions API** (`gemini-decision-1`). The model **never
generates text**. Every result is an _assistant check_ recorded in
`advisory_check`.

| Question set              | Input                                                                   | What it may do                                                                                                                                  | What it never does                     |
| ------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `privacy-screen` v1       | A coachee's reflection, after the local deterministic screen has passed | **Hold** suspected client PII (hidden until revised or released by an admin); **escalate** complaints or specific recommendations to compliance | Release anything                       |
| `narrative-indicators` v1 | The observer's own note, **after** they wrote it                        | Propose indicators the note appears to describe (chips the observer may accept)                                                                 | Pre-tick indicators, set a level, sign |
| `narrative-quality` v1    | The observer's own note                                                 | Nudge toward behavior, effect and next step                                                                                                     | Block signing, rewrite the note        |
| `mode-consistency` v1     | The observer's own note                                                 | Nudge when a note claimed as first-hand reads like a debrief                                                                                    | Change the mode                        |
| `skill-suggest` v1        | A logged reflection                                                     | Suggest skills, shown unselected                                                                                                                | Select skills                          |

## 2. Intended use and limits (Map)

- **Users:** observers (coaches and leaders), coachees, tenant admins and
  compliance reviewers at one financial-services firm.
- **Purpose:** make observers faster and more specific, and keep client PII
  out of development records.
- **Out of scope, by design:**
  - granting credit, awarding badges, releasing held content, or setting
    levels;
  - ranking or comparing people;
  - any HR, pay or performance use;
  - judging clients;
  - drafting attestations.
- **Data:** text only. The design excludes client identifiers (opaque CRM
  references only). No audio, images or attachments.

## 3. Human oversight (Govern)

- **Human first.** Checks on an observer's note run after the note is written.
  Suggestions are never pre-applied.
- **Every effect is labelled** "Assistant check. An automated check; you
  decide."
- **Holds can be released** by an admin and **escalations resolved** by
  compliance. Each such decision is an `advisory_disposition` (who, what, why)
  and an audit event.
- **Promotion is gated.** A question set's effect can move from _nudge_ to
  _hold_ only through a recorded `question_set_release` with metrics and an
  approver.

## 4. Traceability (Measure)

Every check stores:

- the question set and version;
- a digest of the **exact questions**, with the questions themselves in
  `advisory_question_snapshot`;
- a digest of the input (the text is not stored on the check);
- the subject's version;
- the provider and model;
- per-question probabilities, with missing and malformed answers kept
  separately;
- the thresholds applied, the effect, and a plain-language rationale;
- cost, latency, and the failure type.

## 5. Validity and calibration (Measure)

- **Ground-truth labels** come from real actions (ADR 0016):
  - ticks kept or removed at signing;
  - the skills finally rated;
  - holds released (gold) or revised (weak);
  - in future: blind second reads, reported misses, and mode changes.
- **Bias controls:**
  - a 15% **shadow arm**, computed but never shown, gives unbiased labels;
  - exposure logging records who saw each check;
  - evaluation sets use only shadow-arm and gold labels.
- **Metrics per question:** precision and recall at the operating point,
  expected calibration error, and override rate by arm.
- **Current state:** all thresholds are **uncalibrated starting points**. No
  live calls have been made yet; development uses a deterministic mock.

## 6. Failure handling (Manage)

- Missing, malformed, timed-out or refused answers are recorded as
  `failed`. They are **never a pass**.
- A timeout or lost connection may already have been billed, so it is never
  retried automatically. Only HTTP 429 responses are retried.
- When the assistant screen fails, the local deterministic screen has still
  run, and it fails closed.
- `DECISIONS_MODE=disabled` turns every check off. The product works fully
  without them.

## 7. Monitoring and cost

- `/admin/ai-usage` (tenant admins and compliance) reports, per day and
  question set: checks, failures, holds, tokens, cost, p95 latency, labels and
  override rate.
- _Planned:_ the same figures exported as OTLP metrics to Datadog for alerting.
- **Proposed review triggers:** an override rate above 30% or a failure rate
  above 5% over 7 days (G4).

## 8. Data protection

- **Processor:** Google. Required before live use:
  - the paid tier (`DECISIONS_PAID_TIER_CONFIRMED=true`), so inputs are not
    used for training;
  - a DPA;
  - agreed data residency (D4).
- **LangSmith** (optional) receives digests and probabilities only, unless
  `LANGSMITH_CONTENT=screened` is approved.
- Provider inputs and outputs never appear in logs or traces.

## 9. Open items before production

1. Compliance approval of the processors and the data scope (D4).
2. Live baseline: run `privacy-screen` in the shadow arm on synthetic
   PII-seeded text, then measure recall.
3. Board approval of the promotion gate and review thresholds (G1, G4).
4. A second-read workflow (UI) for gold labels.
