# Runbook: backup and restore

PostgreSQL holds all of the application's state, including sessions. The app
containers are stateless and there is no file or blob storage. Backing up the
database backs up the product.

**No restore drill has been run yet.** Run one before a pilot, and record the
date, the restore point and the time taken in the change record.

## Backups

- **Production** uses the managed database's automated backups with
  point-in-time recovery. The firm's infrastructure team owns the schedule,
  the retention and where the backups live.
- Backups are for recovery, not for records retention. They are not the
  books-and-records archive (domain-expert question D1).
- Backups contain everything the database holds, including reflections and
  narratives. They need the same access controls as the database.

## Restore to a point in time

1. **Stop writes.** Scale the app to zero replicas. There is no maintenance
   mode.
2. **Restore** to a new database instance at the chosen time `T`, using the
   provider's console. Keep the old instance until the restore is accepted.
3. **Check the restored database** before pointing the app at it:
   - `btree_gist` is installed (`SELECT * FROM pg_extension;`);
   - `SELECT max(seq), max(created_at) FROM audit_event;` matches the
     expected restore point;
   - `SELECT count(*) FROM credit_entry;` is close to the last known figure.
4. **Revoke every session.** Sessions revoked after `T` are alive again in the
   restored copy.

   ```sql
   DELETE FROM session;
   ```

5. **Re-apply access removals made after `T`.** Any person marked `departed`
   or any grant closed after `T` is open again. Take the list from the
   incident and deprovisioning tickets, and repeat
   [deprovisioning](deprovisioning.md) for each.
6. **Decide about notifications.** Rows sent after `T` are `pending` again
   and would be sent twice. To avoid that, mark them skipped; people still
   see the items in the app.

   ```sql
   UPDATE notification SET status = 'skipped' WHERE status = 'pending';
   ```

7. **Point the app at the new instance** (`DATABASE_URL`), start one replica,
   and wait for `/readyz`. Migrations run at startup unless
   `DB_MIGRATE_ON_START=false`, in which case run `pnpm db:migrate` first.
8. **Smoke test.** Sign in as a tenant admin, open the audit trail, and open
   one person's profile. Then scale back up.

## What is lost

Everything written after `T`: signatures, credits, badges, plans and their
audit events. The audit trail cannot tell you what happened after `T`,
because it was restored too.

To find who was affected, read the request traces in Datadog for the window
after `T`. Each request carries `user.id` and `tenant.id`. Compliance decides
whom to tell; affected observers must sign again.

## Local development

`pnpm db:reset` wipes and reseeds the local database. To keep a local copy
first:

```bash
docker compose exec postgres pg_dump -U app -Fc app > local.dump
docker compose exec -T postgres pg_restore -U app -d app --clean < local.dump
```

## Gaps known today

- No restore drill, and no measured recovery time.
- Advisory checks that were `pending` at `T` stay pending. They are not
  re-driven automatically.
