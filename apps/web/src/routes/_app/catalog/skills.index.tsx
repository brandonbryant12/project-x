import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { SkillsScreen } from '@/features/catalog/catalog-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const skills = queryOptions('catalog', 'skills', { query: {} });

const Skills = () => <SkillsScreen skills={useSuspenseQuery(skills).data} />;

export const Route = createFileRoute('/_app/catalog/skills/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(skills),
  component: Skills,
});
