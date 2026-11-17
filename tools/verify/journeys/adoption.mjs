// The adoption view (ADR 0021, design 2026-11-17 §10): only program owners and
// tenant admins read it; it carries four aggregate figures and no names; a
// figure is withheld (null, never 0) unless it draws on at least five people,
// and "observed recently" is also withheld when the people with a plan who
// were not observed (its complement, found by subtraction) are fewer than five.
//
// From outside, the journey checks what a reader could check: every shown
// figure respects the minimum, and no shown pair reveals a smaller group. On
// the seeded firm "observed recently" comes back withheld (the complement is
// small); which population triggered a withholding is proven by the scenario
// test honest-aggregates and the domain tests in adoption.test.ts.
//
// Re-runnable: yes. It only reads.
const FIGURES = ['withPlan', 'observedRecently', 'medianDaysToSign', 'expiryRate'];

export default {
  name: 'adoption',
  title: 'Adoption: program owners only, aggregates only, small groups withheld',
  rerunnable: true,
  personas: ['Nadia Brooks', 'Rhea Castillo', 'Maya Chen', 'Sam Rivera'],
  run: async (t) => {
    const nadia = await t.as('Nadia Brooks');
    const rhea = await t.as('Rhea Castillo');
    const maya = await t.as('Maya Chen');
    const sam = await t.as('Sam Rivera');

    await t.step('an advisor and a coach are refused', async () => {
      t.refused(await maya.get('/adoption'), 403, 'Forbidden', 'an advisor reads adoption');
      t.refused(await sam.get('/adoption'), 403, 'Forbidden', 'a coach reads adoption');
    });

    const view = await t.step(
      'the program owner and the tenant admin read the same aggregates',
      async () => {
        const owner = t.ok(await nadia.get('/adoption'), 'Nadia reads adoption');
        const admin = t.ok(await rhea.get('/adoption'), 'Rhea reads adoption');
        t.equal(owner, admin, 'the same figures for both readers');
        t.equal(
          Object.keys(owner).toSorted(),
          ['asOf', 'minimumCell', ...FIGURES].toSorted(),
          'only aggregate fields (no names, no per-person rows)',
        );
        t.equal(owner.minimumCell, 5, 'minimum cell');
        return owner;
      },
    );

    await t.step('shown figures respect the minimum; withheld figures are null', async () => {
      for (const key of FIGURES)
        t.check(
          view[key] === null || (typeof view[key] === 'number' && view[key] >= 0),
          `${key} is a number or withheld (null): ${view[key]}`,
        );
      t.check(
        view.withPlan === null || view.withPlan >= 5,
        `withPlan shown below 5: ${view.withPlan}`,
      );
      if (view.withPlan === null)
        t.equal(view.observedRecently, null, 'observedRecently is withheld with withPlan');
      if (view.observedRecently !== null) {
        t.check(
          view.observedRecently >= 5,
          `observedRecently shown below 5: ${view.observedRecently}`,
        );
        t.check(
          view.withPlan - view.observedRecently >= 5,
          `the complement ${view.withPlan} - ${view.observedRecently} reveals a group under 5`,
        );
      }
    });

    await t.step('at least one figure is withheld on this data', async () => {
      // The seeded firm has a small complement for observedRecently. Changed data may not.
      if (!FIGURES.some((key) => view[key] === null))
        t.skip(
          'no figure is withheld on this data, so the withholding path was not reached; reseed with `pnpm verify env seed`',
        );
    });
  },
};
