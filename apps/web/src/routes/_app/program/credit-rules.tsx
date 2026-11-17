import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CreditRulesScreen } from '@/features/program/credit-rules-screen.tsx';
import { queryOptions } from '@/lib/api.ts';

const policy = queryOptions('program', 'creditPolicy', undefined);

const CreditRules = () => <CreditRulesScreen view={useSuspenseQuery(policy).data} />;

export const Route = createFileRoute('/_app/program/credit-rules')({
  loader: ({ context }) => context.queryClient.ensureQueryData(policy),
  component: CreditRules,
});
