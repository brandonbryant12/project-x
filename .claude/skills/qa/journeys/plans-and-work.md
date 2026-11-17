# Plans and work

Playbooks for the plan, the work on it, and logging work. Start with the
[QA skill](../SKILL.md); run everything against the QA environment on port 4410.

## My plan

- **Personas:** Marcus Hill (owner, no plan, no coach), Priya Raman (his
  leader, the agreer), Rhea Castillo (skip-level, must be refused), Maya Chen
  and Sam Rivera (a plan with a coach as agreer).
- **Steps in the UI:** as Marcus open My plan, create a plan with one focus
  skill, edit its title, add work, propose. As Priya agree from his plan. As
  Priya choose "Back to draft": the dialog must list what it clears (the
  agreement, an endorsement, a recorded review that is not confirmed, quoting
  its summary) and "Keep the plan" must change nothing. As Marcus change the
  focus skill, propose again; as Priya agree. As Marcus record the closing
  review. As Priya open Home: "Waiting on you" shows "Marcus Hill recorded a
  closing review" with "Read and confirm", which opens his page. Choose
  "Confirm review": the dialog restates each outcome and the summary; "Not
  yet" changes nothing. Confirm. Cancel the plan.
- **Stale writes:** open the plan as Priya in two windows; change it in one
  (as Marcus record the review again, or move the end date), then agree or
  confirm in the other. The API answers `Conflict`; the screen says the plan
  changed and reloads it, and nothing is agreed or confirmed that she did not
  see.
- **Look at:** the status pill after each step; actions offered only for the
  current state (no Revise after a confirmed review); outcomes shown per focus
  skill; level 4 targets show no badge; both confirmation dialogs at 390 wide
  (buttons reachable, the quoted summary wraps); the Home item gone once the
  review is confirmed.
- **Refusals:** Priya editing Marcus's words; the owner confirming his own
  review; Rhea confirming; focus skills changed on an active plan; any edit to
  a canceled plan; a review on a plan still waiting for agreement; any plan
  write sent with an older `version` (`Conflict`).
- **Commands:**

```sh
pnpm verify show my-plan
pnpm verify run my-plan --kind tests
pnpm verify run my-plan --kind api
pnpm verify run my-plan --kind browser
```

## Work roles and values

- **Personas:** Jordan Blake (coach) and Tom Whitaker (coachee); Sam Rivera
  and Maya Chen; Elena Brooks with a program owner grant in the scenario test.
- **Steps in the UI:** as Jordan open Tom's plan from People I coach, add work
  with one primary and one secondary skill, set an individual value with a
  reason. As Tom read the value, who set it and "applies to work from" today's
  date. Log the work and ask Jordan; as Jordan sign. Log a second piece of the
  same work dated yesterday and ask Jordan again: its credit has the value the
  work had without the individual value (the value applies only to work done
  on or after the day it was set).
- **Look at:** each skill's role and value with its source (the work, the
  template, the skill, the tenant) and, for an individual value, who set it
  and "applies to work from <date>"; the value dialog says the current value's
  date and that a new one applies from today; no "set a value" control for the
  subject or once an observation is open.
- **Stale writes:** open the work dialog (or the value dialog) in two windows,
  save in one, then save in the other: `Conflict`, and the screen reloads the
  work instead of overwriting it.
- **Refusals:** the subject setting a value; a value outside the tenant's range
  or without a reason; two primaries; a retired skill or unpublished template;
  a value on ad hoc work or after an observation is open; an edit or value
  sent with an older `version` (`Conflict`).
- **Commands:**

```sh
pnpm verify run work-roles-values --kind tests
pnpm verify run work-roles-values --kind api
```

## Logging work

- **Personas:** Maya Chen (owner), Sam Rivera (her coach), Aisha Bello (a held
  reflection in the seed).
- **Steps in the UI:** as Maya log work against a planned activity with a plain
  reflection, then again with a client's name and an account number. As Sam
  open the work. As Aisha open her held reflection and revise it.
- **Look at:** the held state and the copy that explains it to the owner; the
  observer sees that words are withheld, never the words; dates more than 30
  days back are refused on the date field. An observer Maya did not ask and
  who has no development access to her (a designee using "I saw this") never
  sees her reflection at all: the observation's `evidence` is `null` and the
  "To sign" item has no preview.
- **Refusals:** asking for an observation of held work; a date older than the
  window.
- **Commands:**

```sh
pnpm verify run log-work --kind tests
pnpm verify run log-work --kind api
pnpm verify run log-work --kind browser
```
