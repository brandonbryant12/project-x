// Coaching proposals (design 2026-11-17 §11): between two coaches with no
// engagement the profile offers both directions; a proposal is made; the pair
// is then offered nothing and the reverse is refused as a conflict; someone who
// is not a coach is never offered, and cannot propose, coaching another person.
//
// Re-runnable: yes. Sam's proposal to Jordan is withdrawn at the end, which
// leaves the pair as it was (a withdrawn proposal is history, not a live
// engagement). A proposal left live by an interrupted run is withdrawn first.

const directions = async (t, viewer, of) =>
  t.ok(await viewer.get(`/people/${of.id}`), `${viewer.name} opens ${of.name}`).coachingDirections;

export default {
  name: 'coaching-proposal',
  title: 'Coaching proposal: both directions between coaches; the forbidden direction refused',
  rerunnable: true,
  personas: ['Sam Rivera', 'Jordan Blake', 'Maya Chen', 'Grace Liu'],
  run: async (t) => {
    const sam = await t.as('Sam Rivera');
    const jordan = await t.as('Jordan Blake');
    const maya = await t.as('Maya Chen');
    const grace = await t.as('Grace Liu');

    await t.step('two coaches are offered both directions, from either side', async () => {
      // A proposal left live by an interrupted run is withdrawn first.
      const coaching = t.ok(await sam.get('/coaching'), 'Sam opens coaching');
      for (const e of coaching.asCoachee.filter(
        (x) => x.coach.id === jordan.id && x.status === 'proposed',
      ))
        t.ok(await sam.post(`/engagements/${e.id}/events`, { event: 'WITHDRAW' }), 'withdraw');
      t.equal(await directions(t, sam, jordan), ['coach_them', 'coach_me'], 'Sam viewing Jordan');
      t.equal(await directions(t, jordan, sam), ['coach_them', 'coach_me'], 'Jordan viewing Sam');
      t.equal(await directions(t, maya, jordan), ['coach_me'], 'an advisor viewing a coach');
      t.equal(await directions(t, maya, grace), [], 'an advisor viewing an advisor');
    });

    const proposal = await t.step(
      'Sam asks Jordan to coach him; the pair is offered nothing more',
      async () => {
        const proposed = t.ok(
          await sam.post('/engagements', {
            coachId: jordan.id,
            coacheeId: sam.id,
            note: 'Help me run better huddles.',
          }),
          'Sam proposes',
        );
        t.equal([proposed.status, proposed.coach.id], ['proposed', jordan.id], 'the proposal');
        t.equal(await directions(t, sam, jordan), [], 'Sam viewing Jordan after proposing');
        t.refused(
          await jordan.post('/engagements', { coachId: sam.id, coacheeId: jordan.id, note: null }),
          409,
          'Conflict',
          'the reverse proposal while one is live',
        );
        return proposed;
      },
    );

    await t.step('the forbidden direction: an advisor proposing to coach someone', async () => {
      t.refused(
        await maya.post('/engagements', { coachId: maya.id, coacheeId: grace.id, note: null }),
        422,
        'Unprocessable',
        'Maya (not a coach) proposes to coach Grace',
      );
    });

    await t.step('Sam withdraws the proposal; both directions are offered again', async () => {
      const withdrawn = t.ok(
        await sam.post(`/engagements/${proposal.id}/events`, { event: 'WITHDRAW' }),
        'Sam withdraws',
      );
      t.equal(withdrawn.status, 'withdrawn', 'status');
      t.equal(await directions(t, sam, jordan), ['coach_them', 'coach_me'], 'Sam viewing Jordan');
    });
  },
};
