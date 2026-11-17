# QA report: one-screen "I saw this" capture

- **Date:** 2026-11-16
- **Commit:** `e775866`
- **Tester:** web track agent
- **Stack:** Postgres 18 (`pnpm db:up`), API `:4400` (watch mode, shared with other
  agents and restarted often), web `:5400`
- **Data reset:** yes, by the coordinator partway through (adds the practice cohort).
  Timing runs and these checks signed real observations in the local database.
- **Personas:** Leo (leader), Sam (coach), Aisha (subject of a draft), Grace (no
  relationships, first run), Maya (advisor, settings)

## Summary

The capture works for the people it is for. A leader or coach goes from the
tab-bar button to a signed receipt on one screen at 390 px. The median of ten
scripted runs is **33.5 s**, against a 60 s budget. The two comments are entered
at dictation pace (90 ms per character, 220 characters), with pauses before each
decision. At thumb-typing pace (about 300 ms per character) the comments alone
take about 66 s, so the 60 s target depends on the phone's dictation; the spec
takes `DICTATION_MS` so this can be checked. The server refuses everything the
rules forbid, and the screen explains each refusal before the server has to.
There are no blockers. One major finding is open on the server: each capture
without a chosen activity leaves a new open ad-hoc activity.

## Findings

| #   | Severity | Persona    | Where                               | What happened                                                                                                                        | Expected                                                                               | Evidence                                                          | Status                                                                                 |
| --- | -------- | ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | major    | Leo        | `POST /observations/start`          | Each capture made without picking an activity creates a new open ad-hoc activity ("Client meeting"); Maya showed a row of duplicates | One ad-hoc activity per capture is fine, but it should not stay open and offered again | `observations/new`, The work chips for Maya after ten timing runs | Mitigated in `e775866` (one chip per name); server cause reported to the backend owner |
| 2   | minor    | Aisha, Leo | `GET /observations/:id` (`actions`) | On an observer-started draft the subject is offered WITHDRAW, and the observer is offered RETURN and DECLINE                         | No actions for the subject; the observer signs, saves or lets it expire                | API response for `obs_jhk777vdtcpmnajp` before the reset          | Reported to the backend owner                                                          |
| 3   | minor    | Aisha      | Home, Needs you                     | `QueueItem.detail` carries a raw ISO date ("Logged for 2026-11-12")                                                                  | A human date                                                                           | `screenshots/aisha-bello/home-*`                                  | Rewritten on the client in `79e09c6`; a typed date field is requested from the server  |
| 4   | polish   | Leo        | Home, This week                     | "1 of your 3 reports were observed": the server's coverage sentence does not agree in number                                         | "1 of your 3 reports was observed"                                                     | `screenshots/leo-okonkwo/home-light-desktop.png`                  | Reported                                                                               |
| 5   | minor    | Sam, Leo   | Home, phone                         | "I saw this" sat below the fold, under the plan rail and the tab bar                                                                 | Above the fold                                                                         | old `sam-rivera/home-light-mobile.png`                            | Fixed in `79e09c6`                                                                     |
| 6   | minor    | Leo        | Home, phone                         | A commitment's Done and Drop wrapped onto separate lines                                                                             | They move together                                                                     | `screenshots/leo-okonkwo/home-light-mobile.png`                   | Fixed in `ca9e79e`                                                                     |
| 7   | polish   | all        | capture vs sign screen              | The second comment was "Next step" in capture and "What next" on the sign screen                                                     | One label, the brief's "What next"                                                     | —                                                                 | Fixed in `ca9e79e`                                                                     |
| 8   | info     | Leo        | timing run                          | One run in an earlier batch hung on "Posting to the record…" while the API restarted; its draft stayed in Leo's Needs you            | The draft survives and can be finished; nothing was signed twice                       | server log restarts during the run                                | Environment; the timing spec now replaces and reports such runs                        |

## Verified

- [x] Happy path, Leo (leader) at 390 px: ten signed captures, median 33.5 s, no
      aborted runs (`pnpm --filter @repo/web e2e:timing`).
- [x] Save and finish later, Sam: the toast names the closing date, Home loads,
      and the draft appears in Sam's `inbox.drafts`.
- [x] Refusals against the API:
  - observing yourself → 403;
  - 20 days back → 422 "Record what you saw within 14 days.";
  - a future date → 422;
  - an ineligible observer (Grace → Maya) → 403;
  - fewer than 40 characters → 409;
  - client details in the note → 409 with the reasons.
- [x] Refusals in the UI:
  - Sign stays disabled until there is a person, a level and 40 characters;
  - a date outside the window shows a hint and blocks;
  - client details show the assistant-styled note, and the bar reads "Remove
    client details to sign".
- [x] A draft stays hidden from the subject (I17): Aisha's view of Leo's draft
      showed no levels and no narrative.
- [x] Retry safety: after a failed sign the started draft is reused and the words
      are saved to it, so a second tap never starts a second observation.
- [x] Screenshots inspected for capture, Home, sign screen and settings:
  - capture at 1280 and 390, light and dark;
  - Home for Leo, Grace and Maya;
  - the sign screen at 390;
  - settings at 1280.
- [x] No horizontal overflow for any persona or route at 360, 390, 768 and
      1280 px (`pnpm --filter @repo/web screenshots`: 12 of 12 passed).
- [x] Keyboard pass, desktop:
  - the person chips are buttons;
  - Tab reaches the level ladder, and the arrow keys move within it;
  - Sign opens the review with focus on Go back, and Escape closes it.
- [x] Manifest served at `/manifest.webmanifest` with the name from `brand.ts`,
      icons at 192 and 512 (maskable) and an "I saw this" shortcut.

## Not verified

- Installing to a real home screen on iOS or Android, and standalone display.
- Real dictation on a real phone, and timing with real people (the A+ bar).
- Screen-reader announcements, and a 200% zoom pass.
- Entra sign-in with `returnTo` (dev mode only; the client side is unit-tested).
- Behavior across an expiry sweep for a saved-for-later draft.
- The audit trail rows for START and SIGN from the capture. They are written by
  the existing use cases, but I did not open `/admin/audit` for these runs.

## Invariants touched

| ID  | Exercised how                                                              | Has a dedicated test?        |
| --- | -------------------------------------------------------------------------- | ---------------------------- |
| I1  | Leo starting an observation of himself: 403                                | yes (`policy.test.ts`)       |
| I4  | Grace, with no relationship, refused at start                              | yes                          |
| I15 | The capture sends the observer's mode, defaulting to "I saw it"            | yes, per the invariants list |
| I16 | 14-day window refused on the server and bounded in the date picker         | yes, per the invariants list |
| I17 | The subject's view of an observer-started draft hides levels and narrative | yes, per the invariants list |
