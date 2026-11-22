import {
  Conflict,
  CurrentActor,
  Forbidden,
  NotFound,
  Unprocessable,
  type Actor,
  type AddSkillResourceInput,
  type AuthorSkillInput,
  type UpdateSkillInput,
} from '@repo/api';
import {
  SkillId,
  SkillIndicatorId,
  SkillVersionId,
  type Level,
  type SkillResource,
  type SkillTier,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, desc, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { randomBytes } from 'node:crypto';
import { now } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { buildSkillDetail } from './views.ts';

const requireCatalogAuthor = (actor: Actor) =>
  actor.grants.includes('tenant_admin') || actor.grants.includes('program_owner')
    ? Effect.void
    : Effect.fail(
        new Forbidden({
          message: 'Only tenant admins and program owners can author skills.',
        }),
      );

const requireResourceEditor = (actor: Actor) =>
  actor.grants.includes('tenant_admin') ||
  actor.grants.includes('program_owner') ||
  actor.grants.includes('coach')
    ? Effect.void
    : Effect.fail(
        new Forbidden({
          message: 'Only coaches, program owners, and tenant admins can customize playbooks.',
        }),
      );

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 72);

const normalizeTags = (tier: SkillTier, tags: ReadonlyArray<string>): Array<string> => {
  const cleaned = tags
    .map((t) => t.trim().toLowerCase().replaceAll(/\s+/g, '-'))
    .filter((t) => t.length > 0 && t !== 'core' && t !== 'common');
  return [tier, ...new Set(cleaned)];
};

const validateLevels = (levels: AuthorSkillInput['levels']) => {
  const seen = new Set(levels.map((l) => l.level));
  if (seen.size !== 4 || ![1, 2, 3, 4].every((n) => seen.has(n as Level))) {
    return Effect.fail(
      new Unprocessable({ message: 'Provide exactly four levels (1 through 4).', field: 'levels' }),
    );
  }
  return Effect.void;
};

const validateResourceUrl = (url: string | null) => {
  if (!url) return Effect.succeed<string | null>(null);
  const trimmed = url.trim();
  if (!trimmed) return Effect.succeed<string | null>(null);
  if (!/^https?:\/\//i.test(trimmed)) {
    return Effect.fail(
      new Unprocessable({
        message: 'Resource URL must start with http:// or https://.',
        field: 'url',
      }),
    );
  }
  return Effect.succeed<string | null>(trimmed);
};

const lineageKeyFor = (level: number, text: string, position: number): string => {
  const stem = slugify(text).slice(0, 48) || `item-${position + 1}`;
  return `l${level}-${position + 1}-${stem}`.slice(0, 64);
};

/** `POST /catalog/skills`: author and publish a new skill with v1 levels and indicators. */
export const createSkill = Effect.fn('catalog.createSkill')(function* (input: AuthorSkillInput) {
  const actor = yield* CurrentActor;
  yield* requireCatalogAuthor(actor);
  yield* validateLevels(input.levels);

  const db = yield* Db;
  const slug = input.slug?.trim() || slugify(input.name);
  if (slug.length < 2) {
    return yield* Effect.fail(
      new Unprocessable({ message: 'Skill name must contain letters or numbers.', field: 'name' }),
    );
  }

  const [existing] = yield* db
    .select({ id: schema.skill.id })
    .from(schema.skill)
    .where(and(eq(schema.skill.tenantId, actor.tenantId), eq(schema.skill.slug, slug)));
  if (existing) {
    return yield* Effect.fail(
      new Conflict({ message: `A skill with slug "${slug}" already exists.` }),
    );
  }

  const skillId = SkillId.generate();
  const versionId = SkillVersionId.generate();
  const timestamp = yield* now;
  const tags = normalizeTags(input.tier, input.tags);

  yield* transactionally(
    Effect.gen(function* () {
      yield* db.insert(schema.skill).values({
        id: skillId,
        tenantId: actor.tenantId,
        slug,
        name: input.name.trim(),
        summary: input.summary.trim(),
        domain: input.domain,
        outcome: input.outcome.trim(),
        tags,
        resources: [],
        status: 'published',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      yield* db.insert(schema.skillVersion).values({
        id: versionId,
        tenantId: actor.tenantId,
        skillId,
        number: 1,
        changeNote: 'Authored in Skill Catalog Studio',
        publishedById: actor.personId,
        publishedAt: timestamp,
      });
      const ordered = input.levels.toSorted((a, b) => a.level - b.level);
      yield* db.insert(schema.skillLevel).values(
        ordered.map((l) => ({
          tenantId: actor.tenantId,
          skillVersionId: versionId,
          level: l.level,
          summary: l.summary.trim(),
        })),
      );
      yield* db.insert(schema.skillIndicator).values(
        ordered.flatMap((l) =>
          l.indicators.map((text, position) => ({
            id: SkillIndicatorId.generate(),
            tenantId: actor.tenantId,
            skillVersionId: versionId,
            level: l.level,
            lineageKey: lineageKeyFor(l.level, text, position),
            text: text.trim(),
            position,
          })),
        ),
      );
      yield* db
        .update(schema.skill)
        .set({ currentVersionId: versionId })
        .where(eq(schema.skill.id, skillId));

      yield* recordAudit(actor, {
        entityType: 'skill',
        entityId: skillId,
        event: 'PUBLISH',
        from: 'draft',
        to: 'published',
        data: { slug, version: 1, tier: input.tier },
      });
    }),
  );

  return yield* buildSkillDetail(slug).pipe(
    Effect.catchTag('NotFound', () => Effect.die('invariant: created skill missing')),
  );
});

/** `PATCH /catalog/skills/:id`: update skill metadata and optionally publish a new immutable version. */
export const updateSkill = Effect.fn('catalog.updateSkill')(function* (
  id: SkillId,
  input: UpdateSkillInput,
) {
  const actor = yield* CurrentActor;
  yield* requireCatalogAuthor(actor);
  if (input.levels) yield* validateLevels(input.levels);

  const db = yield* Db;
  const [skill] = yield* db
    .select()
    .from(schema.skill)
    .where(and(eq(schema.skill.tenantId, actor.tenantId), eq(schema.skill.id, id)));
  if (!skill) return yield* Effect.fail(new NotFound({ entity: 'skill', id }));

  const timestamp = yield* now;
  const tags = normalizeTags(input.tier, input.tags);

  yield* transactionally(
    Effect.gen(function* () {
      let nextVersionId = skill.currentVersionId;
      let nextVersionNumber: number | null = null;

      if (input.levels) {
        const [latest] = yield* db
          .select({ number: schema.skillVersion.number })
          .from(schema.skillVersion)
          .where(eq(schema.skillVersion.skillId, skill.id))
          .orderBy(desc(schema.skillVersion.number))
          .limit(1);
        nextVersionNumber = (latest?.number ?? 0) + 1;
        const createdVersionId = SkillVersionId.generate();
        nextVersionId = createdVersionId;
        yield* db.insert(schema.skillVersion).values({
          id: createdVersionId,
          tenantId: actor.tenantId,
          skillId: skill.id,
          number: nextVersionNumber,
          changeNote: input.changeNote?.trim() || 'Updated in Skill Catalog Studio',
          publishedById: actor.personId,
          publishedAt: timestamp,
        });
        const ordered = input.levels.toSorted((a, b) => a.level - b.level);
        yield* db.insert(schema.skillLevel).values(
          ordered.map((l) => ({
            tenantId: actor.tenantId,
            skillVersionId: createdVersionId,
            level: l.level,
            summary: l.summary.trim(),
          })),
        );
        yield* db.insert(schema.skillIndicator).values(
          ordered.flatMap((l) =>
            l.indicators.map((text, position) => ({
              id: SkillIndicatorId.generate(),
              tenantId: actor.tenantId,
              skillVersionId: createdVersionId,
              level: l.level,
              lineageKey: lineageKeyFor(l.level, text, position),
              text: text.trim(),
              position,
            })),
          ),
        );
      }

      yield* db
        .update(schema.skill)
        .set({
          name: input.name.trim(),
          domain: input.domain,
          summary: input.summary.trim(),
          outcome: input.outcome.trim(),
          tags,
          currentVersionId: nextVersionId,
          version: skill.version + 1,
          updatedAt: timestamp,
        })
        .where(eq(schema.skill.id, skill.id));

      yield* recordAudit(actor, {
        entityType: 'skill',
        entityId: skill.id,
        event: nextVersionNumber ? 'VERSION_PUBLISHED' : 'UPDATED',
        from: skill.status,
        to: skill.status,
        data: { version: nextVersionNumber, tier: input.tier, tags },
      });
    }),
  );

  return yield* buildSkillDetail(skill.slug);
});

/** `POST /catalog/skills/:id/resources`: attach a custom level-up playbook resource. */
export const addSkillResource = Effect.fn('catalog.addResource')(function* (
  id: SkillId,
  input: AddSkillResourceInput,
) {
  const actor = yield* CurrentActor;
  yield* requireResourceEditor(actor);
  const url = yield* validateResourceUrl(input.url);

  const db = yield* Db;
  const [skill] = yield* db
    .select()
    .from(schema.skill)
    .where(and(eq(schema.skill.tenantId, actor.tenantId), eq(schema.skill.id, id)));
  if (!skill) return yield* Effect.fail(new NotFound({ entity: 'skill', id }));

  const resource: SkillResource = {
    id: `res_${randomBytes(6).toString('hex')}`,
    level: input.level,
    kind: input.kind,
    title: input.title.trim(),
    summary: input.summary.trim(),
    url,
    durationMinutes: input.durationMinutes,
  };
  const nextResources = [...skill.resources, resource];
  const timestamp = yield* now;

  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.skill)
        .set({
          resources: nextResources,
          version: skill.version + 1,
          updatedAt: timestamp,
        })
        .where(eq(schema.skill.id, skill.id));
      yield* recordAudit(actor, {
        entityType: 'skill',
        entityId: skill.id,
        event: 'RESOURCE_ADDED',
        data: { resourceId: resource.id, level: resource.level, kind: resource.kind },
      });
    }),
  );

  return yield* buildSkillDetail(skill.slug);
});

/** `DELETE /catalog/skills/:id/resources/:resourceId`: remove a custom playbook resource. */
export const removeSkillResource = Effect.fn('catalog.removeResource')(function* (
  id: SkillId,
  resourceId: string,
) {
  const actor = yield* CurrentActor;
  yield* requireResourceEditor(actor);

  const db = yield* Db;
  const [skill] = yield* db
    .select()
    .from(schema.skill)
    .where(and(eq(schema.skill.tenantId, actor.tenantId), eq(schema.skill.id, id)));
  if (!skill) return yield* Effect.fail(new NotFound({ entity: 'skill', id }));

  const nextResources = skill.resources.filter((r) => r.id !== resourceId);
  if (nextResources.length === skill.resources.length) {
    return yield* Effect.fail(new NotFound({ entity: 'skill_resource', id: resourceId }));
  }

  const timestamp = yield* now;
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.skill)
        .set({
          resources: nextResources,
          version: skill.version + 1,
          updatedAt: timestamp,
        })
        .where(eq(schema.skill.id, skill.id));
      yield* recordAudit(actor, {
        entityType: 'skill',
        entityId: skill.id,
        event: 'RESOURCE_REMOVED',
        data: { resourceId },
      });
    }),
  );

  return yield* buildSkillDetail(skill.slug);
});
