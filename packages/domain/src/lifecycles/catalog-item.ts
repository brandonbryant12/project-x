import { setup } from 'xstate';
import { defineLifecycle } from './lifecycle.ts';

/**
 * Catalog items (skills and activity templates) are curated by catalog keepers.
 * Published definitions are immutable; retired items stay visible on history.
 */
export interface CatalogItemFacts {
  /** Required content is present (e.g. every level has at least one indicator). */
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
    published: { on: { RETIRE: 'retired' } },
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
