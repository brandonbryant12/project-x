import type { FocusSkillView, PlanOutcome } from '@repo/api';
import { PLAN_OUTCOMES, type PlanId } from '@repo/domain';
import { Button, Field, FieldHint, Label, NativeSelect, Textarea, toast } from '@repo/ui';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { useApiMutation } from '@/lib/api.ts';

export const OUTCOME_LABEL: Record<PlanOutcome, string> = {
  achieved: 'Achieved',
  partly: 'Partly',
  carried_over: 'Carried over to my next plan',
  not_pursued: 'Not pursued',
};

export interface ReviewTarget {
  readonly planId: PlanId;
  readonly focusSkills: ReadonlyArray<FocusSkillView>;
  readonly closingSummary: string | null;
  /** Completing the plan in the same step (the owner chose "Complete plan"). */
  readonly completing: boolean;
}

/**
 * The closing review: what became of each focus skill, in the owner's words.
 * A person's judgement: it is never worked out from badges and earns nothing.
 * The owner may record it again until their coach (or leader) confirms it.
 */
export const ClosingReviewDialog = ({
  target,
  onClose,
}: {
  readonly target: ReviewTarget | null;
  readonly onClose: () => void;
}) => (
  <ResponsiveDialog
    open={target !== null}
    onOpenChange={(o) => !o && onClose()}
    title={target?.completing ? 'Complete plan' : 'Closing review'}
    description="Say what became of each focus skill. Your coach, or your leader if you have no coach, confirms it; after that it is fixed. It does not change your record or badges."
  >
    {target ? <ReviewForm target={target} onClose={onClose} /> : null}
  </ResponsiveDialog>
);

const ReviewForm = ({
  target,
  onClose,
}: {
  readonly target: ReviewTarget;
  readonly onClose: () => void;
}) => {
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, PlanOutcome | ''>>>(
    Object.fromEntries(target.focusSkills.map((f) => [f.skill.id, f.outcome ?? ''])),
  );
  const [summary, setSummary] = useState(target.closingSummary ?? '');
  const complete = useApiMutation('development', 'planEvent');
  const record = useApiMutation('development', 'recordPlanReview');
  const pending = complete.isPending || record.isPending;
  const valid =
    summary.trim().length > 0 && target.focusSkills.every((f) => outcomes[f.skill.id] !== '');

  const submit = async (withReview: boolean) => {
    try {
      // Recorded first, while the plan is open; recording again is allowed, so a retry is safe.
      if (withReview) {
        await record.mutateAsync({
          params: { id: target.planId },
          payload: {
            outcomes: target.focusSkills.map((f) => ({
              skillId: f.skill.id,
              outcome: outcomes[f.skill.id] as PlanOutcome,
            })),
            summary: summary.trim(),
          },
        });
      }
      if (target.completing) {
        await complete.mutateAsync({
          params: { id: target.planId },
          payload: { event: 'COMPLETE' },
        });
      }
      if (!target.completing) toast.success('Closing review recorded.');
      else if (withReview) toast.success('Plan completed. Your coach can now confirm the review.');
      else toast.success('Plan completed.');
      onClose();
    } catch {
      // The failed request has already been reported; the dialog stays open.
    }
  };

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void submit(true);
      }}
    >
      <div className="grid gap-3">
        {target.focusSkills.map((f) => (
          <Field key={f.skill.id}>
            <Label htmlFor={`outcome-${f.skill.id}`}>
              {f.skill.name}
              <span className="font-normal text-ink-3">
                {' '}
                · aimed for {f.targetLevelName.toLowerCase()}
              </span>
            </Label>
            <NativeSelect
              id={`outcome-${f.skill.id}`}
              value={outcomes[f.skill.id] ?? ''}
              onChange={(e) =>
                setOutcomes((all) => ({ ...all, [f.skill.id]: e.target.value as PlanOutcome }))
              }
            >
              <option value="" disabled>
                Choose an outcome
              </option>
              {PLAN_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ))}
      </div>
      <Field>
        <Label htmlFor="review-summary">Looking back</Label>
        <Textarea
          id="review-summary"
          rows={4}
          maxLength={2000}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <FieldHint>
          What changed in your work, and what you would do next. No client details.
        </FieldHint>
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {target.completing ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void submit(false)}
          >
            Complete without a review
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={!valid || pending}>
          {target.completing ? 'Complete plan' : 'Record review'}
        </Button>
      </div>
    </form>
  );
};
