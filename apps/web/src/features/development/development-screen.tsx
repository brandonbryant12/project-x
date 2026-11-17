import type {
  ActivitySkillView,
  ActivityView,
  DevelopmentView,
  FocusSkillView,
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
import { ChevronDownIcon, EllipsisIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { FirstRunStep } from '@/components/first-run.tsx';
import { Page, SkillChip } from '@/components/page.tsx';
import { useLogDialog } from '@/components/shell/log-dialog-context.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';
import { formatDate, kindLabel, levelName } from '@/lib/format.ts';
import {
  ACTIVITY_EVENT_LABEL,
  ACTIVITY_STATUS,
  EVIDENCE_STATUS,
  OBSERVATION_STATUS,
  PLAN_EVENT_LABEL,
  PLAN_STATUS,
} from '@/lib/lifecycle-presentation.ts';
import { CreatePlanDialog, EditPlanDialog, TARGET_NOTE } from './plan-dialogs.tsx';
import { RequestObservationDialog } from './request-observation-dialog.tsx';
import { ClosingReviewDialog, OUTCOME_LABEL, type ReviewTarget } from './review-dialog.tsx';
import { ReviseEvidenceDialog } from './revise-evidence-dialog.tsx';
import { SetValueDialog, VALUE_SOURCE } from './value-dialog.tsx';
import { WorkDialog } from './work-dialog.tsx';

/** Primary plan events get a button; the rest live in the overflow menu. */
const PRIMARY_PLAN_EVENTS = new Set(['PROPOSE', 'AGREE', 'ENDORSE', 'RESUME']);

const PlanActions = ({
  plan,
  onEdit,
  onComplete,
}: {
  readonly plan: PlanView;
  readonly onEdit: () => void;
  /** Completing offers the closing review in the same step. */
  readonly onComplete: () => void;
}) => {
  const event = useApiMutation('development', 'planEvent', {
    onSuccess: (_d, v) => toast.success(`${PLAN_EVENT_LABEL[v.payload.event] ?? 'Done'}.`),
  });
  const primary = plan.actions.filter((a) => PRIMARY_PLAN_EVENTS.has(a));
  const rest = plan.actions.filter((a) => !PRIMARY_PLAN_EVENTS.has(a) && a !== 'EXPIRE');
  const send = (e: (typeof plan.actions)[number]) =>
    e === 'COMPLETE' && plan.canRecordReview
      ? onComplete()
      : event.mutate({ params: { id: plan.id }, payload: { event: e } });
  return (
    <div className="flex items-center gap-2">
      {plan.canEdit ? (
        <Button variant="ghost" onClick={onEdit}>
          <PencilIcon /> Edit plan
        </Button>
      ) : null}
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
}: {
  readonly interaction: InteractionSummary;
  readonly onRequest: (id: string) => void;
  readonly onRevise: (id: string) => void;
}) => (
  <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
    <span className="w-16 shrink-0 text-meta text-ink-3 tabular">
      {formatDate(interaction.occurredOn)}
    </span>
    <span className="text-ui text-ink-2">{kindLabel(interaction.kind)}</span>
    {interaction.evidenceStatus && interaction.evidenceStatus !== 'available' ? (
      <StatusPill {...EVIDENCE_STATUS[interaction.evidenceStatus]} />
    ) : null}
    {interaction.canReviseEvidence ? (
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

/** Who set a skill's value for this work, or that it comes from the template. */
const ValueSource = ({ skill }: { readonly skill: ActivitySkillView }) => {
  if (skill.override) {
    return (
      <span className="text-meta text-ink-3">
        Set for this work by {skill.override.setBy.displayName}; applies to work from{' '}
        {formatDate(skill.override.appliesFrom)}
        {skill.value.source === 'activity'
          ? ''
          : ` (not in use: ${VALUE_SOURCE[skill.value.source]} applies)`}
      </span>
    );
  }
  return skill.value.source === 'template' ? (
    <span className="text-meta text-ink-3">{VALUE_SOURCE.template}</span>
  ) : null;
};

/** The skills a piece of work builds, primary first, with what one observation adds today. */
const WorkSkills = ({
  activity,
  onSetValue,
}: {
  readonly activity: ActivityView;
  readonly onSetValue: (skill: ActivitySkillView) => void;
}) => (
  <ul className="grid gap-1.5 border-t border-line px-4 py-3 md:px-5 md:pl-11">
    {activity.skills
      .toSorted((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary'))
      .map((k) => (
        <li key={k.skill.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui">
          <span className="w-20 shrink-0 text-meta text-ink-3">
            {k.role === 'primary' ? 'Primary' : 'Secondary'}
          </span>
          <span className="min-w-0 text-ink">{k.skill.name}</span>
          <span className="text-ink-2 tabular">{k.value.points} points</span>
          <ValueSource skill={k} />
          {activity.canSetValue ? (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => onSetValue(k)}
              aria-label={`Set value of ${k.skill.name}`}
            >
              Set value
            </Button>
          ) : null}
        </li>
      ))}
    <li className="text-meta text-ink-3">
      Points one signed observation would add today. The observer confirms each skill’s role.
    </li>
  </ul>
);

const ActivityRow = ({
  activity,
  onRequest,
  onRevise,
  onEdit,
  onSetValue,
}: {
  readonly activity: ActivityView;
  readonly onRequest: (id: string) => void;
  readonly onRevise: (id: string) => void;
  readonly onEdit: (activity: ActivityView) => void;
  readonly onSetValue: (activity: ActivityView, skill: ActivitySkillView) => void;
}) => {
  const log = useLogDialog();
  const event = useApiMutation('development', 'activityEvent');
  const observed = activity.interactions.filter((i) =>
    i.observations.some((o) => o.status === 'signed'),
  ).length;
  const menu = activity.actions.filter((a) => ACTIVITY_EVENT_LABEL[a]);
  return (
    <Collapsible defaultOpen={activity.interactions.length > 0 && activity.interactions.length < 4}>
      <div className="flex items-start gap-3 px-4 py-4 md:px-5">
        <CollapsibleTrigger className="group grid min-w-0 flex-1 cursor-pointer gap-1.5 text-left">
          <span className="flex items-center gap-2">
            <ChevronDownIcon className="size-4 shrink-0 text-ink-3 transition-transform group-data-[state=closed]:-rotate-90" />
            <span className="truncate text-ui font-medium text-ink">{activity.title}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 pl-6">
            {activity.skills.map((k) => (
              <SkillChip key={k.skill.id} name={k.skill.name} />
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
          {activity.actions.includes('LOG_INTERACTION') ? (
            <Button size="sm" variant="secondary" onClick={() => log.show(activity.id)}>
              Log
            </Button>
          ) : null}
          {menu.length > 0 || activity.canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Actions for this work">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {activity.canEdit ? (
                  <DropdownMenuItem onSelect={() => onEdit(activity)}>Edit work</DropdownMenuItem>
                ) : null}
                {menu.map((a) => (
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
        {activity.description ? (
          <p className="border-t border-line px-4 py-3 text-ui text-ink-2 md:px-5 md:pl-11">
            {activity.description}
          </p>
        ) : null}
        <WorkSkills activity={activity} onSetValue={(k) => onSetValue(activity, k)} />
        {activity.interactions.length > 0 ? (
          <ul className="divide-y divide-line border-t border-line px-4 md:px-5 md:pl-11">
            {activity.interactions.map((i) => (
              <InteractionRow
                key={i.id}
                interaction={i}
                onRequest={onRequest}
                onRevise={onRevise}
              />
            ))}
          </ul>
        ) : (
          <p className="border-t border-line px-4 py-3 text-ui text-ink-3 md:px-5 md:pl-11">
            Nothing logged here yet. After the next time you do this work, take a minute to note
            what you did.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

/** Where the plan's target stands: reviewed by a person, not a badge (levels 2 and 3 only). */
const TargetLine = ({ target }: { readonly target: FocusSkillView }) => (
  <p className="text-meta text-ink-2">
    Plan target: {target.targetLevelName.toLowerCase()}
    {target.targetHasBadge ? '' : ' (no badge at this level)'}.{' '}
    {target.highestObservedLevel === null
      ? 'Not observed yet.'
      : `Highest observed: ${levelName(target.highestObservedLevel).toLowerCase()}; ${
          target.observedAtTarget === 1
            ? 'one piece of work'
            : `${target.observedAtTarget} pieces of work`
        } observed at the target.`}
  </p>
);

export const ProgressBlock = ({
  progress,
  target,
}: {
  readonly progress: ProgressView;
  /** The plan's target for this skill, when it is a focus skill. */
  readonly target?: FocusSkillView | undefined;
}) => {
  const held = Math.max(0, ...progress.heldLevels);
  const subtitle = progress.targetLevelName
    ? `Next badge: ${progress.targetLevelName.toLowerCase()}`
    : 'Every badge held';
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
          <p className="text-meta text-ink-3">{subtitle}</p>
        </div>
      </div>
      {target ? <TargetLine target={target} /> : null}
      {progress.criteria.length > 0 ? (
        <CriteriaChecklist criteria={progress.criteria} nextStep={progress.nextStep} />
      ) : null}
    </div>
  );
};

/** The closing review as recorded, and whether it is confirmed. */
const ReviewSummary = ({
  focusSkills,
  closingSummary,
  review,
}: {
  readonly focusSkills: ReadonlyArray<FocusSkillView>;
  readonly closingSummary: string | null;
  readonly review: PlanView['review'];
}) =>
  review ? (
    <div className="grid gap-2">
      <ul className="grid gap-1 text-ui">
        {focusSkills.map((f) => (
          <li key={f.skill.id} className="flex flex-wrap gap-x-2">
            <span className="text-ink">{f.skill.name}</span>
            <span className="text-ink-2">
              {f.outcome ? OUTCOME_LABEL[f.outcome] : 'No outcome'}
            </span>
          </li>
        ))}
      </ul>
      {closingSummary ? <p className="narrative max-w-2xl text-ink">{closingSummary}</p> : null}
      <p className="text-meta text-ink-3">
        Recorded by {review.recordedBy.displayName}, {formatDate(review.recordedAt)}
        {review.confirmedBy && review.confirmedAt
          ? ` · Confirmed by ${review.confirmedBy.displayName}, ${formatDate(review.confirmedAt)}`
          : ' · Not confirmed yet'}
      </p>
    </div>
  ) : null;

const ConfirmReviewButton = ({ planId }: { readonly planId: PlanView['id'] }) => {
  const confirm = useApiMutation('development', 'confirmPlanReview', {
    onSuccess: () => toast.success('Review confirmed. It is now fixed.'),
  });
  return (
    <Button
      size="sm"
      variant="primary"
      disabled={confirm.isPending}
      onClick={() => confirm.mutate({ params: { id: planId } })}
    >
      Confirm review
    </Button>
  );
};

const ClosingReviewSection = ({
  plan,
  onRecord,
}: {
  readonly plan: PlanView;
  readonly onRecord: () => void;
}) =>
  plan.review || plan.canRecordReview || plan.canConfirmReview ? (
    <section className="grid content-start gap-3" aria-labelledby="closing-review">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel id="closing-review">Closing review</SectionLabel>
        <span className="flex items-center gap-2">
          {plan.canRecordReview ? (
            <Button variant="ghost" size="sm" onClick={onRecord}>
              {plan.review ? 'Change review' : 'Record closing review'}
            </Button>
          ) : null}
          {plan.canConfirmReview ? <ConfirmReviewButton planId={plan.id} /> : null}
        </span>
      </div>
      {plan.review ? (
        <ReviewSummary
          focusSkills={plan.focusSkills}
          closingSummary={plan.closingSummary}
          review={plan.review}
        />
      ) : (
        <p className="text-ui text-ink-3">
          When the plan ends, say what became of each focus skill. Your coach, or your leader if you
          have no coach, confirms it.
        </p>
      )}
    </section>
  ) : null;

/** "Try next time", then progress toward badges beside each plan target. */
const PlanAside = ({ plan }: { readonly plan: PlanView }) => (
  <aside className="grid content-start gap-6 lg:sticky lg:top-20" aria-labelledby="toward-badges">
    {plan.tryNextTime ? (
      <section className="grid gap-2" aria-labelledby="try-next-time">
        <SectionLabel id="try-next-time">Try next time</SectionLabel>
        <p className="narrative text-ink">{plan.tryNextTime.sentence}</p>
        <Link
          to="/observations/$id"
          params={{ id: plan.tryNextTime.observationId }}
          className="text-meta text-ink-3 underline-offset-2 hover:underline"
        >
          {plan.tryNextTime.observer.displayName}, {formatDate(plan.tryNextTime.signedAt)}
        </Link>
      </section>
    ) : null}
    <div className="grid gap-1">
      <SectionLabel id="toward-badges">Toward badges</SectionLabel>
      <p className="text-meta text-ink-3">{TARGET_NOTE}</p>
    </div>
    {plan.progress.map((p) => (
      <ProgressBlock
        key={p.skill.id}
        progress={p}
        target={plan.focusSkills.find((f) => f.skill.id === p.skill.id)}
      />
    ))}
  </aside>
);

const PlanBody = ({
  plan,
  onReview,
}: {
  readonly plan: PlanView;
  readonly onReview: (target: ReviewTarget) => void;
}) => {
  const [editingPlan, setEditingPlan] = useState(false);
  const [work, setWork] = useState<{ readonly activity: ActivityView | null } | null>(null);
  const [valuing, setValuing] = useState<{
    readonly activity: ActivityView;
    readonly skill: ActivitySkillView;
  } | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [revising, setRevising] = useState<string | null>(null);
  const review = (completing: boolean) =>
    onReview({
      planId: plan.id,
      focusSkills: plan.focusSkills,
      closingSummary: plan.closingSummary,
      completing,
    });
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
          <PlanActions
            plan={plan}
            onEdit={() => setEditingPlan(true)}
            onComplete={() => review(true)}
          />
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
        <div className="grid content-start gap-10">
          <section className="grid content-start gap-3" aria-labelledby="activities">
            <div className="flex items-center justify-between">
              <SectionLabel id="activities">Work</SectionLabel>
              {plan.canAddWork ? (
                <Button variant="ghost" size="sm" onClick={() => setWork({ activity: null })}>
                  <PlusIcon /> Add work
                </Button>
              ) : null}
            </div>
            {plan.activities.length > 0 ? (
              <Card className="divide-y divide-line">
                {plan.activities.map((a) => (
                  <ActivityRow
                    key={a.id}
                    activity={a}
                    onRequest={setRequesting}
                    onRevise={setRevising}
                    onEdit={(activity) => setWork({ activity })}
                    onSetValue={(activity, skill) => setValuing({ activity, skill })}
                  />
                ))}
              </Card>
            ) : (
              <EmptyState>
                Add the work that will develop these skills: meetings, reviews, conversations you
                already have.
              </EmptyState>
            )}
          </section>
          <ClosingReviewSection plan={plan} onRecord={() => review(false)} />
        </div>
        <PlanAside plan={plan} />
      </div>
      {plan.canEdit ? (
        <EditPlanDialog plan={plan} open={editingPlan} onClose={() => setEditingPlan(false)} />
      ) : null}
      <WorkDialog
        plan={plan}
        activity={work?.activity ?? null}
        open={work !== null}
        onClose={() => setWork(null)}
      />
      <SetValueDialog
        plan={plan}
        activity={valuing?.activity ?? null}
        skill={valuing?.skill ?? null}
        onClose={() => setValuing(null)}
      />
      <RequestObservationDialog interactionId={requesting} onClose={() => setRequesting(null)} />
      <ReviseEvidenceDialog interactionId={revising} onClose={() => setRevising(null)} />
    </>
  );
};

const PastPlans = ({
  plans,
  onReview,
}: {
  readonly plans: DevelopmentView['pastPlans'];
  readonly onReview: (target: ReviewTarget) => void;
}) => (
  <section className="mt-12 grid gap-3" aria-labelledby="past-plans">
    <SectionLabel id="past-plans">Past plans</SectionLabel>
    <ul className="divide-y divide-line">
      {plans.map((p) => (
        <li key={p.id} className="grid gap-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-ui">
            <span className="text-ink">{p.title}</span>
            <span className="flex flex-wrap items-center gap-3">
              <span className="text-meta text-ink-3">
                {formatDate(p.periodEnd, { year: 'numeric' })}
              </span>
              <StatusPill {...PLAN_STATUS[p.status]} />
              {p.canRecordReview ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onReview({
                      planId: p.id,
                      focusSkills: p.focusSkills,
                      closingSummary: p.closingSummary,
                      completing: false,
                    })
                  }
                >
                  {p.review ? 'Change review' : 'Record closing review'}
                </Button>
              ) : null}
              {p.canConfirmReview ? <ConfirmReviewButton planId={p.id} /> : null}
            </span>
          </div>
          <ReviewSummary
            focusSkills={p.focusSkills}
            closingSummary={p.closingSummary}
            review={p.review}
          />
        </li>
      ))}
    </ul>
  </section>
);

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
  // Held here, not in the plan, so completing the plan does not close the review midway.
  const [reviewing, setReviewing] = useState<ReviewTarget | null>(null);
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
          · Plan
        </p>
      ) : null}
      {development.plan ? (
        <PlanBody plan={development.plan} onReview={setReviewing} />
      ) : (
        <div className="grid max-w-2xl gap-6">
          <h1 className="font-serif text-h1 font-medium text-ink md:text-display">
            {self ? 'My plan' : `${first}’s plan`}
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
        <PastPlans plans={development.pastPlans} onReview={setReviewing} />
      ) : null}
      {self ? <CreatePlanDialog open={creating} onClose={() => setCreating(false)} /> : null}
      <ClosingReviewDialog target={reviewing} onClose={() => setReviewing(null)} />
    </Page>
  );
};
