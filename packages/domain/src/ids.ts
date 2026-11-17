import { Schema } from 'effect';

/**
 * Branded, prefixed identifiers: `<prefix>_<16 Crockford base32 chars>`.
 * Prefixes make IDs self-describing in logs, URLs and support tickets.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const BODY_LENGTH = 16;

const randomBody = (): string => {
  const bytes = new Uint8Array(BODY_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let body = '';
  for (const byte of bytes) body += ALPHABET[byte % 32];
  return body;
};

const idPattern = (prefix: string) =>
  Schema.isPattern(new RegExp(`^${prefix}_[0-9a-hjkmnp-tv-z]{${BODY_LENGTH}}$`));

/** Attaches the prefix and a generator to a branded ID schema. */
const withGenerator = <S extends Schema.Top & { readonly Type: string }>(
  prefix: string,
  schema: S,
) =>
  Object.assign(schema, {
    prefix,
    generate: (): S['Type'] => `${prefix}_${randomBody()}` as S['Type'],
  });

export const TenantId = withGenerator(
  'ten',
  Schema.String.pipe(Schema.check(idPattern('ten')), Schema.brand('TenantId')),
);
export type TenantId = typeof TenantId.Type;

export const PersonId = withGenerator(
  'per',
  Schema.String.pipe(Schema.check(idPattern('per')), Schema.brand('PersonId')),
);
export type PersonId = typeof PersonId.Type;

export const BusinessFunctionId = withGenerator(
  'fun',
  Schema.String.pipe(Schema.check(idPattern('fun')), Schema.brand('BusinessFunctionId')),
);
export type BusinessFunctionId = typeof BusinessFunctionId.Type;

export const ReportingLineId = withGenerator(
  'rpl',
  Schema.String.pipe(Schema.check(idPattern('rpl')), Schema.brand('ReportingLineId')),
);
export type ReportingLineId = typeof ReportingLineId.Type;

export const RoleGrantId = withGenerator(
  'grt',
  Schema.String.pipe(Schema.check(idPattern('grt')), Schema.brand('RoleGrantId')),
);
export type RoleGrantId = typeof RoleGrantId.Type;

export const SkillId = withGenerator(
  'skl',
  Schema.String.pipe(Schema.check(idPattern('skl')), Schema.brand('SkillId')),
);
export type SkillId = typeof SkillId.Type;

export const SkillVersionId = withGenerator(
  'skv',
  Schema.String.pipe(Schema.check(idPattern('skv')), Schema.brand('SkillVersionId')),
);
export type SkillVersionId = typeof SkillVersionId.Type;

export const ActivityTemplateId = withGenerator(
  'atp',
  Schema.String.pipe(Schema.check(idPattern('atp')), Schema.brand('ActivityTemplateId')),
);
export type ActivityTemplateId = typeof ActivityTemplateId.Type;

export const EngagementId = withGenerator(
  'eng',
  Schema.String.pipe(Schema.check(idPattern('eng')), Schema.brand('EngagementId')),
);
export type EngagementId = typeof EngagementId.Type;

export const PlanId = withGenerator(
  'pln',
  Schema.String.pipe(Schema.check(idPattern('pln')), Schema.brand('PlanId')),
);
export type PlanId = typeof PlanId.Type;

export const ActivityId = withGenerator(
  'act',
  Schema.String.pipe(Schema.check(idPattern('act')), Schema.brand('ActivityId')),
);
export type ActivityId = typeof ActivityId.Type;

export const InteractionId = withGenerator(
  'int',
  Schema.String.pipe(Schema.check(idPattern('int')), Schema.brand('InteractionId')),
);
export type InteractionId = typeof InteractionId.Type;

export const EvidenceId = withGenerator(
  'evd',
  Schema.String.pipe(Schema.check(idPattern('evd')), Schema.brand('EvidenceId')),
);
export type EvidenceId = typeof EvidenceId.Type;

export const ObservationId = withGenerator(
  'obs',
  Schema.String.pipe(Schema.check(idPattern('obs')), Schema.brand('ObservationId')),
);
export type ObservationId = typeof ObservationId.Type;

export const CreditId = withGenerator(
  'crd',
  Schema.String.pipe(Schema.check(idPattern('crd')), Schema.brand('CreditId')),
);
export type CreditId = typeof CreditId.Type;

export const BadgeAwardId = withGenerator(
  'bdg',
  Schema.String.pipe(Schema.check(idPattern('bdg')), Schema.brand('BadgeAwardId')),
);
export type BadgeAwardId = typeof BadgeAwardId.Type;

export const AdvisoryCheckId = withGenerator(
  'adv',
  Schema.String.pipe(Schema.check(idPattern('adv')), Schema.brand('AdvisoryCheckId')),
);
export type AdvisoryCheckId = typeof AdvisoryCheckId.Type;

export const AuditEventId = withGenerator(
  'aud',
  Schema.String.pipe(Schema.check(idPattern('aud')), Schema.brand('AuditEventId')),
);
export type AuditEventId = typeof AuditEventId.Type;

export const SessionId = withGenerator(
  'ses',
  Schema.String.pipe(Schema.check(idPattern('ses')), Schema.brand('SessionId')),
);
export type SessionId = typeof SessionId.Type;

export const SkillIndicatorId = withGenerator(
  'ind',
  Schema.String.pipe(Schema.check(idPattern('ind')), Schema.brand('SkillIndicatorId')),
);
export type SkillIndicatorId = typeof SkillIndicatorId.Type;

export const SecondReadId = withGenerator(
  'srd',
  Schema.String.pipe(Schema.check(idPattern('srd')), Schema.brand('SecondReadId')),
);
export type SecondReadId = typeof SecondReadId.Type;

export const CreditReversalId = withGenerator(
  'rev',
  Schema.String.pipe(Schema.check(idPattern('rev')), Schema.brand('CreditReversalId')),
);
export type CreditReversalId = typeof CreditReversalId.Type;

export const NoteId = withGenerator(
  'not',
  Schema.String.pipe(Schema.check(idPattern('not')), Schema.brand('NoteId')),
);
export type NoteId = typeof NoteId.Type;

export const AdvisoryDispositionId = withGenerator(
  'dsp',
  Schema.String.pipe(Schema.check(idPattern('dsp')), Schema.brand('AdvisoryDispositionId')),
);
export type AdvisoryDispositionId = typeof AdvisoryDispositionId.Type;

export const BadgeWaiverId = withGenerator(
  'wvr',
  Schema.String.pipe(Schema.check(idPattern('wvr')), Schema.brand('BadgeWaiverId')),
);
export type BadgeWaiverId = typeof BadgeWaiverId.Type;

export const LegalHoldId = withGenerator(
  'hld',
  Schema.String.pipe(Schema.check(idPattern('hld')), Schema.brand('LegalHoldId')),
);
export type LegalHoldId = typeof LegalHoldId.Type;

export const JobFamilyId = withGenerator(
  'jfm',
  Schema.String.pipe(Schema.check(idPattern('jfm')), Schema.brand('JobFamilyId')),
);
export type JobFamilyId = typeof JobFamilyId.Type;

export const PositionId = withGenerator(
  'pos',
  Schema.String.pipe(Schema.check(idPattern('pos')), Schema.brand('PositionId')),
);
export type PositionId = typeof PositionId.Type;

export const DesignationId = withGenerator(
  'dsg',
  Schema.String.pipe(Schema.check(idPattern('dsg')), Schema.brand('DesignationId')),
);
export type DesignationId = typeof DesignationId.Type;

export const NotificationId = withGenerator(
  'ntf',
  Schema.String.pipe(Schema.check(idPattern('ntf')), Schema.brand('NotificationId')),
);
export type NotificationId = typeof NotificationId.Type;

export const DirectoryExceptionId = withGenerator(
  'dex',
  Schema.String.pipe(Schema.check(idPattern('dex')), Schema.brand('DirectoryExceptionId')),
);
export type DirectoryExceptionId = typeof DirectoryExceptionId.Type;

/** Calendar date as `YYYY-MM-DD`. Lexicographic order equals chronological order. */
export const IsoDate = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  Schema.brand('IsoDate'),
);
export type IsoDate = typeof IsoDate.Type;

export const toIsoDate = (date: Date): IsoDate => date.toISOString().slice(0, 10) as IsoDate;
