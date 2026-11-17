import type { SkillCard, SkillDetail, TemplateCard } from '@repo/api';
import { SKILL_DOMAINS } from '@repo/domain';
import {
  BadgeSeal,
  Card,
  EmptyState,
  Input,
  PersonChip,
  Pill,
  SectionLabel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@repo/ui';
import { Link } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader, SkillChip } from '@/components/page.tsx';
import { domainLabel, kindLabel, levelName } from '@/lib/format.ts';
import { ProgressBlock } from '@/features/development/development-screen.tsx';
import { useSession } from '@/lib/session.ts';

const Search = ({
  value,
  onChange,
  label,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly label: string;
}) => (
  <label className="relative block max-w-sm">
    <SearchIcon
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
    />
    <Input
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="pl-9"
    />
  </label>
);

const SkillRow = ({ skill }: { readonly skill: SkillCard }) => (
  <li>
    <Link
      to="/catalog/skills/$slug"
      params={{ slug: skill.slug }}
      className="flex items-start gap-4 px-4 py-4 transition-colors hover:bg-sunken md:px-5"
    >
      <BadgeSeal
        level={(skill.myHighestLevel ?? 0) as 0 | 2 | 3 | 4}
        domain={skill.domain}
        size={40}
      />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-ui font-medium text-ink">{skill.name}</span>
          {skill.inMyPlan ? <Pill tone="primary">In your plan</Pill> : null}
        </span>
        <span className="text-ui text-ink-2">{skill.summary}</span>
        <span className="text-meta text-ink-3">
          Serves {skill.outcome.toLowerCase()} ·{' '}
          {skill.holderCount === 0
            ? 'No one holds a badge yet'
            : `${skill.holderCount} ${skill.holderCount === 1 ? 'person holds' : 'people hold'} a badge`}
        </span>
      </span>
    </Link>
  </li>
);

export const SkillsScreen = ({ skills }: { readonly skills: ReadonlyArray<SkillCard> }) => {
  const [q, setQ] = useState('');
  const match = (s: SkillCard) =>
    `${s.name} ${s.summary} ${s.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase());
  const visible = skills.filter(match);
  const domains = SKILL_DOMAINS.filter((d) => visible.some((s) => s.domain === d));
  return (
    <Page>
      <PageHeader
        title="Skills"
        description="The capabilities that matter here, and what each looks like at every level. Everyone sees the same catalog."
        actions={<Search value={q} onChange={setQ} label="Find a skill" />}
      />
      {domains.length === 0 ? <EmptyState>No skills match “{q}”.</EmptyState> : null}
      <div className="grid gap-8 lg:grid-cols-2">
        {domains.map((d) => (
          <section key={d} className="grid content-start gap-2">
            <SectionLabel>{domainLabel(d)}</SectionLabel>
            <Card>
              <ul className="divide-y divide-line">
                {visible
                  .filter((s) => s.domain === d)
                  .map((s) => (
                    <SkillRow key={s.id} skill={s} />
                  ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </Page>
  );
};

const TemplateRow = ({ template }: { readonly template: TemplateCard }) => (
  <li className="grid gap-2 px-4 py-4 md:px-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-ui font-medium text-ink">{template.name}</h3>
      <span className="text-meta text-ink-3">
        {kindLabel(template.kind)}
        {template.typicalMinutes ? ` · about ${template.typicalMinutes} min` : ''}
      </span>
    </div>
    <p className="text-ui text-ink-2">{template.description}</p>
    <div className="flex flex-wrap items-center gap-1.5">
      {template.suggestedSkills.map((s) => (
        <SkillChip key={s.id} name={s.name} />
      ))}
    </div>
    {template.observationTip ? (
      <p className="text-meta text-ink-3">
        <span className="font-medium text-ink-2">For the observer: </span>
        {template.observationTip}
      </p>
    ) : null}
  </li>
);

export const SkillScreen = ({ skill }: { readonly skill: SkillDetail }) => {
  const session = useSession();
  // "Who can I learn from" means other people; "Teaching others" first.
  const holders = skill.holders
    .filter((h) => h.person.id !== session.person.id)
    .toSorted((a, b) => b.level - a.level);
  return (
    <Page>
      <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-center">
        <BadgeSeal
          level={(skill.myHighestLevel ?? 0) as 0 | 2 | 3 | 4}
          domain={skill.domain}
          size={64}
        />
        <div className="grid gap-1.5">
          <p className="text-meta text-ink-3">
            {domainLabel(skill.domain)} · serves {skill.outcome.toLowerCase()}
          </p>
          <h1 className="font-serif text-h1 font-medium text-ink md:text-display">{skill.name}</h1>
          <p className="max-w-2xl text-body text-ink-2">{skill.summary}</p>
        </div>
      </header>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-12">
          <section className="grid gap-4" aria-labelledby="levels">
            <SectionLabel id="levels">What it looks like</SectionLabel>
            <Tabs defaultValue="3">
              <TabsList className="flex-wrap">
                {skill.levels.map((l) => (
                  <TabsTrigger key={l.level} value={String(l.level)}>
                    {levelName(l.level)}
                  </TabsTrigger>
                ))}
              </TabsList>
              {skill.levels.map((l) => (
                <TabsContent key={l.level} value={String(l.level)} className="pt-5">
                  <p className="narrative text-ink">{l.summary}</p>
                  <ul className="mt-4 grid gap-2.5">
                    {l.indicators.map((i) => (
                      <li key={i.id} className="flex gap-3 text-body text-ink-2">
                        <span
                          aria-hidden
                          className="mt-2.5 size-1 shrink-0 rounded-full bg-ink-3"
                        />
                        {i.text}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-meta text-ink-3">
                    These are the behaviors an observer looks for.
                  </p>
                </TabsContent>
              ))}
            </Tabs>
          </section>
          <section className="grid gap-3" aria-labelledby="templates">
            <SectionLabel id="templates">Work that builds this</SectionLabel>
            {skill.templates.length > 0 ? (
              <Card>
                <ul className="divide-y divide-line">
                  {skill.templates.map((t) => (
                    <TemplateRow key={t.id} template={t} />
                  ))}
                </ul>
              </Card>
            ) : (
              <p className="text-ui text-ink-3">Any work can show this skill.</p>
            )}
          </section>
        </div>
        <aside className="grid content-start gap-10">
          {skill.myProgress && skill.myProgress.criteria.length > 0 ? (
            <section className="grid gap-3" aria-labelledby="standing">
              <SectionLabel id="standing">Your standing</SectionLabel>
              <ProgressBlock progress={skill.myProgress} />
            </section>
          ) : null}
          <section className="grid gap-3" aria-labelledby="learn">
            <SectionLabel id="learn">Who can I learn from</SectionLabel>
            {holders.length > 0 ? (
              <ul className="grid gap-3">
                {holders.map((h) => (
                  <li key={h.person.id}>
                    <Link
                      to="/people/$id"
                      params={{ id: h.person.id }}
                      className="flex items-center justify-between gap-3 rounded-control"
                    >
                      <PersonChip person={h.person} subtitle={h.levelName} />
                      <BadgeSeal
                        level={h.level as 2 | 3 | 4}
                        domain={skill.domain}
                        size={24}
                        label={h.levelName}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ui text-ink-3">
                No one holds this badge yet. You could be the first.
              </p>
            )}
          </section>
        </aside>
      </div>
    </Page>
  );
};
