import { EvidenceId, IsoDate } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Forbidden, InvalidTransition, NotFound, Unprocessable } from '../errors.ts';
import {
  AiUsageView,
  AuditEventView,
  TenantPolicyView,
  UpdateTenantPolicyInput,
} from '../models/index.ts';

/** Tenant admins and compliance reviewers. Every read here is itself audited (ADR 0015). */
export class AdminGroup extends HttpApiGroup.make('admin')
  .add(
    HttpApiEndpoint.get('aiUsage', '/admin/ai-usage', {
      query: { from: Schema.optional(IsoDate), to: Schema.optional(IsoDate) },
      success: AiUsageView,
      error: Forbidden,
    }),
    HttpApiEndpoint.get('auditTrail', '/admin/audit', {
      query: {
        entityType: Schema.optional(Schema.String),
        entityId: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.NumberFromString),
      },
      success: Schema.Array(AuditEventView),
      error: Forbidden,
    }),
    HttpApiEndpoint.get('policy', '/admin/policy', {
      success: TenantPolicyView,
      error: Forbidden,
    }),
    HttpApiEndpoint.put('updatePolicy', '/admin/policy', {
      payload: UpdateTenantPolicyInput,
      success: TenantPolicyView,
      error: [Forbidden, Unprocessable],
    }),
    HttpApiEndpoint.post('resolveEvidence', '/admin/evidence/:id/resolve', {
      params: { id: EvidenceId },
      payload: Schema.Struct({
        event: Schema.Literals(['RELEASE', 'RESOLVE']),
        reason: Schema.String.pipe(Schema.check(Schema.isMinLength(5), Schema.isMaxLength(600))),
      }),
      success: HttpApiSchema.NoContent,
      error: [Forbidden, NotFound, InvalidTransition],
    }),
  )
  .middleware(Authenticated) {}
