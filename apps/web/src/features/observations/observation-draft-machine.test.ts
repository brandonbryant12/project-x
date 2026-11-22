import { Conflict, type ObservationView } from '@repo/api';
import type { IsoDate, ObservationId, PersonId, SkillId } from '@repo/domain';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { RequestFailed } from '@/lib/api.ts';
import {
  createObservationDraftMachine,
  saveStateFromSnapshot,
} from './observation-draft-machine.ts';

const maya = {
  id: 'per_maya000000000000' as PersonId,
  displayName: 'Maya Chen',
  title: 'Financial advisor',
  initials: 'MC',
  hue: 210,
};

const sam = {
  id: 'per_sam0000000000000' as PersonId,
  displayName: 'Sam Rivera',
  title: 'Coach',
  initials: 'SR',
  hue: 150,
};

const baseView = (version = 1, narrativeSaw = ''): ObservationView => ({
  id: 'obs_1000000000000000' as ObservationId,
  version,
  status: 'drafting',
  viewerRole: 'observer',
  subject: maya,
  observer: sam,
  requestedBy: maya,
  basis: 'coach',
  mode: 'saw_it',
  dueAt: '2026-11-29T00:00:00.000Z',
  signedAt: null,
  acknowledgedAt: null,
  updatedAt: '2026-11-22T00:00:00.000Z',
  interaction: {
    id: 'int_1000000000000000' as ObservationView['interaction']['id'],
    kind: 'client_meeting',
    activityTitle: 'Discovery meeting',
    occurredOn: '2026-11-22' as IsoDate,
    clientRef: null,
  },
  evidence: null,
  requestNote: null,
  requestedSkills: [
    {
      id: 'skl_1000000000000000' as SkillId,
      slug: 'client-discovery',
      name: 'Client discovery',
      domain: 'client_discovery',
    },
  ],
  ratings: [],
  narrativeSaw,
  narrativeNext: '',
  returnNote: null,
  declineReason: null,
  reviewNote: null,
  narrativeVisible: true,
  credits: [],
  earlier: [],
  advisory: [],
  badgesEarned: [],
  actions: ['SIGN'],
});

describe('observationDraftMachine (XState 5 + Effect)', () => {
  it('debounces edits, saves via Effect, and updates version', async () => {
    let saves = 0;
    const machine = createObservationDraftMachine({
      initialView: baseView(1),
      debounceMs: 15,
      now: () => 1000,
      saveEffect: (draft, version) => {
        saves += 1;
        return Effect.succeed(baseView(version + 1, draft.narrativeSaw));
      },
    });
    const actor = createActor(machine).start();

    actor.send({ type: 'EDIT', change: (d) => ({ ...d, narrativeSaw: 'First edit' }) });
    actor.send({ type: 'EDIT', change: (d) => ({ ...d, narrativeSaw: 'Second edit' }) });
    expect(actor.getSnapshot().value).toBe('dirty');

    await new Promise((r) => setTimeout(r, 45));
    expect(saves).toBe(1);
    expect(actor.getSnapshot().value).toBe('saved');
    expect(actor.getSnapshot().context.version).toBe(2);
    expect(
      saveStateFromSnapshot(actor.getSnapshot().value, actor.getSnapshot().context.savedAt),
    ).toEqual({
      kind: 'saved',
      at: 1000,
    });
    actor.stop();
  });

  it('transitions to conflict on API Conflict error and failed on transport error', async () => {
    const conflictMachine = createObservationDraftMachine({
      initialView: baseView(1),
      debounceMs: 10,
      saveEffect: () => Effect.fail(new Conflict({ message: 'Stale version' })),
    });
    const conflictActor = createActor(conflictMachine).start();
    conflictActor.send({ type: 'EDIT', change: (d) => ({ ...d, narrativeSaw: 'Conflict edit' }) });
    await new Promise((r) => setTimeout(r, 35));
    expect(conflictActor.getSnapshot().value).toBe('conflict');
    conflictActor.stop();

    const failMachine = createObservationDraftMachine({
      initialView: baseView(1),
      debounceMs: 10,
      saveEffect: () => Effect.fail(new RequestFailed(new Error('offline'))),
    });
    const failActor = createActor(failMachine).start();
    failActor.send({ type: 'EDIT', change: (d) => ({ ...d, narrativeSaw: 'Offline edit' }) });
    await new Promise((r) => setTimeout(r, 35));
    expect(failActor.getSnapshot().value).toBe('failed');
    failActor.stop();
  });

  it('cancels pending autosave on CANCEL_PENDING and adopts newer server versions when clean', async () => {
    let saves = 0;
    const machine = createObservationDraftMachine({
      initialView: baseView(1, 'Initial'),
      debounceMs: 25,
      saveEffect: (draft, version) => {
        saves += 1;
        return Effect.succeed(baseView(version + 1, draft.narrativeSaw));
      },
    });
    const actor = createActor(machine).start();

    actor.send({ type: 'EDIT', change: (d) => ({ ...d, narrativeSaw: 'Unsaved' }) });
    actor.send({ type: 'CANCEL_PENDING' });
    await new Promise((r) => setTimeout(r, 45));
    expect(saves).toBe(0);
    expect(actor.getSnapshot().value).toBe('idle');

    actor.send({ type: 'SYNC_SERVER', view: baseView(3, 'From server') });
    expect(actor.getSnapshot().context.version).toBe(3);
    expect(actor.getSnapshot().context.draft.narrativeSaw).toBe('From server');
    actor.stop();
  });
});
