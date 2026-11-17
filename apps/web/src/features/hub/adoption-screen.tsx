import type { AdoptionView } from '@repo/api';
import { Card, SectionLabel } from '@repo/ui';
import { Page, PageHeader } from '@/components/page.tsx';
import { formatDate } from '@/lib/format.ts';

type Week = AdoptionView['weeks'][number];

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A suppressed cell: fewer people than the minimum, so no number is shown (ADR 0021). */
const Suppressed = ({ min }: { readonly min: number }) => (
  <span className="text-meta text-ink-3">fewer than {min}</span>
);

const Value = ({
  value,
  min,
  format = String,
}: {
  readonly value: number | null;
  readonly min: number;
  readonly format?: (n: number) => string;
}) => (value === null ? <Suppressed min={min} /> : <>{format(value)}</>);

/** A week's expiry is unknown until its signing window closes; say which kind of blank it is. */
const WeekExpiry = ({ week, min }: { readonly week: Week; readonly min: number }) => {
  if (week.expiryRate !== null) return <>{pct(week.expiryRate)}</>;
  if (week.requested >= min) return <span className="text-meta text-ink-3">window still open</span>;
  return <Suppressed min={min} />;
};

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
    <dd className="text-body text-ink tabular sm:text-right">{children}</dd>
  </div>
);

const WEEK_COLUMNS = [
  'Week of',
  'Requested',
  'Signed',
  'Median days to sign',
  '90th percentile',
  'Expired',
  'Active observers',
] as const;

const WeekTable = ({ data }: { readonly data: AdoptionView }) => {
  const min = data.minimumCell;
  const weeks = data.weeks.toReversed();
  return (
    <>
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-ui">
          <caption className="sr-only">Observation activity by week, newest first</caption>
          <thead>
            <tr className="border-b border-line text-meta text-ink-3">
              {WEEK_COLUMNS.map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`px-4 py-3 font-medium ${i === 0 ? '' : 'text-right'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular">
            {weeks.map((w) => (
              <tr key={w.weekOf}>
                <th scope="row" className="px-4 py-3 text-left font-normal text-ink-2">
                  {formatDate(w.weekOf)}
                </th>
                <td className="px-4 py-3 text-right">{w.requested}</td>
                <td className="px-4 py-3 text-right">{w.signed}</td>
                <td className="px-4 py-3 text-right">
                  <Value value={w.medianDaysToSign} min={min} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Value value={w.p90DaysToSign} min={min} />
                </td>
                <td className="px-4 py-3 text-right">
                  <WeekExpiry week={w} min={min} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Value value={w.activeObservers} min={min} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {/* Phones: one block per week, every number labelled. */}
      <Card className="md:hidden">
        <ul className="divide-y divide-line">
          {weeks.map((w) => (
            <li key={w.weekOf} className="grid gap-2 px-4 py-4">
              <p className="text-ui font-medium text-ink">Week of {formatDate(w.weekOf)}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-ui tabular">
                {(
                  [
                    ['Requested', w.requested],
                    ['Signed', w.signed],
                    ['Median days to sign', <Value key="m" value={w.medianDaysToSign} min={min} />],
                    ['90th percentile', <Value key="p" value={w.p90DaysToSign} min={min} />],
                    ['Expired', <WeekExpiry key="e" week={w} min={min} />],
                    ['Active observers', <Value key="a" value={w.activeObservers} min={min} />],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="grid">
                    <dt className="text-meta text-ink-3">{label}</dt>
                    <dd className="text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
};

const Distribution = ({
  title,
  caption,
  unit,
  countLabel,
  rows,
  min,
}: {
  readonly title: string;
  readonly caption: string;
  readonly unit: string;
  readonly countLabel: string;
  readonly rows: ReadonlyArray<{ readonly bucket: string; readonly count: number | null }>;
  readonly min: number;
}) => (
  <section className="grid content-start gap-3" aria-label={title}>
    <SectionLabel>{title}</SectionLabel>
    <p className="text-meta text-ink-3">{caption}</p>
    <Card>
      <table className="w-full text-left text-ui">
        <thead>
          <tr className="border-b border-line text-meta text-ink-3">
            <th scope="col" className="px-4 py-2.5 font-medium">
              {unit}
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              {countLabel}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular">
          {rows.map((r) => (
            <tr key={r.bucket}>
              <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink-2">
                {r.bucket}
              </th>
              <td className="px-4 py-2.5 text-right">
                <Value value={r.count} min={min} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  </section>
);

/**
 * Adoption for program owners (ADR 0021): aggregates only, never names, and
 * nothing drawn from fewer than the minimum cell size. No ranks, no targets.
 */
export const AdoptionScreen = ({ data }: { readonly data: AdoptionView }) => {
  const min = data.minimumCell;
  const { coverage } = data;
  return (
    <Page>
      <PageHeader
        eyebrow="Program"
        title="Adoption"
        description={`The whole firm as of ${formatDate(data.asOf, { year: 'numeric' })}. Any figure drawn from fewer than ${min} people is withheld. Nothing here names anyone.`}
      />
      <div className="grid gap-12">
        <section className="grid gap-3" aria-labelledby="measures">
          <SectionLabel id="measures">Measures</SectionLabel>
          <Card className="px-5">
            <dl className="divide-y divide-line">
              <Measure
                label="Coverage"
                hint="People with a current plan who were observed in the last six weeks"
              >
                {coverage.observed === null ? (
                  <Suppressed min={min} />
                ) : (
                  <>
                    {coverage.observed} of {coverage.withPlan}
                    {coverage.withPlan > 0 ? (
                      <span className="text-ink-3">
                        {' '}
                        · {pct(coverage.observed / coverage.withPlan)}
                      </span>
                    ) : null}
                  </>
                )}
              </Measure>
              <Measure
                label="Requests that expired"
                hint="Closed without a signature, over weeks whose window has closed"
              >
                <Value value={data.expiryRate} min={min} format={pct} />
              </Measure>
              <Measure label="First-hand" hint="Signed observations the observer saw or reviewed">
                <Value value={data.firstHandShare} min={min} format={pct} />
              </Measure>
              <Measure label="Feedback only" hint="Ratings given as feedback, with no credit">
                <Value value={data.feedbackOnlyShare} min={min} format={pct} />
              </Measure>
              <Measure label="Acknowledged" hint="Signed observations the subject acknowledged">
                <Value value={data.acknowledgedShare} min={min} format={pct} />
              </Measure>
              <Measure label="Review requested" hint="Signed observations the subject questioned">
                <Value value={data.reviewRequestedShare} min={min} format={pct} />
              </Measure>
              <Measure
                label="Notifications acted on"
                hint="Sent notifications followed by the intended action within 7 days"
              >
                <Value value={data.notificationConversion} min={min} format={pct} />
              </Measure>
            </dl>
          </Card>
        </section>

        <section className="grid gap-3" aria-labelledby="by-week">
          <SectionLabel id="by-week">By week</SectionLabel>
          <p className="text-meta text-ink-3">
            Days to sign run from the request to the signature. Newest first.
          </p>
          <WeekTable data={data} />
        </section>

        <div className="grid gap-10 md:grid-cols-2">
          <Distribution
            title="Observers per person"
            caption="How many different people have observed each person with a plan."
            unit="Distinct observers"
            countLabel="People"
            rows={data.distinctObservers.map((r) => ({ bucket: r.bucket, count: r.people }))}
            min={min}
          />
          <Distribution
            title="Observer load"
            caption="Signatures per observer in the last 28 days. A spread, never a ranking."
            unit="Signatures"
            countLabel="Observers"
            rows={data.observerLoad.map((r) => ({ bucket: r.bucket, count: r.observers }))}
            min={min}
          />
        </div>
      </div>
    </Page>
  );
};
