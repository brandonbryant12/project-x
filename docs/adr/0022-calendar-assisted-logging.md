# ADR 0022: Calendar-assisted logging reads the calendar on demand and never stores it

- Status: **Deferred** (2026-11-17). Was proposed; never built. Needs token
  storage design, admin consent and an infosec review before any build. Listed
  in the [backlog](../backlog.md).
- Date: 2026-11-16
- Builds on: [ADR 0012](./0012-privacy-and-audit-by-design.md), [ADR 0014](./0014-session-auth-with-openid-client.md)

## Context

Most interactions worth observing are already in someone's Outlook calendar.
Turning a meeting into a one-tap log would cut the advisor's 30-second
logging target further, and could suggest who was in the room to observe.

But meeting subjects and attendee lists routinely contain client names and
household names. Ingesting calendars server-side would put client PII into
the system, which breaks the rule that development records hold only opaque
`client_ref` values (ADR 0012, invariant I7).

Facts we know:

- Reading a user's calendar needs Microsoft Graph `Calendars.Read`, which is
  a delegated permission that needs admin consent in most firms.
- Today the app holds no Graph tokens. Sign-in keeps only the ID token's
  claims (ADR 0014).

## Decision (proposed)

**Never ingest calendars server-side. When a person asks for it, the app
makes a delegated Graph read of their own calendar for a short range, holds
the events in memory for that request only, and shows them. The person picks
one. Only the date, the activity kind they chose and, if they choose one, a
suggested observer are stored. The meeting subject and attendee list are
never written to the database, logs or traces.**

- Internal attendees are matched to `person` rows only to suggest an
  observer. External attendees are dropped before anything is shown.
- The subject line is shown to the person who owns the calendar and then
  discarded. It never becomes the interaction's title.
- The feature is off per tenant until IT and infosec approve it.

## Questions for IT and infosec

1. Will the firm grant `Calendars.Read` (delegated) to this app, with admin
   consent?
2. Where may a refresh token be stored, and for how long? Or must the app ask
   for consent on every use, with no refresh token?
3. Is a server-side read held only in memory acceptable, or must the read
   happen in the browser with a token that never reaches the server?
4. Do calendar subjects at this firm contain client names often enough that
   showing them back to the owner is itself a concern on shared screens?
5. Which conditional-access policies apply to Graph calls from this app?
6. What audit record does infosec want for each calendar read: an
   `audit_event` with the date range and count only?

## Alternatives considered

- **Server-side calendar sync.** Rejected: it ingests client names.
- **Parse meeting subjects with a model to strip names.** A model that misses
  one name has already stored it. It also sends client names to a provider.
- **Do nothing.** Logging stays manual. Acceptable until the questions above
  are answered.

## Consequences

- If accepted, the app holds Graph tokens for the first time. That changes a
  trust boundary and needs its own threat model.
- If IT refuses delegated calendar access, this ADR is rejected and nothing
  else changes.
