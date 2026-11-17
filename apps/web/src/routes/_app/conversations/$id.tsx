import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ConversationScreen } from '@/features/rhythm/conversations-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const conversation = (id: string) =>
  queryOptions('rhythm', 'conversation', { params: { id: id as never } });

const Conversation = () => {
  const { id } = Route.useParams();
  return <ConversationScreen view={useSuspenseQuery(conversation(id)).data} />;
};

export const Route = createFileRoute('/_app/conversations/$id')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(conversation(params.id)),
  component: Conversation,
});
