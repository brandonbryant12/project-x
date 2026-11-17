import type { FeedItem, HomeView, QueueItem, TodayItem } from '@repo/api';
import {
  BadgeSeal,
  Button,
  Card,
  DueLabel,
  EmptyState,
  PersonAvatar,
  PersonChip,
  SectionLabel,
  StatusPill,
} from '@repo/ui';
import { Link } from '@tanstack/react-router';
import { EyeIcon } from 'lucide-react';
import { useState } from 'react';
import { FirstRunStep } from '@/components/first-run.tsx';
import { Page, SkillChip } from '@/components/page.tsx';
import { ServerLink } from '@/components/server-link.tsx';
import { RequestObservationDialog } from '@/features/development/request-observation-dialog.tsx';
import { CommitmentRow } from '@/features/rhythm/commitments.tsx';
import {
  formatDate,
  formatTime,
  formatWhen,
  greeting,
  humanizeDates,
  relativeDays,
} from '@/lib/format.ts';
import { PLAN_STATUS } from '@/lib/lifecycle-presentation.ts';
import { useSession } from '@/lib/session.ts';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const firstName = (name: string) => name.split(' ')[0] ?? name;

const QueueRow = ({
  item,
  onRequest,
}: {
  readonly item: QueueItem;
  readonly onRequest: (id: string) => void;
}) => {
  const action =
    item.kind === 'request_observation' ? (
      <Button size="sm" variant="secondary" onClick={() => onRequest(item.id)}>
        {item.actionLabel}
      </Button>
    ) : (
      <Button size="sm" variant="secondary" asChild>
        <ServerLink href={item.href}>{item.actionLabel}</ServerLink>
      </Button>
    );
  return (
    <li className="flex items-center gap-3 px-4 py-3.5 md:px-5">
      {item.person ? (
        <PersonAvatar person={item.person} size="md" />
      ) : (
        <span aria-hidden className="grid size-10 place-items-center">
          <span className="size-2 rounded-full bg-line-strong" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui font-medium text-ink">{item.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-ink-3">
          <span>{item.relation}</span>
          {item.detail ? (
            <span className="min-w-0 truncate">· {humanizeDates(item.detail)}</span>
          ) : null}
          {item.dueAt ? <DueLabel dueAt={item.dueAt} /> : null}
        </p>
      </div>
      {action}
    </li>
  );
};

const FeedEntry = ({ item }: { readonly item: FeedItem }) => {
  if (item.kind === 'signed_about_you' && item.observer) {
    return (
      <li className="grid gap-2 py-4">
        <p className="text-meta text-ink-3">
          {item.skill.name} · {item.levelName} · {relativeDays(item.at)}
        </p>
        {item.quote ? (
          <figure className="grid gap-1">
            <figcaption className="text-meta text-ink-3">
              In {firstName(item.observer.displayName)}’s words:
            </figcaption>
            <blockquote className="narrative text-ink">“{item.quote}”</blockquote>
          </figure>
        ) : null}
        <ServerLink href={item.href} className="text-meta text-primary-ink hover:underline">
          Read the observation
        </ServerLink>
      </li>
    );
  }
  if (item.kind === 'read_by_subject') {
    // The observer's loop closes quietly: a named person read their words. No counts.
    return (
      <li className="flex items-center gap-3 py-4">
        <PersonAvatar person={item.person} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-ui text-ink">
            {firstName(item.person.displayName)} read your observation
          </p>
          <p className="text-meta text-ink-3">
            {item.skill.name} · {item.levelName} · {relativeDays(item.at)}
          </p>
        </div>
        <ServerLink href={item.href} className="text-meta text-primary-ink hover:underline">
          Open
        </ServerLink>
      </li>
    );
  }
  const self = item.kind === 'badge_earned';
  return (
    <li className="flex items-center gap-3 py-4">
      <BadgeSeal level={item.level as 2 | 3} domain={item.skill.domain} size={40} />
      <div className="min-w-0 flex-1">
        <p className="text-ui text-ink">
          {self ? 'You earned ' : `${item.person.displayName} earned `}
          <span className="font-medium">
            {item.skill.name} · {item.levelName}
          </span>
        </p>
        <p className="text-meta text-ink-3">{relativeDays(item.at)}</p>
      </div>
      <ServerLink href={item.href} className="text-meta text-primary-ink hover:underline">
        Receipt
      </ServerLink>
    </li>
  );
};

const TODAY_KIND: Record<TodayItem['kind'], string> = {
  conversation: 'Conversation',
  planned_observation: 'Planned work you will observe',
  activity_due: 'Planned work due',
};

/** Today: what is on the calendar the plan already knows about. No calendar needed. */
const TodayBand = ({ home }: { readonly home: HomeView }) => {
  const me = useSession().person.id;
  const next = home.nextConversation;
  const nextIsToday = home.today.some((t) => t.kind === 'conversation' && t.id === next?.id);
  return (
    <section className="grid gap-3" aria-labelledby="today">
      <SectionLabel id="today">Today</SectionLabel>
      {home.today.length > 0 ? (
        <ul className="divide-y divide-line border-y border-line">
          {home.today.map((t) => (
            <li key={`${t.kind}-${t.id}`} className="flex items-center gap-3 py-3">
              <span className="w-14 shrink-0 text-meta text-ink-3 tabular">
                {t.at ? formatTime(t.at) : 'Today'}
              </span>
              {t.person ? <PersonAvatar person={t.person} size="sm" /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui text-ink">{t.title}</p>
                <p className="text-meta text-ink-3">{TODAY_KIND[t.kind]}</p>
              </div>
              <ServerLink href={t.href} className="text-meta text-primary-ink hover:underline">
                Open
              </ServerLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ui text-ink-3">Nothing is planned for today.</p>
      )}
      {next && !nextIsToday ? (
        <p className="text-ui text-ink-2">
          Next conversation:{' '}
          <ServerLink href={next.href} className="text-primary-ink hover:underline">
            with {(next.host.id === me ? next.coachee : next.host).displayName},{' '}
            {formatWhen(next.scheduledFor)}
          </ServerLink>
        </p>
      ) : null}
    </section>
  );
};

/** This week: who to observe and why, commitments due, coverage. Never a ranking. */
const ThisWeekBand = ({ home }: { readonly home: HomeView }) => {
  const session = useSession();
  const week = home.thisWeek;
  const me = session.person.id;
  const due = week.commitmentsDue;
  const open = home.myCommitments.filter((c) => !due.some((d) => d.id === c.id));
  const observer = session.relations.canObserve;
  const empty =
    week.toObserve.length === 0 && due.length === 0 && open.length === 0 && !week.coverageSentence;
  if (empty && !observer) return null;
  return (
    <section className="grid gap-4" aria-labelledby="this-week">
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel id="this-week">This week</SectionLabel>
        <span className="text-meta text-ink-3">from {formatDate(week.weekOf)}</span>
      </div>
      {observer ? (
        <div className="grid gap-2">
          <p className="text-ui font-medium text-ink">
            {week.toObserve.length > 0 ? 'Worth observing' : 'Nobody is waiting to be observed'}
          </p>
          {week.toObserve.length > 0 ? (
            <ul className="divide-y divide-line border-y border-line">
              {week.toObserve.map((s) => (
                <li key={s.person.id} className="flex items-center gap-3 py-3">
                  <PersonAvatar person={s.person} size="md" />
                  <div className="min-w-0 flex-1">
                    <ServerLink href={s.href} className="text-ui text-ink hover:underline">
                      {s.person.displayName}
                    </ServerLink>
                    <p className="text-meta text-ink-3">{s.sentence}</p>
                  </div>
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/observations/new" search={{ for: s.person.id }}>
                      I saw this
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-meta text-ink-3">
            You plan to observe up to {week.observeCapacity}{' '}
            {plural(week.observeCapacity, 'person', 'people')} a week.{' '}
            <Link to="/settings" className="text-primary-ink hover:underline">
              Change
            </Link>
          </p>
          {week.coverageSentence ? (
            <p className="text-ui text-ink-2">{week.coverageSentence}</p>
          ) : null}
        </div>
      ) : null}
      {due.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-ui font-medium text-ink">Commitments due</p>
          <ul className="divide-y divide-line">
            {due.map((c) => (
              <CommitmentRow key={c.id} commitment={c} showOwner={c.owner.id !== me} />
            ))}
          </ul>
        </div>
      ) : null}
      {open.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-ui font-medium text-ink">Your open commitments</p>
          <ul className="divide-y divide-line">
            {open.map((c) => (
              <CommitmentRow key={c.id} commitment={c} showOwner={false} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

const PlanRail = ({ home, firstRun }: { readonly home: HomeView; readonly firstRun: boolean }) => {
  const session = useSession();
  return (
    <aside className="grid content-start gap-6">
      {!home.plan && !firstRun ? (
        <EmptyState
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/development" search={{ start: 'plan' }}>
                Start a plan
              </Link>
            </Button>
          }
        >
          You don’t have a plan yet. Start from a template
          {home.coaches.length > 0 ? ', or ask your coach to propose one' : ''}.
        </EmptyState>
      ) : null}
      {home.plan ? (
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <SectionLabel>Your plan</SectionLabel>
            <StatusPill {...PLAN_STATUS[home.plan.status]} />
          </div>
          <Link
            to="/development"
            className="mt-2 block font-serif text-h1 font-medium text-ink hover:underline"
          >
            {home.plan.title}
          </Link>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {home.plan.focusSkills.map((s) => (
              <SkillChip key={s.id} name={s.name} />
            ))}
          </div>
          <p className="mt-3 text-meta text-ink-3">
            {home.plan.activityCount} {plural(home.plan.activityCount, 'activity', 'activities')} ·{' '}
            {home.plan.observedCount} observed · runs to {formatDate(home.plan.periodEnd)}
          </p>
        </Card>
      ) : null}
      {home.coaches.length > 0 || home.leader ? (
        <div className="grid gap-3">
          <SectionLabel>Your support</SectionLabel>
          {home.coaches.map((c) => (
            <Link key={c.id} to="/people/$id" params={{ id: c.id }} className="rounded-control">
              <PersonChip person={c} subtitle="Your coach" />
            </Link>
          ))}
          {home.leader ? (
            <Link to="/people/$id" params={{ id: home.leader.id }} className="rounded-control">
              <PersonChip person={home.leader} subtitle="Your leader" />
            </Link>
          ) : null}
        </div>
      ) : null}
      {session.relations.canObserve ? (
        // On phones the same action sits under the greeting, above the fold.
        <Button variant="primary" asChild className="hidden lg:inline-flex">
          <Link to="/observations/new">
            <EyeIcon /> I saw this
          </Link>
        </Button>
      ) : null}
    </aside>
  );
};

/** Home ("Today"): what needs me, across every relationship (path to A § 2). */
export const HomeScreen = ({ home }: { readonly home: HomeView }) => {
  const [requesting, setRequesting] = useState<string | null>(null);
  const session = useSession();
  const waiting = home.needsYouTotal;
  // First run: no plan, nothing waiting, nobody to observe. One next step, at the top.
  const firstRun =
    !home.plan && waiting === 0 && !session.relations.canObserve && home.recently.length === 0;
  return (
    <Page>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,720px)_320px] lg:justify-between">
        <div className="grid content-start gap-10">
          <header className="grid gap-2">
            <h1 className="font-serif text-display font-medium text-ink">
              {greeting()}, {home.firstName}.
            </h1>
            <p className="text-body text-ink-2">
              {waiting === 0
                ? 'Here is where things stand.'
                : `${waiting === 1 ? 'One thing is' : `${waiting} things are`} waiting on you.`}
            </p>
            {session.relations.canObserve ? (
              <Button variant="primary" asChild className="mt-2 justify-self-start lg:hidden">
                <Link to="/observations/new">
                  <EyeIcon /> I saw this
                </Link>
              </Button>
            ) : null}
          </header>

          {firstRun ? (
            <FirstRunStep leader={home.leader} coaches={home.coaches} />
          ) : (
            <>
              <TodayBand home={home} />
              <section className="grid gap-3" aria-labelledby="needs-you">
                <SectionLabel id="needs-you">Needs you</SectionLabel>
                {home.needsYou.length > 0 ? (
                  <Card>
                    <ul className="divide-y divide-line">
                      {home.needsYou.map((item) => (
                        <QueueRow
                          key={`${item.kind}-${item.id}`}
                          item={item}
                          onRequest={setRequesting}
                        />
                      ))}
                    </ul>
                    {home.needsYouTotal > home.needsYou.length ? (
                      <div className="border-t border-line px-5 py-3">
                        <Link to="/inbox" className="text-ui text-primary-ink hover:underline">
                          See all {home.needsYouTotal} in Inbox
                        </Link>
                      </div>
                    ) : null}
                  </Card>
                ) : (
                  <EmptyState>
                    Nothing is waiting on you. A good day to notice someone doing something well.
                  </EmptyState>
                )}
              </section>
              <ThisWeekBand home={home} />
            </>
          )}

          {home.nextStep ? (
            <section className="grid gap-3" aria-labelledby="next-step">
              <SectionLabel id="next-step">Your next step</SectionLabel>
              <Card className="flex items-center gap-4 p-5">
                <BadgeSeal level={0} domain={home.nextStep.skill.domain} size={56} />
                <div className="grid gap-1">
                  <p className="text-body text-ink">{home.nextStep.sentence}</p>
                  <Link
                    to="/catalog/skills/$slug"
                    params={{ slug: home.nextStep.skill.slug }}
                    className="text-meta text-primary-ink hover:underline"
                  >
                    What {home.nextStep.skill.name.toLowerCase()} looks like
                  </Link>
                </div>
              </Card>
            </section>
          ) : null}

          <section className="grid gap-1" aria-labelledby="recently">
            <SectionLabel id="recently">Recently</SectionLabel>
            {home.recently.length > 0 ? (
              <ul className="divide-y divide-line">
                {home.recently.map((item) => (
                  <FeedEntry key={`${item.kind}-${item.href}-${item.at}`} item={item} />
                ))}
              </ul>
            ) : (
              <p className="py-3 text-ui text-ink-3">
                When someone signs an observation of your work, their words appear here.
              </p>
            )}
          </section>
        </div>
        <PlanRail home={home} firstRun={firstRun} />
      </div>
      <RequestObservationDialog interactionId={requesting} onClose={() => setRequesting(null)} />
    </Page>
  );
};
