import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ActivitiesScreen } from '@/features/catalog/catalog-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const templates = queryOptions('catalog', 'templates', { query: {} });

const Activities = () => <ActivitiesScreen templates={useSuspenseQuery(templates).data} />;

export const Route = createFileRoute('/_app/catalog/activities')({
  loader: ({ context }) => context.queryClient.ensureQueryData(templates),
  component: Activities,
});
