// Weighted credit (design 2026-11-17 §2, §4, §5): an observer signs with a
// primary and a secondary skill; each credit carries its role, points and
// source; a second observer of the same work adds no points to progress; the
// subject can never write roles; two primaries are refused.
//
// Re-runnable: yes. Each run logs a new piece of Daniel's work and asks his
// coach (Sam) and his leader (Leo) to observe it.
import { ask, logWork, planOf, signature } from './common.mjs';

const progressOf = (view, slug) =>
  [...(view.plan?.progress ?? []), ...view.otherProgress].find((p) => p.skill.slug === slug);

export default {
  name: 'weighted-credit',
  title: 'Weighted credit: roles, points and sources; one piece of work counts once',
  rerunnable: true,
  personas: ['Daniel Okafor', 'Sam Rivera', 'Leo Okonkwo'],
  run: async (t) => {
    const daniel = await t.as('Daniel Okafor');
    const sam = await t.as('Sam Rivera');
    const leo = await t.as('Leo Okonkwo');

    const { work, requests, before } = await t.step(
      'Daniel logs work and asks Sam and Leo to observe two skills',
      async () => {
        const view = await planOf(t, daniel);
        const activity = view.plan?.activities.find((a) => a.title.startsWith('Walk households'));
        t.check(activity, 'seeded activity "Walk households through proposals" is missing');
        t.equal(
          activity.skills.map((s) => [s.skill.slug, s.role]),
          [
            ['explaining-simply', 'primary'],
            ['goals-based-planning', 'secondary'],
          ],
          'the activity carries a primary and a secondary skill',
        );
        const logged = await logWork(t, daniel, {
          activityId: activity.id,
          reflection: 'Walked a couple through their proposal with a one-page timeline drawing.',
        });
        const skillIds = activity.skills.map((s) => s.skill.id);
        const asked = [];
        for (const observer of [sam, leo])
          asked.push(
            await ask(t, daniel, { interactionId: logged.id, observerId: observer.id, skillIds }),
          );
        t.equal(
          asked[0].ratings.map((r) => r.role),
          ['primary', 'secondary'],
          'default roles come from the activity',
        );
        return {
          work: logged,
          requests: asked,
          before: progressOf(view, 'explaining-simply'),
        };
      },
    );

    await t.step(
      'the subject cannot write roles; the observer cannot sign two primaries',
      async () => {
        const [samRequest] = requests;
        const asSubject = await daniel.put(
          `/observations/${samRequest.id}/draft`,
          signature(samRequest, { roles: ['secondary', 'primary'] }),
        );
        t.refused(asSubject, 403, 'Forbidden', 'the subject saves a draft with roles');
        const twoPrimaries = await sam.put(
          `/observations/${samRequest.id}/draft`,
          signature(samRequest, { roles: ['primary', 'primary'] }),
        );
        t.refused(twoPrimaries, 422, 'Unprocessable', 'the observer saves two primaries');
      },
    );

    const afterSam = await t.step(
      'Sam signs: each credit carries role, points and source; progress moves',
      async () => {
        const fresh = t.ok(
          await sam.get(`/observations/${requests[0].id}`),
          'Sam opens the request',
        );
        const signed = t.ok(
          await sam.post(`/observations/${fresh.id}/sign`, signature(fresh, { level: 2 })),
          'Sam signs',
        );
        t.equal(signed.status, 'signed', 'observation status');
        t.equal(
          signed.credits.map((c) => [c.skill.slug, c.role, c.points, c.pointsSource]),
          [
            ['explaining-simply', 'primary', 10, 'tenant'],
            ['goals-based-planning', 'secondary', 3, 'tenant'],
          ],
          'credits (working defaults: primary 10, secondary 3)',
        );
        const progress = progressOf(await planOf(t, daniel), 'explaining-simply');
        t.check(progress, 'Daniel has progress for explaining-simply');
        if (before && progress.targetLevel === before.targetLevel) {
          t.equal(progress.points - before.points, 10, 'progress points added by the signature');
          t.equal(
            progress.demonstrations - before.demonstrations,
            1,
            'pieces of work added by the signature',
          );
        }
        return progress;
      },
    );

    await t.step('Leo signs the same work: progress does not move', async () => {
      const fresh = t.ok(await leo.get(`/observations/${requests[1].id}`), 'Leo opens the request');
      const signed = t.ok(
        await leo.post(`/observations/${fresh.id}/sign`, signature(fresh, { level: 2 })),
        'Leo signs',
      );
      t.equal(signed.credits.length, 2, 'Leo’s signature writes its own two credits');
      const progress = progressOf(await planOf(t, daniel), 'explaining-simply');
      t.equal(
        [progress.points, progress.demonstrations],
        [afterSam.points, afterSam.demonstrations],
        `progress after a second observer of work ${work.id}`,
      );
    });
  },
};
