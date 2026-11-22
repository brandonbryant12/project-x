import type { InboxItem, InboxView } from '@repo/api';
import {
  Button,
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
import { Link, useNavigate } from '@tanstack/react-router';
import { MessageSquarePlusIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Page, PageHeader, SkillChip } from '@/components/page.tsx';
import { formatDate } from '@/lib/format.ts';
import { OBSERVATION_STATUS } from '@/lib/lifecycle-presentation.ts';

export type InboxTab = 'requests' | 'drafts' | 'signed' | 'mine';

const WEEK = 7 * 86_400_000;

const rowActionLabel = (item: InboxItem, perspective: 'observer' | 'subject') => {
  if (perspective === 'subject') return 'View';
  if (item.status === 'requested') return 'Give feedback';
  if (item.status === 'drafting') return 'Continue';
  return 'View';
};

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
  const isActionable =
    perspective === 'observer' && (item.status === 'requested' || item.status === 'drafting');
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        data-inbox-row
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        className="flex w-full cursor-pointer flex-wrap items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-sunken/70 focus-visible:bg-sunken focus-visible:outline-none md:px-5"
      >
        <PersonAvatar person={person} size="md" />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <span className="text-ui font-semibold text-ink">
              {perspective === 'subject' ? `Asked ${person.displayName}` : person.displayName}
            </span>
            {item.status === 'signed' || item.status === 'under_review' ? (
              <span className="text-meta text-ink-3 tabular">
                Published {formatDate(item.updatedAt)}
              </span>
            ) : (
              <DueLabel dueAt={item.dueAt} />
            )}
          </span>
          <span className="truncate text-ui text-ink-2">
            {item.activityTitle} · {formatDate(item.occurredOn)}
          </span>
          {item.evidencePreview ? (
            <span className="line-clamp-1 text-meta text-ink-3">“{item.evidencePreview}”</span>
          ) : null}
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.skills.map((s) => (
              <SkillChip key={s.id} name={s.name} />
            ))}
            {perspective === 'subject' || item.status === 'drafting' ? (
              <StatusPill {...OBSERVATION_STATUS[item.status]} />
            ) : null}
          </span>
        </span>
        <Button
          size="sm"
          variant={isActionable ? 'primary' : 'secondary'}
          asChild
          onClick={(e) => e.stopPropagation()}
        >
          <Link to="/observations/$id" params={{ id: item.id }}>
            {rowActionLabel(item, perspective)}
          </Link>
        </Button>
      </div>
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
      {label ? <h2 className="text-meta font-semibold text-ink-3 uppercase">{label}</h2> : null}
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
        label={soon.length > 0 && later.length > 0 ? 'Due this week' : undefined}
        items={soon}
        perspective="observer"
      />
      <Group label={soon.length > 0 ? 'Later' : undefined} items={later} perspective="observer" />
    </div>
  );
};

/** J/K to move between rows, Enter to open; inactive while typing. */
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
        title="Feedback requests"
        description="Respond to advisors asking for feedback, finish saved drafts, or check requests you sent."
        actions={
          <Button variant="primary" asChild>
            <Link to="/observations/new">
              <MessageSquarePlusIcon /> Give feedback
            </Link>
          </Button>
        }
      />
      <div ref={ref}>
        <Tabs value={tab} onValueChange={(v) => onTab(v as InboxTab)}>
          <TabsList className="mb-6">
            <TabsTrigger value="requests">
              Waiting on you{counts.requests ? ` · ${counts.requests}` : ''}
            </TabsTrigger>
            <TabsTrigger value="drafts">
              Drafts{counts.drafts ? ` · ${counts.drafts}` : ''}
            </TabsTrigger>
            <TabsTrigger value="mine">
              Sent by you{counts.mine ? ` · ${counts.mine}` : ''}
            </TabsTrigger>
            <TabsTrigger value="signed">Published</TabsTrigger>
          </TabsList>
          <TabsContent value="requests">
            {inbox.requests.length > 0 ? (
              <ByUrgency items={inbox.requests} />
            ) : (
              <EmptyState
                action={
                  <Button variant="primary" size="sm" asChild>
                    <Link to="/observations/new">
                      <MessageSquarePlusIcon /> Give feedback
                    </Link>
                  </Button>
                }
              >
                You’re all caught up. If you watched someone handle a great client conversation, you
                can share feedback directly.
              </EmptyState>
            )}
          </TabsContent>
          <TabsContent value="drafts">
            {inbox.drafts.length > 0 ? (
              <Group items={inbox.drafts} perspective="observer" />
            ) : (
              <EmptyState>
                No saved drafts. Feedback you save for later appears here until you publish it.
              </EmptyState>
            )}
          </TabsContent>
          <TabsContent value="mine">
            {inbox.mine.length > 0 ? (
              <Group items={inbox.mine} perspective="subject" />
            ) : (
              <EmptyState>
                No open requests. After a client meeting, click Ask for feedback in the top bar.
              </EmptyState>
            )}
          </TabsContent>
          <TabsContent value="signed">
            {inbox.signed.length > 0 ? (
              <Group items={inbox.signed} perspective="observer" />
            ) : (
              <EmptyState>Feedback you publish appears here.</EmptyState>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Page>
  );
};
