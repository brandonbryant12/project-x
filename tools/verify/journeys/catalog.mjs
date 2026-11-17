// Skill catalog and activity templates (design 2026-11-17 §7): a program owner
// drafts and publishes a skill version and a template; an advisor is refused
// the program screens but sees the published template; a template refuses two
// primaries; a retired skill is refused for new work.
//
// Re-runnable: yes. Names carry a run stamp, so each run creates its own skill
// and template; both are retired at the end, so they are never offered for new
// work (they stay in the program owner's lists, as retired items do).
import { today } from './common.mjs';

const levels = (prefix) =>
  [1, 2, 3, 4].map((level) => ({
    level,
    summary: `${prefix} at level ${level}.`,
    indicators: [
      { lineageKey: null, text: `${prefix}: names the concern, level ${level}` },
      { lineageKey: null, text: `${prefix}: answers with evidence, level ${level}` },
    ],
  }));

const publishTemplate = async (t, { nadia, maya, skillId, skill }) => {
  const explaining = t
    .ok(await maya.get('/catalog/skills'), 'skills')
    .find((c) => c.slug === 'explaining-simply')?.id;
  const input = (skills) => ({
    name: `First meeting with a referred client ${t.stamp}`,
    description: 'A first meeting with a client who came by referral.',
    kind: 'client_meeting',
    observationTip: 'Notice who sets the agenda.',
    typicalMinutes: 45,
    skills,
  });
  t.refused(
    await nadia.post(
      '/program/activity-templates',
      input([
        { skillId, role: 'primary', points: null },
        { skillId: explaining, role: 'primary', points: null },
      ]),
    ),
    422,
    'Unprocessable',
    'a template with two primaries',
  );
  const created = t.ok(
    await nadia.post(
      '/program/activity-templates',
      input([
        { skillId, role: 'primary', points: 12 },
        { skillId: explaining, role: 'secondary', points: null },
      ]),
    ),
    'Nadia drafts a template',
  );
  const published = t.ok(
    await nadia.post(`/program/activity-templates/${created.id}/transition`, {
      version: created.version,
      event: 'PUBLISH',
      note: null,
    }),
    'Nadia publishes the template',
  );
  t.equal(published.status, 'published', 'template status');
  const card = t
    .ok(await maya.get('/catalog/activity-templates'), 'Maya browses templates')
    .find((c) => c.id === created.id);
  t.equal(
    card?.skills.map((s) => [s.skill.slug, s.role, s.points]),
    [
      [skill.slug, 'primary', 12],
      ['explaining-simply', 'secondary', null],
    ],
    'the published template as an advisor sees it',
  );
  return published;
};

const retireSkill = async (t, { nadia, maya, skillId, skill, template }) => {
  const current = t.ok(await nadia.get(`/program/skills/${skill.slug}`), 'Nadia opens the skill');
  const retired = t.ok(
    await nadia.post(`/program/skills/${skill.slug}/transition`, {
      version: current.version,
      event: 'RETIRE',
      note: 'QA check: retired at the end of the run.',
    }),
    'Nadia retires the skill',
  );
  t.equal(retired.status, 'retired', 'skill status');
  const refused = t.refused(
    await maya.post('/interactions', {
      activityId: null,
      adHocTitle: 'Objection call',
      adHocSkillIds: [skillId],
      occurredOn: today(),
      kind: 'client_meeting',
      clientRef: null,
      reflection: 'Took a call about fees and answered the objection.',
    }),
    422,
    'Unprocessable',
    'logging work with a retired skill',
  );
  t.equal(refused.field, 'skills', 'the refused field');
  const latest = t.ok(
    await nadia.get(`/program/activity-templates/${template.id}`),
    'Nadia opens the template',
  );
  t.ok(
    await nadia.post(`/program/activity-templates/${template.id}/transition`, {
      version: latest.version,
      event: 'RETIRE',
      note: 'QA check: retired at the end of the run.',
    }),
    'Nadia retires the template',
  );
};

export default {
  name: 'catalog',
  title: 'Catalog: draft and publish a skill and a template; a retired skill is refused',
  rerunnable: true,
  personas: ['Nadia Brooks', 'Maya Chen'],
  run: async (t) => {
    const nadia = await t.as('Nadia Brooks');
    const maya = await t.as('Maya Chen');
    const name = `Handling objections ${t.stamp}`;

    const skill = await t.step(
      'the program owner drafts and publishes a skill; an advisor may not',
      async () => {
        t.refused(
          await maya.get('/program/skills'),
          403,
          'Forbidden',
          'an advisor lists program skills',
        );
        const created = t.ok(
          await nadia.post('/program/skills', {
            name,
            summary: 'Hears a client’s objection out and answers it with their own goals.',
            domain: 'communication',
            outcome: 'Client trust',
            tags: ['qa'],
          }),
          'Nadia creates a draft skill',
        );
        t.equal(
          [created.status, created.currentVersion],
          ['draft', null],
          'a new skill is a draft',
        );
        t.refused(
          await nadia.post(`/program/skills/${created.slug}/transition`, {
            version: created.version,
            event: 'PUBLISH',
            note: null,
          }),
          409,
          'InvalidTransition',
          'publishing a draft without its levels',
        );
        const drafted = t.ok(
          await nadia.put(`/program/skills/${created.slug}`, {
            version: created.version,
            name: created.name,
            summary: created.summary,
            domain: created.domain,
            outcome: created.outcome,
            tags: [...created.tags],
            definition: levels('Objection'),
          }),
          'Nadia writes the four levels',
        );
        const published = t.ok(
          await nadia.post(`/program/skills/${created.slug}/transition`, {
            version: drafted.version,
            event: 'PUBLISH',
            note: 'First version.',
          }),
          'Nadia publishes it',
        );
        t.equal(
          [published.status, published.currentVersion],
          ['published', 1],
          'published as version 1',
        );
        return published;
      },
    );

    const skillId = await t.step('the new skill is in the catalog everyone browses', async () => {
      const cards = t.ok(await maya.get('/catalog/skills'), 'Maya browses skills');
      const card = cards.find((c) => c.slug === skill.slug);
      t.check(card, `published skill ${skill.slug} is not in the catalog`);
      return card.id;
    });

    const template = await t.step('a template: two primaries refused; drafted and published', () =>
      publishTemplate(t, { nadia, maya, skillId, skill }),
    );

    await t.step('a retired skill is refused for new work', () =>
      retireSkill(t, { nadia, maya, skillId, skill, template }),
    );
  },
};
