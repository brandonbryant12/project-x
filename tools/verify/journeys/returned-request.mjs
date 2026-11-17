// Returned request (design 2026-11-17 §9, invariant I7): the observer sends a
// request back; the coachee revises the reflection from the returned
// observation and resends it; resending (or asking anyone else) is refused
// while the revised reflection is held by the privacy screen, and the observer
// never sees held words; the observer then signs.
//
// Re-runnable: yes. Each run logs a new piece of Aisha's work for Jordan.
import { ask, logWork, planOf, signature } from './common.mjs';

const HELD =
  'Mrs. Patterson asked how the fee compared with her account number 4417 2291 at the old firm.';
const CLEAR =
  'They were surprised I raised the fee first. I showed what they would pay elsewhere and asked which services they valued.';

export default {
  name: 'returned-request',
  title: 'Returned request: revise, refused while held, resend, sign',
  rerunnable: true,
  personas: ['Aisha Bello', 'Jordan Blake', 'Leo Okonkwo'],
  run: async (t) => {
    const aisha = await t.as('Aisha Bello');
    const jordan = await t.as('Jordan Blake');
    const leo = await t.as('Leo Okonkwo');

    const { request, work, skillId } = await t.step(
      'Aisha asks Jordan; Jordan sends it back with a question',
      async () => {
        const view = await planOf(t, aisha);
        const activity = view.plan?.activities.find((a) => a.title.startsWith('Raise fees'));
        t.check(activity, 'seeded activity "Raise fees in every annual review" is missing');
        const primary = activity.skills.find((s) => s.role === 'primary') ?? activity.skills[0];
        const logged = await logWork(t, aisha, {
          activityId: activity.id,
          reflection:
            'Raised the fee at the start of the review and compared it with alternatives.',
        });
        const asked = await ask(t, aisha, {
          interactionId: logged.id,
          observerId: jordan.id,
          skillIds: [primary.skill.id],
          mode: 'discussed',
        });
        const returned = t.ok(
          await jordan.post(`/observations/${asked.id}/events`, {
            event: 'RETURN',
            note: 'Tell me how they reacted when you compared the fee. What did you say next?',
          }),
          'Jordan returns the request',
        );
        t.equal(returned.status, 'returned', 'status after RETURN');
        const mine = t.ok(await aisha.get(`/observations/${asked.id}`), 'Aisha opens it');
        t.check(mine.returnNote, 'the return note reaches Aisha');
        t.check(
          mine.canReviseEvidence,
          'Aisha may revise her reflection from the returned request',
        );
        t.check(
          mine.actions.includes('RESUBMIT') && mine.actions.includes('WITHDRAW'),
          `actions offered to Aisha: ${mine.actions}`,
        );
        return { request: asked, work: logged, skillId: primary.skill.id };
      },
    );

    await t.step(
      'revised with a client name and account number: held, and nothing may be sent',
      async () => {
        const held = t.ok(
          await aisha.post(`/interactions/${work.id}/evidence`, { body: HELD }),
          'Aisha revises with client details',
        );
        t.equal(held.evidence?.status, 'held', 'evidence status after the privacy screen');
        const whileHeld = t.ok(await aisha.get(`/observations/${request.id}`), 'Aisha reopens it');
        t.check(!whileHeld.actions.includes('RESUBMIT'), 'no Resend action while held');
        t.refused(
          await aisha.post(`/observations/${request.id}/events`, { event: 'RESUBMIT', note: null }),
          409,
          'InvalidTransition',
          'resend while held',
        );
        t.refused(
          await aisha.post('/observations', {
            interactionId: work.id,
            observerId: leo.id,
            mode: 'saw_it',
            skillIds: [skillId],
            note: null,
          }),
          422,
          'Unprocessable',
          'asking someone else about held work',
        );
        const observerView = t.ok(
          await jordan.get(`/observations/${request.id}`),
          'Jordan opens it',
        );
        t.equal(observerView.status, 'returned', 'the observer sees no change of state');
        t.equal(observerView.evidence?.body ?? null, null, 'the observer never sees held words');
      },
    );

    await t.step('revised again without them: resent with a note, then signed', async () => {
      const clear = t.ok(
        await aisha.post(`/interactions/${work.id}/evidence`, { body: CLEAR }),
        'Aisha revises without client details',
      );
      t.equal(clear.evidence?.status, 'available', 'evidence status');
      const note = 'I added how they reacted and what I asked next.';
      const resent = t.ok(
        await aisha.post(`/observations/${request.id}/events`, { event: 'RESUBMIT', note }),
        'Aisha resends',
      );
      t.equal([resent.status, resent.requestNote], ['requested', note], 'status and note');
      const seen = t.ok(await jordan.get(`/observations/${request.id}`), 'Jordan opens it again');
      t.equal(seen.evidence?.body, CLEAR, 'the observer reads the revised reflection');
      const signed = t.ok(
        await jordan.post(
          `/observations/${request.id}/sign`,
          signature(seen, { level: 2, mode: 'discussed' }),
        ),
        'Jordan signs',
      );
      t.equal([signed.status, signed.credits.length], ['signed', 1], 'signed with one credit');
    });
  },
};
