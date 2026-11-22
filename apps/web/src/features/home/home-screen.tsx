import type { FeedItem, HomeView, ProgressView, QueueItem } from '@repo/api';
import {
  BadgeSeal,
  Button,
  Card,
  CatalystArc,
  cn,
  DueLabel,
  MasteryRing,
  PersonAvatar,
  PersonChip,
  Pill,
  ProgressBar,
  SectionLabel,
  SkillLadder,
} from '@repo/ui';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, MessageSquarePlusIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { FirstRunStep, ObserverFirstRun, ProgramHealthCard } from '@/components/first-run.tsx';
import { MasteryStrip } from '@/components/mastery-strip.tsx';
import { Page } from '@/components/page.tsx';
import { ServerLink } from '@/components/server-link.tsx';
import { useLogDialog } from '@/components/shell/log-dialog-context.tsx';
import { RequestObservationDialog } from '@/features/development/request-observation-dialog.tsx';
import { greeting, humanizeDates, relativeDays } from '@/lib/format.ts';
import { useSession } from '@/lib/session.ts';

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
      <Button size="sm" variant="primary" onClick={() => onRequest(item.id)}>
        {item.actionLabel}
      </Button>
    ) : (
      <Button
        size="sm"
        variant={
          item.kind === 'sign_observation' || item.kind === 'continue_draft'
            ? 'primary'
            : 'secondary'
        }
        asChild
      >
        <ServerLink href={item.href}>{item.actionLabel}</ServerLink>
      </Button>
    );
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3.5 md:px-5">
      {item.person ? (
        <PersonAvatar person={item.person} size="md" />
      ) : (
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken"
        >
          <span className="size-2 rounded-full bg-primary" />
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

const HomeSkillCard = ({ progress }: { readonly progress: ProgressView }) => {
  const log = useLogDialog();
  const held = progress.heldLevels.length > 0 ? Math.max(...progress.heldLevels) : 0;
  const primaryCriterion = progress.criteria[0];
  const remaining = primaryCriterion
    ? Math.max(0, primaryCriterion.required - primaryCriterion.current)
    : 0;
  const almostThere = remaining === 1 && progress.targetLevelName !== null;
  const subtitle = (() => {
    if (almostThere) return `1 more observation to unlock ${progress.targetLevelName}`;
    if (progress.targetLevelName) return `Next milestone: ${progress.targetLevelName}`;
    return 'Every milestone unlocked';
  })();
  return (
    <Card
      className={cn(
        'flex flex-col justify-between gap-4 p-4 md:p-5',
        almostThere && 'border-brass/65 ring-1 ring-brass/25',
      )}
    >
      <div className="grid gap-3.5">
        <div className="flex items-start gap-3">
          <MasteryRing
            level={held}
            current={primaryCriterion?.current ?? 0}
            required={primaryCriterion?.required ?? 0}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <Link
              to="/catalog/skills/$slug"
              params={{ slug: progress.skill.slug }}
              className="block truncate text-ui font-semibold text-ink hover:underline"
            >
              {progress.skill.name}
            </Link>
            <p
              className={cn('text-meta', almostThere ? 'font-medium text-brass-ink' : 'text-ink-3')}
            >
              {subtitle}
            </p>
          </div>
          {held > 0 ? <Pill tone="success">Level {held}</Pill> : null}
        </div>
        <SkillLadder heldLevels={progress.heldLevels} targetLevel={progress.targetLevel} />
        {primaryCriterion ? (
          <ProgressBar
            current={primaryCriterion.current}
            required={primaryCriterion.required}
            label={primaryCriterion.label}
          />
        ) : (
          <p className="text-meta text-success-ink">All milestones unlocked for this skill.</p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <Link
          to="/catalog/skills/$slug"
          params={{ slug: progress.skill.slug }}
          className="text-meta text-ink-3 hover:text-ink hover:underline"
        >
          See indicators
        </Link>
        <Button
          size="sm"
          variant={almostThere ? 'primary' : 'secondary'}
          onClick={() => log.show({ skillId: progress.skill.id })}
        >
          <SendIcon /> Ask for feedback
        </Button>
      </div>
    </Card>
  );
};

const FeedCard = ({ item }: { readonly item: FeedItem }) => {
  if (item.kind === 'signed_about_you' && item.observer) {
    return (
      <li>
        <Card className="grid gap-2.5 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PersonAvatar person={item.observer} size="xs" />
              <span className="text-ui font-medium text-ink">{item.observer.displayName}</span>
              <span className="text-meta text-ink-3">· {relativeDays(item.at)}</span>
            </div>
            <Pill tone="primary">
              {item.skill.name} · {item.levelName}
            </Pill>
          </div>
          {item.quote ? (
            <blockquote className="narrative border-l-2 border-brass pl-3.5 text-ink">
              “{item.quote}”
            </blockquote>
          ) : null}
          <div>
            <ServerLink
              href={item.href}
              className="inline-flex items-center gap-1 text-meta font-medium text-primary-ink hover:underline"
            >
              Read full feedback <ArrowRightIcon className="size-3" />
            </ServerLink>
          </div>
        </Card>
      </li>
    );
  }
  if (item.kind === 'read_by_subject') {
    return (
      <li>
        <Card className="flex items-center gap-3 p-4">
          <PersonAvatar person={item.person} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-ui text-ink">
              <span className="font-medium">{firstName(item.person.displayName)}</span> read your
              feedback on <span className="font-medium">{item.skill.name}</span>
            </p>
            <p className="text-meta text-ink-3">
              {item.levelName} · {relativeDays(item.at)}
            </p>
          </div>
          <ServerLink
            href={item.href}
            className="text-meta font-medium text-primary-ink hover:underline"
          >
            View
          </ServerLink>
        </Card>
      </li>
    );
  }
  const self = item.kind === 'badge_earned';
  return (
    <li>
      <Card className="flex items-center gap-3.5 border-brass/40 bg-brass-soft/40 p-4">
        <BadgeSeal level={item.level as 2 | 3} domain={item.skill.domain} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-ui text-ink">
            {self ? 'You earned ' : `${item.person.displayName} earned `}
            <span className="font-semibold">
              {item.skill.name} · {item.levelName}
            </span>
          </p>
          <p className="text-meta text-ink-3">{relativeDays(item.at)}</p>
        </div>
        <ServerLink
          href={item.href}
          className="text-meta font-medium text-brass-ink hover:underline"
        >
          How this was earned
        </ServerLink>
      </Card>
    </li>
  );
};

const homeSubtitle = (home: HomeView, waiting: number) => {
  if (waiting > 0) {
    return `You have ${waiting === 1 ? '1 coaching item' : `${waiting} coaching items`} waiting on you.`;
  }
  if (home.plan) {
    return `Focusing on ${home.plan.focusSkills.map((s) => s.name).join(' and ')}.`;
  }
  return 'Track real coaching feedback and build verified advisor skills.';
};

const ActionCenter = ({
  home,
  observer,
  onRequest,
}: {
  readonly home: HomeView;
  readonly observer: boolean;
  readonly onRequest: (id: string) => void;
}) => {
  if (home.needsYou.length === 0 && (!observer || home.toObserve.length === 0)) return null;
  return (
    <section className="grid gap-4" aria-labelledby="waiting">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel id="waiting">Needs your attention</SectionLabel>
        {home.needsYouTotal > home.needsYou.length ? (
          <Link to="/inbox" className="text-meta font-medium text-primary-ink hover:underline">
            See all {home.needsYouTotal}
          </Link>
        ) : null}
      </div>
      {home.needsYou.length > 0 ? (
        <Card>
          <ul className="divide-y divide-line">
            {home.needsYou.map((item) => (
              <QueueRow key={`${item.kind}-${item.id}`} item={item} onRequest={onRequest} />
            ))}
          </ul>
        </Card>
      ) : null}
      {observer && home.toObserve.length > 0 ? (
        <Card className="grid gap-3 p-4 md:p-5">
          <div className="flex items-center gap-2 text-ui font-medium text-ink">
            <CatalystArc size={13} />
            Suggested to observe this week
          </div>
          <ul className="divide-y divide-line">
            {home.toObserve.map((s) => (
              <li
                key={s.person.id}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-1 last:pb-0"
              >
                <PersonAvatar person={s.person} size="sm" />
                <div className="min-w-0 flex-1">
                  <ServerLink
                    href={s.href}
                    className="text-ui font-medium text-ink hover:underline"
                  >
                    {s.person.displayName}
                  </ServerLink>
                  <p className="text-meta text-ink-3">{s.sentence}</p>
                </div>
                <Button size="sm" variant="secondary" asChild>
                  <Link to="/observations/new" search={{ for: s.person.id }}>
                    Give feedback
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
};

const CoachingTeamAside = ({ home }: { readonly home: HomeView }) => {
  const hasSupport = home.coaches.length > 0 || home.leader !== null;
  return (
    <aside className="grid content-start gap-4">
      <SectionLabel>Your coaching team</SectionLabel>
      <Card className="grid gap-4 p-4 md:p-5">
        {hasSupport ? (
          <div className="grid gap-3">
            {home.coaches.map((c) => (
              <Link
                key={c.id}
                to="/people/$id"
                params={{ id: c.id }}
                className="-m-1 rounded-control p-1 transition-colors hover:bg-sunken"
              >
                <PersonChip person={c} subtitle="Your coach" />
              </Link>
            ))}
            {home.leader ? (
              <Link
                to="/people/$id"
                params={{ id: home.leader.id }}
                className="-m-1 rounded-control p-1 transition-colors hover:bg-sunken"
              >
                <PersonChip person={home.leader} subtitle="Your leader" />
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="text-ui text-ink-2">
            No coach linked yet. Find a coach in the directory to get regular feedback.
          </p>
        )}
        <div className="flex flex-wrap gap-3 border-t border-line pt-3 text-meta">
          <Link to="/coaching" className="font-medium text-primary-ink hover:underline">
            Manage coaching
          </Link>
          <Link to="/people" className="text-ink-3 hover:text-ink hover:underline">
            Browse directory
          </Link>
        </div>
      </Card>
    </aside>
  );
};

/** Home: clear action center, visual focus skill cards, and recent coaching feedback. */
export const HomeScreen = ({ home }: { readonly home: HomeView }) => {
  const [requesting, setRequesting] = useState<string | null>(null);
  const session = useSession();
  const log = useLogDialog();
  const waiting = home.needsYouTotal;
  const observer = session.relations.canObserve;

  const showOnboarding = !home.plan && !home.programHealth;
  const showObserverFirstRun =
    observer &&
    !home.plan &&
    waiting === 0 &&
    home.toObserve.length === 0 &&
    home.recently.length === 0;

  return (
    <Page>
      <div className="grid content-start gap-8">
        <header className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-1">
            <h1 className="editorial-serif text-h1 font-normal text-ink md:text-display">
              {greeting()}, <em className="text-primary-ink italic">{home.firstName}.</em>
            </h1>
            <p className="text-body text-ink-2">{homeSubtitle(home, waiting)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={observer ? 'secondary' : 'primary'} onClick={() => log.show()}>
              <SendIcon /> Ask for feedback
            </Button>
            {observer ? (
              <Button variant="primary" asChild>
                <Link to="/observations/new">
                  <MessageSquarePlusIcon /> Give feedback
                </Link>
              </Button>
            ) : null}
          </div>
        </header>

        {home.programHealth ? <ProgramHealthCard health={home.programHealth} /> : null}

        <ActionCenter home={home} observer={observer} onRequest={setRequesting} />

        {showObserverFirstRun ? <ObserverFirstRun /> : null}
        {!showObserverFirstRun && showOnboarding && !observer ? (
          <FirstRunStep leader={home.leader} coaches={home.coaches} />
        ) : null}

        {home.plan && home.progress.length > 0 ? (
          <section className="grid gap-3" aria-labelledby="focus-skills">
            <div className="flex items-baseline justify-between gap-2">
              <SectionLabel id="focus-skills">My focus skills</SectionLabel>
              <Link
                to="/development"
                className="inline-flex items-center gap-1 text-meta font-medium text-primary-ink hover:underline"
              >
                Manage skills & history <ArrowRightIcon className="size-3" />
              </Link>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {home.progress.map((p) => (
                <HomeSkillCard key={p.skill.id} progress={p} />
              ))}
            </div>
            <MasteryStrip personId={session.person.id} progress={home.progress} />
          </section>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="grid content-start gap-3" aria-labelledby="recently">
            <SectionLabel id="recently">Recent coaching feedback</SectionLabel>
            {home.recently.length > 0 ? (
              <ul className="grid gap-3">
                {home.recently.map((item) => (
                  <FeedCard key={`${item.kind}-${item.href}-${item.at}`} item={item} />
                ))}
              </ul>
            ) : (
              <Card className="grid gap-2 p-5 text-ui text-ink-2">
                <p className="font-medium text-ink">No feedback yet</p>
                <p>
                  After your next client meeting or review, click{' '}
                  <button
                    type="button"
                    onClick={() => log.show()}
                    className="cursor-pointer font-medium text-primary-ink underline-offset-2 hover:underline"
                  >
                    Ask for feedback
                  </button>{' '}
                  so your coach or leader can share notes that count toward your milestones.
                </p>
              </Card>
            )}
          </section>
          <CoachingTeamAside home={home} />
        </div>
      </div>
      <RequestObservationDialog interactionId={requesting} onClose={() => setRequesting(null)} />
    </Page>
  );
};
