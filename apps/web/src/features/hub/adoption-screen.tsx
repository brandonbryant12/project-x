import type { AdoptionView } from '@repo/api';
import { Card } from '@repo/ui';
import { Page, PageHeader } from '@/components/page.tsx';
import { formatDate } from '@/lib/format.ts';

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A suppressed figure: fewer people than the minimum, so no number is shown (ADR 0021). */
const Suppressed = ({ min }: { readonly min: number }) => (
  <span className="text-meta text-ink-3">fewer than {min}</span>
);

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
 * nothing drawn from fewer than the minimum cell size. No ranks, no targets.
 */
export const AdoptionScreen = ({ data }: { readonly data: AdoptionView }) => {
  const min = data.minimumCell;
  return (
    <Page width="reading">
      <PageHeader
        eyebrow="Program"
        title="Adoption"
        description={`The whole firm as of ${formatDate(data.asOf, { year: 'numeric' })}. Any figure drawn from fewer than ${min} people is withheld. Nothing here names anyone.`}
      />
      <Card className="px-5">
        <dl className="divide-y divide-line">
          <Measure label="People with a plan" hint="An active or paused development plan">
            {data.withPlan}
          </Measure>
          <Measure
            label="Observed in the last 6 weeks"
            hint="People with a plan whose work someone observed and signed"
          >
            {data.observedRecently === null ? (
              <Suppressed min={min} />
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
            {data.medianDaysToSign === null ? <Suppressed min={min} /> : data.medianDaysToSign}
          </Measure>
          <Measure
            label="Requests that expired"
            hint="Closed without a signature, over the last four weeks"
          >
            {data.expiryRate === null ? <Suppressed min={min} /> : pct(data.expiryRate)}
          </Measure>
        </dl>
      </Card>
    </Page>
  );
};
