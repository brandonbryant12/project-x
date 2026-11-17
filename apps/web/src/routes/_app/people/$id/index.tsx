import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ProfileScreen } from '@/features/people/profile-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const query = (id: string) => queryOptions('people', 'profile', { params: { id: id as never } });

const Profile = () => {
  const { id } = Route.useParams();
  return <ProfileScreen profile={useSuspenseQuery(query(id)).data} />;
};

export const Route = createFileRoute('/_app/people/$id/')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(query(params.id)),
  component: Profile,
});
