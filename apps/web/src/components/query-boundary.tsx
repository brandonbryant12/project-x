import { Button, EmptyState, Skeleton } from '@repo/ui';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { describeError, isNotFound } from '@/lib/api.ts';

class Boundary extends Component<
  { readonly onReset: () => void; readonly children: ReactNode },
  { error: unknown }
> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(_error: unknown, _info: ErrorInfo) {}
  override render() {
    if (this.state.error) {
      return (
        <EmptyState
          title={isNotFound(this.state.error) ? 'Not found' : 'This did not load'}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                this.props.onReset();
                this.setState({ error: null });
              }}
            >
              Try again
            </Button>
          }
        >
          {describeError(this.state.error)}
        </EmptyState>
      );
    }
    return this.props.children;
  }
}

export const PageSkeleton = () => (
  <div className="mx-auto grid w-full max-w-[1200px] gap-4 px-4 py-8 md:px-6" aria-busy="true">
    <Skeleton className="h-9 w-72" />
    <Skeleton className="h-5 w-96 max-w-full" />
    <div className="mt-6 grid gap-3">
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  </div>
);

/** Suspense + error boundary with retry, matching the page layout while loading. */
export const QueryBoundary = ({
  children,
  fallback = <PageSkeleton />,
}: {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) => (
  <QueryErrorResetBoundary>
    {({ reset }) => (
      <Boundary onReset={reset}>
        <Suspense fallback={fallback}>{children}</Suspense>
      </Boundary>
    )}
  </QueryErrorResetBoundary>
);
