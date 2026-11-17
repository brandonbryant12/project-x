# ADR 0016: Ground truth comes from real actions; LangSmith is an optional, privacy-bounded workbench

- Status: Accepted
- Date: 2026-11-16
- Builds on: [ADR 0008](./0008-decisions-api-is-advisory.md), [ADR 0015](./0015-audit-trail-and-ai-decision-records.md)
- Amends: ADR 0008's "provider inputs and outputs are never logged" (see section 4)

## Context

The owner wants a simple way to collect ground truth from normal app use, so
the system improves over time. They also want AI cost monitoring and a
LangSmith integration, behind a flag, that uses its run trees.

A red-team review found three problems with the original design:

- One `disposition` per check could not produce usable labels. A check asks
  many questions, the human had already seen the model's answer, and
  "ignored" is ambiguous.
- Pre-reading the **coachee's** reflection and then asking the observer to
  confirm it routed self-report into credit.
- Measuring success with the same model that nudges people is circular.

## Decision

**Labels are derived on the server, from actions people take anyway, in the
same transaction as the action. There is one label per question, never a
"was this helpful?" click. Exposure is recorded, and a shadow arm keeps an
unbiased slice. Postgres is the system of record. LangSmith is an optional
workbench for traces, feedback, datasets and experiments, and by default it
sends digests, never text.**

### 1. Human first

- Narrative checks (`narrative-indicators`, `narrative-quality`,
  `mode-consistency`) run only on the **observer's own note**, after they have
  written it.
- They never run on the coachee's reflection.
- Indicator suggestions appear as chips the observer may accept. Nothing is
  pre-ticked. Accepted ids are stored with `suggested = true`.

### 2. Label sources (`advisory_label`)

| Check                  | Action that produces the label                                   | Label                        | Strength                                                |
| ---------------------- | ---------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `narrative-indicators` | At signing, an indicator is ticked or not ticked                 | yes / no per indicator       | silver (ticked) / weak (not ticked; ticks are optional) |
| `skill-suggest`        | The skills the observer finally rated                            | yes / no per suggested skill | silver                                                  |
| `privacy-screen`       | An admin **releases** held text unchanged                        | no (false positive)          | **gold**                                                |
| `privacy-screen`       | The author **revises** held text                                 | yes                          | weak (they may be rephrasing to get past the screen)    |
| `privacy-screen`       | "Contains client details" reported on cleared text (planned)     | yes (false negative)         | gold                                                    |
| `mode-consistency`     | The observer changes mode after the nudge, or keeps it (planned) | yes / no                     | silver                                                  |
| Any check              | A blind **second read** (`second_read`, planned)                 | per question                 | gold                                                    |

### 3. Bias controls

- **Shadow arm:** a deterministic 15% of narrative checks (`armFor(id)`) are
  computed but never shown, so labels from those subjects are unanchored.
- **Exposure:** `advisory_exposure` records who saw a check and whether they
  opened it.
- **Evaluation sets** use only **shadow-arm labels and gold labels**. Labels
  from people who saw the check feed monitoring, not evaluation.
- **Uniqueness:** labels are unique per (check, question, source), so retries
  cannot double-count.

### 4. Improvement cycle

1. Freeze a dataset version per question set (weekly).
2. Compute, per question:
   - precision and recall at the operating point;
   - calibration (expected calibration error), since the API returns
     probabilities;
   - override rate by arm.
3. Propose either new wording (a **new version**) or new thresholds.
4. Evaluate offline against the frozen set, then as a shadow challenger.
5. The AI board approves. The evidence goes into a `question_set_release`
   row: metrics, dataset and experiment references, approver.
6. A check may be promoted from _nudge_ to _hold_ only through such a release.

### 5. AI cost and quality monitoring

- **The data:** every check records input tokens, cost in micro-dollars,
  latency, failure type and effect.
- **The report:** `GET /api/admin/ai-usage` (tenant admins and compliance)
  aggregates, per day and question set: checks, failures, holds, tokens, cost,
  p95 latency, labels, and the override rate (the share of non-weak labels that
  disagree with the model's side of the threshold). Reading it is audited.
- **The metrics** (_planned_): the same numbers will be exported as OTLP metrics to Datadog
  for alerting.
- **Review thresholds:** an override rate above 30% or a failure rate above 5%
  over 7 days. This is pending AI-board confirmation (domain-expert question G4).

### 6. LangSmith (optional, off by default)

**Flags**

| Variable            | Values              | Default |
| ------------------- | ------------------- | ------- |
| `LANGSMITH_TRACING` | `true` / `false`    | `false` |
| `LANGSMITH_API_KEY` | key                 | none    |
| `LANGSMITH_PROJECT` | project name        | none    |
| `LANGSMITH_CONTENT` | `none` / `screened` | `none`  |

**Run tree** (one per check):

```
advisory.<question-set>              (chain; metadata: version, arm, subject type, provider)
 ├─ decisions.evaluate               (llm; inputs: question keys + input digest; outputs: probabilities)
 └─ interpret.thresholds             (chain; inputs: thresholds; outputs: effect, rationale)
```

**Content rules**

- `none`: LangSmith receives digests, question keys, probabilities and
  interpretations. It never receives text.
- `screened`: adds the input text, but only for text that has passed **both**
  privacy screens and is in the `available` state. It never applies to
  `privacy-screen` inputs.

**Records and feedback**

- The root run id is stored on `advisory_check.trace_run_id`.
- Each label is posted as feedback on its run, with key `label.<question>`,
  a score of 0 or 1, and the strength and arm as metadata.

**Datasets** (planned script): one per question set and version, with `eval`
(shadow and gold) and `monitor` splits. Examples hold **pointers**, and text
is re-read inside the firm's boundary at evaluation time. That way the evidence
purge rules still hold.

**Governance:** LangSmith is a sub-processor (Reg S-P, SOC 2 CC9.2). `screened`
mode needs compliance approval (domain-expert question D4), or a self-hosted
LangSmith deployment.

## Alternatives considered

- **A thumbs-up/down widget:** low volume, heavily biased, and adds friction.
- **Treating the observer's tick as a label for a pre-read of the coachee's
  text:** the construct doesn't match, and it routes self-report into credit.
- **LangSmith as the system of record:** rejected, consistent with ADR 0015.
  Traces are not an audit trail.
- **OTLP export to LangSmith instead of the SDK:** possible later if its OTLP
  ingestion meets our needs. The SDK keeps feedback and datasets first-class
  today.

## Consequences

- The domain needs no new user actions to produce labels.
- Some planned label sources (reported misses, mode changes, second reads)
  need small UI affordances. They are listed in the invariant and backlog
  docs.
- **Amendment to ADR 0008:** with `LANGSMITH_CONTENT=screened`, screened text
  may leave the boundary to LangSmith. The default (`none`) keeps ADR 0008's
  original guarantee.
