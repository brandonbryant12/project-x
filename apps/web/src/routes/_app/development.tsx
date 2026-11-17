import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';
import { DevelopmentScreen } from '@/features/development/development-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const mine = queryOptions('development', 'mine', undefined);

const Development = () => {
  const { start } = Route.useSearch();
  return (
    <DevelopmentScreen
      development={useSuspenseQuery(mine).data}
      self
      startPlan={start === 'plan'}
    />
  );
};

export const Route = createFileRoute('/_app/development')({
  /** `?start=plan` opens the plan dialog straight away (the first-run step on Home). */
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ start: Schema.optional(Schema.Literals(['plan'])) }),
  ),
  loader: ({ context }) => context.queryClient.ensureQueryData(mine),
  component: Development,
});
