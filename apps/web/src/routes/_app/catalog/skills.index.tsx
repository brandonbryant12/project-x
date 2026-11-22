import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { SkillsScreen } from '@/features/catalog/catalog-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const skills = queryOptions('catalog', 'skills', { query: {} });
const insights = queryOptions('catalog', 'insights', undefined);

const Skills = () => (
  <SkillsScreen skills={useSuspenseQuery(skills).data} insights={useSuspenseQuery(insights).data} />
);

export const Route = createFileRoute('/_app/catalog/skills/')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(skills),
      context.queryClient.ensureQueryData(insights),
    ]);
  },
  component: Skills,
});
