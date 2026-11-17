# Backlog

Open items, one line each, with a pointer. Nothing here is built. When an item
is done, delete its line; when it needs a decision, follow the
[decision framework](engineering/decision-making.md).

## Deferred decisions

- **AI learning loop and LangSmith**: labels, shadow arm, calibration. Revisit once live checks run. [ADR 0016](adr/0016-learning-loop-ground-truth-and-langsmith.md)
- **Skill profiles and expectations by job family**: position history stays built. [ADR 0017](adr/0017-skill-profiles-and-position-history.md)
- **Coaching conversations and commitments**: revisit when pilot users ask for a place to run 1:1s. [ADR 0019](adr/0019-coaching-conversations-and-commitments.md)
- **Calendar-assisted logging**: needs token storage design, admin consent and an infosec review. [ADR 0022](adr/0022-calendar-assisted-logging.md)
- **Commitment rules looser than ADR 0019** (visibility wider than the source conversation): moot while 0019 is deferred. [Re-review](archive/reviews/2026-11-17-re-review.md) finding 9

## Product and domain

- **Designated observers, known gaps** (behind `FEATURE_DESIGNATED_OBSERVERS`, off by default): three-person rings are allowed; a designee's drafts can be left orphaned; designations made by a departed leader stay active; the designate endpoint is not gated by the switch (only the web button is). [ADR 0020](adr/0020-designated-observers.md), `apps/server/src/features/hub/designations.ts`, [re-review](archive/reviews/2026-11-17-re-review.md) finding 11
- **Drop `paused` and the `ENDORSE` ceremony** from the plan and engagement lifecycles: considered, not done. [Lifecycles](architecture/lifecycles.md)
- **Participant one-pager and pilot plan**: blocked on answers only the client can give (open questions 2, 3, 12, 15, 20, 25; domain-expert questions D1, D4, F5). [Open questions](product/open-questions.md), [domain-expert questions](product/domain-expert-questions.md)

## Engineering

- **Adoption complement suppression**: a small cell can be derived by subtracting a shown figure from another. [ADR 0021](adr/0021-program-owner-and-adoption-view.md), `apps/server/src/features/shared/program.ts`
- **I14 on real Postgres**: concurrent signatures are covered by an advisory lock but only tested on PGlite. [Invariants](testing/invariants.md)
- **Axe accessibility scan** in the screenshot run. [DESIGN.md](../apps/web/DESIGN.md)
- **Admin screens for the directory import and departures**: both are API-only today. [Identity and access](architecture/identity-and-access.md), [deprovisioning](runbooks/deprovisioning.md)
- **Empty 400 bodies**: some rejected requests return 400 with no message for the client to show. [Re-review](archive/reviews/2026-11-17-re-review.md) finding 11
- **`IndicatorRow.assistantMatch` is unused**: remove the prop or use it. `packages/ui/src/domain/rating.tsx`
