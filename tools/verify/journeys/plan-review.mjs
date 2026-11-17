// Plans (design 2026-11-17 §8): the owner edits, an agreer adds work with
// roles, a revision of an agreed plan clears the agreement and it is agreed
// again, the closing review is recorded by the owner, waits on the agreer's
// Home and is confirmed by an agreer (never the owner or a skip-level leader),
// it writes no credit or badge, and a closed plan refuses edits. Every plan
// write sends the version the person loaded: an edit from a stale form,
// agreeing to a plan the owner changed since, or confirming a review recorded
// again since, is a Conflict.
//
// Marcus has no coach, so his leader Priya is the agreer (the engaged coach
// agrees when there is one; a coach adding work is exercised by the
// individual-value journey).
//
// Re-runnable: yes. Each run creates Marcus's plan and ends by canceling it; a
// plan left open by an interrupted run is canceled first.
import { addDays, planOf, skillIds, today } from './common.mjs';

/** A lifecycle event on the plan as `seen` (any view carrying its id and version). */
const event = async (t, client, seen, name) =>
  t.ok(
    await client.post(`/plans/${seen.id}/events`, { event: name, version: seen.version }),
    `${client.name} sends ${name}`,
  );

/** Marcus's plan as `client` loads it now (his own page, or his page as another person). */
const reload = async (t, client, marcus) =>
  (await planOf(t, client, client.id === marcus.id ? undefined : marcus.id)).plan;

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
  return added;
};

/** Priya's Home: the "Waiting on you" item for this plan's closing review, if any. */
const reviewWaiting = async (t, priya, plan) => {
  const home = t.ok(await priya.get('/home'), 'Priya opens Home');
  return {
    item: home.needsYou.find((i) => i.kind === 'confirm_review' && i.id === plan.id),
    shown: home.needsYou.length,
    total: home.needsYouTotal,
  };
};

const FIRST_SUMMARY = 'Calmer calls; I still rush to reassure before asking.';
const SECOND_SUMMARY = 'Calmer calls. I now ask what the money is for before I reassure.';

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
  const review = (version, summary = FIRST_SUMMARY) => ({
    version,
    outcomes: [{ skillId: coaching, outcome: 'partly' }],
    summary,
  });
  t.refused(
    await priya.post(`/plans/${plan.id}/review`, review(plan.version)),
    403,
    'Forbidden',
    'the agreer records the owner’s review',
  );
  t.refused(
    await marcus.post(`/plans/${plan.id}/review`, review(plan.version - 1)),
    409,
    'Conflict',
    'recording the review on a plan changed since it was loaded',
  );
  const recorded = t.ok(
    await marcus.post(`/plans/${plan.id}/review`, review(plan.version)),
    'Marcus records it',
  );
  t.equal(recorded.review?.confirmedBy ?? null, null, 'not yet confirmed');
  const waiting = await reviewWaiting(t, priya, plan);
  t.check(
    waiting.item,
    `the review is not in Priya’s "Waiting on you" (${waiting.shown} shown of ${waiting.total})`,
  );
  t.equal(waiting.item.actionLabel, 'Read and confirm', 'the Home action');

  // Priya reads the review; Marcus records it again before she confirms.
  const seenByPriya = await reload(t, priya, marcus);
  t.check(seenByPriya.canConfirmReview, 'Priya is offered "Confirm review"');
  const rerecorded = t.ok(
    await marcus.post(`/plans/${plan.id}/review`, review(recorded.version, SECOND_SUMMARY)),
    'Marcus records it again',
  );
  t.refused(
    await priya.post(`/plans/${plan.id}/review/confirm`, { version: seenByPriya.version }),
    409,
    'Conflict',
    'confirming the review as it was before it was recorded again',
  );
  t.refused(
    await marcus.post(`/plans/${plan.id}/review/confirm`, { version: rerecorded.version }),
    403,
    'Forbidden',
    'the owner confirms his own review',
  );
  t.refused(
    await rhea.post(`/plans/${plan.id}/review/confirm`, { version: rerecorded.version }),
    403,
    'Forbidden',
    'a skip-level leader confirms',
  );
  const reread = await reload(t, priya, marcus);
  t.equal(reread.closingSummary, SECOND_SUMMARY, 'the summary Priya reads after reloading');
  const confirmed = t.ok(
    await priya.post(`/plans/${plan.id}/review/confirm`, { version: reread.version }),
    'Priya confirms after reloading',
  );
  t.equal(confirmed.review?.confirmedBy?.id, priya.id, 'confirmed by');
  t.check(
    !(await reviewWaiting(t, priya, plan)).item,
    'a confirmed review still waits on Priya’s Home',
  );
  t.refused(
    await marcus.post(`/plans/${plan.id}/events`, { event: 'REVISE', version: confirmed.version }),
    409,
    'InvalidTransition',
    'revising after a confirmed review',
  );
  t.refused(
    await marcus.post(`/plans/${plan.id}/review`, review(confirmed.version)),
    422,
    'Unprocessable',
    'recording a confirmed review again',
  );
  t.equal(await ledger(), before, 'progress points and badges after the review');
  return confirmed;
};

export default {
  name: 'plan-review',
  title: 'Plan: edit, add work, revise, agree again, closing review, closed; stale writes refused',
  rerunnable: true,
  personas: ['Marcus Hill', 'Priya Raman', 'Rhea Castillo'],
  run: async (t) => {
    const marcus = await t.as('Marcus Hill');
    const priya = await t.as('Priya Raman');
    const rhea = await t.as('Rhea Castillo');
    const skill = await skillIds(t, marcus);
    const coaching = skill('behavioral-coaching');

    const edited = await t.step(
      'Marcus drafts a plan and edits it; a stale edit and his leader’s edit are refused',
      async () => {
        const current = (await planOf(t, marcus)).plan;
        if (current && !['completed', 'canceled', 'expired'].includes(current.status))
          await event(t, marcus, current, 'CANCEL');
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
        const changed = t.ok(
          await marcus.patch(`/plans/${created.id}`, {
            version: created.version,
            title: 'Steady volatility calls',
          }),
          'Marcus edits his plan',
        );
        t.equal(changed.title, 'Steady volatility calls', 'title after the owner’s edit');
        t.refused(
          await marcus.patch(`/plans/${created.id}`, {
            version: created.version,
            title: 'From a form opened before the edit',
          }),
          409,
          'Conflict',
          'an edit from a form loaded before the last edit',
        );
        t.refused(
          await priya.patch(`/plans/${created.id}`, {
            version: changed.version,
            title: 'Priya’s words',
          }),
          403,
          'Forbidden',
          'the leader edits the owner’s words',
        );
        return changed;
      },
    );

    const withWork = await t.step(
      'the agreer adds work with roles; two primaries are refused',
      () => addWork(t, { priya, plan: edited, coaching, skill }),
    );

    const agreed = await t.step(
      'agreed only as last read; revised back to a draft and agreed again',
      async () => {
        const proposed = await event(t, marcus, withWork, 'PROPOSE');
        const seenByPriya = await reload(t, priya, marcus);
        const moved = t.ok(
          await marcus.patch(`/plans/${proposed.id}`, {
            version: proposed.version,
            periodEnd: addDays(proposed.periodEnd, 30),
          }),
          'Marcus moves the end date while Priya reads',
        );
        t.refused(
          await priya.post(`/plans/${proposed.id}/events`, {
            event: 'AGREE',
            version: seenByPriya.version,
          }),
          409,
          'Conflict',
          'agreeing to the plan as it was before the owner changed it',
        );
        const first = await event(t, priya, moved, 'AGREE');
        t.equal(first.status, 'active', 'status after AGREE');
        t.refused(
          await marcus.patch(`/plans/${first.id}`, {
            version: first.version,
            focusSkills: [{ skillId: skill('transparency'), targetLevel: 2 }],
          }),
          422,
          'Unprocessable',
          'changing focus skills of an active plan',
        );
        const draft = await event(t, priya, first, 'REVISE');
        t.equal([draft.status, draft.agreedBy], ['draft', null], 'REVISE clears the agreement');
        const again = await event(t, marcus, draft, 'PROPOSE');
        const second = await event(t, priya, again, 'AGREE');
        t.equal([second.status, second.agreedBy?.id], ['active', priya.id], 'agreed again');
        return second;
      },
    );

    const reviewed = await t.step(
      'closing review: recorded by the owner, waits on the agreer’s Home, confirmed as read, no credit',
      () => closingReview(t, { marcus, priya, rhea, plan: agreed, coaching }),
    );

    await t.step('a closed plan refuses edits', async () => {
      const canceled = await event(t, marcus, reviewed, 'CANCEL');
      t.equal(canceled.status, 'canceled', 'status');
      t.refused(
        await marcus.patch(`/plans/${canceled.id}`, {
          version: canceled.version,
          title: 'Rewritten after the fact',
        }),
        422,
        'Unprocessable',
        'editing a canceled plan',
      );
    });
  },
};
