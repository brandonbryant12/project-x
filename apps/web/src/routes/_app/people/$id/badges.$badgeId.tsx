import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { BadgeReceiptScreen } from '@/features/people/profile-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const query = (id: string, badgeId: string) =>
  queryOptions('people', 'badgeReceipt', {
    params: { id: id as never, badgeId: badgeId as never },
  });

const Receipt = () => {
  const { id, badgeId } = Route.useParams();
  return <BadgeReceiptScreen receipt={useSuspenseQuery(query(id, badgeId)).data} />;
};

export const Route = createFileRoute('/_app/people/$id/badges/$badgeId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(query(params.id, params.badgeId)),
  component: Receipt,
});
