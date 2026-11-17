// "How this was earned" (I13, I33, I48): a badge is visible to everyone in the
// tenant, but its points, thresholds and per-credit detail are development
// data. The holder and their coach get the detail (every credit marked counted
// or not, and reversed or not; at most one counted per piece of work); a
// colleague with no development access gets the badge and the plain facts
// only: no points, no thresholds, no work, no observers' words. A badge asked
// for under someone who does not hold it is not found.
//
// Re-runnable: yes. It only reads Maya's seeded badges.

export default {
  name: 'badge-receipt',
  title: 'Badge receipt: detail for the holder and coach, badge and facts only for a colleague',
  rerunnable: true,
  personas: ['Maya Chen', 'Sam Rivera', 'Marcus Hill'],
  run: async (t) => {
    const maya = await t.as('Maya Chen');
    const sam = await t.as('Sam Rivera');
    const marcus = await t.as('Marcus Hill');
    const receipt = (client, badgeId, holderId = maya.id) =>
      client.get(`/people/${holderId}/badges/${badgeId}`);

    const { badge, own } = await t.step(
      'the holder reads how her badge was earned, credit by credit',
      async () => {
        const profile = t.ok(await maya.get(`/people/${maya.id}`), 'Maya opens her profile');
        const held = profile.badges[0];
        t.check(held, 'Maya holds no badge in the seed');
        const mine = t.ok(await receipt(maya, held.id), 'Maya opens the receipt');
        t.equal([mine.detailVisible, mine.narrativesVisible], [true, true], 'what the holder sees');
        t.check(typeof mine.points === 'number', 'the holder sees the points that count');
        t.check(mine.required, 'the holder sees the thresholds saved on the award');
        t.check(mine.work.length > 0, 'the holder sees the work behind the badge');
        for (const work of mine.work) {
          t.check(
            work.credits.every((c) => typeof c.reversed === 'boolean'),
            `every credit of work ${work.interactionId} says whether it was reversed`,
          );
          t.check(
            work.credits.filter((c) => c.counted).length <= 1,
            `at most one credit counted for work ${work.interactionId}`,
          );
          t.check(
            work.credits.every((c) => !(c.counted && c.reversed)),
            `a reversed credit counted for work ${work.interactionId}`,
          );
        }
        return { badge: held, own: mine };
      },
    );

    await t.step('her coach sees the same detail', async () => {
      const coach = t.ok(await receipt(sam, badge.id), 'Sam opens the receipt');
      t.equal(
        [coach.detailVisible, coach.points, coach.work.length],
        [true, own.points, own.work.length],
        'what the coach sees',
      );
    });

    await t.step('an unrelated colleague sees the badge and plain facts, no detail', async () => {
      const profile = t.ok(await marcus.get(`/people/${maya.id}`), 'Marcus opens Maya’s profile');
      t.equal(profile.developmentVisible, false, 'Marcus has no development access to Maya');
      t.check(
        profile.badges.some((b) => b.id === badge.id),
        'the badge is visible tenant-wide',
      );
      const colleague = t.ok(await receipt(marcus, badge.id), 'Marcus opens the receipt');
      t.equal(
        {
          detailVisible: colleague.detailVisible,
          narrativesVisible: colleague.narrativesVisible,
          points: colleague.points,
          required: colleague.required,
          work: colleague.work,
        },
        { detailVisible: false, narrativesVisible: false, points: null, required: null, work: [] },
        'what a colleague without development access sees',
      );
      t.equal(colleague.badge.id, badge.id, 'the badge itself');
      t.check(
        colleague.facts.length > 0 && !/points/.test(colleague.facts),
        `the plain facts carry no points: "${colleague.facts}"`,
      );
    });

    await t.step('a badge asked for under someone who does not hold it is not found', async () => {
      t.refused(
        await receipt(marcus, badge.id, marcus.id),
        404,
        'NotFound',
        'Maya’s badge under Marcus',
      );
    });
  },
};
