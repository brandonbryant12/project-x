import {
  CurrentActor,
  Unprocessable,
  type CreditPolicyAdminView,
  type SaveCreditPolicyInput,
  type StoredCreditPolicy,
} from '@repo/api';
import {
  DEFAULT_CREDIT_POLICY,
  creditPolicyVersion,
  type StoredCreditPolicy as DomainStoredPolicy,
  type TenantId,
} from '@repo/domain';
import { transactionally } from '@repo/db';
import { Effect } from 'effect';
import { recordAudit } from '../shared/audit.ts';
import { inspectTenantCreditPolicy, saveCreditPolicy } from '../shared/recognition.ts';
import { changeHistory, changedFields, requireProgramAdmin, type ChangedValue } from './changes.ts';

/** The audit trail's name for a tenant's credit policy; its entity id is the tenant's. */
const ENTITY = 'credit_policy';

/** A reason is required for every change, and must say something (design §2). */
export const MIN_REASON_LENGTH = 10;

export const requireReason = (reason: string) =>
  reason.trim().length >= MIN_REASON_LENGTH
    ? Effect.succeed(reason.trim())
    : Effect.fail(
        new Unprocessable({
          message: `Say why in at least ${MIN_REASON_LENGTH} characters; the reason is kept with the change.`,
          field: 'reason',
        }),
      );

const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** What is stored, field by field; anything missing or mistyped reads as null (never a default). */
const storedView = (stored: DomainStoredPolicy | null): StoredCreditPolicy => ({
  primaryPoints: number(stored?.primaryPoints),
  secondaryPoints: number(stored?.secondaryPoints),
  badgePoints: number(stored?.badgePoints),
  minInteractions: number(stored?.minInteractions),
  minObservers: number(stored?.minObservers),
  minFirstHandShare: number(stored?.minFirstHandShare),
  minSpanDays: number(stored?.minSpanDays),
  minPrimaryPoints: number(stored?.minPrimaryPoints),
  maxSkillsPerObservation: number(stored?.maxSkillsPerObservation),
  activityOverrides: {
    enabled:
      typeof stored?.activityOverrides?.enabled === 'boolean'
        ? stored.activityOverrides.enabled
        : null,
    minPoints: number(stored?.activityOverrides?.minPoints),
    maxPoints: number(stored?.activityOverrides?.maxPoints),
  },
});

/** The policy as flat fields, for the before-and-after record. */
const flat = (p: StoredCreditPolicy): Record<string, ChangedValue> => {
  const { activityOverrides, ...rest } = p;
  return {
    ...rest,
    'activityOverrides.enabled': activityOverrides.enabled,
    'activityOverrides.minPoints': activityOverrides.minPoints,
    'activityOverrides.maxPoints': activityOverrides.maxPoints,
  };
};

const { version: _defaultVersion, ...WORKING_DEFAULTS } = DEFAULT_CREDIT_POLICY;

const policyView = Effect.fn('program.creditPolicyView')(function* (tenantId: TenantId) {
  const { reading, version } = yield* inspectTenantCreditPolicy(tenantId);
  return {
    version,
    valid: reading.ok,
    stored: storedView(reading.ok ? reading.policy : reading.stored),
    problems: reading.ok ? [] : [...reading.problems],
    defaults: WORKING_DEFAULTS,
    history: yield* changeHistory(tenantId, ENTITY, tenantId),
  } satisfies CreditPolicyAdminView;
});

/**
 * `GET /program/credit-policy`: the stored policy exactly as stored, with its
 * problems when it is broken (the only repair path), the working defaults for
 * comparison and the saved changes.
 */
export const readCreditPolicy = Effect.fn('program.creditPolicy')(function* () {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  return yield* policyView(actor.tenantId);
});

/**
 * `PUT /program/credit-policy`: replaces the whole policy with a reason. The
 * save is compared and set on the version the editor loaded (Conflict when
 * someone saved first), validated by the domain (a field-level Unprocessable),
 * stored complete with the next version, and audited with every field before
 * and after in the same transaction. It never re-evaluates existing awards.
 */
export const replaceCreditPolicy = Effect.fn('program.saveCreditPolicy')(function* (
  input: SaveCreditPolicyInput,
) {
  const actor = yield* CurrentActor;
  yield* requireProgramAdmin(actor);
  const reason = yield* requireReason(input.reason);
  yield* transactionally(
    Effect.gen(function* () {
      const { before, after } = yield* saveCreditPolicy(
        actor.tenantId,
        input.expectedVersion,
        input.policy,
      );
      const was = storedView(before.ok ? before.policy : before.stored);
      yield* recordAudit(actor, {
        entityType: ENTITY,
        reasonCode: 'policy_change',
        entityId: actor.tenantId,
        event: 'REPLACE',
        from: before.ok ? String(before.policy.version) : null,
        to: String(after.version),
        policyVersion: creditPolicyVersion(after),
        note: { kind: 'policy_change', body: reason },
        data: {
          repaired: !before.ok,
          before: was,
          after,
          changes: changedFields(flat(was), flat(storedView(after))),
        },
      });
    }),
  );
  return yield* policyView(actor.tenantId);
});
