// Small helpers the API journeys share. Payload shapes follow packages/api/src
// and the server's scenario tests (apps/server/src/journeys).

/** Today in the seeded tenant's time zone, as the server's business date. */
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

/** The current plan of the signed-in person, or of `personId` when given. */
export const planOf = async (t, client, personId) => {
  const view = t.ok(
    await client.get(personId ? `/people/${personId}/development` : '/development'),
    `${client.name} reads the plan`,
  );
  return view;
};

/** One piece of work logged on an activity (or ad hoc when activityId is null), today unless dated. */
export const logWork = async (
  t,
  client,
  { activityId, reflection, adHocTitle, adHocSkillIds, occurredOn },
) =>
  t.ok(
    await client.post('/interactions', {
      activityId: activityId ?? null,
      adHocTitle: adHocTitle ?? null,
      adHocSkillIds: adHocSkillIds ?? [],
      occurredOn: occurredOn ?? today(),
      kind: 'client_meeting',
      clientRef: null,
      reflection,
    }),
    `${client.name} logs work`,
  );

/** Asks one observer to look at a piece of work. */
export const ask = async (t, client, { interactionId, observerId, skillIds, mode = 'saw_it' }) =>
  t.ok(
    await client.post('/observations', {
      interactionId,
      observerId,
      mode,
      skillIds,
      note: null,
    }),
    `${client.name} asks for an observation`,
  );

/** The observer's signature: one level per rated skill, roles as stored unless given. */
export const signature = (view, { level = 2, roles, mode = 'saw_it' } = {}) => ({
  version: view.version,
  mode,
  ratings: view.ratings.map((r, i) => ({
    skillId: r.skill.id,
    level,
    indicatorIds: [],
    credit: true,
    ...(roles && { role: roles[i] }),
  })),
  narrativeSaw:
    'They asked what had changed for the household before showing any numbers, and summarized it back.',
  narrativeNext: 'Ask each partner separately about the trade-offs next time.',
});

/** A refusal tag from a response, for compact assertions. */
export const tagOf = (response) =>
  response.body && typeof response.body === 'object' ? response.body._tag : null;

/** Published skills by slug, as any signed-in person browses them. */
export const skillIds = async (t, client) => {
  const cards = t.ok(await client.get('/catalog/skills'), 'browse the skill catalog');
  return (slug) => {
    const card = cards.find((c) => c.slug === slug);
    t.check(card, `published skill "${slug}" is missing from the catalog`);
    return card.id;
  };
};

/** An ISO date `days` after today. */
export const addDays = (iso, days) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
