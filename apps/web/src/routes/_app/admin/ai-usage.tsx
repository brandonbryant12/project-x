import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { AiUsageScreen } from '@/features/people/people-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const usage = queryOptions('admin', 'aiUsage', { query: {} });

const AiUsage = () => <AiUsageScreen usage={useSuspenseQuery(usage).data} />;

export const Route = createFileRoute('/_app/admin/ai-usage')({
  loader: ({ context }) => context.queryClient.ensureQueryData(usage),
  component: AiUsage,
});
