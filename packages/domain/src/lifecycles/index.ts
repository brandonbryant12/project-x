export * from './lifecycle.ts';
export * from './observation.ts';
export * from './engagement.ts';
export * from './plan.ts';
export * from './activity.ts';
export * from './evidence.ts';
export * from './catalog-item.ts';
export * from './advisory-check.ts';
export * from './badge-award.ts';
export * from './conversation.ts';
export * from './commitment.ts';
export * from './directory-exception.ts';

import { ActivityLifecycle } from './activity.ts';
import { AdvisoryCheckLifecycle } from './advisory-check.ts';
import { BadgeAwardLifecycle } from './badge-award.ts';
import { CatalogItemLifecycle } from './catalog-item.ts';
import { CommitmentLifecycle } from './commitment.ts';
import { ConversationLifecycle } from './conversation.ts';
import { DirectoryExceptionLifecycle } from './directory-exception.ts';
import { EngagementLifecycle } from './engagement.ts';
import { EvidenceLifecycle } from './evidence.ts';
import { ObservationLifecycle } from './observation.ts';
import { PlanLifecycle } from './plan.ts';

/** Every lifecycle, for tests, docs generation and audit tooling. */
export const ALL_LIFECYCLES = [
  ObservationLifecycle,
  EngagementLifecycle,
  PlanLifecycle,
  ActivityLifecycle,
  EvidenceLifecycle,
  CatalogItemLifecycle,
  AdvisoryCheckLifecycle,
  BadgeAwardLifecycle,
  ConversationLifecycle,
  CommitmentLifecycle,
  DirectoryExceptionLifecycle,
] as const;
