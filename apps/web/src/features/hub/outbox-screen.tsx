import type { OutboxRow } from '@repo/api';
import type { NotificationKind } from '@repo/domain';
import {
  Card,
  EmptyState,
  PersonChip,
  SegmentedControl,
  SegmentedItem,
  StatusPill,
  type Tone,
} from '@repo/ui';
import { useState } from 'react';
import { Page, PageHeader } from '@/components/page.tsx';

const STATUS: Record<OutboxRow['status'], { readonly label: string; readonly tone: Tone }> = {
  pending: { label: 'Waiting to send', tone: 'info' },
  sent: { label: 'Sent', tone: 'success' },
  skipped: { label: 'Not sent', tone: 'muted' },
  failed: { label: 'Failed', tone: 'warning' },
};

const KIND: Record<NotificationKind, string> = {
  observation_requested: 'Request to observe',
  observation_signed: 'Observation signed',
  observation_returned: 'Observation returned',
  plan_proposed: 'Plan proposed',
  engagement_proposed: 'Coaching proposed',
  request_expiring: 'Request closing soon',
  weekly_digest: 'Weekly digest',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/** The message exactly as the template rendered it: subject, lines, one link. */
const Rendered = ({ rendered }: { readonly rendered: OutboxRow['rendered'] }) => (
  <div className="grid gap-1.5 rounded-control border border-line bg-sunken px-4 py-3">
    <p className="text-ui font-medium text-ink">{rendered.subject}</p>
    {rendered.lines.map((line, i) => (
      <p key={i} className="text-ui text-ink-2">
        {line}
      </p>
    ))}
    <p className="font-mono text-meta break-all text-primary-ink">{rendered.link}</p>
  </div>
);

/**
 * What the outbox sent (ADR 0018), for tenant admins. A notification row has
 * no free text: what is shown is the template's output, as delivered (I20).
 */
type Filter = 'all' | OutboxRow['status'];

export const OutboxScreen = ({ rows }: { readonly rows: ReadonlyArray<OutboxRow> }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const count = (f: Filter) =>
    f === 'all' ? rows.length : rows.filter((r) => r.status === f).length;
  return (
    <Page width="reading">
      <PageHeader
        eyebrow="Governance"
        title="Notifications sent"
        description="Each message as it was delivered. They carry names, dates and one link, never what anyone wrote."
      />
      {rows.length > 0 ? (
        <SegmentedControl
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          aria-label="Show"
          className="mb-4 flex-wrap"
        >
          {(['all', 'sent', 'skipped', 'pending', 'failed'] as const).map((f) => (
            <SegmentedItem key={f} value={f}>
              {f === 'all' ? 'All' : STATUS[f].label}{' '}
              <span className="text-ink-3 tabular">{count(f)}</span>
            </SegmentedItem>
          ))}
        </SegmentedControl>
      ) : null}
      {visible.length === 0 ? (
        <EmptyState>
          {rows.length === 0 ? 'Nothing has been sent yet.' : 'Nothing in this view.'}
        </EmptyState>
      ) : (
        <Card>
          <ol className="divide-y divide-line">
            {visible.map((r, i) => (
              <li key={`${r.createdAt}-${i}`} className="grid gap-3 px-4 py-4 md:px-5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <PersonChip person={r.recipient} size="xs" />
                  <span className="flex flex-wrap items-center gap-2 text-meta text-ink-3">
                    {KIND[r.kind]}
                    {r.channel ? ` · ${r.channel}` : ''} · {when(r.sentAt ?? r.createdAt)}
                    <StatusPill {...STATUS[r.status]} />
                  </span>
                </div>
                <Rendered rendered={r.rendered} />
              </li>
            ))}
          </ol>
        </Card>
      )}
    </Page>
  );
};
