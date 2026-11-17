// An individual value on planned work (design 2026-11-17 §6): a coach adds
// work with roles to a coachee's plan; the subject can never set its value;
// the coach sets one within the tenant's range and with a reason; it applies
// from the day it was set, so work done before that day never gets it; an edit
// or a value sent from a form loaded before the change is a Conflict; once the
// work has an open observation the value can no longer change; the credit
// signed afterwards carries it with source `activity`.
//
// Re-runnable: yes. Each run adds new work to Tom's plan (coach: Jordan), logs
// two pieces of work on it (yesterday and today), has Jordan sign both and
// completes the work at the end.
import { addDays, ask, logWork, signature, skillIds, today } from './common.mjs';

const REASON = 'Complex household; the call takes a full afternoon of preparation.';

/** The people, skills and calls every step uses. */
const context = async (t) => {
  const jordan = await t.as('Jordan Blake');
  const tom = await t.as('Tom Whitaker');
  const skill = await skillIds(t, jordan);
  const coaching = skill('behavioral-coaching');
  const explaining = skill('explaining-simply');
  return {
    jordan,
    tom,
    coaching,
    explaining,
    roles: [
      { skillId: coaching, role: 'primary' },
      { skillId: explaining, role: 'secondary' },
    ],
    /** The work as `client` loads it now (Tom's own plan, or Tom's plan as Jordan). */
    load: async (client, activityId) => {
      const view = t.ok(
        await client.get(client.id === tom.id ? '/development' : `/people/${tom.id}/development`),
        `${client.name} opens Tom’s plan`,
      );
      const work = view.plan?.activities.find((a) => a.id === activityId);
      t.check(work, `work ${activityId} is not on Tom’s plan`);
      return work;
    },
    setValue: (client, activityId, points, { version, reason = REASON }) =>
      client.post(`/activities/${activityId}/value`, {
        version,
        skillId: coaching,
        points,
        reason,
      }),
  };
};

const addWork = async (t, { jordan, tom, roles }) => {
  const view = t.ok(await jordan.get(`/people/${tom.id}/development`), 'Jordan opens Tom’s plan');
  t.check(view.plan?.canAddWork, 'the coach may add work to the plan');
  t.check(view.plan.valueRange, 'the tenant allows individual values (valueRange)');
  const title = `Volatility call ${t.stamp}`;
  const added = t.ok(
    await jordan.post(`/plans/${view.plan.id}/activities`, {
      templateId: null,
      title,
      description: 'A call with a nervous long-standing client.',
      skills: roles,
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
};

const refusedValues = async (t, { jordan, tom, load, setValue }, activity) => {
  const { version } = await load(jordan, activity.id);
  t.refused(
    await setValue(tom, activity.id, 14, { version }),
    403,
    'Forbidden',
    'the subject sets a value',
  );
  t.refused(
    await setValue(jordan, activity.id, activity.range.max + 1, { version }),
    422,
    'Unprocessable',
    'a value above the tenant’s range',
  );
  t.refused(
    await setValue(jordan, activity.id, 14, { version, reason: ' '.repeat(12) }),
    422,
    'Unprocessable',
    'a value without a reason',
  );
};

const setByCoach = async (t, { jordan, tom, coaching, load, setValue }, activity) => {
  const loaded = await load(jordan, activity.id);
  t.ok(
    await setValue(jordan, activity.id, 14, { version: loaded.version }),
    'Jordan sets 14 points',
  );
  const work = await load(tom, activity.id);
  const value = work.skills.find((s) => s.skill.id === coaching);
  t.equal(value?.value, { points: 14, source: 'activity' }, 'the value Tom sees');
  t.equal(value?.override?.setBy.id, jordan.id, 'who set it');
  t.equal(value?.override?.appliesFrom, today(), 'the date of work it applies from');
  t.check(!work.canSetValue, 'Tom is offered no control');
  return { loaded, without: value.valueWithoutOverride };
};

const staleWrites = async (
  t,
  { jordan, tom, coaching, roles, load, setValue },
  activity,
  stale,
) => {
  t.refused(
    await jordan.patch(`/activities/${activity.id}`, {
      version: stale,
      title: activity.title,
      description: 'Rewritten from a form opened before the value was set.',
      skills: roles,
      dueOn: null,
      intendedObserverId: jordan.id,
      intendedMode: 'saw_it',
    }),
    409,
    'Conflict',
    'editing the work from a stale form',
  );
  t.refused(
    await setValue(jordan, activity.id, 12, { version: stale }),
    409,
    'Conflict',
    'setting a value from a stale form',
  );
  const work = await load(tom, activity.id);
  t.equal(
    work.skills.find((s) => s.skill.id === coaching)?.value,
    { points: 14, source: 'activity' },
    'the value after the stale writes',
  );
};

const creditsOf = (signed) =>
  signed.credits.map((c) => [c.skill.slug, c.role, c.points, c.pointsSource]);

const observed = async (t, ctx, { activity, yesterday, without }) => {
  const { jordan, tom, coaching, explaining, load, setValue } = ctx;
  const logged = await logWork(t, tom, {
    activityId: activity.id,
    reflection: 'Called a client after the drop and asked what the money was for first.',
  });
  const request = await ask(t, tom, {
    interactionId: logged.id,
    observerId: jordan.id,
    skillIds: [coaching, explaining],
  });
  const earlier = await ask(t, tom, {
    interactionId: yesterday.id,
    observerId: jordan.id,
    skillIds: [coaching],
  });
  const { version } = await load(jordan, activity.id);
  t.refused(
    await setValue(jordan, activity.id, 12, { version }),
    422,
    'Unprocessable',
    'changing the value once an observation is open',
  );
  const signed = t.ok(
    await jordan.post(`/observations/${request.id}/sign`, signature(request, { level: 2 })),
    'Jordan signs today’s work',
  );
  t.equal(
    creditsOf(signed),
    [
      ['behavioral-coaching', 'primary', 14, 'activity'],
      ['explaining-simply', 'secondary', 3, 'tenant'],
    ],
    'credits for work done today',
  );
  const fresh = t.ok(
    await jordan.get(`/observations/${earlier.id}`),
    'Jordan opens the request about yesterday',
  );
  const signedEarlier = t.ok(
    await jordan.post(`/observations/${fresh.id}/sign`, signature(fresh, { level: 2 })),
    'Jordan signs yesterday’s work',
  );
  t.equal(
    creditsOf(signedEarlier),
    [['behavioral-coaching', 'primary', without.points, without.source]],
    'credit for work done before the value was set (the value without it)',
  );
  t.ok(
    await tom.post(`/activities/${activity.id}/events`, { event: 'COMPLETE' }),
    'Tom completes the work',
  );
};

export default {
  name: 'individual-value',
  title:
    'Individual value: never the subject, in range with a reason, from the day set, fixed once observed',
  rerunnable: true,
  personas: ['Jordan Blake', 'Tom Whitaker'],
  run: async (t) => {
    const ctx = await context(t);
    const activity = await t.step('Jordan adds work with roles to Tom’s plan', () =>
      addWork(t, ctx),
    );
    const yesterday = await t.step(
      'Tom logs work on it dated yesterday, before anyone values it',
      () =>
        logWork(t, ctx.tom, {
          activityId: activity.id,
          occurredOn: addDays(today(), -1),
          reflection: 'Prepared for the call and listed what the client said last time.',
        }),
    );
    await t.step('the subject is refused; out of range and a missing reason are refused', () =>
      refusedValues(t, ctx, activity),
    );
    const valued = await t.step(
      'the coach sets a value with a reason; the subject sees it applies from today',
      () => setByCoach(t, ctx, activity),
    );
    await t.step('an edit or a value from a form loaded before the value was set is refused', () =>
      staleWrites(t, ctx, activity, valued.loaded.version),
    );
    await t.step('once observed, the value is fixed; it values today’s work, not yesterday’s', () =>
      observed(t, ctx, { activity, yesterday, without: valued.without }),
    );
  },
};
