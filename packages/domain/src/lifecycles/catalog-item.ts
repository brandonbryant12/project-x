import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * Catalog items (skills and activity templates) are curated by program owners.
 * Published definitions are immutable; retired items stay visible on history.
 * PUBLISH on a published item publishes its draft as the next immutable
 * version (a skill's new `skill_version`); it needs the same `complete` fact.
 */
export interface CatalogItemFacts {
  /** There is complete content to publish (e.g. every level has at least one indicator). */
  readonly complete: boolean;
}

export type CatalogItemEvent =
  | { readonly type: 'PUBLISH' }
  | { readonly type: 'RETIRE' }
  | { readonly type: 'DISCARD' };

const catalogItemMachine = setup({
  types: { context: {} as CatalogItemFacts, events: {} as CatalogItemEvent },
  guards: { complete: ({ context }) => context.complete },
}).createMachine({
  id: 'catalogItem',
  initial: 'draft',
  context: { complete: false },
  states: {
    draft: { on: { PUBLISH: { target: 'published', guard: 'complete' }, DISCARD: 'discarded' } },
    published: {
      on: { PUBLISH: { target: 'published', guard: 'complete' }, RETIRE: 'retired' },
    },
    retired: { type: 'final' },
    discarded: { type: 'final' },
  },
});

export const CatalogItemLifecycle = defineLifecycle({
  name: 'catalogItem',
  machine: catalogItemMachine,
  states: ['draft', 'published', 'retired', 'discarded'],
  events: ['PUBLISH', 'RETIRE', 'DISCARD'],
  initialStates: ['draft', 'published'],
  terminalStates: ['retired', 'discarded'],
});

export type CatalogItemStatus = (typeof CatalogItemLifecycle.states)[number];
