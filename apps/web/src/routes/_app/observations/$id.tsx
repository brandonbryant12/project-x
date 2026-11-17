import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ObservationScreen } from '@/features/observations/sign-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const Screen = () => {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(
    queryOptions('observations', 'get', { params: { id: id as never } }),
  );
  return <ObservationScreen view={data} />;
};

export const Route = createFileRoute('/_app/observations/$id')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      queryOptions('observations', 'get', { params: { id: params.id as never } }),
    ),
  component: Screen,
});
