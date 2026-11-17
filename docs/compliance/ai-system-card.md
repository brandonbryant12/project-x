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

Only `privacy-screen` runs. The nudge sets (`narrative-indicators`,
`narrative-quality`, `mode-consistency`, `skill-suggest`) and the learning
loop that would calibrate them (labels, shadow arm, exposure logging, question
set releases, LangSmith) were removed on 2026-11-17 and are **deferred** with
ADR 0016: the provider runs as a deterministic mock and live use is not yet
cleared, so there is nothing to calibrate.

| Question set        | Input                                                                                                                                       | What it may do                                                                                                                                  | What it never does |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `privacy-screen` v1 | A coachee's reflection, after the local deterministic screen has passed it; the local screen runs again on the exact text before it is sent | **Hold** suspected client PII (hidden until revised or released by an admin); **escalate** complaints or specific recommendations to compliance | Release anything   |

## 2. Intended use and limits (Map)

- **Users:** observers (coaches and leaders), coachees, tenant admins and
  compliance reviewers at one financial-services firm.
- **Purpose:** keep client PII out of development records.
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

- **Human first.** The assistant never reads an observer's note and never
  suggests anything; it only screens a coachee's reflection after the local
  screen has passed it.
- **The local screen guards the provider boundary.** The check runner runs
  the local screen again on the exact text it is about to send. Text it holds
  is never sent; the check is recorded as `skipped` (provider `local`), and a
  reflection that is still available is held by the local rule.
- **Every effect is labelled** "Assistant check. An automated check; you
  decide."
- **Holds can be released** by an admin and **escalations resolved** by
  compliance. Each such decision is an `advisory_disposition` (who, what, why)
  and an audit event.
- **Changes are gated.** Changing a question set's wording, thresholds or
  effect bumps its version in source and needs AI governance board approval
  (G1).

## 4. Traceability (Measure)

Every check stores:

- the question set and version;
- a digest of the **exact questions** (the versioned questions live in
  `apps/server/src/features/shared/advisory/question-sets.ts`);
- a digest of the input (the text is not stored on the check);
- the subject's version;
- the provider and model;
- per-question probabilities, with missing and malformed answers kept
  separately;
- the thresholds applied, the effect, and a plain-language rationale;
- cost, latency, and the failure type.

## 5. Validity and calibration (Measure)

- **Calibration is deferred** (ADR 0016). Before live use, the board reviews
  `privacy-screen` against synthetic PII-seeded text; the dispositions on
  released holds and resolved escalations are the human record to compare
  against.
- **Current state:** all thresholds are **uncalibrated starting points**. No
  live calls have been made yet; development uses a deterministic mock.

## 6. Failure handling (Manage)

- Missing, malformed, timed-out or refused answers are recorded as
  `failed`. They are **never a pass**.
- Within one check, only HTTP 429 responses are retried. A check is never
  retried in place.
- The screening sweep (`apps/server/src/scheduler/screening.ts`) screens
  available reflections whose screen was missed or failed: at most three
  attempts per version, 15 minutes apart, only for reflections written in
  the last two days, and only while assistant checks are enabled. A timeout
  may already have been billed, so a retried call can be billed again. The
  two-day look-back means turning the assistant on never sends older
  reflections.
- When the assistant screen fails, the local deterministic screen has still
  run, and it fails closed.
- `DECISIONS_MODE=disabled` turns every check off. The product works fully
  without them.

## 7. Monitoring and cost

- `/admin/ai-usage` (tenant admins and compliance) reports, per day and
  question set: checks, failures, and holds or escalations.
- _Planned:_ the same figures exported as OTLP metrics to Datadog for alerting.
- **Proposed review triggers:** a failure rate above 5% over 7 days (G4).

## 8. Data protection

- **Processor:** Google. Required before live use:
  - the paid tier (`DECISIONS_PAID_TIER_CONFIRMED=true`), so inputs are not
    used for training;
  - a DPA;
  - agreed data residency (D4).
- Provider inputs and outputs never appear in logs or traces.

## 9. Open items before production

1. Compliance approval of the processors and the data scope (D4).
2. Live baseline: run `privacy-screen` on synthetic PII-seeded text, then
   measure recall.
3. Board approval of the change gate and review thresholds (G1, G4).
4. Revisit the learning loop (ADR 0016) once live checks run.
