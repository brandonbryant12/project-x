import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { OutboxScreen } from '@/features/hub/outbox-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const outbox = queryOptions('hub', 'outbox', { query: { limit: 100 } });

const Outbox = () => <OutboxScreen rows={useSuspenseQuery(outbox).data} />;

export const Route = createFileRoute('/_app/admin/outbox')({
  loader: ({ context }) => context.queryClient.ensureQueryData(outbox),
  component: Outbox,
});
