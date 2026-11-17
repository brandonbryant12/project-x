import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { AdoptionScreen } from '@/features/hub/adoption-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const adoption = queryOptions('hub', 'adoption', undefined);

const Adoption = () => <AdoptionScreen data={useSuspenseQuery(adoption).data} />;

export const Route = createFileRoute('/_app/adoption')({
  loader: ({ context }) => context.queryClient.ensureQueryData(adoption),
  component: Adoption,
});
