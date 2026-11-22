import type { CatalogInsights, SkillCard, SkillDetail, TemplateCard } from '@repo/api';
import type { SkillId, SkillTier } from '@repo/domain';
import {
  BadgeSeal,
  Button,
  Card,
  CatalystArc,
  cn,
  EmptyState,
  Input,
  MasteryRing,
  PersonChip,
  Pill,
  SectionLabel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CheckIcon, CompassIcon, PencilIcon, PlusIcon, SearchIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader, SkillChip } from '@/components/page.tsx';
import { useLogDialog } from '@/components/shell/log-dialog-context.tsx';
import { ProgressBlock } from '@/features/development/development-screen.tsx';
import { FocusSkillsDialog } from '@/features/development/plan-dialogs.tsx';
import { queryOptions } from '@/lib/api.ts';
import { domainLabel, kindLabel, levelName } from '@/lib/format.ts';
import { useSession } from '@/lib/session.ts';
import {
  RareComboCard,
  SIGNAL_META,
  SkillConstellation,
  SkillLandscapeChart,
} from './catalog-visuals.tsx';
import { SkillPlaybooksSection } from './playbook-section.tsx';
import { SkillStudioDialog } from './skill-studio-dialog.tsx';

type CatalogLens = 'all' | 'popular' | 'lacking' | 'in_plan' | 'unearned';

const Search = ({
  value,
  onChange,
  label,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly label: string;
}) => (
  <label className="relative block w-full sm:w-64">
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

const CatalogSkillCard = ({
  skill,
  activeTag,
  onTagClick,
  onAddToPlan,
}: {
  readonly skill: SkillCard;
  readonly activeTag: string | null;
  readonly onTagClick: (tag: string) => void;
  readonly onAddToPlan: (skillId: SkillId) => void;
}) => {
  const sig = SIGNAL_META[skill.signal];
  const almost =
    skill.myRequired > 0 &&
    skill.myRequired - skill.myCurrent === 1 &&
    (skill.myHighestLevel ?? 0) < 3;
  return (
    <Card
      className={cn(
        'flex flex-col justify-between gap-4 p-4 transition-colors hover:border-line-strong md:p-5',
        almost && 'border-brass/60 ring-1 ring-brass/20',
      )}
    >
      <div className="grid gap-3">
        <div className="flex items-start gap-3.5">
          <Link to="/catalog/skills/$slug" params={{ slug: skill.slug }} className="shrink-0">
            <MasteryRing
              level={skill.myHighestLevel ?? 0}
              current={skill.myCurrent}
              required={skill.myRequired}
              size="md"
            />
          </Link>
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                to="/catalog/skills/$slug"
                params={{ slug: skill.slug }}
                className="text-body font-semibold text-ink hover:text-primary-ink hover:underline"
              >
                {skill.name}
              </Link>
              <Pill tone={skill.tier === 'core' ? 'primary' : 'outline'}>
                {skill.tier === 'core' ? 'Core' : 'Common'}
              </Pill>
              {skill.signal !== 'balanced' ? <Pill tone={sig.tone}>{sig.label}</Pill> : null}
            </div>
            <p className="text-ui text-ink-2">{skill.summary}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {skill.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTagClick(tag)}
              className={cn(
                'cursor-pointer rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                activeTag === tag
                  ? 'border-brass bg-brass-soft text-brass-ink'
                  : 'border-line bg-sunken/60 text-ink-3 hover:border-line-strong hover:text-ink',
              )}
            >
              #{tag}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="font-mono text-meta text-ink-3 tabular">
          {skill.holderCount} held · {skill.activeFocusCount} active
          {skill.resourceCount > 0 ? ` · ${skill.resourceCount} playbooks` : ''}
        </span>
        <div className="flex items-center gap-2">
          <Link
            to="/catalog/skills/$slug"
            params={{ slug: skill.slug }}
            className="text-meta font-medium text-ink-2 hover:text-ink hover:underline"
          >
            Indicators
          </Link>
          {skill.inMyPlan ? (
            <Pill tone="success">
              <CheckIcon className="mr-0.5 size-3" /> In plan
            </Pill>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => onAddToPlan(skill.id)}>
              <PlusIcon /> Add to plan
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};

const matchesCatalogFilters = (
  s: SkillCard,
  opts: {
    readonly tier: 'all' | SkillTier;
    readonly lens: CatalogLens;
    readonly tag: string | null;
    readonly q: string;
    readonly popularIds: ReadonlySet<SkillId>;
    readonly lackingIds: ReadonlySet<SkillId>;
  },
) => {
  if (opts.tier !== 'all' && s.tier !== opts.tier) return false;
  if (opts.lens === 'popular' && !opts.popularIds.has(s.id) && s.signal !== 'popular') return false;
  if (opts.lens === 'lacking' && !opts.lackingIds.has(s.id) && s.signal !== 'scarce') return false;
  if (opts.lens === 'in_plan' && !s.inMyPlan) return false;
  if (opts.lens === 'unearned' && (s.myHighestLevel ?? 0) > 0) return false;
  if (opts.tag && !s.tags.includes(opts.tag)) return false;
  if (opts.q.trim().length > 0) {
    const hay = `${s.name} ${s.summary} ${s.outcome} ${s.tags.join(' ')}`.toLowerCase();
    if (!hay.includes(opts.q.trim().toLowerCase())) return false;
  }
  return true;
};

const FilterStrip = ({
  tier,
  onTier,
  lens,
  onLens,
  tag,
  onTag,
  tags,
  coreCount,
  commonCount,
}: {
  readonly tier: 'all' | SkillTier;
  readonly onTier: (t: 'all' | SkillTier) => void;
  readonly lens: CatalogLens;
  readonly onLens: (l: CatalogLens) => void;
  readonly tag: string | null;
  readonly onTag: (t: string | null) => void;
  readonly tags: CatalogInsights['tags'];
  readonly coreCount: number;
  readonly commonCount: number;
}) => (
  <div className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ['all', `All (${coreCount + commonCount})`],
            ['core', `Core (${coreCount})`],
            ['common', `Common (${commonCount})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tier === key}
            onClick={() => onTier(key)}
            className={cn(
              'h-8 cursor-pointer rounded-full border px-3 text-ui font-medium transition-colors',
              tier === key
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-line text-ink-2 hover:bg-sunken',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ['all', 'Any standing'],
            ['popular', 'Most popular'],
            ['lacking', 'Lacking in firm'],
            ['unearned', 'Not unlocked'],
            ['in_plan', 'In my plan'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={lens === key}
            onClick={() => onLens(key)}
            className={cn(
              'h-7 cursor-pointer rounded-full border px-2.5 text-meta font-medium transition-colors',
              lens === key
                ? 'border-brass bg-brass-soft text-brass-ink'
                : 'border-line text-ink-2 hover:bg-sunken',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>

    {tags.length > 0 ? (
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        <span className="mr-1 font-mono text-[10.5px] tracking-wider text-ink-3 uppercase">
          Tags
        </span>
        {tags.map((t) => (
          <button
            key={t.tag}
            type="button"
            aria-pressed={tag === t.tag}
            onClick={() => onTag(tag === t.tag ? null : t.tag)}
            className={cn(
              'cursor-pointer rounded-full border px-2.5 py-0.5 text-meta transition-colors',
              tag === t.tag
                ? 'border-primary bg-primary-soft text-primary-ink'
                : 'border-line text-ink-3 hover:border-line-strong hover:text-ink',
            )}
          >
            #{t.tag} <span className="font-mono text-[10px] opacity-70">{t.count}</span>
          </button>
        ))}
        {tag ? (
          <button
            type="button"
            onClick={() => onTag(null)}
            className="ml-1 cursor-pointer text-meta text-primary-ink hover:underline"
          >
            Clear tag
          </button>
        ) : null}
      </div>
    ) : null}
  </div>
);

const RareCombosSection = ({
  combos,
  skillById,
  onBuildCombo,
}: {
  readonly combos: CatalogInsights['rareCombos'];
  readonly skillById: ReadonlyMap<SkillId, SkillCard>;
  readonly onBuildCombo: (ids: ReadonlyArray<SkillId>) => void;
}) =>
  combos.length > 0 ? (
    <section className="grid gap-3" aria-labelledby="rare-combos-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel id="rare-combos-heading">Rare combos · stand out uniquely</SectionLabel>
        <span className="inline-flex items-center gap-1.5 text-meta text-ink-3">
          <CatalystArc size={12} /> Cross-domain pairs held by few or no peers yet
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {combos.slice(0, 4).map((combo) => (
          <RareComboCard
            key={`${combo.skills[0].id}-${combo.skills[1].id}`}
            combo={combo}
            skillById={skillById}
            onBuildCombo={onBuildCombo}
          />
        ))}
      </div>
    </section>
  ) : null;

export const SkillsScreen = ({
  skills,
  insights,
}: {
  readonly skills: ReadonlyArray<SkillCard>;
  readonly insights: CatalogInsights;
}) => {
  const session = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<'all' | SkillTier>('all');
  const [lens, setLens] = useState<CatalogLens>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [planSeedIds, setPlanSeedIds] = useState<ReadonlyArray<SkillId> | null>(null);
  const [authoring, setAuthoring] = useState(false);

  const canAuthor =
    session.grants.includes('tenant_admin') || session.grants.includes('program_owner');
  const myDev = useQuery(queryOptions('development', 'mine', undefined));
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const popularIds = new Set(insights.popularSkillIds);
  const lackingIds = new Set(insights.lackingSkillIds);

  const visible = skills.filter((s) =>
    matchesCatalogFilters(s, { tier, lens, tag, q, popularIds, lackingIds }),
  );
  const coreCount = skills.filter((s) => s.tier === 'core').length;
  const commonCount = skills.filter((s) => s.tier === 'common').length;

  return (
    <Page>
      <div className="grid gap-8">
        <PageHeader
          title="Skill catalog"
          description="Explore Core foundations and Common differentiators, see where the firm has gaps, and discover rare skill combos to build your plan."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Search value={q} onChange={setQ} label="Search skills or tags" />
              {canAuthor ? (
                <Button variant="secondary" onClick={() => setAuthoring(true)}>
                  <PlusIcon /> New skill
                </Button>
              ) : null}
              <Button variant="primary" onClick={() => setPlanSeedIds([])}>
                <CompassIcon /> Build plan
              </Button>
            </div>
          }
        />

        {/* Visual Atlas: Mastery Constellation + Firm Skill Landscape */}
        <section
          className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]"
          aria-label="Skill visualizations"
        >
          <SkillConstellation
            skills={skills}
            onSelect={(s) =>
              void navigate({ to: '/catalog/skills/$slug', params: { slug: s.slug } })
            }
          />
          <SkillLandscapeChart
            skills={skills}
            totalPeople={insights.totalPeople}
            onPickSkill={(s) =>
              void navigate({ to: '/catalog/skills/$slug', params: { slug: s.slug } })
            }
          />
        </section>

        {/* Rare Combos Discovery */}
        <RareCombosSection
          combos={insights.rareCombos}
          skillById={skillById}
          onBuildCombo={(ids) => setPlanSeedIds(ids)}
        />

        {/* Interactive Explorer */}
        <section className="grid gap-4" aria-labelledby="browse-catalog-heading">
          <div className="flex items-baseline justify-between gap-2">
            <SectionLabel id="browse-catalog-heading">
              Browse skills · {visible.length} shown
            </SectionLabel>
            <span className="text-meta text-ink-3">
              2 published observations (1+ first-hand) unlock each level ring
            </span>
          </div>

          <FilterStrip
            tier={tier}
            onTier={setTier}
            lens={lens}
            onLens={setLens}
            tag={tag}
            onTag={setTag}
            tags={insights.tags}
            coreCount={coreCount}
            commonCount={commonCount}
          />

          {visible.length === 0 ? (
            <EmptyState>
              No skills match those filters.{' '}
              <button
                type="button"
                onClick={() => {
                  setQ('');
                  setTier('all');
                  setLens('all');
                  setTag(null);
                }}
                className="cursor-pointer font-medium text-primary-ink hover:underline"
              >
                Reset filters
              </button>
            </EmptyState>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {visible.map((s) => (
                <CatalogSkillCard
                  key={s.id}
                  skill={s}
                  activeTag={tag}
                  onTagClick={(clicked) => setTag(tag === clicked ? null : clicked)}
                  onAddToPlan={(id) => setPlanSeedIds([id])}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {planSeedIds !== null ? (
        <FocusSkillsDialog
          key={planSeedIds.join(',')}
          open
          onClose={() => setPlanSeedIds(null)}
          existingPlan={myDev.data?.plan ?? null}
          initialSkillIds={planSeedIds.length > 0 ? planSeedIds : undefined}
        />
      ) : null}
      {authoring ? (
        <SkillStudioDialog
          open
          onClose={() => setAuthoring(false)}
          onSaved={(created) =>
            void navigate({ to: '/catalog/skills/$slug', params: { slug: created.slug } })
          }
        />
      ) : null}
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

const SkillDetailHeader = ({
  skill,
  canAuthor,
  onEdit,
  onAddToPlan,
  onAskFeedback,
}: {
  readonly skill: SkillDetail;
  readonly canAuthor: boolean;
  readonly onEdit: () => void;
  readonly onAddToPlan: () => void;
  readonly onAskFeedback: () => void;
}) => {
  const sig = SIGNAL_META[skill.signal];
  return (
    <header className="mb-10 flex flex-col gap-5 border-b border-line pb-8 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <MasteryRing
          level={skill.myHighestLevel ?? 0}
          current={skill.myCurrent}
          required={skill.myRequired}
          size="lg"
        />
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={skill.tier === 'core' ? 'primary' : 'outline'}>
              {skill.tier === 'core' ? 'Core skill' : 'Common skill'}
            </Pill>
            {skill.signal !== 'balanced' ? <Pill tone={sig.tone}>{sig.label}</Pill> : null}
            <span className="text-meta text-ink-3">
              {domainLabel(skill.domain)} · serves {skill.outcome.toLowerCase()} · v{skill.version}
            </span>
          </div>
          <h1 className="editorial-serif text-h1 font-normal text-ink md:text-display">
            {skill.name}
          </h1>
          <p className="max-w-2xl text-body text-ink-2">{skill.summary}</p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {skill.tags.map((t) => (
              <span
                key={t}
                className="rounded-full border border-line bg-sunken/70 px-2.5 py-0.5 text-meta text-ink-3"
              >
                #{t}
              </span>
            ))}
            <span className="font-mono text-meta text-ink-3 tabular">
              · {skill.holderCount} held · {skill.activeFocusCount} focusing
            </span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-center">
        {canAuthor ? (
          <Button variant="ghost" onClick={onEdit}>
            <PencilIcon /> Edit skill
          </Button>
        ) : null}
        {!skill.inMyPlan ? (
          <Button variant="secondary" onClick={onAddToPlan}>
            <PlusIcon /> Add to plan
          </Button>
        ) : null}
        <Button variant="primary" onClick={onAskFeedback}>
          <SendIcon /> Ask for feedback
        </Button>
      </div>
    </header>
  );
};

export const SkillScreen = ({ skill }: { readonly skill: SkillDetail }) => {
  const session = useSession();
  const log = useLogDialog();
  const [planSeedIds, setPlanSeedIds] = useState<ReadonlyArray<SkillId> | null>(null);
  const [editing, setEditing] = useState(false);
  const myDev = useQuery(queryOptions('development', 'mine', undefined));
  const allSkills = useQuery(queryOptions('catalog', 'skills', { query: {} }));
  const skillById = new Map((allSkills.data ?? []).map((s) => [s.id, s]));

  const canAuthor =
    session.grants.includes('tenant_admin') || session.grants.includes('program_owner');
  const canEditResources = canAuthor || session.grants.includes('coach');
  const holders = skill.holders
    .filter((h) => h.person.id !== session.person.id)
    .toSorted((a, b) => b.level - a.level);

  return (
    <Page>
      <SkillDetailHeader
        skill={skill}
        canAuthor={canAuthor}
        onEdit={() => setEditing(true)}
        onAddToPlan={() => setPlanSeedIds([skill.id])}
        onAskFeedback={() => log.show({ skillId: skill.id })}
      />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid content-start gap-12">
          <section className="grid gap-4" aria-labelledby="levels">
            <SectionLabel id="levels">What each level looks like</SectionLabel>
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
                          className="mt-2.5 size-1 shrink-0 rounded-full bg-primary"
                        />
                        {i.text}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-meta text-ink-3">
                    These are the observable behaviors a coach or leader looks for.
                  </p>
                </TabsContent>
              ))}
            </Tabs>
          </section>

          <SkillPlaybooksSection skill={skill} canEdit={canEditResources} />

          <section className="grid gap-3" aria-labelledby="templates">
            <SectionLabel id="templates">Real work that builds this</SectionLabel>
            {skill.templates.length > 0 ? (
              <Card>
                <ul className="divide-y divide-line">
                  {skill.templates.map((t) => (
                    <TemplateRow key={t.id} template={t} />
                  ))}
                </ul>
              </Card>
            ) : (
              <p className="text-ui text-ink-3">
                Any real client or team work can show this skill.
              </p>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-10">
          {skill.myProgress && skill.myProgress.criteria.length > 0 ? (
            <section className="grid gap-3" aria-labelledby="standing">
              <SectionLabel id="standing">Your mastery ring</SectionLabel>
              <ProgressBlock progress={skill.myProgress} />
            </section>
          ) : null}

          {skill.rarePairings.length > 0 ? (
            <section className="grid gap-3" aria-labelledby="pairings">
              <SectionLabel id="pairings">Pair for a rare combo</SectionLabel>
              <div className="grid gap-3">
                {skill.rarePairings.map((combo) => (
                  <RareComboCard
                    key={`${combo.skills[0].id}-${combo.skills[1].id}`}
                    combo={combo}
                    skillById={skillById}
                    onBuildCombo={(ids) => setPlanSeedIds(ids)}
                  />
                ))}
              </div>
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
                No one holds this badge yet — you could be the first in the firm.
              </p>
            )}
          </section>
        </aside>
      </div>

      {planSeedIds !== null ? (
        <FocusSkillsDialog
          key={planSeedIds.join(',')}
          open
          onClose={() => setPlanSeedIds(null)}
          existingPlan={myDev.data?.plan ?? null}
          initialSkillIds={planSeedIds}
        />
      ) : null}
      {editing ? (
        <SkillStudioDialog
          key={`${skill.id}-${skill.version}`}
          open
          onClose={() => setEditing(false)}
          skill={skill}
        />
      ) : null}
    </Page>
  );
};
