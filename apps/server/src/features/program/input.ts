import { Unprocessable } from '@repo/api';
import { slugify, type CatalogProblem, type TenantId } from '@repo/domain';
import { Db, schema } from '@repo/db';
import { and, eq, like } from 'drizzle-orm';
import { Effect } from 'effect';

/** Trimmed text within bounds, or a field-level Unprocessable. */
export const requireText = (
  value: string,
  field: string,
  label: string,
  bounds: { readonly min: number; readonly max: number },
) => {
  const text = value.trim();
  return text.length >= bounds.min && text.length <= bounds.max
    ? Effect.succeed(text)
    : Effect.fail(
        new Unprocessable({
          message:
            bounds.min > 0
              ? `${label} needs ${bounds.min} to ${bounds.max} characters.`
              : `Keep ${label.toLowerCase()} under ${bounds.max} characters.`,
          field,
        }),
      );
};

/** Optional text: empty is null. */
export const optionalText = (value: string | null, field: string, label: string, max: number) =>
  value === null || value.trim() === ''
    ? Effect.succeed(null)
    : requireText(value, field, label, { min: 1, max });

/** The first of a domain check's problems as the API error. */
export const problemError = (problems: ReadonlyArray<CatalogProblem>) =>
  new Unprocessable({
    message: problems[0]?.message ?? 'Check the values.',
    ...(problems[0] && { field: problems[0].field }),
  });

/** Fails with the first problem, or succeeds when there are none. */
export const refuseProblems = (problems: ReadonlyArray<CatalogProblem>) =>
  problems.length > 0 ? Effect.fail(problemError(problems)) : Effect.void;

/**
 * A slug for a new catalog item that no other item of the tenant has: the
 * name's slug, else that slug with `-2`, `-3`… Slugs never change, so links
 * to a skill stay valid when it is renamed.
 */
export const uniqueSlug = Effect.fn('program.uniqueSlug')(function* (
  tenantId: TenantId,
  table: 'skill' | 'activityTemplate',
  name: string,
) {
  const db = yield* Db;
  const base = slugify(name) || (table === 'skill' ? 'skill' : 'template');
  const t = table === 'skill' ? schema.skill : schema.activityTemplate;
  const taken = new Set(
    (yield* db
      .select({ slug: t.slug })
      .from(t)
      .where(and(eq(t.tenantId, tenantId), like(t.slug, `${base}%`)))).map((r) => r.slug),
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
});
