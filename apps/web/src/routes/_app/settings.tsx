import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { PreferencesScreen } from '@/features/settings/preferences-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const preferences = queryOptions('hub', 'preferences', undefined);

const Settings = () => <PreferencesScreen saved={useSuspenseQuery(preferences).data} />;

export const Route = createFileRoute('/_app/settings')({
  loader: ({ context }) => context.queryClient.ensureQueryData(preferences),
  component: Settings,
});
