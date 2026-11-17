// An individual value on planned work (design 2026-11-17 §6): a coach adds
// work with roles to a coachee's plan; the subject can never set its value;
// the coach sets one within the tenant's range and with a reason; once the work
// has an open observation the value can no longer change; the credit signed
// afterwards carries it with source `activity`.
//
// Re-runnable: yes. Each run adds new work to Tom's plan (coach: Jordan) and
// completes it at the end.
import { ask, logWork, signature, skillIds } from './common.mjs';

const REASON = 'Complex household; the call takes a full afternoon of preparation.';

export default {
  name: 'individual-value',
  title: 'Individual value: never the subject, in range with a reason, fixed once observed',
  rerunnable: true,
  personas: ['Jordan Blake', 'Tom Whitaker'],
  run: async (t) => {
    const jordan = await t.as('Jordan Blake');
    const tom = await t.as('Tom Whitaker');
    const skill = await skillIds(t, jordan);
    const coaching = skill('behavioral-coaching');
    const explaining = skill('explaining-simply');
    const setValue = (client, activityId, points, reason = REASON) =>
      client.post(`/activities/${activityId}/value`, { skillId: coaching, points, reason });

    const activity = await t.step('Jordan adds work with roles to Tom’s plan', async () => {
      const view = t.ok(
        await jordan.get(`/people/${tom.id}/development`),
        'Jordan opens Tom’s plan',
      );
      t.check(view.plan?.canAddWork, 'the coach may add work to the plan');
      t.check(view.plan.valueRange, 'the tenant allows individual values (valueRange)');
      const title = `Volatility call ${t.stamp}`;
      const added = t.ok(
        await jordan.post(`/plans/${view.plan.id}/activities`, {
          templateId: null,
          title,
          description: 'A call with a nervous long-standing client.',
          skills: [
            { skillId: coaching, role: 'primary' },
            { skillId: explaining, role: 'secondary' },
          ],
          dueOn: null,
          intendedObserverId: jordan.id,
          intendedMode: 'saw_it',
        }),
        'Jordan adds work',
      );
      const work = added.activities.find((a) => a.title === title);
      t.check(work, 'the added work is on the plan');
      t.check(work.canSetValue, 'the coach is offered "set a value"');
      return { ...work, range: view.plan.valueRange };
    });

    await t.step(
      'the subject is refused; out of range and a missing reason are refused',
      async () => {
        t.refused(
          await setValue(tom, activity.id, 14),
          403,
          'Forbidden',
          'the subject sets a value',
        );
        t.refused(
          await setValue(jordan, activity.id, activity.range.max + 1),
          422,
          'Unprocessable',
          'a value above the tenant’s range',
        );
        t.refused(
          await setValue(jordan, activity.id, 14, ' '.repeat(12)),
          422,
          'Unprocessable',
          'a value without a reason',
        );
      },
    );

    await t.step('the coach sets a value with a reason; the subject sees it', async () => {
      t.ok(await setValue(jordan, activity.id, 14), 'Jordan sets 14 points');
      const seen = t.ok(await tom.get('/development'), 'Tom reads his plan');
      const work = seen.plan.activities.find((a) => a.id === activity.id);
      const value = work?.skills.find((s) => s.skill.id === coaching);
      t.equal(value?.value, { points: 14, source: 'activity' }, 'the value Tom sees');
      t.equal(value?.override?.setBy.id, jordan.id, 'who set it');
      t.check(!work.canSetValue, 'Tom is offered no control');
    });

    await t.step('once observed, the value is fixed; the signed credit carries it', async () => {
      const logged = await logWork(t, tom, {
        activityId: activity.id,
        reflection: 'Called a client after the drop and asked what the money was for first.',
      });
      const request = await ask(t, tom, {
        interactionId: logged.id,
        observerId: jordan.id,
        skillIds: [coaching, explaining],
      });
      t.refused(
        await setValue(jordan, activity.id, 12),
        422,
        'Unprocessable',
        'changing the value once an observation is open',
      );
      const signed = t.ok(
        await jordan.post(`/observations/${request.id}/sign`, signature(request, { level: 2 })),
        'Jordan signs',
      );
      t.equal(
        signed.credits.map((c) => [c.skill.slug, c.role, c.points, c.pointsSource]),
        [
          ['behavioral-coaching', 'primary', 14, 'activity'],
          ['explaining-simply', 'secondary', 3, 'tenant'],
        ],
        'credits',
      );
      t.ok(
        await tom.post(`/activities/${activity.id}/events`, { event: 'COMPLETE' }),
        'Tom completes the work',
      );
    });
  },
};
