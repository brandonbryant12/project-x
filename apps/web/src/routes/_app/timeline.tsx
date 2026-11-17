import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { TimelineScreen } from '@/features/people/people-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const timeline = queryOptions('people', 'timeline', undefined);

const Timeline = () => <TimelineScreen items={useSuspenseQuery(timeline).data} />;

export const Route = createFileRoute('/_app/timeline')({
  loader: ({ context }) => context.queryClient.ensureQueryData(timeline),
  component: Timeline,
});
