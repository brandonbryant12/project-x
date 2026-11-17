import type { AdoptionView } from '@repo/api';
import { Card } from '@repo/ui';
import { Page, PageHeader } from '@/components/page.tsx';
import { formatDate } from '@/lib/format.ts';

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * A withheld figure (ADR 0021): it draws on fewer people than the minimum, or
 * would reveal such a group beside another figure, so no number is shown.
 */
const Withheld = () => <span className="text-meta text-ink-3">withheld</span>;

const Measure = ({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children: React.ReactNode;
}) => (
  <div className="grid gap-1 py-4 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-baseline sm:gap-6">
    <dt className="grid gap-0.5">
      <span className="text-ui font-medium text-ink">{label}</span>
      <span className="text-meta text-ink-3">{hint}</span>
    </dt>
    <dd className="text-h2 text-ink tabular sm:text-right">{children}</dd>
  </div>
);

/**
 * Adoption for program owners (ADR 0021): four numbers, never names, and
 * nothing drawn from fewer than the minimum number of people. No ranks, no
 * targets.
 */
export const AdoptionScreen = ({ data }: { readonly data: AdoptionView }) => {
  const min = data.minimumCell;
  return (
    <Page width="reading">
      <PageHeader
        eyebrow="Program"
        title="Adoption"
        description={`The whole firm as of ${formatDate(data.asOf, { year: 'numeric' })}. A figure is withheld when it draws on fewer than ${min} people, or when it would let you work out a smaller group. Nothing here names anyone.`}
      />
      <Card className="px-5">
        <dl className="divide-y divide-line">
          <Measure label="People with a plan" hint="An active or paused plan">
            {data.withPlan === null ? <Withheld /> : data.withPlan}
          </Measure>
          <Measure
            label="Observed in the last 6 weeks"
            hint="People with a plan whose work someone observed and signed"
          >
            {data.observedRecently === null || data.withPlan === null ? (
              <Withheld />
            ) : (
              <>
                {data.observedRecently}
                {data.withPlan > 0 ? (
                  <span className="text-ui text-ink-3">
                    {' '}
                    · {pct(data.observedRecently / data.withPlan)}
                  </span>
                ) : null}
              </>
            )}
          </Measure>
          <Measure
            label="Median days to sign"
            hint="From logging the work to the signature, over the last four weeks"
          >
            {data.medianDaysToSign === null ? <Withheld /> : data.medianDaysToSign}
          </Measure>
          <Measure
            label="Requests that expired"
            hint="Closed without a signature, over the last four weeks"
          >
            {data.expiryRate === null ? <Withheld /> : pct(data.expiryRate)}
          </Measure>
        </dl>
      </Card>
    </Page>
  );
};
