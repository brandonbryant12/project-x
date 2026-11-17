import type { InboxItem, InboxView } from '@repo/api';
import {
  Card,
  DueLabel,
  EmptyState,
  PersonAvatar,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@repo/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Page, PageHeader, SkillChip } from '@/components/page.tsx';
import { formatDate } from '@/lib/format.ts';
import { OBSERVATION_STATUS } from '@/lib/lifecycle-presentation.ts';

export type InboxTab = 'requests' | 'drafts' | 'signed' | 'mine';

const WEEK = 7 * 86_400_000;

const Row = ({
  item,
  perspective,
}: {
  readonly item: InboxItem;
  readonly perspective: 'observer' | 'subject';
}) => {
  const navigate = useNavigate();
  const person = perspective === 'observer' ? item.subject : item.observer;
  const open = () => void navigate({ to: '/observations/$id', params: { id: item.id } });
  return (
    <li>
      <button
        type="button"
        data-inbox-row
        onClick={open}
        className="flex w-full cursor-pointer items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none md:px-5"
      >
        <PersonAvatar person={person} size="md" />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-ui font-medium text-ink">
              {perspective === 'subject' ? `Asked ${person.displayName}` : person.displayName}
            </span>
            {item.status === 'signed' || item.status === 'under_review' ? (
              <span className="text-meta text-ink-3 tabular">
                Signed {formatDate(item.updatedAt)}
              </span>
            ) : (
              <DueLabel dueAt={item.dueAt} />
            )}
          </span>
          <span className="truncate text-ui text-ink-2">
            {item.activityTitle} · {formatDate(item.occurredOn)}
          </span>
          {item.evidencePreview ? (
            <span className="line-clamp-1 text-meta text-ink-3">{item.evidencePreview}</span>
          ) : null}
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.skills.map((s) => (
              <SkillChip key={s.id} name={s.name} />
            ))}
            {item.status === 'drafting' && item.indicatorsTicked > 0 ? (
              <span className="text-meta text-ink-3">
                · {item.indicatorsTicked} indicators ticked
              </span>
            ) : null}
            {perspective === 'subject' || item.status === 'drafting' ? (
              <StatusPill {...OBSERVATION_STATUS[item.status]} className="ml-auto" />
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
};

const Group = ({
  label,
  items,
  perspective,
}: {
  readonly label?: string | undefined;
  readonly items: ReadonlyArray<InboxItem>;
  readonly perspective: 'observer' | 'subject';
}) =>
  items.length === 0 ? null : (
    <section className="grid gap-2">
      {label ? <h2 className="text-meta font-medium text-ink-3">{label}</h2> : null}
      <Card>
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <Row key={item.id} item={item} perspective={perspective} />
          ))}
        </ul>
      </Card>
    </section>
  );

const ByUrgency = ({ items }: { readonly items: ReadonlyArray<InboxItem> }) => {
  const [now] = useState(() => Date.now());
  const soon = items.filter((i) => new Date(i.dueAt).getTime() - now < WEEK);
  const later = items.filter((i) => !soon.includes(i));
  return (
    <div className="grid gap-6">
      <Group
        label={soon.length > 0 && later.length > 0 ? 'Closing this week' : undefined}
        items={soon}
        perspective="observer"
      />
      <Group label={soon.length > 0 ? 'Later' : undefined} items={later} perspective="observer" />
    </div>
  );
};

/** J/K to move between rows, Enter to open (ux-brief §3); inactive while typing. */
const useRowKeys = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      const rows = [...(ref.current?.querySelectorAll<HTMLElement>('[data-inbox-row]') ?? [])];
      if (rows.length === 0) return;
      const index = rows.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'j' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
      rows[index === -1 ? 0 : next]?.focus();
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return ref;
};

export const InboxScreen = ({
  inbox,
  tab,
  onTab,
}: {
  readonly inbox: InboxView;
  readonly tab: InboxTab;
  readonly onTab: (tab: InboxTab) => void;
}) => {
  const ref = useRowKeys();
  const counts = {
    requests: inbox.requests.length,
    drafts: inbox.drafts.length,
    signed: inbox.signed.length,
    mine: inbox.mine.length,
  };
  return (
    <Page width="reading">
      <PageHeader
        title="To sign"
        description="Observations waiting for your signature, and the ones you have asked for."
      />
      <div ref={ref}>
        <Tabs value={tab} onValueChange={(v) => onTab(v as InboxTab)}>
          <TabsList className="mb-6">
            <TabsTrigger value="requests">
              Requests{counts.requests ? ` · ${counts.requests}` : ''}
            </TabsTrigger>
            <TabsTrigger value="drafts">
              Drafts{counts.drafts ? ` · ${counts.drafts}` : ''}
            </TabsTrigger>
            <TabsTrigger value="signed">Signed</TabsTrigger>
            <TabsTrigger value="mine">
              Asked by you{counts.mine ? ` · ${counts.mine}` : ''}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="requests">
            {inbox.requests.length > 0 ? (
              <ByUrgency items={inbox.requests} />
            ) : (
              <EmptyState>
                You’re all caught up. If you saw someone do good work today, you can start an
                observation yourself.
              </EmptyState>
            )}
          </TabsContent>
          <TabsContent value="drafts">
            {inbox.drafts.length > 0 ? (
              <Group items={inbox.drafts} perspective="observer" />
            ) : (
              <EmptyState>
                No drafts. Observations you start are kept here until you sign them.
              </EmptyState>
            )}
          </TabsContent>
          <TabsContent value="signed">
            {inbox.signed.length > 0 ? (
              <Group items={inbox.signed} perspective="observer" />
            ) : (
              <EmptyState>Observations you sign appear here.</EmptyState>
            )}
          </TabsContent>
          <TabsContent value="mine">
            {inbox.mine.length > 0 ? (
              <Group items={inbox.mine} perspective="subject" />
            ) : (
              <EmptyState>
                Nothing you asked for is waiting. After your next client meeting, log it and ask
                someone who saw it.
              </EmptyState>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Page>
  );
};
