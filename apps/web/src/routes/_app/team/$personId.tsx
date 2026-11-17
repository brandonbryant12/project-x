import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { DevelopmentScreen } from '@/features/development/development-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

/** Someone else's development, for their coach or leader chain (visibility is enforced by the API). */
const query = (personId: string) =>
  queryOptions('development', 'of', { params: { id: personId as never } });

const TheirDevelopment = () => {
  const { personId } = Route.useParams();
  return <DevelopmentScreen development={useSuspenseQuery(query(personId)).data} self={false} />;
};

export const Route = createFileRoute('/_app/team/$personId')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(query(params.personId)),
  component: TheirDevelopment,
});
