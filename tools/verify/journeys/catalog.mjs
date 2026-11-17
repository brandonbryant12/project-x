// Skill catalog and activity templates (design 2026-11-17 §7): a program owner
// drafts and publishes a skill version and a template; an advisor is refused
// the program screens but sees the published template; a template refuses two
// primaries; a change to a template's skills, roles or values needs a reason
// (a change of words alone does not) and a stale edit is a conflict; a retired
// skill is refused for new work.
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
  return { published, input, explaining };
};

const REASON = 'Referred clients take a longer first meeting; the primary skill is worth more.';

/** Edits of the published template: words alone without a reason, values only with one. */
const reviseTemplate = async (t, { nadia, maya, skillId, template }) => {
  const { published, input, explaining } = template;
  const skills = (points) => [
    { skillId, role: 'primary', points },
    { skillId: explaining, role: 'secondary', points: null },
  ];
  const put = (version, points, reason, description) =>
    nadia.put(`/program/activity-templates/${published.id}`, {
      ...input(skills(points)),
      ...(description && { description }),
      version,
      reason,
    });
  const worded = t.ok(
    await put(
      published.version,
      12,
      null,
      'A first meeting with a client who came to us by referral.',
    ),
    'Nadia changes the words without a reason',
  );
  t.equal(worded.history[0]?.event, 'UPDATE', 'the edit is in the template’s history');
  const unexplained = t.refused(
    await put(worded.version, 15, null),
    422,
    'Unprocessable',
    'changing a value without a reason',
  );
  t.equal(unexplained.field, 'reason', 'the refused field');
  t.refused(
    await put(worded.version, 15, 'Longer'),
    422,
    'Unprocessable',
    'changing a value with a reason under 10 characters',
  );
  t.refused(
    await put(published.version, 15, REASON),
    409,
    'Conflict',
    'changing a value from a form loaded before the last edit',
  );
  const revalued = t.ok(
    await put(worded.version, 15, REASON),
    'Nadia changes the value with a reason',
  );
  t.equal(
    [revalued.history[0]?.event, revalued.history[0]?.reason],
    ['UPDATE', REASON],
    'the reason is kept with the change',
  );
  const card = t
    .ok(await maya.get('/catalog/activity-templates'), 'Maya browses templates')
    .find((c) => c.id === published.id);
  t.equal(
    card?.skills.find((s) => s.role === 'primary')?.points,
    15,
    'the new value an advisor sees',
  );
  return revalued;
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
  title:
    'Catalog: draft and publish a skill and a template; a template value needs a reason; a retired skill is refused',
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

    const drafted = await t.step('a template: two primaries refused; drafted and published', () =>
      publishTemplate(t, { nadia, maya, skillId, skill }),
    );

    const template = await t.step(
      'template edits: words without a reason; a value only with one; a stale edit refused',
      () => reviseTemplate(t, { nadia, maya, skillId, template: drafted }),
    );

    await t.step('a retired skill is refused for new work', () =>
      retireSkill(t, { nadia, maya, skillId, skill, template }),
    );
  },
};
