import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ProgramTemplatesScreen } from '@/features/program/templates-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const templates = queryOptions('program', 'templates', undefined);

const Templates = () => <ProgramTemplatesScreen templates={useSuspenseQuery(templates).data} />;

export const Route = createFileRoute('/_app/program/templates/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(templates),
  component: Templates,
});
