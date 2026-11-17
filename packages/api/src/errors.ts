import { Schema } from 'effect';

/**
 * API errors. Each declares its HTTP status, so HttpApi encodes it and the typed
 * client decodes it back into the same class. Missing and not-visible resources
 * are both NotFound (ADR 0003). Broken invariants are defects (500), not errors.
 */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()(
  'Forbidden',
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  'NotFound',
  { entity: Schema.String, id: Schema.String },
  { httpApiStatus: 404 },
) {}

/** A lifecycle event that the entity's current state does not accept (ADR 0005). */
export class InvalidTransition extends Schema.TaggedError<InvalidTransition>()(
  'InvalidTransition',
  {
    entity: Schema.String,
    from: Schema.String,
    event: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class Conflict extends Schema.TaggedError<Conflict>()(
  'Conflict',
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Business-rule validation that a schema cannot express. */
export class Unprocessable extends Schema.TaggedError<Unprocessable>()(
  'Unprocessable',
  { message: Schema.String, field: Schema.optional(Schema.String) },
  { httpApiStatus: 422 },
) {}

export type ApiError =
  | Unauthorized
  | Forbidden
  | NotFound
  | InvalidTransition
  | Conflict
  | Unprocessable;

/** User-facing message for any API error. */
export const errorMessage = (error: ApiError): string => {
  switch (error._tag) {
    case 'NotFound':
      return 'That could not be found, or you do not have access to it.';
    case 'Unauthorized':
    case 'Forbidden':
    case 'InvalidTransition':
    case 'Conflict':
    case 'Unprocessable':
      return error.message;
  }
};
