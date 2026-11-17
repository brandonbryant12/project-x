# ADR 0018: Notifications go through a transactional outbox, under a content policy

- Status: Accepted (amended)
- Date: 2026-11-16
- Builds on: [ADR 0011](./0011-single-deployable-with-in-process-scheduler.md), [ADR 0012](./0012-privacy-and-audit-by-design.md)

> **Amended, 2026-11-17.** Email is the only channel: the Teams channel and
> its preference were dropped (an old Teams choice is delivered by email). A
> person has two settings, email on or off and the weekly digest on or off.
> The admin outbox page was removed. The adoption view no longer reports
> notification-to-action conversion (ADR 0021 amendment). The text below is
> the original decision.

> **Amended, 2026-11-17: delivery is at least once.** Delivery is at least
> once. The dispatcher claims a row in a short transaction (counting the
> attempt and leasing the row for 10 minutes), sends it with no transaction
> open and a 60-second timeout, then acknowledges it with an update that
> applies only if the row is still pending at the attempt it claimed. If the
> process dies or the acknowledgement is lost after the transport accepted a
> message, the row becomes due again when the lease ends and is sent again;
> the dedupe key prevents duplicate rows, not that duplicate send. A row
> claimed five times without an acknowledgement is marked failed at its next
> claim. Before this amendment the send ran inside the claiming transaction.
> The code is `apps/server/src/features/notifications/dispatcher.ts`; the
> journey test is
> `apps/server/src/journeys/notification-delivery-at-least-once.scenario.test.ts`.
> The Dispatch section below is corrected where it said that two replicas
> never send the same row.

## Context

The independent review graded product usefulness B-. The loop depends on
observers remembering to open an inbox. Observer time is the scarce resource,
and a request nobody sees expires.

Facts that constrain the design:

- Every transition that makes something wait on a person already writes an
  `audit_event` in its own transaction (ADR 0005, ADR 0015).
- Email and the Teams activity feed leave the firm's control once sent. They
  are forwarded, previewed on lock screens and kept in mailboxes with their
  own retention.
- The product holds content that must not travel: reflections, narratives,
  levels, hold reasons and `client_ref` values (ADR 0012).
- One server process runs the API and the scheduler (ADR 0011). A queue
  service is out of scope at this scale.
- `frame-ancestors 'none'` blocks a Teams tab. That stays until a separate
  ADR changes it.

## Decision

**A transition that makes something wait on a person writes a
`notification` row in the same transaction as its audit event. A dispatcher
in the existing scheduler sends pending rows. A message carries only the
recipient's first name, a colleague's display name, a verb from a closed
template set, counts, dates and a deep link. It never carries narrative,
reflection, levels, hold reasons or `client_ref` (invariant I20).**

### The outbox row

`notification` columns: `tenant_id`, `id`, `recipient_id`, `kind`,
`entity_type`, `entity_id` (null for a digest), `actor_id` (nullable),
`due_on` (nullable), `item_count` (nullable), `dedupe_key`, `status`,
`channel`, `attempts`, `send_after`, `created_at`, `sent_at`.

- `kind` is a closed set: `observation_requested`, `observation_signed`,
  `observation_returned`, `plan_proposed`, `engagement_proposed`,
  `request_expiring`, `weekly_digest`.
- `status` is `pending`, `sent`, `skipped` or `failed`.
- Nobody is notified about their own action.
- `dedupe_key` is unique per tenant. Writing the same key twice is a no-op,
  so a retried transaction or a second sweep cannot queue a second message.
- **The table has no free-text column.** The renderer can only use the typed
  fields above plus the display names of `recipient_id` and `actor_id`.

### What sends immediately

Five triggers, six kinds (a proposal is either a plan or an engagement):

| Trigger                                 | Kind                                   | Recipient                  |
| --------------------------------------- | -------------------------------------- | -------------------------- |
| Someone asks you to observe             | `observation_requested`                | The observer               |
| An observation about you is signed      | `observation_signed`                   | The subject                |
| An observation is returned to you       | `observation_returned`                 | The subject                |
| A plan or engagement is proposed to you | `plan_proposed`, `engagement_proposed` | The person who must answer |
| A request expires in 48 hours           | `request_expiring`                     | The observer               |

The first four are written by the use case that makes the transition. The
expiry reminder is written by the scheduler, once per request. A dedupe key
is the kind, the entity id and the recipient id (plus an occurrence for a
repeat, such as a second return).

Everything else waits for the **weekly digest**: Monday 07:30 in the tenant's
time zone. A digest carries counts and dates, one link per line. It makes no
comparisons and never says "behind". An empty digest is not sent.

### Dispatch

- The dispatcher runs in the existing scheduler, once a minute. It claims
  each pending row with `FOR UPDATE SKIP LOCKED` in its own short
  transaction and leases it, so two replicas do not claim the same row while
  its lease holds. _Corrected 2026-11-17: this does not mean a row is never
  sent twice; delivery is at least once (see the amendment above)._ (The
  expiry sweeps use a Postgres advisory lock instead.)
- It reads the recipient's `notification_preference` (`channel`: `email`,
  `teams` or `off`; `weekly_digest` on or off). Defaults: email, digest on.
  A row whose recipient has turned notifications off is marked `skipped`, and
  so is a digest with nothing to say.
- A row is not sent before `send_after`. A failed send increments `attempts`
  and is retried with exponential backoff. After five attempts the row is
  `failed` and kept for inspection. The database caps `attempts` at 20.
- Channels, recorded on the row when sent:
  - `log` writes the rendered message to the server log. Development and
    tests use it, and it is the default.
  - `email` over the firm's SMTP relay (`NOTIFY_TRANSPORT=smtp`, with
    `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` kept
    `Redacted`, and `NOTIFY_FROM`). Plain text with a minimal HTML twin. Proven
    against an in-process relay in `platform/notifier.test.ts`; a refusal is a
    retryable failure. Locally, `docker compose --profile mail up` runs Mailpit
    to read the messages.
  - `teams` (the activity feed) is _planned_, behind configuration, once IT
    grants the Graph permission. Until then a Teams preference is delivered by
    email.
- A deep link opens one action. Sign-in returns the person to that link.

### Templates

Each kind has one template. A template is a function of typed parameters
(first name, display name, count, date, link). It cannot accept a string from
user content. Changing a template's wording is a code change that goes
through review.

## Alternatives considered

- **Send from the use case after commit.** A crash between commit and send
  loses the message, and there is nowhere to dedupe or batch into a digest.
- **A queue service or worker** (Effect Cluster, a hosted queue). Rejected
  for now, per ADR 0011: the volume is a few messages per person per week.
- **Put the observation's quote in the "signed" message.** It is the most
  motivating content, and the most dangerous to forward. The quote stays in
  the app; the message says who signed and links to it.
- **AI-written digests.** Rejected for now. The Decisions API never generates
  text (ADR 0008), and generated text could not be held to the content policy
  by construction.
- **A Teams personal tab.** Deferred. It needs `frame-ancestors` relaxed and
  its own ADR.

## Consequences

- Notifications are as reliable as the transaction that writes them. If the
  transition commits, the row exists.
- Delivery is at least once. A crash after a transport accepts a message and before
  the row is marked `sent` can send it twice. The dedupe key stops duplicate
  rows, not that duplicate send.
- Adding a kind is a vocabulary change, a template and a migration for the
  `CHECK` constraint.
- Invariant **I20** (no content in a notification) needs a test that renders
  every kind and finds no narrative, reflection, level, hold reason or
  `client_ref`. See [invariants](../testing/invariants.md).
- The adoption view (ADR 0021) reports notification-to-action conversion.
  **This decision was wrong if** conversion stays low after the first weeks of
  a pilot, or opt-outs pass a fifth of recipients. Then the triggers or the
  copy need rework, not more messages.
- Open: which channels the firm allows, and the Teams permissions; digest
  timing ([open questions](../product/open-questions.md) 20 and 21).
