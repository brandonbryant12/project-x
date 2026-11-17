import type { FeedItem, HomeView, QueueItem } from '@repo/api';
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
import { FirstRunStep, ObserverFirstRun, ProgramHealthCard } from '@/components/first-run.tsx';
import { Page, SkillChip } from '@/components/page.tsx';
import { ServerLink } from '@/components/server-link.tsx';
import { RequestObservationDialog } from '@/features/development/request-observation-dialog.tsx';
import { formatDate, greeting, humanizeDates, relativeDays } from '@/lib/format.ts';
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
        How this was earned
      </ServerLink>
    </li>
  );
};

/** Waiting on you: one merged queue, then (for observers) who is worth observing. */
const WaitingOnYou = ({
  home,
  onRequest,
}: {
  readonly home: HomeView;
  readonly onRequest: (id: string) => void;
}) => {
  const observer = useSession().relations.canObserve;
  const empty = home.needsYou.length === 0 && home.toObserve.length === 0;
  return (
    <section className="grid gap-3" aria-labelledby="waiting">
      <SectionLabel id="waiting">Waiting on you</SectionLabel>
      {home.needsYou.length > 0 ? (
        <Card>
          <ul className="divide-y divide-line">
            {home.needsYou.map((item) => (
              <QueueRow key={`${item.kind}-${item.id}`} item={item} onRequest={onRequest} />
            ))}
          </ul>
          {home.needsYouTotal > home.needsYou.length ? (
            <div className="border-t border-line px-5 py-3">
              <Link to="/inbox" className="text-ui text-primary-ink hover:underline">
                See all {home.needsYouTotal}
              </Link>
            </div>
          ) : null}
        </Card>
      ) : null}
      {observer && home.toObserve.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-ui font-medium text-ink">Worth observing this week</p>
          <ul className="divide-y divide-line border-y border-line">
            {home.toObserve.map((s) => (
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
        </div>
      ) : null}
      {empty ? (
        <EmptyState>
          Nothing is waiting on you.
          {observer ? ' A good day to notice someone doing something well.' : ''}
        </EmptyState>
      ) : null}
    </section>
  );
};

/** Your plan, the next step toward a badge, and who supports you. */
const YourPlan = ({ home }: { readonly home: HomeView }) => {
  const support = home.coaches.length > 0 || home.leader;
  return (
    <section className="grid gap-3" aria-labelledby="your-plan">
      <SectionLabel id="your-plan">Your plan</SectionLabel>
      {home.plan ? (
        <Card className="grid gap-4 p-5">
          <div className="grid gap-2">
            <div className="flex items-start justify-between gap-3">
              <Link
                to="/development"
                className="font-serif text-h2 font-medium text-ink hover:underline md:text-h1"
              >
                {home.plan.title}
              </Link>
              <StatusPill {...PLAN_STATUS[home.plan.status]} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {home.plan.focusSkills.map((s) => (
                <SkillChip key={s.id} name={s.name} />
              ))}
            </div>
            <p className="text-meta text-ink-3">
              {home.plan.activityCount} {plural(home.plan.activityCount, 'piece', 'pieces')} of work
              · {home.plan.observedCount} {plural(home.plan.observedCount, 'time', 'times')}{' '}
              observed · runs to {formatDate(home.plan.periodEnd)}
            </p>
          </div>
          {home.nextStep ? (
            <div className="flex items-center gap-4 border-t border-line pt-4">
              <BadgeSeal level={0} domain={home.nextStep.skill.domain} size={40} />
              <div className="grid gap-1">
                <p className="text-meta text-ink-3">Next step</p>
                <p className="text-body text-ink">{home.nextStep.sentence}</p>
                <Link
                  to="/catalog/skills/$slug"
                  params={{ slug: home.nextStep.skill.slug }}
                  className="text-meta text-primary-ink hover:underline"
                >
                  What {home.nextStep.skill.name.toLowerCase()} looks like
                </Link>
              </div>
            </div>
          ) : null}
        </Card>
      ) : (
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
      )}
      {support ? (
        <div className="grid gap-2">
          <p className="text-meta text-ink-3">Your support</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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
            <Link to="/coaching" className="text-meta text-primary-ink hover:underline">
              Coaching
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
};

/** The first-run card, by persona: program owner, then observer, then advisor. */
const FirstStep = ({ home, observer }: { readonly home: HomeView; readonly observer: boolean }) => {
  if (home.programHealth) return <ProgramHealthCard health={home.programHealth} />;
  if (observer) return <ObserverFirstRun />;
  return <FirstRunStep leader={home.leader} coaches={home.coaches} />;
};

/** Home: waiting on you, your plan (with the next step), and what happened recently. */
export const HomeScreen = ({ home }: { readonly home: HomeView }) => {
  const [requesting, setRequesting] = useState<string | null>(null);
  const session = useSession();
  const waiting = home.needsYouTotal;
  const observer = session.relations.canObserve;
  // First run: no plan, nothing waiting or worth observing, nothing yet. One next step, at the top.
  const firstRun =
    !home.plan && waiting === 0 && home.toObserve.length === 0 && home.recently.length === 0;
  return (
    <Page width="reading">
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
          {observer && !firstRun ? (
            <Button variant="primary" asChild className="mt-2 justify-self-start">
              <Link to="/observations/new">
                <EyeIcon /> I saw this
              </Link>
            </Button>
          ) : null}
        </header>

        {firstRun ? (
          <FirstStep home={home} observer={observer} />
        ) : (
          <>
            <WaitingOnYou home={home} onRequest={setRequesting} />
            <YourPlan home={home} />
          </>
        )}

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
              Nothing signed yet. Ask your leader or coach to watch your next client meeting.
            </p>
          )}
        </section>
      </div>
      <RequestObservationDialog interactionId={requesting} onClose={() => setRequesting(null)} />
    </Page>
  );
};
