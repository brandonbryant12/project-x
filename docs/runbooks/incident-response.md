# Runbook: incident response

Use this when something has gone wrong that affects people's data, access or
trust: suspected client PII in the app, an account used by the wrong person,
a misbehaving AI check, a message sent to the wrong person, or an outage.

The firm owns incident staffing, the on-call rota, the incident record and
regulatory notification. This runbook covers what the application team does
and which levers exist today. Where a lever is manual SQL, it says so.

**Manual SQL writes no audit event.** Write every statement you run, with the
time and your name, into the incident record.

## 1. First 15 minutes

1. Open an incident in the firm's tracker. Name an incident lead.
2. Classify it:

   | Class                                   | Examples                                                             | Tell at once            |
   | --------------------------------------- | -------------------------------------------------------------------- | ----------------------- |
   | **A. Client information exposed**       | A client name in a reflection or narrative that others could read    | Compliance              |
   | **B. Access misuse**                    | A shared or stolen session; a leaver still signed in                 | Security, compliance    |
   | **C. AI provider**                      | Wrong holds at scale; provider outage; data sent that should not be  | AI board owner          |
   | **D. Wrong recipient or wrong content** | A notification to the wrong person, or one that carries content      | Compliance              |
   | **E. Outage or data integrity**         | `/readyz` failing; migrations failing; constraint errors in the logs | Owner of the deployment |

3. Do not delete anything. The ledger (`credit_entry`, `credit_reversal`),
   `audit_event`, AI labels and dispositions, and published catalog versions
   are append-only: the database refuses updates, deletes and truncates.

## 2. Contain

Run SQL against the production database with an operator account. Replace
`$tenant`, `$person` and so on with real ids.

| Goal                                | Lever                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign one person out everywhere      | `DELETE FROM session WHERE tenant_id = $tenant AND person_id = $person;`                                                                                                                                                                                                                                                                                                                    |
| Sign everyone in a tenant out       | `DELETE FROM session WHERE tenant_id = $tenant;`                                                                                                                                                                                                                                                                                                                                            |
| Stop a person using the app at all  | `UPDATE person SET status = 'departed' WHERE tenant_id = $tenant AND id = $person;` Takes effect on their next request, and sign-in is refused after that. See [deprovisioning](deprovisioning.md).                                                                                                                                                                                         |
| Remove a capability now             | Remove it in Entra, then `UPDATE role_grant SET valid_to = CURRENT_DATE WHERE tenant_id = $tenant AND person_id = $person AND role = $role AND valid_to IS NULL;` If `valid_from` is today, delete that row instead. Without the Entra change, the next sign-in grants it again.                                                                                                            |
| Stop all AI calls                   | Set `DECISIONS_MODE=disabled` and restart. Every check then reads "assistant check unavailable"; the product keeps working.                                                                                                                                                                                                                                                                 |
| Stop sending to LangSmith           | Set `LANGSMITH_TRACING=false` and restart.                                                                                                                                                                                                                                                                                                                                                  |
| Stop pending notifications          | `UPDATE notification SET status = 'skipped' WHERE tenant_id = $tenant AND status = 'pending';` This stops the dispatcher sending them; it skips rows that are no longer pending. A config switch to pause the dispatcher is _planned_.                                                                                                                                                      |
| Remove client information from text | Only on compliance's instruction, after they have taken any copy they need. Evidence: `UPDATE evidence SET body = NULL, purged_at = now() WHERE tenant_id = $tenant AND id = $id;` Observation: `UPDATE observation SET narrative_saw = NULL, narrative_next = NULL, purged_at = now() WHERE tenant_id = $tenant AND id = $id;` The digests survive, so audit and AI records still resolve. |

Held reflections are already hidden from everyone but their author, tenant
admins and compliance reviewers. If the text is held, there is usually no
need to purge it during the incident.

## 3. Preserve evidence

- Export the audit trail for the window, ordered by `seq`:

  ```sql
  SELECT * FROM audit_event
  WHERE tenant_id = $tenant AND created_at BETWEEN $from AND $to
  ORDER BY seq;
  ```

- For AI questions, export `advisory_check` rows for the window. They hold
  digests, probabilities, thresholds and effects, not the text.
- Traces and logs in Datadog carry `user.id` and `tenant.id` on each request.
  They never carry narratives or provider payloads.
- If people are involved in a dispute, compliance can place a legal hold:
  insert a `legal_hold` row for the person. Purging is not built yet, so
  nothing is purged automatically either way.

## 4. Recover

- Fix the cause through a normal PR and `pnpm check`. No hot edits on the
  server.
- Reverse the containment you no longer need (for example, set
  `DECISIONS_MODE` back), and record it.
- If data was lost, follow [backup and restore](backup-and-restore.md).

## 5. Close

Within five working days, write a short review in the incident record: what
happened, the timeline, what contained it, and the change that stops it
recurring. If the cause was a gap in an invariant, add the invariant and its
test ([invariants](../testing/invariants.md)).

## Gaps known today

- Containment is SQL, not an audited admin action.
- There is no alert routing yet. Dashboards and monitors are _planned_
  (ADR 0013).
- Stuck `pending` advisory checks are not re-driven automatically.
