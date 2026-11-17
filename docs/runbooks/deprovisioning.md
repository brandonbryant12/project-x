# Runbook: deprovisioning a leaver

Use this when someone leaves the firm, or must lose access at once. For a
role change inside the firm, change their Entra groups and reporting line
instead; nothing here is needed.

**Use the app.** After IT disables the account (step 1 below), a tenant
admin departs the person with `POST /admin/people/:id/depart` (optionally
`{ effectiveOn }`, today or up to 30 days back), or by running the directory
import with `applyDepartures: true`. In one audited transaction it:

- marks the person `departed` and deletes their sessions;
- ends their open reporting lines, grants, position and designations;
- ends their engagements and expires requests waiting on them as observer,
  through the lifecycles, so requesters can ask someone else;
- skips their pending notifications;
- raises a `manager_departed` exception for each report left without a
  manager.

Signed history and credit are never touched. Proven by
`journeys/deprovision-leaver.scenario.test.ts` (I30).

The SQL steps below are the **fallback** for when the app itself is
unavailable. Record each statement, with the time and your name, in the
ticket: manual SQL writes no audit event.

## What the app does on its own

- Sign-in goes through Entra. Once IT disables the account, no new session
  can start.
- Every request reloads the person and their current grants
  (`loadActor` in `apps/server/src/auth/sessions.ts`). A person marked
  `departed` is refused on their next request, and sign-in is refused too.
- A grant removed in Entra closes only at the person's **next sign-in**. An
  existing session keeps the old grants for up to 7 days. That is why step 3
  exists.

## Fallback steps (app unavailable)

1. **Entra (IT).** Disable the account, or remove it from the app's groups.
2. **Mark the person departed.**

   ```sql
   UPDATE person SET status = 'departed'
   WHERE tenant_id = $tenant AND id = $person;
   ```

3. **End their sessions and close their grants.**

   ```sql
   DELETE FROM session WHERE tenant_id = $tenant AND person_id = $person;

   UPDATE role_grant SET valid_to = CURRENT_DATE
   WHERE tenant_id = $tenant AND person_id = $person
     AND valid_to IS NULL AND valid_from < CURRENT_DATE;
   DELETE FROM role_grant
   WHERE tenant_id = $tenant AND person_id = $person
     AND valid_to IS NULL AND valid_from = CURRENT_DATE;
   ```

4. **Close their reporting lines** (as manager and as report), unless the
   directory feed will do it. Use the leaving date, not a past date, so
   eligibility for past work stays correct.

   ```sql
   UPDATE reporting_line SET valid_to = $leaving_date
   WHERE tenant_id = $tenant AND valid_to IS NULL
     AND (manager_id = $person OR report_id = $person);
   ```

   Their reports now have no leader in the app until HR records a new
   manager. Tell the new manager.

5. **Coaching engagements.** Ask each remaining party to end the engagement
   in the app (either party may). That path is audited. Do not change
   `engagement` rows by SQL.
6. **Designations.** Ask the subject's leader or coach to end any active
   designation where the leaver is the observer or the subject. Ending one is
   an audited action in the app. If nobody is left who can end it, use SQL:

   ```sql
   UPDATE observer_designation SET ended_on = $leaving_date
   WHERE tenant_id = $tenant AND ended_on IS NULL
     AND valid_from <= $leaving_date AND valid_to > $leaving_date
     AND (observer_id = $person OR subject_id = $person);
   ```

   The database allows a designation to be ended once and refuses any other
   change.

7. **Pending notifications.**

   ```sql
   UPDATE notification SET status = 'skipped'
   WHERE tenant_id = $tenant AND recipient_id = $person AND status = 'pending';
   ```

## What is kept

Everything. Signed observations, credits, badges and audit events about or
by the leaver stay, because they were true on their dates. Requests waiting on
the leaver expire on their own after the signing window (14 days). Purging
free text under a retention class is not built yet (ADR 0012).

If compliance or legal asks for a legal hold, record it in the ticket. Holds
are not modelled in the database yet; nothing is purged automatically, and the
purge job must honour holds when it is built.

## Check

- Sign-in as the person fails with "Your access has ended."
- `SELECT count(*) FROM session WHERE person_id = $person;` returns 0.
- No open `role_grant` rows remain for the person.

## Gaps known today

- Nothing here is audited in the app.
- No scheduled directory sync, so a leaver who is never deprovisioned keeps
  access until their Entra account is disabled and their session expires.
- How fast access removal must take effect is domain-expert question F3.
