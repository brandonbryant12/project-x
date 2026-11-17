import type { NotificationPreferences } from '@repo/api';
import { Card, toast } from '@repo/ui';
import { useState } from 'react';
import { Page, PageHeader } from '@/components/page.tsx';
import { useApiMutation } from '@/lib/api.ts';
import { useSession } from '@/lib/session.ts';

const Toggle = ({
  title,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) => (
  <label className="flex min-h-11 cursor-pointer items-start gap-3 border-b border-line py-5 last:border-b-0 has-disabled:cursor-default">
    <input
      type="checkbox"
      className="mt-1 size-4 shrink-0 accent-(--color-primary)"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="grid gap-0.5">
      <span className="text-ui font-medium text-ink">{title}</span>
      <span className="text-meta text-ink-3">{description}</span>
    </span>
  </label>
);

/** Notification preferences (ADR 0018). Each change saves on its own; nothing to submit. */
export const PreferencesScreen = ({ saved }: { readonly saved: NotificationPreferences }) => {
  const session = useSession();
  const [prefs, setPrefs] = useState(saved);
  const [status, setStatus] = useState('');
  const update = useApiMutation('hub', 'updatePreferences', {
    invalidates: ['hub'],
    onSuccess: () => setStatus('Saved'),
    onError: () => {
      setPrefs(saved);
      setStatus('');
      toast.error('Not saved. Your previous choice is kept.');
    },
  });
  const change = (patch: Partial<NotificationPreferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setStatus('Saving…');
    update.mutate({ payload: next });
  };
  return (
    <Page width="reading">
      <PageHeader
        title="Notifications"
        description="What reaches you outside the app. A message carries a name, a date and one link; never what anyone wrote."
      />
      <p aria-live="polite" className="-mt-4 mb-2 h-5 text-meta text-ink-3">
        {status}
      </p>
      <Card className="px-5 md:px-6">
        <Toggle
          title="Email me when something waits on me"
          description={`To ${session.email}: requests to observe you, observations signed or returned, proposals, and a reminder two days before a request closes. When off, everything still waits for you on Home.`}
          checked={prefs.sendEmail}
          onChange={(sendEmail) => change({ sendEmail })}
        />
        <Toggle
          title="Send me the weekly digest"
          description={
            prefs.sendEmail
              ? "Monday morning, in your firm's time zone. Numbers and dates, one link per line. Skipped when there is nothing to say."
              : 'Turn on email to receive it.'
          }
          checked={prefs.weeklyDigest && prefs.sendEmail}
          disabled={!prefs.sendEmail}
          onChange={(weeklyDigest) => change({ weeklyDigest })}
        />
      </Card>
    </Page>
  );
};
