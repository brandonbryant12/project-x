import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  CODED_COLUMNS,
  LABEL_COLUMNS,
  NARRATIVE_COLUMNS,
  STRUCTURED_COLUMN_NAME,
  TABLE_RETENTION,
} from './retention.ts';
import * as schema from './schema/index.ts';

/**
 * I22: every table has a retention class and every free-text column is
 * classified exactly once (ADR 0012). A new table or column fails here until
 * someone decides how long it lives.
 */
const tables = (Object.values(schema) as ReadonlyArray<unknown>)
  .filter((value): value is PgTable => value instanceof PgTable)
  .map((table) => getTableConfig(table));

describe('retention', () => {
  it('I22: every table has exactly one retention class', () => {
    expect(tables.map((t) => t.name).toSorted()).toEqual(Object.keys(TABLE_RETENTION).toSorted());
  });

  it('I22: every free-text column is classified as narrative, label or code, once', () => {
    const classified = [NARRATIVE_COLUMNS, LABEL_COLUMNS, CODED_COLUMNS].flatMap((group) =>
      Object.entries(group).flatMap(([table, columns]) => columns.map((c) => `${table}.${c}`)),
    );
    expect(new Set(classified).size).toBe(classified.length);
    const freeText = tables.flatMap((t) =>
      t.columns
        .filter((c) => c.columnType === 'PgText' && !STRUCTURED_COLUMN_NAME.test(c.name))
        .map((c) => `${t.name}.${c.name}`),
    );
    expect(freeText.toSorted()).toEqual(classified.toSorted());
  });
});
