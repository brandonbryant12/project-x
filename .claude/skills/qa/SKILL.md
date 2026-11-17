---
name: qa
description: QA a feature or user journey in the running app the way an expert tester would. Start from the feature map (`pnpm verify show <id>`), run its tests, API journey checks and screenshots against the isolated QA environment, sign in as each affected persona, walk the journey including the edge and refusal paths, inspect screenshots in light and dark on desktop and phone, check privacy, accessibility and audit records, and write a structured report to docs/qa/reports/. Use after building or changing a flow, before declaring UI work done, or when asked to "QA", "test the flow", "check this works".
---

# QA a journey

This is an inspection, not a unit test. Your job is to find what a real
advisor, coach, leader or compliance reviewer would trip over, and to say
plainly what you did and did not check. Keep three kinds of evidence apart
and never let one stand in for another:

| Kind    | Command                               | What it proves                                       |
| ------- | ------------------------------------- | ---------------------------------------------------- |
| tests   | `pnpm verify run <id> --kind tests`   | Rules, through domain tables and PGlite scenarios    |
| api     | `pnpm verify run <id> --kind api`     | The real server answers the journey, refusals too    |
| browser | `pnpm verify run <id> --kind browser` | Pages render; only you looking at the PNGs judges UI |

A `skipped` check is not a pass. Report it as not verified, with its reason.

## 0. Find the feature

1. `pnpm verify which --changed` lists the features your branch touches;
   `pnpm verify list` lists them all.
2. `pnpm verify show <id>` prints everything about one: personas, who may and
   who must be refused, the states worth checking, code, tests, the playbook
   under `.claude/skills/qa/journeys/`, and the exact verify commands.
3. Open the playbook section it names and follow it alongside this file.

## 1. Start the isolated QA environment

Never use the shared development ports (4400, 5400) or reset a shared
database. The QA environment is one server on port 4410 with its own PGlite
data under `.data/qa` (git-ignored), dev sign-in, the mock assistant and
logged mail.

```sh
pnpm verify env build    # the web app, after a UI change (heavy: use the machine's gate if it has one)
pnpm verify env seed     # wipe and seed .data/qa only (refused while the server runs)
pnpm verify env start    # serves API and web on http://localhost:4410
pnpm verify env status   # url, pid, database, web build, log path
pnpm verify env stop     # when you finish; confirms the port is free
```

`QA_PORT` and `QA_DATA_DIR` move it. It refuses the shared ports, a
`DATABASE_URL` that is not PGlite, and a data directory git does not ignore.
List personas with `curl -s localhost:4410/api/auth/dev/personas`.

| Persona       | Situation in the seed                                    |
| ------------- | -------------------------------------------------------- |
| Maya Chen     | Advisor with badges; coach Sam, leader Leo               |
| Leo Okonkwo   | Leader with a pending request; Sam coaches him           |
| Sam Rivera    | Coach with a plan to agree and a request to sign         |
| Daniel Okafor | Plan waiting for Sam; a request waiting on Sam           |
| Aisha Bello   | Returned observation and a held reflection; coach Jordan |
| Tom Whitaker  | Badge holder; coach Jordan, leader Priya                 |
| Marcus Hill   | No plan; a proposed engagement with Jordan; leader Priya |
| Grace Liu     | Empty states                                             |
| Rhea Castillo | Tenant admin; skip-level leader of everyone              |
| Nina Patel    | Compliance reviewer                                      |
| Nadia Brooks  | Program owner                                            |

## 2. Run the automated checks

```sh
pnpm verify run <id> --kind tests
pnpm verify run <id> --kind api
pnpm verify run <id> --kind browser
```

Each run writes `result.json` (structured), `summary.md` and its artifacts to
`.data/verify/runs/<run>/` (or `--out <dir>`), and exits non-zero when a check
failed or errored; add `--strict` to fail on skipped checks too. The API
journeys in `tools/verify/journeys/` say at their top whether they are
re-runnable on the same database (all are today). Run journeys one at a time:
the credit-rules journey changes the tenant's policy while it runs.

## 3. Walk the journey yourself

The automated checks are the floor. For each persona the playbook names, sign
in at `http://localhost:4410/sign-in` (persona picker) and do the journey for
real:

- **Happy path**, start to finish. Note every moment of hesitation.
- **Refusals.** Try what the rules forbid, in the UI and against the API (the
  `refused` list of `pnpm verify show <id>`). A refused action must be
  _absent_ from the UI, not disabled; the API must answer the right tag
  (`Forbidden` 403, `NotFound` 404, `InvalidTransition` or `Conflict` 409,
  `Unprocessable` 422).
- **Lifecycle edges.** Every state's pill and actions must match the machine
  in `packages/domain/src/lifecycles`. Buttons come only from a view's
  `actions`.
- **Privacy.** Text with a client-like name or an account number in a
  reflection must be held and invisible to observers, with copy that says why.
- **Visibility.** Someone outside the relationship gets 404 or nothing; a
  skip-level leader sees levels but not narratives.
- **Audit.** As Rhea or Nina, open `/admin/audit` and confirm each step left an
  event with the right actor, states and reason.

## 4. Look at it

`--kind browser` captures each of the feature's routes in light and dark at
1280 and 390 wide, and checks for sideways scrolling at 360, 390, 768 and 1280.
The PNGs are listed in the run's `summary.md`. **Open them and look**, judging
them against `apps/web/DESIGN.md`: hierarchy, alignment, spacing, truncation,
contrast, focus visibility, empty and loading states, copy fidelity, no "AI
slop". Then a keyboard pass: tab through the flow (focus ring always visible),
dialogs trap and return focus, shortcuts (`⌘K`, `J`/`K`, `⌘Enter`) work and do
not fire while typing.

## 5. Diagnose a failure

- `result.json` names each failed check and its reason. For an API journey,
  `api-<journey>.json` beside it lists every step with each request, its status
  and, for a refusal or failure, the response body.
- The server log is `.data/qa/server.log` (`pnpm verify env status` prints it).
- Vitest and Playwright output sits beside the result (`vitest-*.log`,
  `playwright-*.log` and their JSON reports).
- Re-run one feature's journeys with `pnpm verify run <id> --kind api`. If the
  data drifted (an interrupted run, a manual change): stop, seed, start.
- A journey that fails on product behavior is a finding, not a check to edit:
  record the request, the response and what was expected.

## 6. Report

Write `docs/qa/reports/YYYY-MM-DD-<journey>.md` using
[`docs/qa/report-template.md`](../../../docs/qa/report-template.md), with:

- **severity** for each finding (blocker / major / minor / polish), with repro
  steps, the persona, and a screenshot or result path;
- the run ids and their totals by kind (tests, api, browser);
- **verified** versus **not verified**, listed separately; skipped checks go
  under not verified with their reason;
- **invariants touched**, using IDs from `docs/testing/invariants.md`. Note any
  that lack a test.

Fix blockers and majors you can fix within scope, re-verify, and say so in the
report. Never mark something verified because it "should" work. If the feature
changed, update the map as well (`.claude/skills/feature-map/SKILL.md`).
