import { INTERACTION_KINDS, LOG_WINDOW_DAYS, type InteractionKind } from '@repo/domain';
import {
  Button,
  Field,
  FieldHint,
  Input,
  Label,
  NativeSelect,
  SegmentedControl,
  SegmentedItem,
  Textarea,
  toast,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { RequestObservationDialog } from './request-observation-dialog.tsx';
import { useLogDialog } from '@/components/shell/log-dialog-context.tsx';
import { queryOptions, useApiMutation } from '@/lib/api.ts';
import { daysAgoIso, kindLabel, todayIso } from '@/lib/format.ts';

type When = 'today' | 'yesterday' | 'pick';

const WhenField = ({
  when,
  onWhen,
  pickedDate,
  onPickedDate,
}: {
  readonly when: When;
  readonly onWhen: (when: When) => void;
  readonly pickedDate: string;
  readonly onPickedDate: (date: string) => void;
}) => (
  <Field>
    <Label>When</Label>
    <SegmentedControl type="single" value={when} onValueChange={(v) => v && onWhen(v as When)}>
      <SegmentedItem value="today">Today</SegmentedItem>
      <SegmentedItem value="yesterday">Yesterday</SegmentedItem>
      <SegmentedItem value="pick">Pick</SegmentedItem>
    </SegmentedControl>
    {when === 'pick' ? (
      <Input
        type="date"
        aria-label="Date"
        min={daysAgoIso(LOG_WINDOW_DAYS)}
        max={todayIso()}
        value={pickedDate}
        onChange={(e) => onPickedDate(e.target.value)}
      />
    ) : null}
  </Field>
);

const KindField = ({
  kind,
  onKind,
}: {
  readonly kind: InteractionKind;
  readonly onKind: (kind: InteractionKind) => void;
}) => (
  <Field>
    <Label htmlFor="log-kind">Kind of work</Label>
    <NativeSelect
      id="log-kind"
      value={kind}
      onChange={(e) => onKind(e.target.value as InteractionKind)}
    >
      {INTERACTION_KINDS.map((k) => (
        <option key={k} value={k}>
          {kindLabel(k)}
        </option>
      ))}
    </NativeSelect>
  </Field>
);

/**
 * Log work I did (ux-brief §2): one screen, four fields, ~30 seconds.
 * Logging is self-report of the *event*; it never credits.
 */
export const LogInteractionDialog = () => {
  const dialog = useLogDialog();
  const development = useQuery({
    ...queryOptions('development', 'mine', undefined),
    enabled: dialog.open,
  });
  const activities = (development.data?.plan?.activities ?? []).filter(
    (a) => a.status === 'planned' || a.status === 'underway',
  );
  const [activityId, setActivityId] = useState<string>('');
  const [when, setWhen] = useState<When>('today');
  const [pickedDate, setPickedDate] = useState(todayIso());
  const [kind, setKind] = useState<InteractionKind>('client_meeting');
  const [reflection, setReflection] = useState('');
  const [adHocTitle, setAdHocTitle] = useState('');
  const selectedActivity = activityId || dialog.activityId || activities[0]?.id || '';
  const adHoc = selectedActivity === '' || selectedActivity === 'ad_hoc';

  const [thenRequest, setThenRequest] = useState(false);
  const [requestFor, setRequestFor] = useState<string | null>(null);
  const log = useApiMutation('development', 'logInteraction', {
    onSuccess: (interaction) => {
      setReflection('');
      setAdHocTitle('');
      dialog.hide();
      if (interaction.evidence?.status === 'held') {
        toast.info(
          'Held for privacy. It appears to include client details, so it hasn’t been shared. Revise it from your plan.',
        );
      } else if (thenRequest) {
        setRequestFor(interaction.id);
      } else {
        toast.success('Logged. Credit comes when someone who saw it signs.');
      }
    },
  });

  const occurredOn = { today: todayIso(), yesterday: daysAgoIso(1), pick: pickedDate }[when];
  const canSave = reflection.trim().length >= 10 && (!adHoc || adHocTitle.trim().length >= 3);
  const save = (request: boolean) => {
    setThenRequest(request);
    log.mutate({
      payload: {
        activityId: adHoc ? null : (selectedActivity as never),
        adHocTitle: adHoc ? adHocTitle.trim() : null,
        adHocSkillIds: [],
        occurredOn: occurredOn as never,
        kind,
        clientRef: null,
        reflection: reflection.trim(),
      },
    });
  };

  return (
    <>
      <RequestObservationDialog interactionId={requestFor} onClose={() => setRequestFor(null)} />
      <ResponsiveDialog
        open={dialog.open}
        onOpenChange={(o) => (o ? dialog.show(dialog.activityId) : dialog.hide())}
        title="Log work I did"
        description="Logging adds this to your plan. Credit comes when someone who saw it signs."
      >
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save(true);
          }}
        >
          <Field>
            <Label htmlFor="log-activity">Which work</Label>
            <NativeSelect
              id="log-activity"
              value={selectedActivity}
              onChange={(e) => setActivityId(e.target.value)}
            >
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
              <option value="ad_hoc">Something not in my plan</option>
            </NativeSelect>
            {adHoc ? (
              <Input
                aria-label="What was the work?"
                placeholder="What was the work? e.g. Annual review with a long-standing client"
                value={adHocTitle}
                onChange={(e) => setAdHocTitle(e.target.value)}
              />
            ) : null}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <WhenField
              when={when}
              onWhen={setWhen}
              pickedDate={pickedDate}
              onPickedDate={setPickedDate}
            />
            <KindField kind={kind} onKind={setKind} />
          </div>
          <Field>
            <Label htmlFor="log-reflection">What happened</Label>
            <Textarea
              id="log-reflection"
              rows={3}
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave) save(true);
              }}
            />
            <FieldHint>
              Describe what you did, not who the client was. No client names or account details.
            </FieldHint>
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => dialog.hide()}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!canSave || log.isPending}
              onClick={() => save(false)}
            >
              Save
            </Button>
            <Button type="submit" variant="primary" disabled={!canSave || log.isPending}>
              {log.isPending ? 'Saving…' : 'Save and ask someone who saw it'}
            </Button>
          </div>
        </form>
      </ResponsiveDialog>
    </>
  );
};
