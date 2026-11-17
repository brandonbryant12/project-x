import type { NotificationPreferences } from '@repo/api';
import type { NotificationChannel } from '@repo/domain';
import { Button, Card, cn, toast } from '@repo/ui';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader } from '@/components/page.tsx';
import { useApiMutation } from '@/lib/api.ts';
import { useSession } from '@/lib/session.ts';

const CHANNELS: ReadonlyArray<{
  readonly value: NotificationChannel;
  readonly label: string;
  readonly hint: (email: string) => string;
}> = [
  { value: 'email', label: 'Email', hint: (email) => `To ${email}.` },
  { value: 'teams', label: 'Teams', hint: () => 'In your Teams activity feed.' },
  {
    value: 'off',
    label: 'Off',
    hint: () => 'Nothing is sent. Everything still waits for you on Home.',
  },
];

const Section = ({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
}) => (
  <section className="grid gap-4 border-b border-line py-6 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-8">
    <div className="grid content-start gap-1">
      <h2 className="text-ui font-medium text-ink">{title}</h2>
      <p className="text-meta text-ink-3">{description}</p>
    </div>
    <div>{children}</div>
  </section>
);

/** Notification preferences (ADR 0018). Each change saves on its own; nothing to submit. */
export const PreferencesScreen = ({ saved }: { readonly saved: NotificationPreferences }) => {
  const session = useSession();
  const [prefs, setPrefs] = useState(saved);
  const [status, setStatus] = useState('');
  const update = useApiMutation('hub', 'updatePreferences', {
    invalidates: ['hub', 'support'],
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
        <Section
          title="Where to send"
          description="Requests to observe you, observations signed or returned, proposals, and a reminder two days before a request closes."
        >
          <div role="radiogroup" aria-label="Where to send" className="grid gap-2">
            {CHANNELS.map((c) => (
              <label
                key={c.value}
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5 transition-colors',
                  prefs.channel === c.value
                    ? 'border-primary bg-primary-soft/40'
                    : 'border-line hover:bg-sunken',
                )}
              >
                <input
                  type="radio"
                  name="channel"
                  className="mt-1 size-4 shrink-0 accent-(--color-primary)"
                  checked={prefs.channel === c.value}
                  onChange={() => change({ channel: c.value })}
                />
                <span className="grid">
                  <span className="text-ui font-medium text-ink">{c.label}</span>
                  <span className="text-meta text-ink-3">{c.hint(session.email)}</span>
                </span>
              </label>
            ))}
          </div>
        </Section>
        <Section
          title="Weekly digest"
          description="Monday morning, in your firm's time zone. Numbers and dates, one link per line. Skipped when there is nothing to say."
        >
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-ui text-ink">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-(--color-primary)"
              checked={prefs.weeklyDigest}
              disabled={prefs.channel === 'off'}
              onChange={(e) => change({ weeklyDigest: e.target.checked })}
            />
            Send me the weekly digest
          </label>
          {prefs.channel === 'off' ? (
            <p className="text-meta text-ink-3">Choose email or Teams to receive it.</p>
          ) : null}
        </Section>
        {session.relations.canObserve ? (
          <Section
            title="People to observe each week"
            description="Home suggests up to this many people a week, each with a reason. It is your own pace, never a target anyone else sees."
          >
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="icon"
                className="size-11 md:size-9"
                aria-label="Fewer"
                disabled={prefs.observeCapacity <= 0}
                onClick={() => change({ observeCapacity: prefs.observeCapacity - 1 })}
              >
                <MinusIcon />
              </Button>
              <output
                aria-live="polite"
                className="w-8 text-center text-h2 font-semibold text-ink tabular"
              >
                {prefs.observeCapacity}
              </output>
              <Button
                variant="secondary"
                size="icon"
                className="size-11 md:size-9"
                aria-label="More"
                disabled={prefs.observeCapacity >= 10}
                onClick={() => change({ observeCapacity: prefs.observeCapacity + 1 })}
              >
                <PlusIcon />
              </Button>
              <span className="text-ui text-ink-2">
                {prefs.observeCapacity === 1 ? 'person' : 'people'} a week
              </span>
            </div>
          </Section>
        ) : null}
      </Card>
    </Page>
  );
};
