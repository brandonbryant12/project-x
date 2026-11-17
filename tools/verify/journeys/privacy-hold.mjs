// The privacy hold (rule 5, invariant I7): a reflection that names a client or
// carries an account number is held by the local screen; the observer never
// sees the held words; held work cannot be put to an observer. A clean
// reflection is not held (control).
//
// Re-runnable: yes. Each run logs two new pieces of Maya's work.
import { logWork, planOf } from './common.mjs';

const HELD =
  'Mr. Hendricks asked me to move everything to cash; his account number is 5521 0098 3314.';
const CLEAN =
  'Called a client after the drop and asked what the money was for before anything else.';

export default {
  name: 'privacy-hold',
  title: 'Privacy hold: client details held and invisible to the observer',
  rerunnable: true,
  personas: ['Maya Chen', 'Sam Rivera'],
  run: async (t) => {
    const maya = await t.as('Maya Chen');
    const sam = await t.as('Sam Rivera');
    const activity = await t.step('Maya’s plan has work to log against', async () => {
      const view = await planOf(t, maya);
      const found = view.plan?.activities.find((a) => a.title.startsWith('Proactive calls'));
      t.check(found, 'seeded activity "Proactive calls after market drops" is missing');
      return found;
    });

    await t.step('a clean reflection is available to her coach', async () => {
      const logged = await logWork(t, maya, { activityId: activity.id, reflection: CLEAN });
      const seen = t.ok(await sam.get(`/interactions/${logged.id}`), 'Sam opens the work');
      t.equal(
        [seen.evidence?.status, seen.evidence?.body],
        ['available', CLEAN],
        'evidence as the coach sees it',
      );
    });

    await t.step('client details are held and the coach sees no words', async () => {
      const logged = await logWork(t, maya, { activityId: activity.id, reflection: HELD });
      const own = t.ok(await maya.get(`/interactions/${logged.id}`), 'Maya opens her work');
      t.equal(own.evidence?.status, 'held', 'evidence status after the privacy screen');
      const seen = t.ok(await sam.get(`/interactions/${logged.id}`), 'Sam opens the work');
      t.equal(seen.evidence?.body ?? null, null, 'held words as the coach sees them');
      t.refused(
        await maya.post('/observations', {
          interactionId: logged.id,
          observerId: sam.id,
          mode: 'saw_it',
          skillIds: [activity.skills[0].skill.id],
          note: null,
        }),
        422,
        'Unprocessable',
        'asking for an observation of held work',
      );
    });
  },
};
