import type { ActivitySkillView, ActivityView, PlanView } from '@repo/api';
import { Button, Field, FieldHint, Input, Label, Textarea, toast } from '@repo/ui';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { useApiMutation } from '@/lib/api.ts';
import { formatDateTime } from '@/lib/format.ts';

/** Where a value comes from, in plain words. */
export const VALUE_SOURCE: Record<ActivitySkillView['value']['source'], string> = {
  activity: 'set for this work',
  template: 'from the template',
  skill: 'the skill’s value',
  tenant: 'the standard value',
};

/**
 * Set or clear one skill's value on planned work. Offered only when the view
 * says the viewer may (`activity.canSetValue`): the owner's coach or a program
 * owner, before the work is observed. The reason is kept with the change.
 */
export const SetValueDialog = ({
  plan,
  activity,
  skill,
  onClose,
}: {
  readonly plan: PlanView;
  readonly activity: ActivityView | null;
  readonly skill: ActivitySkillView | null;
  readonly onClose: () => void;
}) => (
  <ResponsiveDialog
    open={activity !== null && skill !== null}
    onOpenChange={(o) => !o && onClose()}
    title={skill ? `Value of ${skill.skill.name}` : 'Value'}
    description="Set before the work is observed. It applies only to work logged from now on and done today or later, never to work already logged."
  >
    {activity && skill && plan.valueRange ? (
      <ValueForm activity={activity} skill={skill} range={plan.valueRange} onClose={onClose} />
    ) : null}
  </ResponsiveDialog>
);

const ValueForm = ({
  activity,
  skill,
  range,
  onClose,
}: {
  readonly activity: ActivityView;
  readonly skill: ActivitySkillView;
  readonly range: NonNullable<PlanView['valueRange']>;
  readonly onClose: () => void;
}) => {
  const [points, setPoints] = useState(String(skill.override?.points ?? skill.value.points));
  const [reason, setReason] = useState('');
  const save = useApiMutation('development', 'setActivityValue', {
    onSuccess: (_d, v) => {
      toast.success(v.payload.points === null ? 'Value cleared.' : 'Value set.');
      onClose();
    },
  });
  const n = Number(points);
  const inRange = Number.isInteger(n) && n >= range.min && n <= range.max;
  const explained = reason.trim().length >= 10;
  const send = (value: number | null) =>
    save.mutate({
      params: { id: activity.id },
      payload: {
        version: activity.version,
        skillId: skill.skill.id,
        points: value,
        reason: reason.trim(),
      },
    });
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (inRange && explained) send(n);
      }}
    >
      <p className="text-ui text-ink-2">
        In “{activity.title}”, {skill.skill.name} is {skill.role}. Without a value of its own, one
        observation adds {skill.valueWithoutOverride.points} points (
        {VALUE_SOURCE[skill.valueWithoutOverride.source]}).
        {skill.override
          ? ` The current value of ${skill.override.points} applies to work logged from ${formatDateTime(skill.override.setAt)}. If you change or clear it, work already logged gets ${skill.valueWithoutOverride.points} points when observed; a new value applies only to work logged from now on.`
          : ''}
      </p>
      <Field>
        <Label htmlFor="value-points">Points for one observation</Label>
        <Input
          id="value-points"
          type="number"
          inputMode="numeric"
          className="w-32"
          min={range.min}
          max={range.max}
          step={1}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
        <FieldHint>
          From {range.min} to {range.max}.
        </FieldHint>
      </Field>
      <Field>
        <Label htmlFor="value-reason">Why this work is worth that</Label>
        <Textarea
          id="value-reason"
          rows={3}
          maxLength={600}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <FieldHint>
          At least 10 characters. Kept with the change; the coachee sees who set it.
        </FieldHint>
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {skill.override ? (
          <Button
            type="button"
            variant="secondary"
            disabled={!explained || save.isPending}
            onClick={() => send(null)}
          >
            Clear value
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={!inRange || !explained || save.isPending}>
          {save.isPending ? 'Saving…' : 'Set value'}
        </Button>
      </div>
    </form>
  );
};
