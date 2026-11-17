# Governance and platform

Playbooks for sign-in, assistant checks, the audit trail, notifications, the
directory API, scheduler sweeps and tenancy. Start with the
[QA skill](../SKILL.md); run everything against the QA environment on port 4410.

## Sign-in and session

- **Personas:** Maya Chen (no grants), Rhea Castillo (tenant admin).
- **Steps in the UI:** open `http://localhost:4410/`, get sent to the persona
  picker, sign in as Maya, then sign out; sign in as Rhea.
- **Look at:** navigation shaped by relationships and grants (Maya: Home, My
  plan, Skills; Rhea adds Program and Governance); return to the page you
  asked for after sign-in.
- **Refusals:** the API without a session (401); a write without the
  `x-requested-with` header (403); the old cookie after sign-out (401).
- **Commands:**

```sh
pnpm verify run sign-in-session --kind tests
pnpm verify run sign-in-session --kind api
```

## Assistant checks

- **Personas:** Rhea Castillo (releases holds), Nina Patel (resolves
  escalations), Aisha Bello (a held reflection in the seed).
- **Steps in the UI:** as Rhea open Assistant checks; release Aisha's held
  reflection with a reason (on a QA database you will reseed).
- **Look at:** each check's effect and rationale without the reflection's text;
  skipped checks for held text; the disposition recorded with who and why.
- **Refusals:** anyone else opening the page; a model clearing anything.
- **Commands:**

```sh
pnpm verify run assistant-checks --kind tests
pnpm verify run assistant-checks --kind browser
```

## Audit trail

- **Personas:** Rhea Castillo, Nina Patel; Maya Chen (refused).
- **Steps in the UI:** after any journey, open the audit trail and filter by the
  entity you changed.
- **Look at:** actor, event, from and to states, reason and policy version for
  every step; reads of this page are audited too.
- **Refusals:** anyone without the tenant admin or compliance grant.
- **Commands:**

```sh
pnpm verify run audit-trail --kind tests
pnpm verify run audit-trail --kind api
pnpm verify run audit-trail --kind browser
```

## Notifications

- **Personas:** Maya Chen (preferences), Sam Rivera (receives requests).
- **Steps in the UI:** as Maya open Settings and change a preference. Ask Sam
  for an observation, then read the server log for the logged send
  (`.data/qa/server.log`).
- **Look at:** the send carries names, a verb, counts, dates and a link, never
  a reflection or narrative.
- **Refusals:** none in the UI.
- **Commands:**

```sh
pnpm verify run notifications --kind tests
pnpm verify run notifications --kind browser
```

## Directory import and departures

API only. There is no screen; the scenario tests carry the CSV shapes.

- **Personas:** Rhea Castillo (tenant admin).
- **Steps:** none in the UI. Read
  `apps/server/src/journeys/directory-import-exceptions.scenario.test.ts` and
  `apps/server/src/journeys/deprovision-leaver.scenario.test.ts` for the
  requests and the exceptions reported.
- **Refusals:** anyone but a tenant admin.
- **Commands:**

```sh
pnpm verify run directory-import --kind tests
```

## Scheduler sweeps

- **Personas:** none (system actions).
- **Steps:** none in the UI. The QA server runs the scheduler; expiries show in
  the audit trail with no actor.
- **Look at:** expired requests, plans and proposals in their screens after a
  sweep; the audit events.
- **Commands:**

```sh
pnpm verify run scheduler-sweeps --kind tests
```

## Tenancy and roles

- **Personas:** one per grant: Rhea Castillo, Nina Patel, Nadia Brooks, and
  Maya Chen with none.
- **Steps:** try each sensitive action as each persona against the API; the
  role-by-action scenario test is the reference table.
- **Refusals:** another tenant's data is `NotFound`, an action owned by another
  grant is `Forbidden`.
- **Commands:**

```sh
pnpm verify run tenancy-and-roles --kind tests
```
