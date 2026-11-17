import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { HomeScreen } from '@/features/home/home-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const homeQuery = queryOptions('support', 'home', undefined);

const Home = () => <HomeScreen home={useSuspenseQuery(homeQuery).data} />;

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery),
  component: Home,
});
