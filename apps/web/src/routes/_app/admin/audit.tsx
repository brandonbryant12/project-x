import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { AuditScreen } from '@/features/people/people-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const audit = queryOptions('admin', 'auditTrail', { query: { limit: 200 } });

const Audit = () => <AuditScreen events={useSuspenseQuery(audit).data} />;

export const Route = createFileRoute('/_app/admin/audit')({
  loader: ({ context }) => context.queryClient.ensureQueryData(audit),
  component: Audit,
});
