import type { SkillDetail } from '@repo/api';
import { SKILL_DOMAINS, type Level, type SkillDomain, type SkillTier } from '@repo/domain';
import {
  Button,
  cn,
  Field,
  FieldHint,
  Input,
  Label,
  NativeSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@repo/ui';
import { useState, type FormEvent } from 'react';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { useApiMutation } from '@/lib/api.ts';
import { domainLabel, levelName } from '@/lib/format.ts';

interface LevelDraft {
  readonly level: Level;
  readonly summary: string;
  readonly indicatorsText: string;
}

const DEFAULT_LEVELS: ReadonlyArray<LevelDraft> = [
  {
    level: 1,
    summary: 'Applies the fundamentals using a guide with support.',
    indicatorsText: 'Prepares using the firm checklist before the conversation',
  },
  {
    level: 2,
    summary: 'Executes consistently with occasional coaching.',
    indicatorsText: 'Demonstrates the core behavior clearly in a live client interaction',
  },
  {
    level: 3,
    summary: 'Leads independently and adapts to the client in the moment.',
    indicatorsText: 'Adapts cleanly when priorities shift and confirms alignment',
  },
  {
    level: 4,
    summary: 'Models the standard and coaches peers on the team.',
    indicatorsText: 'Debriefs real examples and helps colleagues sharpen their craft',
  },
];

const levelsFromSkill = (skill: SkillDetail | null): ReadonlyArray<LevelDraft> =>
  skill
    ? ([1, 2, 3, 4] as const).map((lvl) => {
        const found = skill.levels.find((l) => l.level === lvl);
        return {
          level: lvl,
          summary: found?.summary ?? '',
          indicatorsText: (found?.indicators ?? []).map((i) => i.text).join('\n'),
        };
      })
    : DEFAULT_LEVELS;

const parseIndicators = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 3);

const LevelEditorTabs = ({
  levels,
  onChange,
}: {
  readonly levels: ReadonlyArray<LevelDraft>;
  readonly onChange: (level: Level, patch: Partial<LevelDraft>) => void;
}) => (
  <div className="grid gap-2">
    <Label>4-level skill ladder &amp; observable indicators</Label>
    <Tabs defaultValue="2">
      <TabsList className="flex-wrap">
        {levels.map((l) => (
          <TabsTrigger key={l.level} value={String(l.level)}>
            L{l.level} · {levelName(l.level)}
          </TabsTrigger>
        ))}
      </TabsList>
      {levels.map((l) => (
        <TabsContent key={l.level} value={String(l.level)} className="grid gap-3 pt-3">
          <Field>
            <Label htmlFor={`lvl-sum-${l.level}`}>Level {l.level} summary</Label>
            <Input
              id={`lvl-sum-${l.level}`}
              value={l.summary}
              onChange={(e) => onChange(l.level, { summary: e.target.value })}
              placeholder="One sentence describing what this level looks like in practice."
              maxLength={400}
            />
          </Field>
          <Field>
            <Label htmlFor={`lvl-ind-${l.level}`}>Observable behaviors (one per line)</Label>
            <Textarea
              id={`lvl-ind-${l.level}`}
              rows={3}
              value={l.indicatorsText}
              onChange={(e) => onChange(l.level, { indicatorsText: e.target.value })}
              placeholder="Write observable actions a coach can actually see (one per line)."
            />
            <FieldHint>At least 1 observable indicator required per level.</FieldHint>
          </Field>
        </TabsContent>
      ))}
    </Tabs>
  </div>
);

const SkillMetadataFields = ({
  name,
  onName,
  domain,
  onDomain,
  tier,
  onTier,
  outcome,
  onOutcome,
  summary,
  onSummary,
  tagsText,
  onTagsText,
}: {
  readonly name: string;
  readonly onName: (v: string) => void;
  readonly domain: SkillDomain;
  readonly onDomain: (v: SkillDomain) => void;
  readonly tier: SkillTier;
  readonly onTier: (v: SkillTier) => void;
  readonly outcome: string;
  readonly onOutcome: (v: string) => void;
  readonly summary: string;
  readonly onSummary: (v: string) => void;
  readonly tagsText: string;
  readonly onTagsText: (v: string) => void;
}) => (
  <>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field>
        <Label htmlFor="studio-name">Skill name</Label>
        <Input
          id="studio-name"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="e.g. Estate transition readiness"
          maxLength={100}
        />
      </Field>
      <Field>
        <Label htmlFor="studio-domain">Domain</Label>
        <NativeSelect
          id="studio-domain"
          value={domain}
          onChange={(e) => onDomain(e.target.value as SkillDomain)}
        >
          {SKILL_DOMAINS.map((d) => (
            <option key={d} value={d}>
              {domainLabel(d)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <Field>
        <Label>Catalog tier</Label>
        <div className="flex gap-2">
          {(['core', 'common'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tier === t}
              onClick={() => onTier(t)}
              className={cn(
                'h-9 flex-1 cursor-pointer rounded-control border text-ui font-medium transition-colors',
                tier === t
                  ? 'border-primary bg-primary-soft text-primary-ink'
                  : 'border-line text-ink-2 hover:bg-sunken',
              )}
            >
              {t === 'core' ? 'Core skill' : 'Common skill'}
            </button>
          ))}
        </div>
      </Field>
      <Field>
        <Label htmlFor="studio-outcome">Business outcome</Label>
        <Input
          id="studio-outcome"
          value={outcome}
          onChange={(e) => onOutcome(e.target.value)}
          placeholder="e.g. Client trust, Multi-gen retention"
          maxLength={120}
        />
      </Field>
    </div>

    <Field>
      <Label htmlFor="studio-summary">Summary</Label>
      <Textarea
        id="studio-summary"
        rows={2}
        value={summary}
        onChange={(e) => onSummary(e.target.value)}
        placeholder="One crisp sentence explaining what this skill enables."
        maxLength={320}
      />
    </Field>

    <Field>
      <Label htmlFor="studio-tags">Discovery tags (comma-separated)</Label>
      <Input
        id="studio-tags"
        value={tagsText}
        onChange={(e) => onTagsText(e.target.value)}
        placeholder="client-facing, planning, households"
      />
    </Field>
  </>
);

/**
 * Skill Catalog Authoring Studio dialog:
 * creates new published skills (v1) or edits & publishes a new version (vN+1)
 * while preserving historical observations pinned to prior skill versions.
 */
export const SkillStudioDialog = ({
  open,
  onClose,
  skill = null,
  onSaved,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly skill?: SkillDetail | null;
  readonly onSaved?: (saved: SkillDetail) => void;
}) => {
  const [name, setName] = useState(skill?.name ?? '');
  const [domain, setDomain] = useState<SkillDomain>(skill?.domain ?? 'client_discovery');
  const [tier, setTier] = useState<SkillTier>(skill?.tier ?? 'core');
  const [outcome, setOutcome] = useState(skill?.outcome ?? 'Client trust');
  const [summary, setSummary] = useState(skill?.summary ?? '');
  const [tagsText, setTagsText] = useState(skill ? skill.tags.join(', ') : 'client-facing');
  const [levels, setLevels] = useState<ReadonlyArray<LevelDraft>>(() => levelsFromSkill(skill));
  const [changeNote, setChangeNote] = useState('');

  const create = useApiMutation('catalog', 'createSkill', {
    onSuccess: (created) => {
      toast.success(`Published “${created.name}” to the skill catalog.`);
      onSaved?.(created);
      onClose();
    },
  });
  const update = useApiMutation('catalog', 'updateSkill', {
    onSuccess: (updated) => {
      toast.success(`Updated “${updated.name}” (v${updated.version}).`);
      onSaved?.(updated);
      onClose();
    },
  });

  const patchLevel = (lvl: Level, patch: Partial<LevelDraft>) =>
    setLevels((prev) => prev.map((item) => (item.level === lvl ? { ...item, ...patch } : item)));

  const parsedLevels = levels.map((l) => ({
    level: l.level,
    summary: l.summary.trim(),
    indicators: parseIndicators(l.indicatorsText),
  }));
  const levelsValid = parsedLevels.every((l) => l.summary.length >= 3 && l.indicators.length >= 1);
  const valid =
    name.trim().length >= 2 &&
    summary.trim().length >= 5 &&
    outcome.trim().length >= 2 &&
    levelsValid;
  const pending = create.isPending || update.isPending;
  const actionLabel = skill ? 'Publish update' : 'Publish skill';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const base = {
      name: name.trim(),
      domain,
      tier,
      summary: summary.trim(),
      outcome: outcome.trim(),
      tags,
      levels: parsedLevels,
    };
    if (skill) {
      update.mutate({
        params: { id: skill.id },
        payload: { ...base, ...(changeNote.trim() ? { changeNote: changeNote.trim() } : {}) },
      });
      return;
    }
    create.mutate({ payload: base });
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={skill ? `Edit skill · ${skill.name}` : 'Author a new skill'}
      description={
        skill
          ? `Publishing edits creates version ${skill.version + 1} while preserving past observations.`
          : 'Define a firm skill with Core/Common tier, tags, and 4 observable levels.'
      }
    >
      <form className="grid max-h-[75vh] gap-4 overflow-y-auto pr-1" onSubmit={submit}>
        <SkillMetadataFields
          name={name}
          onName={setName}
          domain={domain}
          onDomain={setDomain}
          tier={tier}
          onTier={setTier}
          outcome={outcome}
          onOutcome={setOutcome}
          summary={summary}
          onSummary={setSummary}
          tagsText={tagsText}
          onTagsText={setTagsText}
        />

        <LevelEditorTabs levels={levels} onChange={patchLevel} />

        {skill ? (
          <Field>
            <Label htmlFor="studio-note">Version change note · optional</Label>
            <Input
              id="studio-note"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="e.g. Clarified Level 3 trade-off indicator"
              maxLength={200}
            />
          </Field>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || pending}>
            {pending ? 'Publishing…' : actionLabel}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};
