import type { ObservationView } from '@repo/api';
import type { PersonId, SkillId } from '@repo/domain';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { createTeaRuntime, pure } from '@/lib/foldkit.ts';
import {
  initialQuickRequestModel,
  quickRequestPrivacy,
  submitCommand,
  updateQuickRequest,
} from './quick-request-tea.ts';

const skill1 = 'skl_1000000000000000' as SkillId;
const skill2 = 'skl_2000000000000000' as SkillId;
const coachId = 'per_sam0000000000000' as PersonId;

describe('quickRequest TEA (Foldkit + Effect)', () => {
  it('updates model purely and flags client PII locally', () => {
    const m0 = initialQuickRequestModel();
    const [m1] = updateQuickRequest(m0, { _tag: 'SelectObserver', observerId: coachId });
    expect(m1.observerId).toBe(coachId);

    const [m2] = updateQuickRequest(m1, {
      _tag: 'ToggleSkill',
      skillId: skill2,
      current: [skill1],
    });
    expect(m2.chosenSkills).toEqual([skill1, skill2]);

    const [m3] = updateQuickRequest(m2, {
      _tag: 'SetNote',
      note: 'Spoke with Mrs. Patterson about account number 4417 2291.',
    });
    expect(quickRequestPrivacy(m3).held).toBe(true);
  });

  it('executes Effect commands through createTeaRuntime and recovers cleanly on error', async () => {
    const runtime = createTeaRuntime(() => pure(initialQuickRequestModel()), updateQuickRequest);
    runtime.start();

    const failCmd = submitCommand(
      Effect.tryPromise({
        try: () => Promise.reject(new Error('offline')),
        catch: (e) => e,
      }),
      () => undefined,
      () => 'Connection lost',
    );
    runtime.dispatch({ _tag: 'Submit', command: failCmd });
    expect(runtime.getSnapshot().submitting).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    expect(runtime.getSnapshot().submitting).toBe(false);
    expect(runtime.getSnapshot().error).toBe('Connection lost');

    let succeeded = false;
    const okCmd = submitCommand(
      Effect.promise(() => Promise.resolve({} as ObservationView)),
      () => {
        succeeded = true;
      },
      () => 'err',
    );
    runtime.dispatch({ _tag: 'Submit', command: okCmd });
    await new Promise((r) => setTimeout(r, 20));
    expect(succeeded).toBe(true);
    expect(runtime.getSnapshot().submitting).toBe(false);
    runtime.stop();
  });
});
