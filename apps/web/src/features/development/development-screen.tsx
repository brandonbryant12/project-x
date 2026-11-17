import type {
  ActivityView,
  DevelopmentView,
  InteractionSummary,
  PlanView,
  ProgressView,
} from '@repo/api';
import {
  BadgeSeal,
  Button,
  Card,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  CriteriaChecklist,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  PersonAvatar,
  PersonChip,
  SectionLabel,
  StatusPill,
  toast,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDownIcon, EllipsisIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { FirstRunStep } from '@/components/first-run.tsx';
import { Page, SkillChip } from '@/components/page.tsx';
import { useLogDialog } from '@/components/shell/log-dialog-context.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';
import { formatDate, kindLabel } from '@/lib/format.ts';
import {
  ACTIVITY_EVENT_LABEL,
  ACTIVITY_STATUS,
  EVIDENCE_STATUS,
  OBSERVATION_STATUS,
  PLAN_EVENT_LABEL,
  PLAN_STATUS,
} from '@/lib/lifecycle-presentation.ts';
import { AddActivityDialog, CreatePlanDialog } from './plan-dialogs.tsx';
import { RequestObservationDialog } from './request-observation-dialog.tsx';
import { ReviseEvidenceDialog } from './revise-evidence-dialog.tsx';

/** Primary plan events get a button; the rest live in the overflow menu. */
const PRIMARY_PLAN_EVENTS = new Set(['PROPOSE', 'AGREE', 'ENDORSE', 'RESUME']);

const PlanActions = ({ plan }: { readonly plan: PlanView }) => {
  const event = useApiMutation('development', 'planEvent', {
    onSuccess: (_d, v) => toast.success(`${PLAN_EVENT_LABEL[v.payload.event] ?? 'Done'}.`),
  });
  const primary = plan.actions.filter((a) => PRIMARY_PLAN_EVENTS.has(a));
  const rest = plan.actions.filter((a) => !PRIMARY_PLAN_EVENTS.has(a) && a !== 'EXPIRE');
  const send = (e: (typeof plan.actions)[number]) =>
    event.mutate({ params: { id: plan.id }, payload: { event: e } });
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
            <Button variant="secondary" size="icon" aria-label="More plan actions">
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

const InteractionRow = ({
  interaction,
  onRequest,
  onRevise,
  editable,
}: {
  readonly interaction: InteractionSummary;
  readonly onRequest: (id: string) => void;
  readonly onRevise: (id: string) => void;
  readonly editable: boolean;
}) => (
  <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
    <span className="w-16 shrink-0 text-meta text-ink-3 tabular">
      {formatDate(interaction.occurredOn)}
    </span>
    <span className="text-ui text-ink-2">{kindLabel(interaction.kind)}</span>
    {interaction.evidenceStatus && interaction.evidenceStatus !== 'available' ? (
      <StatusPill {...EVIDENCE_STATUS[interaction.evidenceStatus]} />
    ) : null}
    {editable && interaction.evidenceStatus === 'held' ? (
      <Button size="sm" variant="secondary" onClick={() => onRevise(interaction.id)}>
        Revise
      </Button>
    ) : null}
    <span className="ml-auto flex flex-wrap items-center gap-2">
      {interaction.observations.map((o) => (
        <Link
          key={o.id}
          to="/observations/$id"
          params={{ id: o.id }}
          className="inline-flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-0.5 hover:bg-sunken"
        >
          <PersonAvatar person={o.observer} size="xs" />
          <StatusPill {...OBSERVATION_STATUS[o.status]} />
        </Link>
      ))}
      {interaction.canRequestObservation ? (
        <Button
          size="sm"
          variant={interaction.observations.length === 0 ? 'secondary' : 'ghost'}
          className={interaction.observations.length === 0 ? '' : 'text-ink-3'}
          onClick={() => onRequest(interaction.id)}
        >
          {interaction.observations.length === 0
            ? 'Ask someone to observe'
            : 'Ask another observer'}
        </Button>
      ) : null}
    </span>
  </li>
);

const ActivityRow = ({
  activity,
  editable,
  onRequest,
  onRevise,
}: {
  readonly activity: ActivityView;
  readonly editable: boolean;
  readonly onRequest: (id: string) => void;
  readonly onRevise: (id: string) => void;
}) => {
  const log = useLogDialog();
  const event = useApiMutation('development', 'activityEvent');
  const observed = activity.interactions.filter((i) =>
    i.observations.some((o) => o.status === 'signed'),
  ).length;
  const live = activity.status === 'planned' || activity.status === 'underway';
  return (
    <Collapsible defaultOpen={activity.interactions.length > 0 && activity.interactions.length < 4}>
      <div className="flex items-start gap-3 px-4 py-4 md:px-5">
        <CollapsibleTrigger className="group grid min-w-0 flex-1 cursor-pointer gap-1.5 text-left">
          <span className="flex items-center gap-2">
            <ChevronDownIcon className="size-4 shrink-0 text-ink-3 transition-transform group-data-[state=closed]:-rotate-90" />
            <span className="truncate text-ui font-medium text-ink">{activity.title}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 pl-6">
            {activity.targetSkills.map((s) => (
              <SkillChip key={s.id} name={s.name} />
            ))}
            <span className="text-meta text-ink-3">
              {activity.interactions.length === 0
                ? 'Nothing logged yet'
                : `${activity.interactions.length} logged · ${observed} observed`}
              {activity.intendedObserver
                ? ` · ${activity.intendedObserver.displayName.split(' ')[0]} will observe`
                : ''}
            </span>
          </span>
        </CollapsibleTrigger>
        <span className="flex shrink-0 items-center gap-2">
          {activity.status !== 'underway' ? (
            <StatusPill {...ACTIVITY_STATUS[activity.status]} />
          ) : null}
          {editable && live ? (
            <Button size="sm" variant="secondary" onClick={() => log.show(activity.id)}>
              Log
            </Button>
          ) : null}
          {editable && activity.actions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Activity actions">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {activity.actions
                  .filter((a) => ACTIVITY_EVENT_LABEL[a])
                  .map((a) => (
                    <DropdownMenuItem
                      key={a}
                      onSelect={() =>
                        event.mutate({ params: { id: activity.id }, payload: { event: a } })
                      }
                    >
                      {ACTIVITY_EVENT_LABEL[a]}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </span>
      </div>
      <CollapsibleContent>
        {activity.interactions.length > 0 ? (
          <ul className="divide-y divide-line border-t border-line px-4 md:px-5 md:pl-11">
            {activity.interactions.map((i) => (
              <InteractionRow
                key={i.id}
                interaction={i}
                onRequest={onRequest}
                onRevise={onRevise}
                editable={editable}
              />
            ))}
          </ul>
        ) : (
          <p className="border-t border-line px-4 py-3 text-ui text-ink-3 md:px-5 md:pl-11">
            Nothing logged here yet. After your next client meeting, take a minute to note what you
            did.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

export const ProgressBlock = ({
  progress,
  aim,
}: {
  readonly progress: ProgressView;
  readonly aim?: string | undefined;
}) => {
  const held = Math.max(0, ...progress.heldLevels);
  const subtitle = [
    aim ? `Aiming for ${aim.toLowerCase()}` : null,
    progress.targetLevelName
      ? `next badge: ${progress.targetLevelName.toLowerCase()}`
      : 'every badge held',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="grid content-start gap-3">
      <div className="flex items-center gap-3">
        <BadgeSeal level={held as 0 | 2 | 3} domain={progress.skill.domain} size={40} />
        <div className="min-w-0">
          <Link
            to="/catalog/skills/$slug"
            params={{ slug: progress.skill.slug }}
            className="block truncate text-ui font-medium text-ink hover:underline"
          >
            {progress.skill.name}
          </Link>
          <p className="text-meta text-ink-3">
            {subtitle.charAt(0).toUpperCase() + subtitle.slice(1)}
          </p>
        </div>
      </div>
      {progress.criteria.length > 0 ? (
        <CriteriaChecklist criteria={progress.criteria} nextStep={progress.nextStep} />
      ) : null}
    </div>
  );
};

const PlanBody = ({ plan, editable }: { readonly plan: PlanView; readonly editable: boolean }) => {
  const [adding, setAdding] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [revising, setRevising] = useState<string | null>(null);
  return (
    <>
      <header className="mb-8 grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill {...PLAN_STATUS[plan.status]} />
          <span className="text-meta text-ink-3 tabular">
            {formatDate(plan.periodStart)} – {formatDate(plan.periodEnd, { year: 'numeric' })}
          </span>
        </div>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <h1 className="font-serif text-h1 font-medium text-ink md:text-display">{plan.title}</h1>
          <PlanActions plan={plan} />
        </div>
        {plan.intent ? <p className="narrative max-w-2xl text-ink-2">{plan.intent}</p> : null}
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {plan.coach ? (
            <PersonChip
              person={plan.coach}
              subtitle={plan.agreedBy?.id === plan.coach.id ? 'Coach · agreed' : 'Coach'}
            />
          ) : null}
          {plan.leader ? (
            <PersonChip
              person={plan.leader}
              subtitle={plan.endorsedBy ? 'Leader · endorsed' : 'Leader'}
            />
          ) : null}
        </div>
      </header>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="grid content-start gap-3" aria-labelledby="activities">
          <div className="flex items-center justify-between">
            <SectionLabel id="activities">Activities</SectionLabel>
            {editable ? (
              <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
                <PlusIcon /> Add real work
              </Button>
            ) : null}
          </div>
          {plan.activities.length > 0 ? (
            <Card className="divide-y divide-line">
              {plan.activities.map((a) => (
                <ActivityRow
                  key={a.id}
                  activity={a}
                  editable={editable}
                  onRequest={setRequesting}
                  onRevise={setRevising}
                />
              ))}
            </Card>
          ) : (
            <EmptyState>
              Add the real work that will develop these skills: meetings, reviews, conversations you
              already have.
            </EmptyState>
          )}
        </section>
        <aside
          className="grid content-start gap-6 lg:sticky lg:top-20"
          aria-labelledby="toward-badges"
        >
          <SectionLabel id="toward-badges">Toward badges</SectionLabel>
          {plan.progress.map((p) => (
            <ProgressBlock
              key={p.skill.id}
              progress={p}
              aim={plan.focusSkills.find((f) => f.skill.id === p.skill.id)?.targetLevelName}
            />
          ))}
        </aside>
      </div>
      {editable ? (
        <AddActivityDialog plan={plan} open={adding} onClose={() => setAdding(false)} />
      ) : null}
      <RequestObservationDialog interactionId={requesting} onClose={() => setRequesting(null)} />
      <ReviseEvidenceDialog interactionId={revising} onClose={() => setRevising(null)} />
    </>
  );
};

export const DevelopmentScreen = ({
  development,
  self,
  startPlan = false,
}: {
  readonly development: DevelopmentView;
  readonly self: boolean;
  /** Arrived from the first-run step: open the plan dialog straight away. */
  readonly startPlan?: boolean;
}) => {
  const [creating, setCreating] = useState(startPlan && self && !development.plan);
  // Who supports me, for the first-run sentence; Home already loads it.
  const home = useQuery({ ...queryOptions('support', 'home', undefined), enabled: self });
  const first = development.person.displayName.split(' ')[0];
  return (
    <Page>
      {!self ? (
        <p className="mb-2 text-meta text-ink-3">
          <Link to="/people/$id" params={{ id: development.person.id }} className="hover:underline">
            {development.person.displayName}
          </Link>{' '}
          · Development plan
        </p>
      ) : null}
      {development.plan ? (
        <PlanBody plan={development.plan} editable={self} />
      ) : (
        <div className="grid max-w-2xl gap-6">
          <h1 className="font-serif text-h1 font-medium text-ink md:text-display">
            {self ? 'Development' : `${first}’s development`}
          </h1>
          {self ? (
            <FirstRunStep
              leader={home.data?.leader ?? null}
              coaches={home.data?.coaches ?? []}
              onStart={() => setCreating(true)}
            />
          ) : (
            <EmptyState>{first} doesn’t have a current plan.</EmptyState>
          )}
        </div>
      )}
      {development.otherProgress.length > 0 ? (
        <section className="mt-12 grid gap-4" aria-labelledby="other-skills">
          <SectionLabel id="other-skills">Other skills observed</SectionLabel>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {development.otherProgress.map((p) => (
              <ProgressBlock key={p.skill.id} progress={p} />
            ))}
          </div>
        </section>
      ) : null}
      {development.pastPlans.length > 0 ? (
        <section className="mt-12 grid gap-3" aria-labelledby="past-plans">
          <SectionLabel id="past-plans">Past plans</SectionLabel>
          <ul className="divide-y divide-line">
            {development.pastPlans.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-ui">
                <span className="text-ink">{p.title}</span>
                <span className="flex items-center gap-3">
                  <span className="text-meta text-ink-3">
                    {formatDate(p.periodEnd, { year: 'numeric' })}
                  </span>
                  <StatusPill {...PLAN_STATUS[p.status]} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {self ? <CreatePlanDialog open={creating} onClose={() => setCreating(false)} /> : null}
    </Page>
  );
};
