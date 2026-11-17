import type { LegalHoldId, NoteId, PersonId } from '@repo/domain';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, instant, oneOf, tenantIdColumn } from './columns.ts';
import { personFk } from './directory.ts';

/**
 * Human-written reasons attached to lifecycle events (return note, decline
 * reason, review request, void reason, release reason). Append-only history —
 * a second RETURN adds a note instead of overwriting one — and purgeable
 * content under its retention class, unlike audit_event.
 */
export const note = pgTable(
  'note',
  {
    id: text('id').$type<NoteId>().primaryKey(),
    tenantId: tenantIdColumn(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    kind: text('kind').notNull(),
    authorId: text('author_id').$type<PersonId>().notNull(),
    body: text('body'),
    contentDigest: text('content_digest').notNull(),
    purgedAt: instant('purged_at'),
    createdAt: createdAt(),
  },
  (t) => [
    personFk('note_author_fk', t.tenantId, t.authorId),
    oneOf('note_kind_check', t.kind, [
      'request',
      'return',
      'decline',
      'review',
      'void',
      'uphold',
      'release',
      'resolve',
    ]),
    check('note_purge_shape', sql`(${t.body} is null) = (${t.purgedAt} is not null)`),
    index('note_entity_idx').on(t.tenantId, t.entityType, t.entityId, t.createdAt),
  ],
);

/** While active, nothing about the person is purged regardless of retention class. */
export const legalHold = pgTable(
  'legal_hold',
  {
    id: text('id').$type<LegalHoldId>().primaryKey(),
    tenantId: tenantIdColumn(),
    personId: text('person_id').$type<PersonId>().notNull(),
    placedById: text('placed_by_id').$type<PersonId>().notNull(),
    reasonCode: text('reason_code').notNull(),
    placedAt: instant('placed_at').notNull(),
    releasedAt: instant('released_at'),
  },
  (t) => [
    personFk('legal_hold_person_fk', t.tenantId, t.personId),
    personFk('legal_hold_placed_by_fk', t.tenantId, t.placedById),
    index('legal_hold_person_idx').on(t.tenantId, t.personId),
  ],
);
