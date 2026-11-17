# ADR 0001: Record architecture decisions as ADRs

- Status: Accepted
- Date: 2026-11-16

## Context

Coding agents do much of the work in this repository. An agent writes
consistent code only if it knows _why_ the code has its current shape.
Content Studio, the sibling product, showed that a short ADR log plus a
glossary (`CONTEXT.md`) gives agents that context without a heavy process.

## Decision

**We keep numbered ADRs in `docs/adr/`, written from `template.md` and
indexed in `docs/adr/README.md`.** An ADR describes the situation on its date
and is never silently rewritten. Product rules live in
`docs/product/domain-model.md` and vocabulary in `CONTEXT.md`. ADRs link to
them rather than duplicating them.

## Alternatives considered

- **No ADRs, only code comments.** The reasoning gets lost, and agents
  re-argue settled questions.
- **A wiki outside the repository.** Agents cannot see it, and it drifts from
  the code.

## Consequences

Any change that reverses an ADR must say so explicitly. The ADR README lists
when one is required.
