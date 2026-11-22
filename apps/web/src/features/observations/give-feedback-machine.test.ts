import type { ObserveTarget, SkillRef } from '@repo/api';
import type { PersonId, SkillId } from '@repo/domain';
import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { createGiveFeedbackMachine, missingToPublish } from './give-feedback-machine.ts';

const skillA: SkillRef = {
  id: 'skl_1000000000000000' as SkillId,
  slug: 'client-discovery',
  name: 'Client discovery',
  domain: 'client_discovery',
};

const skillB: SkillRef = {
  id: 'skl_2000000000000000' as SkillId,
  slug: 'behavioral-coaching',
  name: 'Behavioral coaching',
  domain: 'behavioral_coaching',
};

const target: ObserveTarget = {
  person: {
    id: 'per_maya000000000000' as PersonId,
    displayName: 'Maya Chen',
    title: 'Financial Advisor',
    initials: 'MC',
    hue: 120,
  },
  basis: 'leader',
  activities: [],
  focusSkills: [skillA],
};

describe('giveFeedbackMachine', () => {
  it('blocks publishing until person, level, and narrative are provided', () => {
    const actor = createActor(createGiveFeedbackMachine(null)).start();
    expect(missingToPublish(actor.getSnapshot().context)).toBe('Choose who you observed');

    // Attempt to publish prematurely stays in editing.
    actor.send({ type: 'PUBLISH' });
    expect(actor.getSnapshot().value).toBe('editing');

    // Selecting a person pre-selects their first focus skill.
    actor.send({ type: 'CHOOSE_PERSON', target });
    expect(actor.getSnapshot().context.ratings).toHaveLength(1);
    expect(missingToPublish(actor.getSnapshot().context)).toBe('Pick a level for each skill');

    // Pick a level and add a note.
    actor.send({
      type: 'UPDATE_RATING',
      rating: { skillId: skillA.id, level: 3, indicatorIds: [], credit: true },
    });
    actor.send({
      type: 'SET_SAW',
      value: 'Maya summarized the couple’s retirement goals clearly before showing any numbers.',
    });
    expect(missingToPublish(actor.getSnapshot().context)).toBeNull();

    // Transitions cleanly into publishing and blocks duplicate edits while in flight.
    actor.send({ type: 'PUBLISH' });
    expect(actor.getSnapshot().value).toBe('publishing');

    // Failure returns to editing with the user's text preserved.
    actor.send({ type: 'FAILED', message: 'Network unavailable' });
    expect(actor.getSnapshot().value).toBe('editing');
    expect(actor.getSnapshot().context.error).toBe('Network unavailable');
    expect(actor.getSnapshot().context.narrativeSaw).toContain('retirement goals');
    actor.stop();
  });

  it('blocks publishing when local privacy check detects client PII', () => {
    const actor = createActor(createGiveFeedbackMachine(target)).start();
    actor.send({
      type: 'UPDATE_RATING',
      rating: { skillId: skillA.id, level: 2, indicatorIds: [], credit: true },
    });
    actor.send({
      type: 'SET_SAW',
      value: 'Spoke with Mrs. Patterson about account number 4417 2291.',
    });
    expect(missingToPublish(actor.getSnapshot().context)).toMatch(/client/i);
    actor.send({ type: 'PUBLISH' });
    expect(actor.getSnapshot().value).toBe('editing');
    actor.stop();
  });

  it('toggles additional skills cleanly up to the maximum', () => {
    const actor = createActor(createGiveFeedbackMachine(target)).start();
    actor.send({ type: 'TOGGLE_SKILL', skill: skillB });
    expect(actor.getSnapshot().context.ratings.map((r) => r.skillId)).toEqual([
      skillA.id,
      skillB.id,
    ]);
    actor.send({ type: 'TOGGLE_SKILL', skill: skillA });
    expect(actor.getSnapshot().context.ratings.map((r) => r.skillId)).toEqual([skillB.id]);
    actor.stop();
  });
});
