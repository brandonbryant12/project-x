import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CoachingScreen } from '@/features/support/support-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const coaching = queryOptions('support', 'coaching', undefined);

const Coaching = () => <CoachingScreen coaching={useSuspenseQuery(coaching).data} />;

export const Route = createFileRoute('/_app/coaching')({
  loader: ({ context }) => context.queryClient.ensureQueryData(coaching),
  component: Coaching,
});
