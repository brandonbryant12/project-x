import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { TeamScreen } from '@/features/support/support-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const team = queryOptions('support', 'team', undefined);

const Team = () => <TeamScreen team={useSuspenseQuery(team).data} />;

export const Route = createFileRoute('/_app/team/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(team),
  component: Team,
});
