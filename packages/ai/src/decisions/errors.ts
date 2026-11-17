import { Schema } from 'effect';

export class DecisionsDisabled extends Schema.TaggedError<DecisionsDisabled>()(
  'DecisionsDisabled',
  {},
) {}

/** We refused to send a request that violates a documented limit. */
export class DecisionsInvalidRequest extends Schema.TaggedError<DecisionsInvalidRequest>()(
  'DecisionsInvalidRequest',
  { rule: Schema.String, message: Schema.String },
) {}

export class DecisionsRateLimited extends Schema.TaggedError<DecisionsRateLimited>()(
  'DecisionsRateLimited',
  { retryAfterSeconds: Schema.NullOr(Schema.Number) },
) {}

/**
 * `rejected`: the provider answered with an error (nothing billed for answers).
 * `unknown`: timeout or lost connection — the request may have been billed, so
 * it is never re-sent automatically.
 */
export class DecisionsFailed extends Schema.TaggedError<DecisionsFailed>()('DecisionsFailed', {
  outcome: Schema.Literals(['rejected', 'unknown']),
  status: Schema.NullOr(Schema.Number),
  message: Schema.String,
}) {}

export type DecisionsError =
  | DecisionsDisabled
  | DecisionsInvalidRequest
  | DecisionsRateLimited
  | DecisionsFailed;
