# Plans and work

Playbooks for the plan, the work on it, and logging work. Start with the
[QA skill](../SKILL.md); run everything against the QA environment on port 4410.

## My plan

- **Personas:** Marcus Hill (owner, no plan, no coach), Priya Raman (his
  leader, the agreer), Rhea Castillo (skip-level, must be refused), Maya Chen
  and Sam Rivera (a plan with a coach as agreer).
- **Steps in the UI:** as Marcus open My plan, create a plan with one focus
  skill, edit its title, add work, propose. As Priya agree from his plan. As
  Priya revise it back to a draft; as Marcus change the focus skill, propose
  again; as Priya agree. As Marcus record the closing review; as Priya confirm
  it. Cancel the plan.
- **Look at:** the status pill after each step; actions offered only for the
  current state (no Revise after a confirmed review); outcomes shown per focus
  skill; level 4 targets show no badge.
- **Refusals:** Priya editing Marcus's words; the owner confirming his own
  review; Rhea confirming; focus skills changed on an active plan; any edit to
  a canceled plan; a review on a plan still waiting for agreement.
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
  reason. As Tom read the value and who set it. Log the work and ask Jordan;
  as Jordan sign.
- **Look at:** each skill's role and value with its source (the work, the
  template, the skill, the tenant); no "set a value" control for the subject
  or once an observation is open.
- **Refusals:** the subject setting a value; a value outside the tenant's range
  or without a reason; two primaries; a retired skill or unpublished template;
  a value on ad hoc work or after an observation is open.
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
  days back are refused on the date field.
- **Refusals:** asking for an observation of held work; a date older than the
  window.
- **Commands:**

```sh
pnpm verify run log-work --kind tests
pnpm verify run log-work --kind api
pnpm verify run log-work --kind browser
```
