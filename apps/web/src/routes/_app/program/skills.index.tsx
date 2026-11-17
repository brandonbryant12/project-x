import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ProgramSkillsScreen } from '@/features/program/skills-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const skills = queryOptions('program', 'skills', undefined);

const Skills = () => <ProgramSkillsScreen list={useSuspenseQuery(skills).data} />;

export const Route = createFileRoute('/_app/program/skills/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(skills),
  component: Skills,
});
