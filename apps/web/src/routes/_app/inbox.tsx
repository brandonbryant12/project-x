import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';
import { InboxScreen, type InboxTab } from '@/features/inbox/inbox-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const inboxQuery = queryOptions('observations', 'inbox', undefined);

const Screen = () => {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const inbox = useSuspenseQuery(inboxQuery).data;
  const fallback: InboxTab =
    inbox.requests.length > 0 || inbox.mine.length === 0 ? 'requests' : 'mine';
  return (
    <InboxScreen
      inbox={inbox}
      tab={tab ?? fallback}
      onTab={(t) => void navigate({ search: { tab: t } })}
    />
  );
};

export const Route = createFileRoute('/_app/inbox')({
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      tab: Schema.optional(Schema.Literals(['requests', 'drafts', 'signed', 'mine'])),
    }),
  ),
  loader: ({ context }) => context.queryClient.ensureQueryData(inboxQuery),
  component: Screen,
});
