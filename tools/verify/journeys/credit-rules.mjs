// Credit rules (design 2026-11-17 §2, §7): an advisor is refused; a program
// owner saves a change with a reason and the version goes up; a save from a
// stale version gets a conflict; a save without a reason is refused; the change
// is in the audit trail with the actor, the versions and the reason.
//
// Re-runnable: yes. The journey restores the policy it found (one more audited
// save). Do not run it at the same time as another journey: while it runs the
// tenant's secondary value differs from the working default.
export default {
  name: 'credit-rules',
  title: 'Credit rules: refused to an advisor, reasoned save, stale save conflicts, audited',
  rerunnable: true,
  personas: ['Maya Chen', 'Nadia Brooks', 'Rhea Castillo'],
  run: async (t) => {
    const maya = await t.as('Maya Chen');
    const nadia = await t.as('Nadia Brooks');
    const rhea = await t.as('Rhea Castillo');
    const reason = `QA check ${t.stamp}: agreed with the practice leads.`;

    const found = await t.step(
      'an advisor is refused; the program owner reads the rules',
      async () => {
        t.refused(await maya.get('/program/credit-policy'), 403, 'Forbidden', 'an advisor reads');
        const view = t.ok(await nadia.get('/program/credit-policy'), 'Nadia reads the rules');
        t.check(
          view.valid,
          `the stored policy is valid (problems: ${JSON.stringify(view.problems)})`,
        );
        t.refused(
          await maya.put('/program/credit-policy', {
            expectedVersion: view.version,
            policy: view.stored,
            reason,
          }),
          403,
          'Forbidden',
          'an advisor saves',
        );
        return view;
      },
    );

    const saved = await t.step(
      'a save needs a reason, bumps the version, and a stale save conflicts',
      async () => {
        const changed = { ...found.stored, secondaryPoints: found.stored.secondaryPoints + 1 };
        const save = (expectedVersion, why) =>
          nadia.put('/program/credit-policy', { expectedVersion, policy: changed, reason: why });
        t.refused(
          await save(found.version, 'Because.'),
          422,
          'Unprocessable',
          'a save without a reason',
        );
        const view = t.ok(await save(found.version, reason), 'Nadia saves with a reason');
        t.equal(view.version, found.version + 1, 'version after the save');
        t.equal(view.history[0]?.reason, reason, 'the reason is on the change history');
        t.equal(
          view.history[0]?.changes.map((c) => [c.field, c.before, c.after]),
          [['secondaryPoints', found.stored.secondaryPoints, changed.secondaryPoints]],
          'the change, before and after',
        );
        t.refused(
          await save(found.version, reason),
          409,
          'Conflict',
          'a save from the stale version',
        );
        return view;
      },
    );

    await t.step('the change is in the audit trail', async () => {
      const events = t.ok(
        await rhea.get('/admin/audit?entityType=credit_policy&limit=20'),
        'Rhea reads the audit trail',
      );
      const event = events.find((e) => e.toState === String(saved.version));
      t.check(event, `no credit_policy audit event to version ${saved.version}`);
      t.equal(
        [event.event, event.fromState, event.actor?.id, event.reason],
        ['REPLACE', String(found.version), nadia.id, reason],
        'the audit event',
      );
    });

    await t.step('the policy is restored', async () => {
      const restored = t.ok(
        await nadia.put('/program/credit-policy', {
          expectedVersion: saved.version,
          policy: found.stored,
          reason: `QA check ${t.stamp}: restore the values found.`,
        }),
        'Nadia restores the values',
      );
      t.equal(restored.stored, found.stored, 'the stored values after the restore');
    });
  },
};
