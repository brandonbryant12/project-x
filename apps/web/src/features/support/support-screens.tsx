import type { CoachingView, EngagementView, SupportRow, TeamView } from '@repo/api';
import {
  Button,
  Card,
  EmptyState,
  PersonChip,
  Pill,
  SectionLabel,
  SegmentedControl,
  SegmentedItem,
  StatusPill,
  toast,
} from '@repo/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { MessageSquarePlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader, SkillChip } from '@/components/page.tsx';
import { useApiMutation } from '@/lib/api.ts';
import { relativeDays } from '@/lib/format.ts';
import { ENGAGEMENT_EVENT_LABEL, ENGAGEMENT_STATUS } from '@/lib/lifecycle-presentation.ts';

const observationStatus = (row: SupportRow) => {
  if (!row.lastObservedOn) return { label: 'Not observed yet', tone: 'warning' as const };
  const allRecent = row.coverage.length > 0 && row.coverage.every((c) => c.observedRecently);
  const label = `Observed ${relativeDays(row.lastObservedOn)}`;
  return { label, tone: allRecent ? ('success' as const) : ('neutral' as const) };
};

/** Scannable coaching roster with explicit status pills and 1-click "Give feedback" buttons. */
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
            <th className="px-5 py-3 font-medium">Advisor</th>
            <th className="px-3 py-3 font-medium">Focus skills</th>
            <th className="px-3 py-3 font-medium">Coaching status</th>
            <th className="px-5 py-3 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => {
            const status = observationStatus(row);
            return (
              <tr
                key={row.person.id}
                onClick={() => open(row)}
                className="cursor-pointer align-middle transition-colors hover:bg-sunken/70"
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
                  {row.plan && row.plan.focusSkills.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {row.plan.focusSkills.map((s) => (
                        <SkillChip key={s.id} name={s.name} />
                      ))}
                    </div>
                  ) : (
                    <span className="text-ui text-ink-3">No focus skills yet</span>
                  )}
                </td>
                <td className="px-3 py-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={status.tone} dot>
                      {status.label}
                    </Pill>
                    {row.waitingOnYou > 0 ? (
                      <Pill tone="primary">
                        {row.waitingOnYou} {row.waitingOnYou === 1 ? 'request' : 'requests'} waiting
                      </Pill>
                    ) : null}
                  </div>
                </td>
                <td className="px-5 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/observations/new" search={{ for: row.person.id }}>
                      <MessageSquarePlusIcon /> Give feedback
                    </Link>
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => {
          const status = observationStatus(row);
          return (
            <li key={row.person.id} className="grid gap-3 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <Link to="/team/$personId" params={{ personId: row.person.id }}>
                  <PersonChip person={row.person} />
                </Link>
                <Button size="sm" variant="secondary" asChild>
                  <Link to="/observations/new" search={{ for: row.person.id }}>
                    Give feedback
                  </Link>
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone={status.tone} dot>
                  {status.label}
                </Pill>
                {row.waitingOnYou > 0 ? (
                  <Pill tone="primary">{row.waitingOnYou} waiting</Pill>
                ) : null}
                {row.plan?.focusSkills.map((s) => (
                  <SkillChip key={s.id} name={s.name} />
                ))}
              </div>
            </li>
          );
        })}
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
        description="See what your direct reports are working on and give quick feedback. Never a ranking."
        actions={
          <Button variant="primary" asChild>
            <Link to="/observations/new">
              <MessageSquarePlusIcon /> Give feedback
            </Link>
          </Button>
        }
      />
      {team.rows.length === 0 ? (
        <EmptyState>Nobody reports to you in the directory yet.</EmptyState>
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {team.waitingOnYou > 0 ? (
                <Link to="/inbox">
                  <Pill tone="primary">
                    {team.waitingOnYou} {team.waitingOnYou === 1 ? 'request' : 'requests'} waiting
                    on you
                  </Pill>
                </Link>
              ) : null}
              {team.unobservedCount > 0 ? (
                <Pill tone="warning">
                  {team.unobservedCount}{' '}
                  {team.unobservedCount === 1 ? 'person needs' : 'people need'} observation
                </Pill>
              ) : (
                <Pill tone="success">Everyone observed recently</Pill>
              )}
            </div>
            <SegmentedControl
              type="single"
              value={sort}
              onValueChange={(v) => v && setSort(v as 'name' | 'waiting')}
              aria-label="Sort"
            >
              <SegmentedItem value="name">A–Z</SegmentedItem>
              <SegmentedItem value="waiting">Needs attention</SegmentedItem>
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
        description="Coaching is a peer growth relationship with no reporting authority."
        actions={
          coaching.isCoach ? (
            <Button variant="primary" asChild>
              <Link to="/observations/new">
                <MessageSquarePlusIcon /> Give feedback
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-10">
        {proposals.length > 0 ? (
          <section className="grid gap-3">
            <SectionLabel>Pending invitations</SectionLabel>
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
            <SectionLabel>Advisors you coach</SectionLabel>
            {rows.length > 0 ? (
              <SupportTable rows={rows} caption="Advisors you coach" />
            ) : (
              <EmptyState>
                You are not coaching anyone yet. Offer coaching from someone’s profile in People.
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
              <Link to="/people" className="font-medium text-primary-ink hover:underline">
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
