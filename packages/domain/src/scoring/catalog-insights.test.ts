import { describe, expect, it } from 'vitest';
import type { PersonId, SkillId } from '../ids.ts';
import {
  computeCatalogInsights,
  extractDisplayTags,
  rarePairingsForSkill,
  skillTierFromTags,
  type CatalogSkillInput,
} from './catalog-insights.ts';

const s1 = 'skl_1000000000000000' as SkillId;
const s2 = 'skl_2000000000000000' as SkillId;
const s3 = 'skl_3000000000000000' as SkillId;
const s4 = 'skl_4000000000000000' as SkillId;

const p1 = 'per_1000000000000000' as PersonId;
const p2 = 'per_2000000000000000' as PersonId;
const p3 = 'per_3000000000000000' as PersonId;

const skills: ReadonlyArray<CatalogSkillInput> = [
  { id: s1, name: 'Client discovery', domain: 'client_discovery', tags: ['core', 'client-facing'] },
  { id: s2, name: 'Goals-based planning', domain: 'planning_advice', tags: ['core', 'planning'] },
  {
    id: s3,
    name: 'Behavioral coaching',
    domain: 'behavioral_coaching',
    tags: ['common', 'volatility'],
  },
  { id: s4, name: 'Trust and transparency', domain: 'trust_integrity', tags: ['core', 'trust'] },
];

describe('catalog insights (core/common, popularity, gaps, rare combos)', () => {
  it('classifies core vs common skills and strips tier markers from display tags', () => {
    expect(skillTierFromTags(['core', 'client-facing'])).toBe('core');
    expect(skillTierFromTags(['common', 'volatility'])).toBe('common');
    expect(extractDisplayTags(['core', 'client-facing', 'meetings'])).toEqual([
      'client-facing',
      'meetings',
    ]);
  });

  it('identifies popular skills, lacking skills, and personalized rare combos', () => {
    const result = computeCatalogInsights({
      skills,
      badges: [
        { skillId: s1, personId: p1, level: 3 },
        { skillId: s1, personId: p2, level: 2 },
        { skillId: s1, personId: p3, level: 2 },
        { skillId: s2, personId: p2, level: 2 },
      ],
      activeFocuses: [
        { skillId: s1, personId: p2 },
        { skillId: s3, personId: p1 },
        { skillId: s3, personId: p3 },
      ],
      viewerPersonId: p1,
    });

    expect(result.popularSkillIds[0]).toBe(s1);
    expect(result.metrics.get(s1)?.signal).toBe('popular');
    expect(result.metrics.get(s3)?.signal).toBe('emerging');
    expect(result.metrics.get(s4)?.signal).toBe('scarce');
    expect(result.lackingSkillIds).toContain(s4);

    // Viewer p1 already holds s1 (core); top rare combo should pair s1 with a 0-joint-holder common skill (s3)
    expect(result.rareCombos[0]?.matchesViewer).toBe(true);
    expect(result.rareCombos[0]?.viewerHeldSkillId).toBe(s1);
    expect(result.rareCombos[0]?.skillIds).toEqual([s1, s3]);
    expect(result.rareCombos[0]?.jointHolders).toBe(0);
  });

  it('returns targeted rare pairings for an individual skill', () => {
    const pairings = rarePairingsForSkill(s4, {
      skills,
      badges: [{ skillId: s1, personId: p1, level: 3 }],
      viewerPersonId: p1,
    });
    expect(pairings.length).toBeGreaterThan(0);
    expect(pairings[0]?.skillIds).toContain(s4);
    expect(pairings[0]?.skillIds).toContain(s1);
  });
});
