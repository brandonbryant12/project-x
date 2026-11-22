import type {
  ActivityView,
  DevelopmentView,
  PlanView,
  ProgressView,
  RecentObservationItem,
} from '@repo/api';
import { OBSERVATION_MODE_LABELS } from '@repo/domain';
import {
  Button,
  Card,
  CatalystArc,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  MasteryRing,
  PersonAvatar,
  PersonChip,
  Pill,
  ProgressBar,
  SectionLabel,
  SkillLadder,
  StatusPill,
  toast,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  EllipsisIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
} from 'lucide-react';
import { useState } from 'react';
import { FirstRunStep } from '@/components/first-run.tsx';
import { MasteryStrip } from '@/components/mastery-strip.tsx';
import { Page, SkillChip } from '@/components/page.tsx';
import { useLogDialog } from '@/components/shell/log-dialog-context.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';
import { formatDate, kindLabel } from '@/lib/format.ts';
import { OBSERVATION_STATUS, PLAN_EVENT_LABEL, PLAN_STATUS } from '@/lib/lifecycle-presentation.ts';
import { AddActivityDialog, FocusSkillsDialog } from './plan-dialogs.tsx';
import { ReviseEvidenceDialog } from './revise-evidence-dialog.tsx';

/** Secondary/formal plan transitions (shown only when relevant, e.g. coach agreeing a proposed plan). */
const PRIMARY_PLAN_EVENTS = new Set(['AGREE', 'RESUME']);

const PlanOverflow = ({ plan }: { readonly plan: PlanView }) => {
  const event = useApiMutation('development', 'planEvent', {
    onSuccess: (_d, v) => toast.success(`${PLAN_EVENT_LABEL[v.payload.event] ?? 'Done'}.`),
  });
  const primary = plan.actions.filter((a) => PRIMARY_PLAN_EVENTS.has(a));
  const rest = plan.actions.filter(
    (a) => !PRIMARY_PLAN_EVENTS.has(a) && a !== 'EXPIRE' && a !== 'PROPOSE' && a !== 'REVISE',
  );
  const send = (e: (typeof plan.actions)[number]) =>
    event.mutate({ params: { id: plan.id }, payload: { event: e } });
  if (primary.length === 0 && rest.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      {primary.map((a) => (
        <Button key={a} variant="primary" disabled={event.isPending} onClick={() => send(a)}>
          {PLAN_EVENT_LABEL[a]}
        </Button>
      ))}
      {rest.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" aria-label="More options">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {rest.map((a) => (
              <DropdownMenuItem key={a} onSelect={() => send(a)}>
                {PLAN_EVENT_LABEL[a]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
};

const progressSubtitle = (progress: ProgressView, aim?: string) => {
  if (aim) return `Goal: ${aim}`;
  if (progress.targetLevelName) return `Next: ${progress.targetLevelName}`;
  return 'All badges earned';
};

export const ProgressBlock = ({
  progress,
  aim,
  action,
}: {
  readonly progress: ProgressView;
  readonly aim?: string | undefined;
  readonly action?: React.ReactNode;
}) => {
  const held = progress.heldLevels.length > 0 ? Math.max(...progress.heldLevels) : 0;
  const primary = progress.criteria[0];
  const almostThere =
    primary !== undefined &&
    primary.required - primary.current === 1 &&
    progress.targetLevelName !== null;
  return (
    <Card
      className={cn(
        'flex flex-col justify-between gap-4 p-5',
        almostThere && 'border-brass/65 ring-1 ring-brass/25',
      )}
    >
      <div className="grid gap-4">
        <div className="flex items-start gap-3">
          <MasteryRing
            level={held}
            current={primary?.current ?? 0}
            required={primary?.required ?? 0}
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
              {almostThere
                ? `1 more observation to unlock ${progress.targetLevelName}`
                : progressSubtitle(progress, aim)}
            </p>
          </div>
          {held > 0 ? <Pill tone="success">Level {held}</Pill> : null}
        </div>

        <SkillLadder heldLevels={progress.heldLevels} targetLevel={progress.targetLevel} />

        {progress.criteria.length > 0 ? (
          <div className="grid gap-2.5">
            {progress.criteria.map((c) => (
              <ProgressBar key={c.key} current={c.current} required={c.required} label={c.label} />
            ))}
          </div>
        ) : (
          <p className="text-ui text-success-ink">You hold every badge for this skill.</p>
        )}
      </div>

      {action ? (
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <Link
            to="/catalog/skills/$slug"
            params={{ slug: progress.skill.slug }}
            className="text-meta text-ink-3 hover:text-ink hover:underline"
          >
            What it looks like
          </Link>
          {action}
        </div>
      ) : null}
    </Card>
  );
};

const ObservationFeedCard = ({ item }: { readonly item: RecentObservationItem }) => (
  <li>
    <Card className="grid gap-3 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-meta text-ink-3">
          <span className="font-medium text-ink tabular">{formatDate(item.occurredOn)}</span>
          <span>·</span>
          <span>{item.activityTitle}</span>
          <span>·</span>
          <span>{OBSERVATION_MODE_LABELS[item.mode]}</span>
        </div>
        <StatusPill {...OBSERVATION_STATUS[item.status]} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PersonAvatar person={item.observer} size="xs" />
        <span className="text-ui font-medium text-ink">{item.observer.displayName}</span>
        <div className="flex flex-wrap gap-1.5">
          {item.ratings.map((r) => (
            <Pill key={r.skill.id} tone={r.level ? 'primary' : 'outline'}>
              {r.skill.name}
              {r.levelName ? ` · ${r.levelName}` : ''}
              {!r.credit ? ' (note only)' : ''}
            </Pill>
          ))}
        </div>
      </div>

      {item.narrativeVisible && item.narrativeSaw ? (
        <blockquote className="narrative border-l-2 border-brass pl-3.5 text-ink">
          {item.narrativeSaw}
        </blockquote>
      ) : null}
      {!item.narrativeSaw && (item.status === 'requested' || item.status === 'drafting') ? (
        <p className="text-ui text-ink-3">
          Waiting for {item.observer.displayName.split(' ')[0]} to add feedback.
        </p>
      ) : null}

      {item.narrativeVisible && item.narrativeNext ? (
        <p className="rounded-control bg-sunken px-3 py-2 text-ui text-ink-2">
          <span className="font-medium text-ink">Try next time: </span>
          {item.narrativeNext}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-meta text-ink-3">{kindLabel(item.kind)}</span>
        <Link
          to="/observations/$id"
          params={{ id: item.id }}
          className="inline-flex items-center gap-1 text-meta font-medium text-primary-ink hover:underline"
        >
          Open details <ArrowRightIcon className="size-3" />
        </Link>
      </div>
    </Card>
  </li>
);

const PlannedActivitiesSection = ({
  activities,
  editable,
  onAdd,
}: {
  readonly activities: ReadonlyArray<ActivityView>;
  readonly editable: boolean;
  readonly onAdd: () => void;
}) => {
  const planned = activities.filter((a) => a.origin === 'planned');
  if (planned.length === 0 && !editable) return null;
  return (
    <Collapsible className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 md:px-5">
        <CollapsibleTrigger className="group flex flex-1 cursor-pointer items-center gap-2 text-left text-ui font-medium text-ink">
          <ChevronDownIcon className="size-4 text-ink-3 transition-transform group-data-[state=closed]:-rotate-90" />
          Planned practice activities
          <span className="text-meta text-ink-3 tabular">({planned.length})</span>
        </CollapsibleTrigger>
        {editable ? (
          <Button variant="ghost" size="sm" onClick={onAdd}>
            <PlusIcon /> Plan activity
          </Button>
        ) : null}
      </div>
      <CollapsibleContent className="border-t border-line">
        {planned.length > 0 ? (
          <ul className="divide-y divide-line">
            {planned.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-5"
              >
                <div className="grid gap-1">
                  <span className="text-ui font-medium text-ink">{a.title}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {a.targetSkills.map((s) => (
                      <SkillChip key={s.id} name={s.name} />
                    ))}
                    {a.intendedObserver ? (
                      <span className="text-meta text-ink-3">
                        · {a.intendedObserver.displayName.split(' ')[0]} will observe
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="text-meta text-ink-3 tabular">{a.interactions.length} logged</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-ui text-ink-3 md:px-5">
            Optional: add upcoming client meetings or huddles you want to practice a skill in.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

const FeedbackHistorySection = ({
  plan,
  observations,
  editable,
}: {
  readonly plan: PlanView;
  readonly observations: ReadonlyArray<RecentObservationItem>;
  readonly editable: boolean;
}) => {
  const log = useLogDialog();
  const [skillFilter, setSkillFilter] = useState<string>('all');
  const filteredObs =
    skillFilter === 'all'
      ? observations
      : observations.filter((o) => o.ratings.some((r) => r.skill.id === skillFilter));
  const filterSkills = [
    ...new Map(
      [
        ...plan.focusSkills.map((f) => f.skill),
        ...observations.flatMap((o) => o.ratings.map((r) => r.skill)),
      ].map((s) => [s.id, s]),
    ).values(),
  ];
  return (
    <section className="grid gap-4" aria-labelledby="feedback-history">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel id="feedback-history">Coaching feedback & requests</SectionLabel>
        {filterSkills.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSkillFilter('all')}
              className={`h-7 cursor-pointer rounded-full border px-2.5 text-meta transition-colors ${
                skillFilter === 'all'
                  ? 'border-primary bg-primary-soft font-medium text-primary-ink'
                  : 'border-line bg-surface text-ink-2 hover:bg-sunken'
              }`}
            >
              All ({observations.length})
            </button>
            {filterSkills.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSkillFilter(s.id)}
                className={`h-7 cursor-pointer rounded-full border px-2.5 text-meta transition-colors ${
                  skillFilter === s.id
                    ? 'border-primary bg-primary-soft font-medium text-primary-ink'
                    : 'border-line bg-surface text-ink-2 hover:bg-sunken'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {filteredObs.length > 0 ? (
        <ul className="grid gap-3">
          {filteredObs.map((obs) => (
            <ObservationFeedCard key={obs.id} item={obs} />
          ))}
        </ul>
      ) : (
        <EmptyState
          action={
            editable ? (
              <Button variant="primary" size="sm" onClick={() => log.show()}>
                <SendIcon /> Ask for feedback
              </Button>
            ) : undefined
          }
        >
          No coaching feedback recorded yet. Request feedback after your next client call or review.
        </EmptyState>
      )}
    </section>
  );
};

const PlanBody = ({
  plan,
  observations,
  personId,
  editable,
}: {
  readonly plan: PlanView;
  readonly observations: ReadonlyArray<RecentObservationItem>;
  readonly personId: string;
  readonly editable: boolean;
}) => {
  const log = useLogDialog();
  const [editingSkills, setEditingSkills] = useState(false);
  const [addingActivity, setAddingActivity] = useState(false);
  const [revising, setRevising] = useState<string | null>(null);

  const heldInteractions = plan.activities
    .flatMap((a) => a.interactions)
    .filter((i) => i.evidenceStatus === 'held');

  return (
    <div className="grid gap-8">
      <header className="grid gap-4 border-b border-line pb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {plan.status !== 'active' ? <StatusPill {...PLAN_STATUS[plan.status]} /> : null}
              <span className="text-meta text-ink-3">
                {editable ? 'My growth focus' : `${plan.owner.displayName}’s growth focus`}
              </span>
            </div>
            <h1 className="font-serif text-h1 font-medium text-ink md:text-display">
              {plan.title}
            </h1>
            {plan.intent ? <p className="max-w-2xl text-body text-ink-2">{plan.intent}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable ? (
              <>
                <Button variant="secondary" onClick={() => setEditingSkills(true)}>
                  <PencilIcon /> Edit focus skills
                </Button>
                <Button variant="primary" onClick={() => log.show()}>
                  <SendIcon /> Ask for feedback
                </Button>
              </>
            ) : (
              <Button variant="primary" asChild>
                <Link to="/observations/new" search={{ for: personId }}>
                  <MessageSquarePlusIcon /> Give feedback
                </Link>
              </Button>
            )}
            <PlanOverflow plan={plan} />
          </div>
        </div>
        {plan.coach || plan.leader ? (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {plan.coach ? <PersonChip person={plan.coach} subtitle="Coach" /> : null}
            {plan.leader ? <PersonChip person={plan.leader} subtitle="Leader" /> : null}
          </div>
        ) : null}
      </header>

      {editable && heldInteractions.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/40 bg-warning-soft/50 px-4 py-3.5">
          <div className="flex items-start gap-2.5 text-ui text-warning-ink">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              A note you wrote is held for privacy (it appears to include client details). Revise it
              to share with your observer.
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRevising(heldInteractions[0]?.id ?? null)}
          >
            Revise note
          </Button>
        </Card>
      ) : null}

      {plan.tryNextTime ? (
        <Card className="grid gap-1.5 border-brass/40 bg-brass-soft/45 p-4 md:p-5">
          <div className="flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.09em] text-brass-ink uppercase">
            <CatalystArc size={13} />
            Try next time
          </div>
          <p className="narrative text-ink">“{plan.tryNextTime.sentence}”</p>
          <Link
            to="/observations/$id"
            params={{ id: plan.tryNextTime.observationId }}
            className="text-meta text-ink-3 hover:text-ink hover:underline"
          >
            From {plan.tryNextTime.observer.displayName} · {formatDate(plan.tryNextTime.signedAt)}
          </Link>
        </Card>
      ) : null}

      <section className="grid gap-3" aria-labelledby="focus-skills-heading">
        <SectionLabel id="focus-skills-heading">Focus skills</SectionLabel>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plan.progress.map((p) => (
            <ProgressBlock
              key={p.skill.id}
              progress={p}
              aim={plan.focusSkills.find((f) => f.skill.id === p.skill.id)?.targetLevelName}
              action={
                editable ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => log.show({ skillId: p.skill.id })}
                  >
                    <SendIcon /> Ask for feedback
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/observations/new" search={{ for: personId }}>
                      Give feedback
                    </Link>
                  </Button>
                )
              }
            />
          ))}
        </div>
        <MasteryStrip personId={plan.owner.id} progress={plan.progress} />
      </section>

      <FeedbackHistorySection plan={plan} observations={observations} editable={editable} />

      <PlannedActivitiesSection
        activities={plan.activities}
        editable={editable}
        onAdd={() => setAddingActivity(true)}
      />

      {editable ? (
        <>
          <FocusSkillsDialog
            open={editingSkills}
            onClose={() => setEditingSkills(false)}
            existingPlan={plan}
          />
          <AddActivityDialog
            plan={plan}
            open={addingActivity}
            onClose={() => setAddingActivity(false)}
          />
          <ReviseEvidenceDialog interactionId={revising} onClose={() => setRevising(null)} />
        </>
      ) : null}
    </div>
  );
};

export const DevelopmentScreen = ({
  development,
  self,
  startPlan = false,
}: {
  readonly development: DevelopmentView;
  readonly self: boolean;
  readonly startPlan?: boolean;
}) => {
  const [creating, setCreating] = useState(startPlan && self && !development.plan);
  const home = useQuery({ ...queryOptions('support', 'home', undefined), enabled: self });
  const first = development.person.displayName.split(' ')[0];
  return (
    <Page>
      {!self ? (
        <p className="mb-3 text-meta text-ink-3">
          <Link to="/people/$id" params={{ id: development.person.id }} className="hover:underline">
            {development.person.displayName}
          </Link>{' '}
          · Skills & coaching
        </p>
      ) : null}
      {development.plan ? (
        <PlanBody
          plan={development.plan}
          observations={development.recentObservations}
          personId={development.person.id}
          editable={self}
        />
      ) : (
        <div className="grid gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="font-serif text-h1 font-medium text-ink md:text-display">
              {self ? 'My skills' : `${first}’s skills`}
            </h1>
            {!self ? (
              <Button variant="primary" asChild>
                <Link to="/observations/new" search={{ for: development.person.id }}>
                  <MessageSquarePlusIcon /> Give feedback
                </Link>
              </Button>
            ) : null}
          </div>
          {self ? (
            <FirstRunStep
              leader={home.data?.leader ?? null}
              coaches={home.data?.coaches ?? []}
              onStart={() => setCreating(true)}
            />
          ) : (
            <EmptyState>
              {first} hasn’t picked focus skills yet. You can still give them feedback on any skill
              in the catalog.
            </EmptyState>
          )}
          {development.recentObservations.length > 0 ? (
            <section className="grid gap-3">
              <SectionLabel>Recent coaching feedback</SectionLabel>
              <ul className="grid gap-3">
                {development.recentObservations.map((obs) => (
                  <ObservationFeedCard key={obs.id} item={obs} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      {development.otherProgress.length > 0 ? (
        <section className="mt-10 grid gap-4" aria-labelledby="other-skills">
          <SectionLabel id="other-skills">Other skills observed</SectionLabel>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {development.otherProgress.map((p) => (
              <ProgressBlock key={p.skill.id} progress={p} />
            ))}
          </div>
        </section>
      ) : null}

      {self ? <FocusSkillsDialog open={creating} onClose={() => setCreating(false)} /> : null}
    </Page>
  );
};
