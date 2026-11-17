import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ProgramTemplateScreen } from '@/features/program/templates-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const query = (id: string) => queryOptions('program', 'template', { params: { id: id as never } });
const skills = queryOptions('program', 'skills', undefined);

const Template = () => {
  const { id } = Route.useParams();
  const template = useSuspenseQuery(query(id)).data;
  const catalog = useSuspenseQuery(skills).data;
  return <ProgramTemplateScreen template={template} catalog={catalog.skills} />;
};

export const Route = createFileRoute('/_app/program/templates/$id')({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(query(params.id)),
      context.queryClient.ensureQueryData(skills),
    ]),
  component: Template,
});
