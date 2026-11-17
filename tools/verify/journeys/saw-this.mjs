// "I saw this" attaches to work already logged (design 2026-11-17 §9): the
// observer is offered the coachee's logged work (title and kind, never the
// reflection), attaches to it instead of recording it twice, cannot attach the
// same work twice or someone else's work, and signs. Logged work is
// development data (I47): a designated observer without development access to
// the person is offered none of it and cannot attach to it.
//
// Re-runnable: yes. Each run logs a new piece of Tom's work for Jordan. Priya
// (Tom's leader) designates Marcus to observe Tom for the run and ends the
// designation at the end of that step; one left active by an interrupted run is
// reused, and an ended one does not block the next run's designation.
import { addDays, logWork, planOf, signature, today } from './common.mjs';

/** Marcus's active designation to observe Tom, made by Priya unless one is still active. */
const designation = async (t, { priya, tom, marcus }) => {
  const listed = t.ok(await priya.get(`/people/${tom.id}/designations`), 'Priya lists them');
  const active = listed.find((d) => d.observer.id === marcus.id && d.active);
  if (active) return active;
  const on = today();
  return t.ok(
    await priya.post('/designations', {
      subjectId: tom.id,
      observerId: marcus.id,
      validFrom: on,
      validTo: addDays(on, 30),
    }),
    'Priya designates Marcus to observe Tom',
  );
};

export default {
  name: 'saw-this',
  title:
    '"I saw this": offered logged work, attaches once, refuses others’ work, signs; never to a designee without development access',
  rerunnable: true,
  personas: ['Tom Whitaker', 'Jordan Blake', 'Daniel Okafor', 'Priya Raman', 'Marcus Hill'],
  run: async (t) => {
    const tom = await t.as('Tom Whitaker');
    const jordan = await t.as('Jordan Blake');
    const daniel = await t.as('Daniel Okafor');
    const priya = await t.as('Priya Raman');
    const marcus = await t.as('Marcus Hill');

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

    await t.step(
      'a designee without development access is offered none of Tom’s work and cannot attach',
      async () => {
        const named = await designation(t, { priya, tom, marcus });
        const targets = t.ok(
          await marcus.get('/observations/targets'),
          'Marcus opens "I saw this"',
        );
        const target = targets.people.find((p) => p.person.id === tom.id);
        t.check(target, 'the designee may observe Tom');
        t.equal(target.work, [], 'Tom’s logged work offered to the designee');
        t.refused(
          await marcus.post('/observations/start', {
            subjectId: tom.id,
            interactionId: work.id,
            activityId: null,
            title: null,
            occurredOn: work.occurredOn,
            kind: 'client_meeting',
            mode: 'saw_it',
            skillIds: [work.skillId],
          }),
          404,
          'NotFound',
          'the designee attaches to Tom’s logged work',
        );
        const ended = t.ok(
          await priya.post(`/designations/${named.id}/end`),
          'Priya ends the designation',
        );
        t.equal(ended.active, false, 'the designation is no longer active');
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
