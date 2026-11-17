import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { SkillScreen } from '@/features/catalog/catalog-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const query = (slug: string) => queryOptions('catalog', 'skill', { params: { slug } });

const Skill = () => {
  const { slug } = Route.useParams();
  return <SkillScreen skill={useSuspenseQuery(query(slug)).data} />;
};

export const Route = createFileRoute('/_app/catalog/skills/$slug')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(query(params.slug)),
  component: Skill,
});
