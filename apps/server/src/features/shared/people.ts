import type { PersonSummary } from '@repo/api';
import type { PersonId, TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

type PersonRow = typeof schema.person.$inferSelect;

const hueOf = (id: string): number => {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
};

export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

export const toPersonSummary = (row: PersonRow): PersonSummary => ({
  id: row.id,
  displayName: row.displayName,
  title: row.title,
  initials: initialsOf(row.displayName),
  hue: hueOf(row.id),
});

export const firstName = (displayName: string): string =>
  displayName.split(/\s+/)[0] ?? displayName;

/** Loads people by id into a map of summaries. Missing ids are simply absent. */
export const loadPeople = Effect.fn('people.load')(function* (
  tenantId: TenantId,
  ids: ReadonlyArray<PersonId>,
) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<PersonId, PersonSummary>();
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(schema.person)
    .where(and(eq(schema.person.tenantId, tenantId), inArray(schema.person.id, unique)));
  return new Map(rows.map((row) => [row.id, toPersonSummary(row)]));
});

/** Summary lookup that treats a missing person as a broken invariant. */
export const personFrom = (
  people: ReadonlyMap<PersonId, PersonSummary>,
  id: PersonId,
): PersonSummary => {
  const found = people.get(id);
  if (!found) throw new Error(`invariant: person ${id} not loaded`);
  return found;
};
