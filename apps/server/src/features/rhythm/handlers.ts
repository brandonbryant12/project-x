import { Api, CurrentActor, NotFound } from '@repo/api';
import type { CommitmentId, ConversationId, PersonId } from '@repo/domain';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import { buildCommitmentViews } from '../shared/rhythm.ts';
import {
  commitmentEvent,
  conversationEvent,
  createCommitment,
  loadCommitment,
  loadConversation,
  scheduleConversation,
} from './use-cases.ts';
import { buildConversations, buildConversationView, buildPersonCommitments } from './views.ts';

/** The weekly rhythm: conversations and commitments (ADR 0019). */
const conversationView = (id: ConversationId) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    return yield* buildConversationView(actor, yield* loadConversation(id));
  });

const commitmentView = (id: CommitmentId) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor;
    const [view] = yield* buildCommitmentViews(actor, [yield* loadCommitment(id)]);
    if (!view) return yield* Effect.die('invariant: commitment view missing');
    return view;
  });

const personCommitments = (personId: PersonId) =>
  Effect.gen(function* () {
    const { visible, views } = yield* buildPersonCommitments(yield* CurrentActor, personId);
    if (!visible) return yield* Effect.fail(new NotFound({ entity: 'person', id: personId }));
    return views;
  });

export const RhythmHandlers = HttpApiBuilder.group(Api, 'rhythm', (handlers) =>
  handlers
    .handle('conversations', () =>
      Effect.gen(function* () {
        return yield* buildConversations(yield* CurrentActor);
      }).pipe(apiErrorsOnly),
    )
    .handle('scheduleConversation', ({ payload }) =>
      scheduleConversation(payload).pipe(Effect.flatMap(conversationView), apiErrorsOnly),
    )
    .handle('conversation', ({ params }) => conversationView(params.id).pipe(apiErrorsOnly))
    .handle('conversationEvent', ({ params, payload }) =>
      conversationEvent(params.id, payload).pipe(
        Effect.andThen(conversationView(params.id)),
        apiErrorsOnly,
      ),
    )
    .handle('commitments', ({ params }) => personCommitments(params.id).pipe(apiErrorsOnly))
    .handle('createCommitment', ({ payload }) =>
      createCommitment(payload).pipe(Effect.flatMap(commitmentView), apiErrorsOnly),
    )
    .handle('commitmentEvent', ({ params, payload }) =>
      commitmentEvent(params.id, payload.event).pipe(
        Effect.andThen(commitmentView(params.id)),
        apiErrorsOnly,
      ),
    ),
);
