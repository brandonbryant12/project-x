# QA report: conversations, commitments and designated observers

- **Date:** 2026-11-17
- **Commit:** see the commit that adds this report
- **Tester:** web track agent
- **Stack:** Postgres 18, API `:4400` (shared watch mode), web `:5400`
- **Data reset:** no; this ran on the coordinator's reset that includes the
  practice cohort. The checks created a conversation, a commitment and a
  designation in the local database; I ended the designation.
- **Personas:** Jordan (coach), Tom (coachee), Maya (subject of signed
  observations), Leo (leader), Grace (outsider), Nadia (program owner), Rhea
  (tenant admin)

## Summary

The weekly rhythm works for the people it is for. A coach schedules with a
partner and the conversation opens on its assembled agenda. The page shows what
was observed, what was logged but not observed, the commitments and the next
step. Lifecycle buttons come only from `actions`. Commitments can be added (at
most 280 characters, privacy-screened before sending) and closed with an Undo.
They also come from a signed observation's next step. A leader can name, see and
end a designated observer. There are no blockers. The one major finding was on
the server: "today" was computed in UTC. It is fixed, and I re-verified it
through the UI.

## Findings

| #   | Severity | Persona | Where                                | What happened                                                                                                              | Expected                                    | Evidence                                                | Status                                                                                               |
| --- | -------- | ------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | major    | Leo     | `POST /designations`                 | At 23:30 New York, `validFrom` = the local today gets 422 "A designation starts today or later": the server's today is UTC | "Today" is the tenant's day                 | API response; the dialog shows the reason inline        | Fixed on the server (tenant business date); re-verified through the UI                               |
| 2   | minor    | Jordan  | `/conversations/:id`, Commitments    | After Done, the commitment left the agenda (the server lists open ones), so Reopen had nowhere to appear                   | A way back from an accidental Done          | Scripted run                                            | Fixed in `5edcb59`: Done and Drop offer Undo (REOPEN)                                                |
| 3   | minor    | Jordan  | `/conversations/:id`                 | Actions arrived as Cancel, Reschedule; Cancel is final and fired on one click                                              | Steady order; confirm before a final action | `screenshots/sam-rivera/conversation-light-desktop.png` | Fixed in `607ea9b`: order Hold, Miss, Reschedule, Cancel; Cancel asks first, with focus on "Keep it" |
| 4   | polish   | Sam     | `/conversations/:id`, Observed since | 18 rows for one coachee (timing-run data) made a long agenda                                                               | A readable first view                       | same screenshot                                         | Fixed in `607ea9b`: six shown, "Show N more"                                                         |
| 5   | polish   | Tom     | `/conversations/:id` as coachee      | "Everything Tom logged…" and "Tom's next step" on Tom's own screen                                                         | Second person for the coachee               | `qa-conv-coachee-mobile.png` (scratch)                  | Fixed with this report                                                                               |
| 6   | polish   | Leo     | `/people/:id`, In progress           | A short progress block sat vertically centered beside a tall one                                                           | Top-aligned                                 | `qa-designation.png` (scratch)                          | Fixed in `5edcb59`                                                                                   |
| 7   | info     | Leo     | `/people/:id`                        | Who may designate is inferred from the profile's relation labels ("Your report", "Your coachee")                           | A `canDesignate` flag from the server       | —                                                       | Contract gap reported; the server enforces the rule anyway                                           |

## Verified

- [x] Happy path, Jordan (coach) with Tom, scripted at 1280:
  - schedule;
  - open the agenda;
  - add a commitment;
  - Done, then Undo;
  - reschedule to 11:15;
  - cancel, confirmed;
  - after cancelling, Reschedule is gone.
- [x] Lifecycle buttons only from `actions`: a future conversation has no
      "Mark as held".
- [x] Privacy: a commitment naming "Mr. Smith" with an account number shows the
      assistant-styled note, and Add stays disabled.
- [x] Visibility:
  - Grace, an outsider, gets 404 on `GET /conversations/:id`;
  - Grace sees no "Name an observer" on Maya's page.
- [x] Tom (the coachee) sees the same conversation and its commitment at 390 px.
- [x] Maya (subject), "Make this a commitment" on a signed observation:
  - the dialog is prefilled with the observer's next step;
  - saving shows "Commitment added".
- [x] Leo (leader) on Maya's page, after the server fix:
  - names a colleague through the dialog;
  - the toast names the end date;
  - the list shows "Named by you" and the dates;
  - End now marks it Ended.

  Earlier test designations dated under the UTC "today" were refused as
  overlapping (409), which is correct.

- [x] Adoption (Nadia):
  - measures, the weekly table and the distributions;
  - null cells read "fewer than 5";
  - open expiry windows say so;
  - no names anywhere on the page.
- [x] Outbox (Rhea):
  - each message rendered as delivered;
  - the status filter works;
  - Rhea (admin only) sees the nav item; program owners do not.
- [x] No horizontal overflow at 360, 390, 768 and 1280 for seven personas,
      including the conversation, adoption and outbox routes
      (`pnpm --filter @repo/web screenshots`).
- [x] Screenshots inspected:
  - conversation, desktop light;
  - coachee conversation, phone;
  - adoption, desktop;
  - outbox, phone dark;
  - person page with designations.

## Not verified

- HOLD and MISS from the UI: the seed has no conversation whose time has passed
  and is still scheduled. Both buttons are rendered from `actions` like the others.
- A designated observer then signing an observation of the subject (the
  journey `designated-observer-signs` belongs to the tests track).
- Commitment visibility to the owner's leader, and purge behavior.
- Screen reader, keyboard-only and 200% zoom passes of these screens.
- Audit rows for SCHEDULE, CANCEL, designate and end in `/admin/audit`.

## Invariants touched

| ID  | Exercised how                                                                             | Has a dedicated test?      |
| --- | ----------------------------------------------------------------------------------------- | -------------------------- |
| I12 | Conversation and commitment buttons came only from the machine's `actions`                | yes (`lifecycles.test.ts`) |
| I20 | The outbox page shows only template output: names, dates, counts and a link; no narrative | per the invariants list    |
