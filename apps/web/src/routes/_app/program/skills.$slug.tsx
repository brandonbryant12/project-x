import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ProgramSkillScreen } from '@/features/program/skills-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const query = (slug: string) => queryOptions('program', 'skill', { params: { slug } });

const Skill = () => {
  const { slug } = Route.useParams();
  return <ProgramSkillScreen skill={useSuspenseQuery(query(slug)).data} />;
};

export const Route = createFileRoute('/_app/program/skills/$slug')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(query(params.slug)),
  component: Skill,
});
