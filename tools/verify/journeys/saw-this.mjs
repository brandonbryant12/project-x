// "I saw this" attaches to work already logged (design 2026-11-17 §9): the
// observer is offered the coachee's logged work (title and kind, never the
// reflection), attaches to it instead of recording it twice, cannot attach the
// same work twice or someone else's work, and signs.
//
// Re-runnable: yes. Each run logs a new piece of Tom's work for Jordan.
import { logWork, planOf, signature } from './common.mjs';

export default {
  name: 'saw-this',
  title: '"I saw this": offered logged work, attaches once, refuses others’ work, signs',
  rerunnable: true,
  personas: ['Tom Whitaker', 'Jordan Blake', 'Daniel Okafor'],
  run: async (t) => {
    const tom = await t.as('Tom Whitaker');
    const jordan = await t.as('Jordan Blake');
    const daniel = await t.as('Daniel Okafor');

    const work = await t.step(
      'Tom logs work; Jordan is offered it without the reflection',
      async () => {
        const view = await planOf(t, tom);
        const activity = view.plan?.activities.find((a) => a.title.startsWith('Volatility calls'));
        t.check(
          activity,
          'seeded activity "Volatility calls with long-standing clients" is missing',
        );
        const logged = await logWork(t, tom, {
          activityId: activity.id,
          reflection: 'Kept a nervous client on plan by asking what the money was for.',
        });
        const targets = t.ok(
          await jordan.get('/observations/targets'),
          'Jordan opens "I saw this"',
        );
        const offer = targets.people
          .find((p) => p.person.id === tom.id)
          ?.work.find((w) => w.id === logged.id);
        t.check(offer, 'Tom’s logged work is offered to his coach');
        t.check(!('reflection' in offer), 'the offer carries no reflection');
        return { ...logged, skillId: activity.skills[0].skill.id };
      },
    );

    const attached = await t.step(
      'Jordan attaches to it; not twice, and not to another’s work',
      async () => {
        const start = (interactionId) =>
          jordan.post('/observations/start', {
            subjectId: tom.id,
            interactionId,
            activityId: null,
            title: null,
            occurredOn: work.occurredOn,
            kind: 'client_meeting',
            mode: 'saw_it',
            skillIds: [work.skillId],
          });
        const danielWork = (await planOf(t, daniel)).plan?.activities
          .flatMap((a) => a.interactions)
          .at(0);
        t.check(danielWork, 'Daniel has logged work in the seed');
        t.refused(await start(danielWork.id), 404, 'NotFound', 'attaching Daniel’s work to Tom');
        const view = t.ok(await start(work.id), 'Jordan attaches');
        t.equal(view.interaction.id, work.id, 'the observation is about the logged work');
        t.refused(await start(work.id), 409, 'Conflict', 'attaching the same work again');
        return view;
      },
    );

    await t.step('Jordan signs the attached observation', async () => {
      const signed = t.ok(
        await jordan.post(`/observations/${attached.id}/sign`, signature(attached, { level: 2 })),
        'Jordan signs',
      );
      t.equal([signed.status, signed.credits.length], ['signed', 1], 'signed with one credit');
    });
  },
};
