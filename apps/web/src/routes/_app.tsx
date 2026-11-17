import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { PageSkeleton, QueryBoundary } from '@/components/query-boundary.tsx';
import { AppShell } from '@/components/shell/app-shell.tsx';
import { LogDialogProvider } from '@/components/shell/log-dialog-context.tsx';
import { isUnauthorized } from '@/lib/api.ts';
import { sessionQuery, useSession } from '@/lib/session.ts';

const AppLayout = () => {
  const session = useSession();
  return (
    <LogDialogProvider>
      <AppShell session={session}>
        <QueryBoundary>
          <Outlet />
        </QueryBoundary>
      </AppShell>
    </LogDialogProvider>
  );
};

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(sessionQuery);
    } catch (error) {
      if (isUnauthorized(error)) {
        throw redirect({ to: '/sign-in', search: { next: location.href } });
      }
      throw error;
    }
  },
  pendingComponent: PageSkeleton,
  component: AppLayout,
});
