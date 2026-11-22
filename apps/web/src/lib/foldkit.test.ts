import { describe, expect, it } from 'vitest';
import { assign, setup } from 'xstate';
import { createMachineBridge } from './foldkit.ts';

const counterMachine = setup({
  types: {
    context: {} as { count: number },
    events: {} as { type: 'INC' },
  },
}).createMachine({
  id: 'counter',
  initial: 'ready',
  context: { count: 0 },
  states: {
    ready: {
      on: {
        INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
      },
    },
  },
});

describe('createMachineBridge (React 19 StrictMode lifecycle)', () => {
  it('recreates and restarts cleanly after stop() so StrictMode remounts keep handling events', () => {
    const bridge = createMachineBridge(counterMachine);
    let notifications = 0;
    const unsub = bridge.subscribe(() => {
      notifications += 1;
    });

    // Simulate React 19 StrictMode: mount -> cleanup -> remount
    bridge.start();
    bridge.stop();
    bridge.start();

    bridge.send({ type: 'INC' });
    expect(bridge.getSnapshot().context.count).toBe(1);
    expect(notifications).toBeGreaterThan(0);

    unsub();
    bridge.stop();
  });
});
