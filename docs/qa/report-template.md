# QA report: <journey>

- **Date:** YYYY-MM-DD
- **Commit:** `<sha>`
- **Tester:** <agent or person>
- **Stack:** Postgres 18 (`pnpm db:up`), API `:4400`, web `:5400`
- **Data reset:** yes / no
- **Personas:** Maya (advisor), Leo (leader), …

## Summary

One paragraph: does the journey work for the people it is for? List any
blockers.

## Findings

| #   | Severity                         | Persona | Where             | What happened | Expected | Evidence                    | Status                  |
| --- | -------------------------------- | ------- | ----------------- | ------------- | -------- | --------------------------- | ----------------------- |
| 1   | blocker / major / minor / polish |         | route or endpoint |               |          | screenshot path or response | open / fixed in `<sha>` |

## Verified

- [ ] Happy path for each persona
- [ ] Refusals: self-observation, ineligible observer, below minimums, closed item, concurrent edit
- [ ] Lifecycle pills and actions match the machine in every state reached
- [ ] Privacy hold: text held, hidden from others, copy correct
- [ ] Visibility: outsiders get 404; skip-level leaders see levels but not narratives
- [ ] Audit events present with actor, states and reason
- [ ] Screenshots inspected: light and dark, 1280 and 390 wide
- [ ] Keyboard pass and focus management

## Not verified

Be explicit, for example: "Entra sign-in (dev mode only)", "behavior across
an expiry sweep", "screen reader".

## Invariants touched

| ID  | Exercised how                      | Has a dedicated test?  |
| --- | ---------------------------------- | ---------------------- |
| I1  | Tried to observe self as Maya: 403 | yes (`policy.test.ts`) |
