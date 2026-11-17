# People and coaching

Playbooks for Home, My team, coaching, profiles and designated observers.
Start with the [QA skill](../SKILL.md); run everything against the QA
environment on port 4410.

## Home

- **Personas:** Maya Chen (Try next time), Leo Okonkwo (requests waiting),
  Grace Liu (empty states), Priya Raman (a closing review to confirm, after
  Marcus records one: see [My plan](plans-and-work.md#my-plan)).
- **Steps in the UI:** open Home as each. As Priya, with Marcus's review
  recorded, choose "Read and confirm" in "Waiting on you".
- **Look at:** "Try next time" first, then the points sentence, "Waiting on
  you" and up to three people worth observing, each with a reason; empty states
  that say what to do next. Never a ranking. A recorded closing review waits
  on the agreer as "<name> recorded a closing review" with "Read and confirm"
  and leaves once confirmed. "Times observed" on the plan card counts each
  piece of work once, however many focus skills it built.
- **Refusals:** none; Home shows only the viewer's own items.
- **Commands:**

```sh
pnpm verify run home --kind tests
pnpm verify run home --kind api
pnpm verify run home --kind browser
```

## My team

- **Personas:** Leo Okonkwo (leader), Rhea Castillo (skip-level).
- **Steps in the UI:** as Leo open My team and one report.
- **Look at:** coverage per skill counts only credit that stands; last
  observed date and observer; the skip-level view shows levels without words.
- **Refusals:** people outside the reporting line are not listed and their
  pages answer 404.
- **Commands:**

```sh
pnpm verify run my-team --kind tests
pnpm verify run my-team --kind browser
```

## Coaching

- **Personas:** Sam Rivera and Jordan Blake (two coaches), Maya Chen and Grace
  Liu (advisors), Marcus Hill (a proposal waiting on Jordan).
- **Steps in the UI:** as Sam open Jordan's profile and propose being coached
  by him; as Jordan accept or decline; as Sam withdraw instead. As Marcus see
  his proposal waiting.
- **Look at:** both directions offered between two coaches and none once a
  proposal is live; the note; the states of People I coach.
- **Refusals:** an advisor proposing to coach someone; a leader coaching their
  own report; a second live engagement between the same two people, in either
  direction (`Conflict`; the database refuses it too).
- **Commands:**

```sh
pnpm verify run coaching --kind tests
pnpm verify run coaching --kind api
pnpm verify run coaching --kind browser
```

## People and profiles

- **Personas:** Maya Chen (own profile), Grace Liu (unrelated), Sam Rivera and
  Leo Okonkwo (coach and leader).
- **Steps in the UI:** search for Maya; open her profile as each persona.
- **Look at:** badges visible to everyone; progress only to Maya, her coaches
  and her leader chain; the coaching directions offered.
- **Refusals:** progress to unrelated colleagues, program owners and tenant
  admins.
- **Commands:**

```sh
pnpm verify run people-profiles --kind tests
pnpm verify run people-profiles --kind api
pnpm verify run people-profiles --kind browser
```

## Designated observers

Behind `FEATURE_DESIGNATED_OBSERVERS` (off in the QA environment). To look at
the screens, stop the server and start it with the switch on:
`FEATURE_DESIGNATED_OBSERVERS=true pnpm verify env start`.

- **Personas:** Leo Okonkwo (leader designates), Sam Rivera (coach), Maya Chen
  (subject sees it).
- **Steps in the UI:** as Leo open Maya's profile, ask a colleague to observe
  her for a window, then end it.
- **Look at:** the window (at most 90 days), the designation visible to Maya,
  the audit events. The designee observes Maya but is offered none of her
  logged work and never sees her reflection unless she asks them (see
  [I saw this](observations.md#i-saw-this)).
- **Refusals:** anyone but the subject's leader or engaged coach; a reciprocal
  overlapping designation.
- **Commands:**

```sh
pnpm verify run designated-observers --kind tests
pnpm verify run designated-observers --kind api
```
