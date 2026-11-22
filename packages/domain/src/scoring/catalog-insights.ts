import { Schema } from 'effect';
import type { PersonId, SkillId } from '../ids.ts';
import type { SkillDomain } from '../vocabulary.ts';

/**
 * Skill tiers for catalog discovery:
 * - `core`: foundational skills expected across every advisor/coach
 * - `common`: broader practice, relationship, and leadership skills for specialization
 */
export const SKILL_TIERS = ['core', 'common'] as const;
export const SkillTier = Schema.Literals(SKILL_TIERS);
export type SkillTier = typeof SkillTier.Type;

/** Firm-wide supply/demand signal for a skill. */
export const SKILL_SIGNALS = ['popular', 'scarce', 'emerging', 'balanced'] as const;
export const SkillSignal = Schema.Literals(SKILL_SIGNALS);
export type SkillSignal = typeof SkillSignal.Type;

export interface CatalogSkillInput {
  readonly id: SkillId;
  readonly name: string;
  readonly domain: SkillDomain;
  readonly tags: ReadonlyArray<string>;
}

export interface CatalogBadgeInput {
  readonly skillId: SkillId;
  readonly personId: PersonId;
  readonly level: number;
}

export interface CatalogFocusInput {
  readonly skillId: SkillId;
  readonly personId: PersonId;
}

export interface SkillMetric {
  readonly skillId: SkillId;
  readonly tier: SkillTier;
  readonly displayTags: ReadonlyArray<string>;
  readonly holderCount: number;
  readonly activeFocusCount: number;
  readonly signal: SkillSignal;
}

export interface RareComboInsight {
  readonly skillIds: readonly [SkillId, SkillId];
  readonly jointHolders: number;
  readonly matchesViewer: boolean;
  readonly viewerHeldSkillId: SkillId | null;
  readonly rationale: string;
}

export interface CatalogInsightsResult {
  readonly metrics: ReadonlyMap<SkillId, SkillMetric>;
  readonly popularSkillIds: ReadonlyArray<SkillId>;
  readonly lackingSkillIds: ReadonlyArray<SkillId>;
  readonly rareCombos: ReadonlyArray<RareComboInsight>;
  readonly tagCounts: ReadonlyArray<{ readonly tag: string; readonly count: number }>;
}

const TIER_TAGS = new Set<string>(SKILL_TIERS);

export const skillTierFromTags = (tags: ReadonlyArray<string>): SkillTier =>
  tags.some((t) => t.toLowerCase() === 'core') ? 'core' : 'common';

export const extractDisplayTags = (tags: ReadonlyArray<string>): ReadonlyArray<string> =>
  tags.filter((t) => !TIER_TAGS.has(t.toLowerCase()));

const signalForSkill = (
  holders: number,
  activeFocus: number,
  medianHolders: number,
  maxHolders: number,
): SkillSignal => {
  if (holders === 0) {
    return activeFocus >= 2 ? 'emerging' : 'scarce';
  }
  if (maxHolders > 0 && holders >= Math.max(2, maxHolders * 0.75)) {
    return 'popular';
  }
  if (holders < medianHolders) {
    return activeFocus > holders ? 'emerging' : 'scarce';
  }
  return 'balanced';
};

const comboRationale = (
  a: CatalogSkillInput,
  b: CatalogSkillInput,
  jointHolders: number,
  viewerHeldSkillId: SkillId | null,
): string => {
  let heldName: string | null = null;
  if (viewerHeldSkillId === a.id) heldName = a.name;
  else if (viewerHeldSkillId === b.id) heldName = b.name;
  if (jointHolders === 0) {
    return heldName
      ? `You already hold ${heldName} — be the first in the firm to combine both.`
      : 'Nobody in the firm holds both badges yet — a rare cross-domain pairing.';
  }
  if (jointHolders === 1) {
    return heldName
      ? `You hold ${heldName} — only 1 person in the firm combines both.`
      : 'Only 1 person in the firm holds both badges.';
  }
  return `Only ${jointHolders} people in the firm hold both badges.`;
};

const computeRareCombos = (
  skills: ReadonlyArray<CatalogSkillInput>,
  holdersBySkill: ReadonlyMap<SkillId, ReadonlySet<PersonId>>,
  viewerHeld: ReadonlySet<SkillId>,
  limit: number,
): ReadonlyArray<RareComboInsight> => {
  const candidates: Array<RareComboInsight & { readonly score: number }> = [];
  for (let i = 0; i < skills.length; i++) {
    const a = skills[i];
    if (!a) continue;
    const holdersA = holdersBySkill.get(a.id) ?? new Set<PersonId>();
    for (let j = i + 1; j < skills.length; j++) {
      const b = skills[j];
      if (!b) continue;
      // Prefer cross-domain pairings so combos genuinely broaden an advisor's craft
      if (a.domain === b.domain && skills.length > 3) continue;
      const holdersB = holdersBySkill.get(b.id) ?? new Set<PersonId>();
      let joint = 0;
      for (const p of holdersA) {
        if (holdersB.has(p)) joint += 1;
      }
      const hasA = viewerHeld.has(a.id);
      const hasB = viewerHeld.has(b.id);
      // Skip combos the viewer already completely holds
      if (hasA && hasB) continue;
      const matchesViewer = hasA !== hasB;
      let viewerHeldSkillId: SkillId | null = null;
      if (hasA) viewerHeldSkillId = a.id;
      else if (hasB) viewerHeldSkillId = b.id;
      const aTier = skillTierFromTags(a.tags);
      const bTier = skillTierFromTags(b.tags);
      // Prioritize: (1) matches one of viewer's held skills, (2) low joint holders,
      // (3) pairing a core skill with a differentiating common skill.
      const mixedTierBonus = aTier !== bTier ? 2 : 0;
      const viewerBonus = matchesViewer ? 10 : 0;
      const scarcityBonus = Math.max(0, 5 - joint);
      const score = viewerBonus + scarcityBonus + mixedTierBonus;
      candidates.push({
        skillIds: [a.id, b.id],
        jointHolders: joint,
        matchesViewer,
        viewerHeldSkillId,
        rationale: comboRationale(a, b, joint, viewerHeldSkillId),
        score,
      });
    }
  }
  return candidates
    .toSorted((x, y) => y.score - x.score || x.jointHolders - y.jointHolders)
    .slice(0, limit)
    .map(({ score: _score, ...combo }) => combo);
};

/**
 * Computes real firm-wide skill discovery insights from badge awards and active plans:
 * - Popular skills (most held + actively focused)
 * - Lacking / scarce skills (lowest firm coverage)
 * - Rare cross-domain skill combos (personalized to what the viewer already holds)
 * - Topical tag counts for discovery filtering
 */
export const computeCatalogInsights = (input: {
  readonly skills: ReadonlyArray<CatalogSkillInput>;
  readonly badges: ReadonlyArray<CatalogBadgeInput>;
  readonly activeFocuses: ReadonlyArray<CatalogFocusInput>;
  readonly viewerPersonId: PersonId;
}): CatalogInsightsResult => {
  const holdersBySkill = new Map<SkillId, Set<PersonId>>();
  const focusBySkill = new Map<SkillId, Set<PersonId>>();
  const viewerHeld = new Set<SkillId>();

  for (const s of input.skills) {
    holdersBySkill.set(s.id, new Set());
    focusBySkill.set(s.id, new Set());
  }
  for (const b of input.badges) {
    holdersBySkill.get(b.skillId)?.add(b.personId);
    if (b.personId === input.viewerPersonId) viewerHeld.add(b.skillId);
  }
  for (const f of input.activeFocuses) {
    focusBySkill.get(f.skillId)?.add(f.personId);
  }

  const holderCounts = input.skills
    .map((s) => holdersBySkill.get(s.id)?.size ?? 0)
    .toSorted((a, b) => a - b);
  const mid = Math.floor(holderCounts.length / 2);
  const medianHolders = holderCounts[mid] ?? 0;
  const maxHolders = holderCounts.at(-1) ?? 0;

  const metrics = new Map<SkillId, SkillMetric>();
  const tagMap = new Map<string, number>();

  for (const s of input.skills) {
    const holderCount = holdersBySkill.get(s.id)?.size ?? 0;
    const activeFocusCount = focusBySkill.get(s.id)?.size ?? 0;
    const tier = skillTierFromTags(s.tags);
    const displayTags = extractDisplayTags(s.tags);
    for (const tag of displayTags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
    metrics.set(s.id, {
      skillId: s.id,
      tier,
      displayTags,
      holderCount,
      activeFocusCount,
      signal: signalForSkill(holderCount, activeFocusCount, medianHolders, maxHolders),
    });
  }

  const popularSkillIds = [...metrics.values()]
    .toSorted(
      (a, b) =>
        b.holderCount + b.activeFocusCount - (a.holderCount + a.activeFocusCount) ||
        b.holderCount - a.holderCount,
    )
    .filter((m) => m.holderCount > 0 || m.activeFocusCount > 0)
    .slice(0, 3)
    .map((m) => m.skillId);

  const lackingSkillIds = [...metrics.values()]
    .toSorted(
      (a, b) =>
        a.holderCount - b.holderCount ||
        (a.tier === 'core' ? 0 : 1) - (b.tier === 'core' ? 0 : 1) ||
        a.activeFocusCount - b.activeFocusCount,
    )
    .slice(0, 3)
    .map((m) => m.skillId);

  const rareCombos = computeRareCombos(input.skills, holdersBySkill, viewerHeld, 4);

  const tagCounts = [...tagMap.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .toSorted((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return { metrics, popularSkillIds, lackingSkillIds, rareCombos, tagCounts };
};

/** Best rare-combo partners for one specific skill (used on the Skill detail screen). */
export const rarePairingsForSkill = (
  skillId: SkillId,
  input: {
    readonly skills: ReadonlyArray<CatalogSkillInput>;
    readonly badges: ReadonlyArray<CatalogBadgeInput>;
    readonly viewerPersonId: PersonId;
  },
  limit = 2,
): ReadonlyArray<RareComboInsight> => {
  const holdersBySkill = new Map<SkillId, Set<PersonId>>();
  const viewerHeld = new Set<SkillId>();
  for (const s of input.skills) holdersBySkill.set(s.id, new Set());
  for (const b of input.badges) {
    holdersBySkill.get(b.skillId)?.add(b.personId);
    if (b.personId === input.viewerPersonId) viewerHeld.add(b.skillId);
  }
  const all = computeRareCombos(input.skills, holdersBySkill, viewerHeld, input.skills.length * 2);
  return all.filter((c) => c.skillIds[0] === skillId || c.skillIds[1] === skillId).slice(0, limit);
};
