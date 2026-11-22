import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { PolicyScreen } from '@/features/admin/policy-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const policyQuery = queryOptions('admin', 'policy', undefined);

const PolicyRoute = () => <PolicyScreen policy={useSuspenseQuery(policyQuery).data} />;

export const Route = createFileRoute('/_app/admin/policy')({
  loader: ({ context }) => context.queryClient.ensureQueryData(policyQuery),
  component: PolicyRoute,
});
