---
name: qa
description: QA a feature or user journey in the running app the way an expert tester would. Sign in as each affected persona, walk the journey including the edge and refusal paths, inspect screenshots in light and dark on desktop and phone, check privacy, accessibility and audit records, and write a structured report to docs/qa/reports/. Use after building or changing a flow, before declaring UI work done, or when asked to "QA", "test the flow", "check this works".
---

# QA a journey

This is an inspection, not a unit test. Your job is to find what a real
advisor, coach, leader or compliance reviewer would trip over, and to say
plainly what you did and did not check.

## 0. Prepare (2 minutes)

1. Make sure the stack is up:
   - `pnpm db:up`
   - API on `:4400` (`curl -sf localhost:4400/readyz`)
   - web on `:5400`
   - If data is stale, run `pnpm db:reset`. This wipes local data; say so in
     your report.
2. Read the journey's source of truth:
   - `docs/product/ux-brief.md` for the screen spec and copy;
   - `docs/product/domain-model.md` for rules and lifecycles;
   - the relevant lifecycle in `packages/domain/src/lifecycles/`.
3. List the personas involved. Personas are seeded; list them with
   `curl localhost:4400/api/auth/dev/personas`.

   | Persona | Situation in the seed                            |
   | ------- | ------------------------------------------------ |
   | Maya    | Advisor with badges                              |
   | Leo     | Leader with a pending request                    |
   | Sam     | Coach with a plan to agree and a request to sign |
   | Aisha   | Returned observation and a held reflection       |
   | Tom     | Badge holder                                     |
   | Marcus  | Proposed engagement                              |
   | Grace   | Empty states                                     |
   | Rhea    | Tenant admin                                     |
   | Nina    | Compliance reviewer                              |
   | Elena   | Catalog keeper                                   |

## 1. Walk the journey

For each persona, sign in (persona picker at `/sign-in`, or
`POST /api/auth/dev/sign-in` with `x-requested-with: fetch`) and do the
journey for real:

- **Happy path**, start to finish. Note every moment of hesitation.
- **Refusals.** Try what the rules forbid, both through the UI and directly
  against the API:
  - observing yourself;
  - an ineligible observer;
  - signing below the minimums;
  - acting on a closed item;
  - two windows editing the same draft (expect `Conflict`).
- **Lifecycle edges.**
  - Every state's pill and actions must match the machine. Actions not valid
    in a state must be _absent_, not disabled.
  - Check what happens after expiry. You can force it with the sweep, or by
    making the due date earlier in a local DB.
- **Privacy.**
  - Paste text containing a client-like name or an account number into a
    reflection. It must be held.
  - It must be invisible to observers, with the brief's copy explaining why.
- **Visibility.** Sign in as someone outside the relationship and confirm they
  get 404 or no access. As a skip-level leader, confirm you see levels but not
  narratives.
- **Audit.** As Rhea or Nina, open `/admin/audit`. Confirm each step you took
  left an event with the right actor, from and to states, and reason.

## 2. Look at it

- Run `pnpm --filter @repo/web screenshots` (or capture the specific routes).
- **Open the PNGs and look at them**, in light and dark, at 1280 and 390
  wide. Judge them as an expert product designer would, against
  `apps/web/DESIGN.md`:
  - hierarchy, alignment, spacing rhythm, truncation;
  - contrast, focus visibility;
  - empty and loading states, copy fidelity;
  - no "AI slop" patterns.
- Keyboard pass:
  - Tab through the main flow; the focus ring must always be visible.
  - Dialogs trap and return focus.
  - Shortcuts (`⌘K`, `J`/`K`, `⌘Enter`) work, and don't fire while you are
    typing in a field.

## 3. Report

Write `docs/qa/reports/YYYY-MM-DD-<journey>.md` using
[`docs/qa/report-template.md`](../../../docs/qa/report-template.md), with:

- **severity** for each finding (blocker / major / minor / polish), with
  repro steps, the persona, and a screenshot path;
- **verified** versus **not verified**, listed separately;
- **invariants touched**, using IDs from `docs/testing/invariants.md`. Note any
  that lack a test.

Fix blockers and majors you can fix within scope, re-verify, and say so in the
report. Never mark something verified because it "should" work.
