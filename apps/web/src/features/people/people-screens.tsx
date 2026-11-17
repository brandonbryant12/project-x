import type { AiUsageView, AuditEventView, PersonCard } from '@repo/api';
import { BadgeSeal, Card, EmptyState, Input, NativeSelect, PersonChip, Pill } from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Page, PageHeader } from '@/components/page.tsx';
import { queryOptions } from '@/lib/api.ts';
import { formatDate, levelName } from '@/lib/format.ts';

/** People and skill search: "who can I learn from" across the firm. */
export const PeopleScreen = () => {
  const [q, setQ] = useState('');
  const [skillId, setSkillId] = useState('');
  const deferred = useDeferredValue(q);
  const skills = useQuery(queryOptions('catalog', 'skills', { query: {} }));
  const people = useQuery(
    queryOptions('people', 'search', {
      query: {
        ...(deferred ? { q: deferred } : {}),
        ...(skillId ? { skillId: skillId as never } : {}),
      },
    }),
  );
  const rows: ReadonlyArray<PersonCard> = people.data ?? [];
  return (
    <Page>
      <PageHeader
        title="People"
        description="Find colleagues, and who holds a badge you are working toward."
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <label className="relative block w-full max-w-sm">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
          />
          <Input
            aria-label="Search people"
            placeholder="Name or title"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </label>
        <NativeSelect
          aria-label="Holds a badge in"
          className="max-w-xs"
          value={skillId}
          onChange={(e) => setSkillId(e.target.value)}
        >
          <option value="">Any skill</option>
          {(skills.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              Holds a badge in {s.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {rows.length > 0 ? (
        <Card>
          <ul className="divide-y divide-line" aria-busy={people.isFetching}>
            {rows.map((p) => (
              <li key={p.person.id}>
                <Link
                  to="/people/$id"
                  params={{ id: p.person.id }}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-sunken md:px-5"
                >
                  <PersonChip person={p.person} size="md" className="min-w-56 flex-1" />
                  <span className="hidden w-48 truncate text-ui text-ink-2 md:block">
                    {[p.businessFunction, p.location].filter(Boolean).join(' · ')}
                  </span>
                  <span className="flex items-center gap-1">
                    {p.badges.slice(0, 6).map((b) => (
                      <BadgeSeal
                        key={`${b.skill.id}-${b.level}`}
                        level={b.level as 2 | 3 | 4}
                        domain={b.skill.domain}
                        size={24}
                        label={`${b.skill.name} · ${levelName(b.level)}`}
                      />
                    ))}
                  </span>
                  {p.relation && p.relation !== 'You' ? (
                    <Pill tone="outline">{p.relation}</Pill>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState>
          {people.isFetching ? 'Searching…' : 'No one matches. Try a different name or skill.'}
        </EmptyState>
      )}
    </Page>
  );
};

const usd = (n: number) =>
  n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: n < 1 ? 4 : 2,
  });
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
const latency = (ms: number | null) => (ms === null ? '—' : `${ms} ms`);

/** AI cost and quality for governance (ADR 0016). Plain table: auditors read numbers, not charts. */
export const AiUsageScreen = ({ usage }: { readonly usage: AiUsageView }) => (
  <Page>
    <PageHeader
      eyebrow="Governance"
      title="Assistant checks"
      description={`${usage.totalChecks} checks cost ${usd(usage.totalCostUsd)} from ${formatDate(usage.from)} to ${formatDate(usage.to, { year: 'numeric' })}. Disagreement is measured against human decisions, never against the model itself.`}
    />
    {usage.rows.length === 0 ? (
      <EmptyState>No assistant checks ran in this period.</EmptyState>
    ) : (
      <>
        <Card className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-ui">
            <thead>
              <tr className="border-b border-line text-meta text-ink-3">
                {[
                  'Day',
                  'Question set',
                  'Provider',
                  'Checks',
                  'Failed',
                  'Held or escalated',
                  'Tokens',
                  'Cost',
                  'p95 latency',
                  'Labels',
                  'Humans disagreed',
                ].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular">
              {usage.rows.map((r) => (
                <tr key={`${r.day}-${r.questionSet}-${r.provider}`}>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-2">{formatDate(r.day)}</td>
                  <td className="px-4 py-3 font-mono text-meta whitespace-nowrap text-ink">
                    {r.questionSet}
                  </td>
                  <td className="px-4 py-3 text-ink-2">{r.provider}</td>
                  <td className="px-4 py-3">{r.checks}</td>
                  <td className="px-4 py-3">{r.failed}</td>
                  <td className="px-4 py-3">{r.holds}</td>
                  <td className="px-4 py-3">{r.inputTokens.toLocaleString()}</td>
                  <td className="px-4 py-3">{usd(r.costUsd)}</td>
                  <td className="px-4 py-3">{latency(r.p95LatencyMs)}</td>
                  <td className="px-4 py-3">{r.labels}</td>
                  <td className="px-4 py-3">{pct(r.overrideRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {/* Phones: one block per row, every number labelled, nothing scrolls sideways. */}
        <Card className="md:hidden">
          <ul className="divide-y divide-line">
            {usage.rows.map((r) => (
              <li key={`${r.day}-${r.questionSet}-${r.provider}`} className="grid gap-3 px-4 py-4">
                <p className="flex flex-wrap items-baseline gap-x-2 text-ui">
                  <span className="font-mono text-meta text-ink">{r.questionSet}</span>
                  <span className="text-meta text-ink-3">
                    {formatDate(r.day)} · {r.provider}
                  </span>
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-ui tabular">
                  {(
                    [
                      ['Checks', r.checks],
                      ['Failed', r.failed],
                      ['Held or escalated', r.holds],
                      ['Tokens', r.inputTokens.toLocaleString()],
                      ['Cost', usd(r.costUsd)],
                      ['p95 latency', latency(r.p95LatencyMs)],
                      ['Labels', r.labels],
                      ['Humans disagreed', pct(r.overrideRate)],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="grid">
                      <dt className="text-meta text-ink-3">{label}</dt>
                      <dd className="text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </Card>
      </>
    )}
  </Page>
);

export const AuditScreen = ({ events }: { readonly events: ReadonlyArray<AuditEventView> }) => {
  const [filter, setFilter] = useState('');
  const visible = events.filter((e) =>
    `${e.entityType} ${e.event} ${e.actor?.displayName ?? 'system'}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <Page>
      <PageHeader
        eyebrow="Governance"
        title="Audit trail"
        description="Who did what, when, why and under which rules. Reading this page is itself recorded."
        actions={
          <Input
            aria-label="Filter"
            placeholder="Filter by entity, event or person"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-72"
          />
        }
      />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-ui">
          <thead>
            <tr className="border-b border-line text-meta text-ink-3">
              {['When', 'Who', 'What', 'Change', 'Why', 'Policy'].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {visible.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-3 whitespace-nowrap text-ink-2 tabular">
                  {new Date(e.at).toLocaleString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="px-4 py-3">
                  {e.actor ? (
                    <PersonChip person={e.actor} size="xs" />
                  ) : (
                    <span className="text-ink-3">System</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-ink">{e.event}</span>
                  <span className="block font-mono text-meta text-ink-3">
                    {e.entityType} · {e.entityId}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-2">
                  {e.fromState || e.toState ? `${e.fromState ?? '∅'} → ${e.toState ?? '∅'}` : '—'}
                </td>
                <td className="max-w-72 px-4 py-3 text-ink-2">{e.reason ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-meta text-ink-3">
                  {e.policyVersion ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
};
