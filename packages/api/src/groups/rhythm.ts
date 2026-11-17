import { CommitmentId, CommitmentLifecycle, ConversationId, PersonId } from '@repo/domain';
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { Authenticated } from '../auth.ts';
import { Conflict, Forbidden, InvalidTransition, NotFound, Unprocessable } from '../errors.ts';
import {
  CommitmentView,
  ConversationEventInput,
  ConversationsView,
  ConversationView,
  CreateCommitmentInput,
  ScheduleConversationInput,
} from '../models/index.ts';

/** The weekly rhythm: conversations and commitments (ADR 0019). */
export class RhythmGroup extends HttpApiGroup.make('rhythm')
  .add(
    HttpApiEndpoint.get('conversations', '/conversations', { success: ConversationsView }),
    HttpApiEndpoint.post('scheduleConversation', '/conversations', {
      payload: ScheduleConversationInput,
      success: ConversationView,
      error: [Forbidden, Unprocessable, NotFound],
    }),
    HttpApiEndpoint.get('conversation', '/conversations/:id', {
      params: { id: ConversationId },
      success: ConversationView,
      error: NotFound,
    }),
    HttpApiEndpoint.post('conversationEvent', '/conversations/:id/events', {
      params: { id: ConversationId },
      payload: ConversationEventInput,
      success: ConversationView,
      error: [NotFound, Forbidden, InvalidTransition, Conflict, Unprocessable],
    }),
    HttpApiEndpoint.get('commitments', '/people/:id/commitments', {
      params: { id: PersonId },
      success: Schema.Array(CommitmentView),
      error: [NotFound],
    }),
    HttpApiEndpoint.post('createCommitment', '/commitments', {
      payload: CreateCommitmentInput,
      success: CommitmentView,
      error: [Forbidden, Unprocessable, NotFound],
    }),
    HttpApiEndpoint.post('commitmentEvent', '/commitments/:id/events', {
      params: { id: CommitmentId },
      payload: Schema.Struct({ event: Schema.Literals(CommitmentLifecycle.events) }),
      success: CommitmentView,
      error: [NotFound, Forbidden, InvalidTransition, Conflict],
    }),
  )
  .middleware(Authenticated) {}
