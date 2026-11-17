import { describe, expect, it } from 'vitest';
import {
  checkSkillValues,
  checkTemplateSkills,
  isDefinitionComplete,
  prepareDefinition,
  type LevelDraft,
  type TemplateSkill,
} from './catalog.ts';
import type { SkillId } from './ids.ts';
import { CatalogItemLifecycle } from './lifecycles/index.ts';

/**
 * Protects the catalog rules program owners edit under (design 2026-11-17,
 * §7): a skill is published only when complete, and publishing a published
 * skill makes its next version; indicator lineage survives a new version;
 * a template lists each skill once with at most one primary; a skill's own
 * values stay inside the same sanity limits as the tenant's policy.
 */
describe('catalog item lifecycle', () => {
  const L = CatalogItemLifecycle;
  it.each([
    ['draft', true, 'PUBLISH', 'published'],
    ['draft', false, 'PUBLISH', null],
    ['published', true, 'PUBLISH', 'published'],
    ['published', false, 'PUBLISH', null],
    ['published', true, 'RETIRE', 'retired'],
    ['draft', true, 'DISCARD', 'discarded'],
    ['published', true, 'DISCARD', null],
    ['retired', true, 'PUBLISH', null],
    ['discarded', true, 'PUBLISH', null],
  ] as const)('%s, complete %s: %s → %s', (from, complete, event, to) => {
    expect(L.next(from, { complete }, { type: event })).toBe(to);
  });
});

const level = (n: 1 | 2 | 3 | 4, ...texts: Array<string | [string, string]>): LevelDraft => ({
  level: n,
  summary: `Level ${n} summary`,
  indicators: texts.map((t) =>
    typeof t === 'string' ? { text: t } : { lineageKey: t[0], text: t[1] },
  ),
});

describe('prepareDefinition', () => {
  it('keeps carried-over lineage keys and gives new indicators unique ones', () => {
    const prepared = prepareDefinition([
      level(2, ['l2-open-questions', 'Asks open questions'], 'Lets the client finish'),
      level(1, ' Writes down goals ', 'Writes down goals!'),
    ]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.levels.map((l) => l.level)).toEqual([1, 2]);
    expect(prepared.levels.flatMap((l) => l.indicators)).toEqual([
      { lineageKey: 'l1-writes-down-goals', text: 'Writes down goals' },
      { lineageKey: 'l1-writes-down-goals-2', text: 'Writes down goals!' },
      { lineageKey: 'l2-open-questions', text: 'Asks open questions' },
      { lineageKey: 'l2-lets-the-client-finish', text: 'Lets the client finish' },
    ]);
  });

  it.each([
    ['a level twice', [level(1, 'Abc'), level(1, 'Def')], 'level1'],
    ['a key twice', [level(1, ['k-1', 'Abc']), level(2, ['k-1', 'Def'])], 'level2'],
    ['an invalid key', [level(3, ['Not A Key', 'Abc'])], 'level3'],
    ['indicator text too short', [level(4, 'ab')], 'level4'],
  ] as const)('refuses %s', (_, levels, field) => {
    const prepared = prepareDefinition(levels);
    expect(prepared.ok ? [] : prepared.problems.map((p) => p.field)).toContain(field);
  });

  it('a draft may be incomplete; publishing needs four levels with a summary and an indicator', () => {
    const partial = prepareDefinition([level(1, 'Abc'), level(2)]);
    expect(partial.ok && isDefinitionComplete(partial)).toBe(false);
    const full = prepareDefinition([
      level(1, 'Abc'),
      level(2, 'Bcd'),
      level(3, 'Cde'),
      level(4, 'Def'),
    ]);
    expect(full.ok && isDefinitionComplete(full)).toBe(true);
  });
});

describe('checkSkillValues', () => {
  const none = {
    primaryPoints: null,
    secondaryPoints: null,
    badgePoints: null,
    minPrimaryPoints: null,
  };
  it.each([
    ['all empty (the tenant’s values apply)', none, []],
    ['values below the tenant’s', { ...none, primaryPoints: 1, badgePoints: 1 }, []],
    ['zero points', { ...none, secondaryPoints: 0 }, ['secondaryPoints']],
    ['a fraction', { ...none, primaryPoints: 2.5 }, ['primaryPoints']],
    ['a badge above the limit', { ...none, badgePoints: 100_001 }, ['badgePoints']],
    [
      'a primary minimum above its own badge',
      { ...none, badgePoints: 20, minPrimaryPoints: 21 },
      ['minPrimaryPoints'],
    ],
    ['a primary minimum of zero (off)', { ...none, minPrimaryPoints: 0 }, []],
  ] as const)('%s', (_, values, fields) => {
    expect(checkSkillValues(values).map((p) => p.field)).toEqual(fields);
  });
});

const s = (skillId: SkillId, role: TemplateSkill['role'], points: number | null = null) => ({
  skillId,
  role,
  points,
});

describe('checkTemplateSkills', () => {
  const a = 'skl_aaaaaaaaaaaaaaaa' as SkillId;
  const b = 'skl_bbbbbbbbbbbbbbbb' as SkillId;
  it.each([
    ['one primary and a secondary with a value', [s(a, 'primary'), s(b, 'secondary', 4)], 0],
    ['no primary', [s(a, 'secondary'), s(b, 'secondary')], 0],
    ['two primaries', [s(a, 'primary'), s(b, 'primary')], 1],
    ['a skill twice', [s(a, 'primary'), s(a, 'secondary')], 1],
    ['a value of zero', [s(a, 'primary', 0)], 1],
  ] as const)('%s', (_, skills, problems) => {
    expect(checkTemplateSkills(skills)).toHaveLength(problems);
  });
});
