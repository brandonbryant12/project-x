import {
  CurrentActor,
  Forbidden,
  NotFound,
  Unprocessable,
  type UpdateTenantPolicyInput,
} from '@repo/api';
import {
  AdvisoryDispositionId,
  EvidenceLifecycle,
  type EvidenceId,
  type EvidenceStatus,
} from '@repo/domain';
import { Db, schema, transactionally } from '@repo/db';
import { and, desc, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { now } from '../../platform/time.ts';
import { recordAudit } from '../shared/audit.ts';
import { decide } from '../shared/mutation.ts';
import { buildTenantPolicy } from './views.ts';

interface ResolveEvidenceInput {
  readonly event: 'RELEASE' | 'RESOLVE';
  readonly reason: string;
}

/**
 * Settles held evidence: tenant admins release privacy holds; compliance
 * reviewers resolve escalations. Records a disposition on the latest check.
 */
export const resolveEvidence = Effect.fn('admin.resolveEvidence')(function* (
  id: EvidenceId,
  payload: ResolveEvidenceInput,
) {
  const actor = yield* CurrentActor;
  const db = yield* Db;
  const [evidence] = yield* db
    .select()
    .from(schema.evidence)
    .where(and(eq(schema.evidence.tenantId, actor.tenantId), eq(schema.evidence.id, id)));
  if (!evidence) return yield* Effect.fail(new NotFound({ entity: 'evidence', id }));
  const from = evidence.status as EvidenceStatus;
  const to = yield* decide({
    lifecycle: EvidenceLifecycle,
    from,
    facts: {},
    event: { type: payload.event },
    // Admins release privacy holds; only compliance resolves escalations.
    permitted:
      payload.event === 'RELEASE'
        ? actor.grants.includes('tenant_admin')
        : actor.grants.includes('compliance_reviewer'),
  });
  const [check] = yield* db
    .select()
    .from(schema.advisoryCheck)
    .where(
      and(
        eq(schema.advisoryCheck.subjectType, 'evidence'),
        eq(schema.advisoryCheck.subjectId, evidence.id),
      ),
    )
    .orderBy(desc(schema.advisoryCheck.createdAt))
    .limit(1);
  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.evidence)
        .set({
          status: to,
          holdReason: null,
          version: evidence.version + 1,
          updatedAt: yield* now,
        })
        .where(
          and(eq(schema.evidence.id, evidence.id), eq(schema.evidence.version, evidence.version)),
        );
      yield* recordAudit(actor, {
        entityType: 'evidence',
        entityId: evidence.id,
        event: payload.event,
        from,
        to,
        note: {
          kind: payload.event === 'RELEASE' ? 'release' : 'resolve',
          body: payload.reason,
        },
      });
      if (check && check.status === 'completed') {
        yield* db.insert(schema.advisoryDisposition).values({
          id: AdvisoryDispositionId.generate(),
          tenantId: actor.tenantId,
          checkId: check.id,
          actorId: actor.personId,
          disposition: payload.event === 'RELEASE' ? 'overrode' : 'agreed',
          reasonCode: payload.event === 'RELEASE' ? 'admin_release' : 'compliance_resolution',
        });
      }
    }),
  );
});

/** `PUT /admin/policy`: updates tenant badge rigor criteria and observation window (audited). */
export const updateTenantPolicy = Effect.fn('admin.updatePolicy')(function* (
  payload: UpdateTenantPolicyInput,
) {
  const actor = yield* CurrentActor;
  if (!actor.grants.includes('tenant_admin')) {
    return yield* Effect.fail(
      new Forbidden({ message: 'Only tenant admins can update program policy.' }),
    );
  }
  if (payload.badgeCriteria.minObservers > payload.badgeCriteria.minDemonstrations) {
    return yield* Effect.fail(
      new Unprocessable({
        message: 'Minimum distinct observers cannot exceed minimum observations.',
        field: 'badgeCriteria.minObservers',
      }),
    );
  }
  const db = yield* Db;
  const [tenantRow] = yield* db
    .select({ settings: schema.tenant.settings })
    .from(schema.tenant)
    .where(eq(schema.tenant.id, actor.tenantId));
  if (!tenantRow) return yield* Effect.die('invariant: actor tenant missing');

  const nextSettings = {
    ...tenantRow.settings,
    badgeCriteria: {
      minDemonstrations: payload.badgeCriteria.minDemonstrations,
      minObservers: payload.badgeCriteria.minObservers,
      minFirstHandShare: payload.badgeCriteria.minFirstHandShare,
      minSpanDays: payload.badgeCriteria.minSpanDays,
    },
    observationWindowDays: payload.observationWindowDays,
  };

  yield* transactionally(
    Effect.gen(function* () {
      yield* db
        .update(schema.tenant)
        .set({ settings: nextSettings })
        .where(eq(schema.tenant.id, actor.tenantId));
      yield* recordAudit(actor, {
        entityType: 'tenant_policy',
        entityId: actor.tenantId,
        event: 'POLICY_UPDATED',
        ...(payload.reason?.trim()
          ? { note: { kind: 'review' as const, body: payload.reason.trim() } }
          : {}),
        data: {
          badgeCriteria: nextSettings.badgeCriteria,
          observationWindowDays: nextSettings.observationWindowDays,
        },
      });
    }),
  );

  return yield* buildTenantPolicy();
});
