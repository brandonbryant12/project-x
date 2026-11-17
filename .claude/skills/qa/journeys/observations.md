# Observations

Playbooks for asking, signing, "I saw this", returned requests, review and
void. Start with the [QA skill](../SKILL.md); run everything against the QA
environment on port 4410.

## Asking for an observation

- **Personas:** Daniel Okafor (asks), Sam Rivera (coach) and Leo Okonkwo
  (leader) as observers.
- **Steps in the UI:** as Daniel log work on "Walk households through
  proposals" and ask Sam, then Leo, about two skills.
- **Look at:** only eligible observers are offered; the skills default to the
  work's roles; the request appears in the observer's "To sign".
- **Refusals:** asking yourself; an ineligible observer; more skills than the
  tenant's limit; held work.
- **Commands:**

```sh
pnpm verify run request-observation --kind tests
pnpm verify run request-observation --kind api
```

## To sign

- **Personas:** Sam Rivera, Leo Okonkwo, Jordan Blake (observers); Daniel
  Okafor (subject).
- **Steps in the UI:** as Sam open "To sign", open a request, save a draft,
  change a skill's role, sign with a level per skill and one specific comment.
- **Look at:** the role control (at most one primary), the points each skill
  would add, the draft surviving a reload, the signed read view.
- **Refusals:** the subject saving a draft or roles; two primaries; a stale
  version from a second window (`Conflict`); signing twice.
- **Commands:**

```sh
pnpm verify run to-sign --kind tests
pnpm verify run to-sign --kind api
pnpm verify run to-sign --kind browser
```

## I saw this

- **Personas:** Jordan Blake (observer, Tom's coach), Tom Whitaker (subject),
  Priya Raman (Tom's leader, designates), Marcus Hill (designee with no
  development access to Tom), Sam Rivera (browser check).
- **Steps in the UI:** as Tom log work; as Jordan open "I saw this", pick Tom,
  choose the work he already logged, rate and sign. Then the designee case:
  "Asked to observe" is behind `FEATURE_DESIGNATED_OBSERVERS` (off in the QA
  environment), so either start the server with it on (see
  [Designated observers](people-and-coaching.md#designated-observers)) and
  designate Marcus from Tom's profile as Priya, or designate through the API
  (`POST /api/designations`, as the `saw-this` journey does before it ends
  the designation). As Marcus open "I saw this" and pick Tom.
- **Look at:** the logged work is offered by title and kind only, never the
  reflection; attaching does not create a second piece of work. Logged work
  is offered only to the person's coaches and leader chain, and only work
  dated when they were an eligible observer: Marcus sees Tom but no logged
  work, records what he saw as new work, and never sees Tom's reflection
  unless Tom asks him for that work himself.
- **Refusals:** attaching the same work twice (`Conflict`); someone else's work
  (`NotFound`); a designee without development access attaching logged work
  (`NotFound`); logged work dated before the viewer was eligible (`Forbidden`);
  work older than 14 days.
- **Commands:**

```sh
pnpm verify run saw-this --kind tests
pnpm verify run saw-this --kind api
pnpm verify run saw-this --kind browser
```

## Returned request

- **Personas:** Aisha Bello (subject), Jordan Blake (observer), Leo Okonkwo
  (someone else to ask).
- **Steps in the UI:** as Jordan send a request back with a question. As Aisha
  open it, revise the reflection with a client's name and account number, then
  without them, and resend with a note. As Jordan read and sign.
- **Look at:** the return note; no Resend while the reflection is held, with
  copy that says why; the new note and revised words reach Jordan.
- **Refusals:** resending while held (`InvalidTransition`); asking someone else
  about held work (`Unprocessable`); Jordan never sees held words.
- **Commands:**

```sh
pnpm verify run returned-request --kind tests
pnpm verify run returned-request --kind api
pnpm verify run returned-request --kind browser
```

## Acknowledge and review

- **Personas:** Maya Chen (subject), Nina Patel (compliance), Rhea Castillo
  (tenant admin, must be refused).
- **Steps in the UI:** as Maya open a signed observation, acknowledge one and
  request review of another. As Nina resolve the review.
- **Look at:** states and actions after each step; the review reason.
- **Refusals:** anyone but a compliance reviewer upholding or voiding.
- **Commands:**

```sh
pnpm verify run acknowledge-review --kind tests
```

## Void and reversal

- **Personas:** Nina Patel (voids), Maya Chen (badge holder), Leo Okonkwo (team
  coverage).
- **Steps in the UI:** only on a QA database you will reseed: as Nina void one
  of Maya's signed observations with a reason. As Maya open the badge receipt;
  as Leo open My team.
- **Look at:** the voided state and reason; the receipt marks the voided
  credit "reversed" and no longer counts it; a badge revoked and, when still
  met under today's rules, re-awarded; team coverage falls back to the
  previous real observation.
- **Refusals:** anyone else voiding.
- **Commands:**

```sh
pnpm verify run void-reversal --kind tests
```
