import { Api } from '@repo/api';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import { resolveEvidence } from './use-cases.ts';
import { buildAiUsage, buildAuditTrail } from './views.ts';

export const AdminHandlers = HttpApiBuilder.group(Api, 'admin', (handlers) =>
  handlers
    .handle('aiUsage', ({ query }) => buildAiUsage(query).pipe(apiErrorsOnly))
    .handle('auditTrail', ({ query }) => buildAuditTrail(query).pipe(apiErrorsOnly))
    .handle('resolveEvidence', ({ params, payload }) =>
      resolveEvidence(params.id, payload).pipe(apiErrorsOnly),
    ),
);
