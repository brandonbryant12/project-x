# Program administration

Playbooks for the program owner's screens and for browsing skills. Start with
the [QA skill](../SKILL.md); run everything against the QA environment on port 4410.

## Credit rules

- **Personas:** Nadia Brooks (program owner), Rhea Castillo (tenant admin,
  reads the audit trail), Maya Chen (advisor, refused).
- **Steps in the UI:** as Nadia open Credit rules, change one value, save with a
  reason. Open the same page in a second window, save there from the old
  version. As Rhea open the audit trail. Put the value back.
- **Look at:** the plain-words consequence when a value is below the working
  default; the change history with before, after, who and why.
- **Refusals:** Maya opening or saving the rules; a save without a reason; a
  stale save (`Conflict`).
- **Commands:**

```sh
pnpm verify run credit-rules --kind tests
pnpm verify run credit-rules --kind api
pnpm verify run credit-rules --kind browser
```

## Skill catalog

- **Personas:** Nadia Brooks; Maya Chen (refused, then browses).
- **Steps in the UI:** as Nadia create a draft skill, write its four levels and
  indicators, publish, edit and publish version 2, set the skill's own values
  with a reason, retire it.
- **Look at:** the version history and change notes; the draft beside the
  published version; values that differ from the tenant's.
- **Refusals:** publishing an incomplete draft; a retired skill for new work;
  Maya opening program screens.
- **Commands:**

```sh
pnpm verify run skill-catalog --kind tests
pnpm verify run skill-catalog --kind api
pnpm verify run skill-catalog --kind browser
```

## Activity templates

- **Personas:** Nadia Brooks; Maya Chen.
- **Steps in the UI:** as Nadia draft a template with a primary and a secondary
  skill and points for one, publish it, edit it, retire it. As Maya add work
  from it to a plan.
- **Look at:** roles and points per skill; the template's values copied onto
  the work when added, unchanged by later template edits.
- **Refusals:** two primaries; a skill listed twice; an unpublished or retired
  skill; a stale edit.
- **Commands:**

```sh
pnpm verify run activity-templates --kind tests
pnpm verify run activity-templates --kind api
pnpm verify run activity-templates --kind browser
```

## Skills browsing

- **Personas:** Maya Chen, Grace Liu.
- **Steps in the UI:** open Skills, search, filter by domain, open a skill.
- **Look at:** levels and indicators, holders, "in my plan", values that differ
  from the tenant's; no drafts or retired skills.
- **Refusals:** none beyond hidden drafts.
- **Commands:**

```sh
pnpm verify run skills-browse --kind tests
pnpm verify run skills-browse --kind browser
```

## Adoption

- **Personas:** Nadia Brooks and Rhea Castillo (readers); Maya Chen and Sam
  Rivera (refused).
- **Steps in the UI:** as Nadia open Adoption.
- **Look at:** four figures, no names; a withheld figure says why rather than
  showing 0.
- **Refusals:** anyone without the program owner or tenant admin grant.
- **Commands:**

```sh
pnpm verify run adoption --kind tests
pnpm verify run adoption --kind api
pnpm verify run adoption --kind browser
```
