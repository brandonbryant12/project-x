import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ConversationsScreen } from '@/features/rhythm/conversations-screens.tsx';
import { queryOptions } from '@/lib/api.ts';

const conversations = queryOptions('rhythm', 'conversations', undefined);

const Conversations = () => <ConversationsScreen data={useSuspenseQuery(conversations).data} />;

export const Route = createFileRoute('/_app/conversations/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(conversations),
  component: Conversations,
});
