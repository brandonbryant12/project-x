import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';
import { ObserveNew } from '@/features/observations/observe-new.tsx';
import { queryOptions } from '@/lib/api.ts';

const targets = queryOptions('observations', 'targets', undefined);
const inbox = queryOptions('observations', 'inbox', undefined);

const Observe = () => {
  const search = Route.useSearch();
  // The inbox only re-orders people and points at open requests; never block on it.
  const open = useQuery(inbox);
  return (
    <ObserveNew targets={useSuspenseQuery(targets).data} inbox={open.data} preselect={search.for} />
  );
};

export const Route = createFileRoute('/_app/observations/new')({
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ for: Schema.optional(Schema.String) })),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(inbox);
    return context.queryClient.ensureQueryData(targets);
  },
  component: Observe,
});
