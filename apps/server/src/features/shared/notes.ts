import type { Actor } from '@repo/api';
import { NoteId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';

export type NoteKind = (typeof schema.NOTE_KINDS)[number];

export const digestOf = (text: string) => createHash('sha256').update(text).digest('hex');

/** Appends a human-written reason (purgeable content, ADR 0015). */
export const addNote = Effect.fn('notes.add')(function* (
  actor: Pick<Actor, 'tenantId' | 'personId'>,
  note: { entityType: string; entityId: string; kind: NoteKind; body: string },
) {
  const db = yield* Db;
  const id = NoteId.generate();
  yield* db.insert(schema.note).values({
    id,
    tenantId: actor.tenantId,
    entityType: note.entityType,
    entityId: note.entityId,
    kind: note.kind,
    authorId: actor.personId,
    body: note.body,
    contentDigest: digestOf(note.body),
  });
  return id;
});

/** Latest note body per kind for each entity (purged notes read as null). */
export const latestNotes = Effect.fn('notes.latest')(function* (
  tenantId: Actor['tenantId'],
  entityType: string,
  entityIds: ReadonlyArray<string>,
) {
  const result = new Map<string, Partial<Record<NoteKind, string | null>>>();
  if (entityIds.length === 0) return result;
  const db = yield* Db;
  const rows = yield* db
    .select()
    .from(schema.note)
    .where(
      and(
        eq(schema.note.tenantId, tenantId),
        eq(schema.note.entityType, entityType),
        inArray(schema.note.entityId, [...entityIds]),
      ),
    )
    .orderBy(desc(schema.note.createdAt));
  for (const row of rows) {
    const entry = result.get(row.entityId) ?? {};
    if (!(row.kind in entry)) entry[row.kind as NoteKind] = row.body;
    result.set(row.entityId, entry);
  }
  return result;
});
