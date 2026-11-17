import {
  GRANT_ROLES,
  PersonId,
  RoleGrantId,
  TenantId,
  initialCreditPolicy,
  type IsoDate,
} from '@repo/domain';
import { Db, schema } from '@repo/db';
import { Effect } from 'effect';

/**
 * A second tenant for leak tests: one active person holding every grant, and
 * nothing else. Directory facts only (no observations or credit), so writing
 * the rows directly bypasses no rule. Sign in with `signInAs(OUTSIDER)`.
 */
export const OUTSIDER = 'Zed Outsider';

export const seedSecondTenant = Effect.gen(function* () {
  const db = yield* Db;
  const tenantId = TenantId.generate();
  const personId = PersonId.generate();
  yield* db.insert(schema.tenant).values({
    id: tenantId,
    name: 'Southwind Advisors',
    slug: 'southwind',
    timeZone: 'America/Chicago',
    settings: { creditPolicy: initialCreditPolicy() },
  });
  yield* db.insert(schema.person).values({
    id: personId,
    tenantId,
    email: 'zed.outsider@southwind.example',
    displayName: OUTSIDER,
  });
  yield* db.insert(schema.roleGrant).values(
    GRANT_ROLES.map((role) => ({
      id: RoleGrantId.generate(),
      tenantId,
      personId,
      role,
      validFrom: '2025-01-01' as IsoDate,
      source: 'seed',
    })),
  );
  return { tenantId, personId };
});
