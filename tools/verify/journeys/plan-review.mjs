// Plans (design 2026-11-17 §8): the owner edits, an agreer adds work with
// roles, a revision of an agreed plan clears the agreement and it is agreed
// again, the closing review is recorded by the owner and confirmed by an
// agreer (never the owner or a skip-level leader), it writes no credit or
// badge, and a closed plan refuses edits.
//
// Marcus has no coach, so his leader Priya is the agreer (the engaged coach
// agrees when there is one; a coach adding work is exercised by the
// individual-value journey).
//
// Re-runnable: yes. Each run creates Marcus's plan and ends by canceling it; a
// plan left open by an interrupted run is canceled first.
import { addDays, planOf, skillIds, today } from './common.mjs';

const event = async (t, client, planId, name) =>
  t.ok(
    await client.post(`/plans/${planId}/events`, { event: name }),
    `${client.name} sends ${name}`,
  );

const addWork = async (t, { priya, plan, coaching, skill }) => {
  const work = (skills) => ({
    templateId: null,
    title: 'Calls after market drops',
    description: 'Call long-standing clients within a day of a sharp fall.',
    skills,
    dueOn: null,
    intendedObserverId: priya.id,
    intendedMode: 'saw_it',
  });
  t.refused(
    await priya.post(
      `/plans/${plan.id}/activities`,
      work([
        { skillId: coaching, role: 'primary' },
        { skillId: skill('explaining-simply'), role: 'primary' },
      ]),
    ),
    422,
    'Unprocessable',
    'work with two primary skills',
  );
  const added = t.ok(
    await priya.post(
      `/plans/${plan.id}/activities`,
      work([
        { skillId: coaching, role: 'primary' },
        { skillId: skill('explaining-simply'), role: 'secondary' },
      ]),
    ),
    'Priya adds work',
  );
  t.equal(
    added.activities[0]?.skills.map((s) => [s.skill.slug, s.role]),
    [
      ['behavioral-coaching', 'primary'],
      ['explaining-simply', 'secondary'],
    ],
    'roles on the added work',
  );
};

const closingReview = async (t, { marcus, priya, rhea, plan, coaching }) => {
  const ledger = async () => {
    const view = await planOf(t, marcus);
    const profile = t.ok(await marcus.get(`/people/${marcus.id}`), 'Marcus’s profile');
    return {
      progress: [...(view.plan?.progress ?? []), ...view.otherProgress].map((p) => [
        p.skill.slug,
        p.points,
      ]),
      badges: profile.badges.length,
    };
  };
  const before = await ledger();
  const review = {
    outcomes: [{ skillId: coaching, outcome: 'partly' }],
    summary: 'Calmer calls; I still rush to reassure before asking.',
  };
  t.refused(
    await priya.post(`/plans/${plan.id}/review`, review),
    403,
    'Forbidden',
    'the agreer records the owner’s review',
  );
  const recorded = t.ok(await marcus.post(`/plans/${plan.id}/review`, review), 'Marcus records it');
  t.equal(recorded.review?.confirmedBy ?? null, null, 'not yet confirmed');
  t.refused(
    await marcus.post(`/plans/${plan.id}/review/confirm`),
    403,
    'Forbidden',
    'the owner confirms his own review',
  );
  t.refused(
    await rhea.post(`/plans/${plan.id}/review/confirm`),
    403,
    'Forbidden',
    'a skip-level leader confirms',
  );
  const confirmed = t.ok(await priya.post(`/plans/${plan.id}/review/confirm`), 'Priya confirms');
  t.equal(confirmed.review?.confirmedBy?.id, priya.id, 'confirmed by');
  t.refused(
    await marcus.post(`/plans/${plan.id}/events`, { event: 'REVISE' }),
    409,
    'InvalidTransition',
    'revising after a confirmed review',
  );
  t.refused(
    await marcus.post(`/plans/${plan.id}/review`, review),
    422,
    'Unprocessable',
    'recording a confirmed review again',
  );
  t.equal(await ledger(), before, 'progress points and badges after the review');
};

export default {
  name: 'plan-review',
  title: 'Plan: edit, add work with roles, revise, agree again, closing review, closed',
  rerunnable: true,
  personas: ['Marcus Hill', 'Priya Raman', 'Rhea Castillo'],
  run: async (t) => {
    const marcus = await t.as('Marcus Hill');
    const priya = await t.as('Priya Raman');
    const rhea = await t.as('Rhea Castillo');
    const skill = await skillIds(t, marcus);
    const coaching = skill('behavioral-coaching');

    const plan = await t.step('Marcus drafts a plan and edits it; his leader may not', async () => {
      const current = (await planOf(t, marcus)).plan;
      if (current && !['completed', 'canceled', 'expired'].includes(current.status))
        await event(t, marcus, current.id, 'CANCEL');
      const on = today();
      const created = t.ok(
        await marcus.post('/plans', {
          title: 'Calm volatility calls',
          intent: 'Keep clients invested when markets fall.',
          periodStart: on,
          periodEnd: addDays(on, 90),
          focusSkills: [{ skillId: coaching, targetLevel: 2 }],
        }),
        'Marcus creates a plan',
      );
      t.equal(created.status, 'draft', 'a new plan is a draft');
      const edited = t.ok(
        await marcus.patch(`/plans/${created.id}`, { title: 'Steady volatility calls' }),
        'Marcus edits his plan',
      );
      t.equal(edited.title, 'Steady volatility calls', 'title after the owner’s edit');
      t.refused(
        await priya.patch(`/plans/${created.id}`, { title: 'Priya’s words' }),
        403,
        'Forbidden',
        'the leader edits the owner’s words',
      );
      return created;
    });

    await t.step('the agreer adds work with roles; two primaries are refused', () =>
      addWork(t, { priya, plan, coaching, skill }),
    );

    await t.step('agreed, then revised back to a draft and agreed again', async () => {
      await event(t, marcus, plan.id, 'PROPOSE');
      t.equal((await event(t, priya, plan.id, 'AGREE')).status, 'active', 'status after AGREE');
      t.refused(
        await marcus.patch(`/plans/${plan.id}`, {
          focusSkills: [{ skillId: skill('transparency'), targetLevel: 2 }],
        }),
        422,
        'Unprocessable',
        'changing focus skills of an active plan',
      );
      const draft = await event(t, priya, plan.id, 'REVISE');
      t.equal([draft.status, draft.agreedBy], ['draft', null], 'REVISE clears the agreement');
      await event(t, marcus, plan.id, 'PROPOSE');
      const agreed = await event(t, priya, plan.id, 'AGREE');
      t.equal([agreed.status, agreed.agreedBy?.id], ['active', priya.id], 'agreed again');
    });

    await t.step('closing review: recorded by the owner, confirmed by the agreer, no credit', () =>
      closingReview(t, { marcus, priya, rhea, plan, coaching }),
    );

    await t.step('a closed plan refuses edits', async () => {
      t.equal((await event(t, marcus, plan.id, 'CANCEL')).status, 'canceled', 'status');
      t.refused(
        await marcus.patch(`/plans/${plan.id}`, { title: 'Rewritten after the fact' }),
        422,
        'Unprocessable',
        'editing a canceled plan',
      );
    });
  },
};
