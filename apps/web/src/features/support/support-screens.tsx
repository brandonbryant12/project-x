import type { CoachingView, EngagementView, SupportRow, TeamView } from '@repo/api';
import {
  Button,
  Card,
  CoverageDots,
  EmptyState,
  PersonChip,
  SectionLabel,
  SegmentedControl,
  SegmentedItem,
  StatusPill,
  toast,
} from '@repo/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Page, PageHeader, SkillChip } from '@/components/page.tsx';
import { useApiMutation } from '@/lib/api.ts';
import { relativeDays } from '@/lib/format.ts';
import {
  ENGAGEMENT_EVENT_LABEL,
  ENGAGEMENT_STATUS,
  PLAN_STATUS,
} from '@/lib/lifecycle-presentation.ts';

const coverageDots = (row: SupportRow) =>
  row.coverage.map((c) => ({
    key: c.skill.id,
    filled: c.observedRecently,
    label: c.lastObservedOn
      ? `${c.skill.name}: last observed ${relativeDays(c.lastObservedOn)}${c.lastObserver ? ` by ${c.lastObserver}` : ''}`
      : `${c.skill.name}: not observed yet`,
  }));

/** Table on desktop, stacked rows on phones. Never sortable by progress (ux-brief §2.8). */
const SupportTable = ({
  rows,
  caption,
}: {
  readonly rows: ReadonlyArray<SupportRow>;
  readonly caption: string;
}) => {
  const navigate = useNavigate();
  const open = (row: SupportRow) =>
    void navigate({ to: '/team/$personId', params: { personId: row.person.id } });
  return (
    <Card className="overflow-hidden">
      <table className="hidden w-full text-left md:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-meta text-ink-3">
            <th className="px-5 py-3 font-medium">Person</th>
            <th className="px-3 py-3 font-medium">Plan</th>
            <th className="px-3 py-3 font-medium">Waiting on you</th>
            <th className="px-3 py-3 font-medium">Last observed</th>
            <th className="px-5 py-3 font-medium">Observed in the last 6 weeks</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr
              key={row.person.id}
              onClick={() => open(row)}
              className="cursor-pointer align-top transition-colors hover:bg-sunken"
            >
              <td className="px-5 py-4">
                <Link
                  to="/team/$personId"
                  params={{ personId: row.person.id }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <PersonChip person={row.person} />
                </Link>
              </td>
              <td className="px-3 py-4">
                {row.plan ? (
                  <div className="grid gap-1.5">
                    <StatusPill {...PLAN_STATUS[row.plan.status]} className="justify-self-start" />
                    <div className="flex flex-wrap gap-1">
                      {row.plan.focusSkills.map((s) => (
                        <SkillChip key={s.id} name={s.name} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className="text-ui text-ink-3">No plan</span>
                )}
              </td>
              <td className="px-3 py-4 text-ui text-ink tabular">
                {row.waitingOnYou > 0 ? row.waitingOnYou : <span className="text-ink-3">—</span>}
              </td>
              <td className="px-3 py-4 text-ui text-ink-2">
                {row.lastObservedOn ? relativeDays(row.lastObservedOn) : 'Not yet'}
              </td>
              <td className="px-5 py-4">
                <CoverageDots dots={coverageDots(row)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li key={row.person.id}>
            <button
              type="button"
              onClick={() => open(row)}
              className="grid w-full cursor-pointer gap-2 px-4 py-4 text-left"
            >
              <span className="flex items-center justify-between gap-3">
                <PersonChip person={row.person} />
                <CoverageDots dots={coverageDots(row)} />
              </span>
              <span className="text-meta text-ink-3">
                {row.plan ? PLAN_STATUS[row.plan.status].label : 'No plan'} · last observed{' '}
                {row.lastObservedOn ? relativeDays(row.lastObservedOn) : 'not yet'}
                {row.waitingOnYou > 0 ? ` · ${row.waitingOnYou} waiting on you` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
};

export const TeamScreen = ({ team }: { readonly team: TeamView }) => {
  const [sort, setSort] = useState<'name' | 'waiting'>('name');
  const rows =
    sort === 'name' ? team.rows : team.rows.toSorted((a, b) => b.waitingOnYou - a.waitingOnYou);
  return (
    <Page>
      <PageHeader
        title="My team"
        description="Who was observed lately and what is waiting on you. Never a ranking."
        actions={
          <Link to="/people" className="text-ui text-primary-ink hover:underline">
            Find anyone in the firm
          </Link>
        }
      />
      {team.rows.length === 0 ? (
        <EmptyState>Nobody reports to you in the directory.</EmptyState>
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ul className="grid gap-1 text-body text-ink-2">
              {team.waitingOnYou > 0 ? (
                <li>
                  <Link to="/inbox" className="text-ink hover:underline">
                    {team.waitingOnYou === 1 ? '1 thing is' : `${team.waitingOnYou} things are`}{' '}
                    waiting on you
                  </Link>
                </li>
              ) : null}
              {team.unobservedCount > 0 ? (
                <li>
                  {team.unobservedCount === 1
                    ? '1 person hasn’t'
                    : `${team.unobservedCount} people haven’t`}{' '}
                  been observed in 6 weeks
                </li>
              ) : (
                <li>Everyone has been observed in the last 6 weeks.</li>
              )}
            </ul>
            <SegmentedControl
              type="single"
              value={sort}
              onValueChange={(v) => v && setSort(v as 'name' | 'waiting')}
              aria-label="Sort"
            >
              <SegmentedItem value="name">A–Z</SegmentedItem>
              <SegmentedItem value="waiting">Waiting on you</SegmentedItem>
            </SegmentedControl>
          </div>
          <SupportTable rows={rows} caption="Your direct reports" />
        </div>
      )}
    </Page>
  );
};

const isPrimary = (a: string) => a === 'ACCEPT' || a === 'RESUME';

const EngagementCard = ({
  engagement,
  perspective,
}: {
  readonly engagement: EngagementView;
  readonly perspective: 'coach' | 'coachee';
}) => {
  const event = useApiMutation('support', 'engagementEvent', {
    onSuccess: (_d, v) => toast.success(`${ENGAGEMENT_EVENT_LABEL[v.payload.event] ?? 'Done'}.`),
  });
  const other = perspective === 'coach' ? engagement.coachee : engagement.coach;
  const send = (e: (typeof engagement.actions)[number]) =>
    event.mutate({ params: { id: engagement.id }, payload: { event: e } });
  const primary = engagement.actions.filter(isPrimary);
  const rest = engagement.actions.filter((a) => !isPrimary(a) && a !== 'EXPIRE');
  return (
    <Card className="grid gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/people/$id" params={{ id: other.id }}>
          <PersonChip
            person={other}
            subtitle={perspective === 'coach' ? 'You coach them' : 'Your coach'}
          />
        </Link>
        <StatusPill {...ENGAGEMENT_STATUS[engagement.status]} />
      </div>
      {engagement.note ? <p className="narrative text-ink-2">“{engagement.note}”</p> : null}
      {engagement.status === 'proposed' ? (
        <p className="text-meta text-ink-3">
          {engagement.proposedBy.id === other.id
            ? `${other.displayName.split(' ')[0]} proposed this`
            : 'You proposed this'}
          {engagement.expiresAt
            ? ` · open until ${new Date(engagement.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
            : ''}
        </p>
      ) : null}
      {engagement.row && engagement.row.coverage.length > 0 ? (
        <div className="flex items-center gap-3 text-meta text-ink-3">
          <CoverageDots dots={coverageDots(engagement.row)} />
          Last observed{' '}
          {engagement.row.lastObservedOn ? relativeDays(engagement.row.lastObservedOn) : 'not yet'}
        </div>
      ) : null}
      {engagement.actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {primary.map((a) => (
            <Button
              key={a}
              size="sm"
              variant="primary"
              disabled={event.isPending}
              onClick={() => send(a)}
            >
              {ENGAGEMENT_EVENT_LABEL[a]}
            </Button>
          ))}
          {rest.map((a) => (
            <Button
              key={a}
              size="sm"
              variant="ghost"
              disabled={event.isPending}
              onClick={() => send(a)}
            >
              {ENGAGEMENT_EVENT_LABEL[a]}
            </Button>
          ))}
        </div>
      ) : null}
    </Card>
  );
};

export const CoachingScreen = ({ coaching }: { readonly coaching: CoachingView }) => {
  const proposals = [...coaching.asCoach, ...coaching.asCoachee].filter(
    (e) => e.status === 'proposed',
  );
  const coachees = coaching.asCoach.filter((e) => e.status !== 'proposed');
  const coaches = coaching.asCoachee.filter((e) => e.status !== 'proposed');
  const rows = coachees.flatMap((e) => (e.row ? [e.row] : []));
  return (
    <Page>
      <PageHeader
        title={coaching.isCoach ? 'People I coach' : 'Coaching'}
        description="Coaching is a relationship between two people. It carries no reporting line."
      />
      <div className="grid gap-10">
        {proposals.length > 0 ? (
          <section className="grid gap-3">
            <SectionLabel>Proposals</SectionLabel>
            <div className="grid gap-3 md:grid-cols-2">
              {proposals.map((e) => (
                <EngagementCard
                  key={e.id}
                  engagement={e}
                  perspective={coaching.asCoach.includes(e) ? 'coach' : 'coachee'}
                />
              ))}
            </div>
          </section>
        ) : null}
        {coaching.isCoach ? (
          <section className="grid gap-3">
            <SectionLabel>People you coach</SectionLabel>
            {rows.length > 0 ? (
              <SupportTable rows={rows} caption="People you coach" />
            ) : (
              <EmptyState>
                You are not coaching anyone yet. Offer coaching from someone’s profile.
              </EmptyState>
            )}
          </section>
        ) : null}
        <section className="grid gap-3">
          <SectionLabel>Your coaches</SectionLabel>
          {coaches.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {coaches.map((e) => (
                <EngagementCard key={e.id} engagement={e} perspective="coachee" />
              ))}
            </div>
          ) : (
            <EmptyState>
              You don’t have a coach yet. Find one in{' '}
              <Link to="/people" className="text-primary-ink hover:underline">
                People
              </Link>{' '}
              and ask them from their profile.
            </EmptyState>
          )}
        </section>
      </div>
    </Page>
  );
};
