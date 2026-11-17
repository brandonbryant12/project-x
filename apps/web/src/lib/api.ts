import { Api, errorMessage, type ApiError } from '@repo/api';
import {
  QueryClient,
  QueryCache,
  MutationCache,
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { Cause, Effect, Exit, Option } from 'effect';
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { toast } from '@repo/ui';

/**
 * The typed client is derived from the shared HttpApi (ADR 0010). Query keys are
 * `[group, endpoint, request]`; nothing is hand-mapped per endpoint.
 */
const makeClient = HttpApiClient.make(Api, {
  transformClient: HttpClient.mapRequest(HttpClientRequest.setHeader('x-requested-with', 'fetch')),
}).pipe(Effect.provide(FetchHttpClient.layer));

type Client = Effect.Success<typeof makeClient>;
export type Group = keyof Client;
export type EndpointOf<G extends Group> = keyof Client[G] & string;
type Fn<G extends Group, E extends EndpointOf<G>> = Client[G][E] extends (
  ...args: infer A
) => Effect.Effect<infer S, infer Er, infer _R>
  ? { args: A; success: S; error: Er }
  : never;
export type RequestOf<G extends Group, E extends EndpointOf<G>> = Fn<G, E>['args'] extends []
  ? void
  : Fn<G, E>['args'][0];
/** Endpoints are overloaded on `responseMode`; we always use the decoded value. */
type Decoded<T> = Exclude<
  T,
  HttpClientResponse.HttpClientResponse | readonly [unknown, HttpClientResponse.HttpClientResponse]
>;
export type SuccessOf<G extends Group, E extends EndpointOf<G>> = Decoded<Fn<G, E>['success']>;

let clientPromise: Promise<Client> | undefined;
const client = () => (clientPromise ??= Effect.runPromise(makeClient));

/** Any failure surfaced to React: a declared API error, or a transport/decoding failure. */
export class RequestFailed extends Error {
  constructor(override readonly cause: unknown) {
    super('The request failed. Check your connection and try again.');
  }
}

const isApiError = (e: unknown): e is ApiError =>
  typeof e === 'object' &&
  e !== null &&
  '_tag' in e &&
  [
    'Unauthorized',
    'Forbidden',
    'NotFound',
    'InvalidTransition',
    'Conflict',
    'Unprocessable',
  ].includes(String((e as { _tag: unknown })._tag));

export const call = async <G extends Group, E extends EndpointOf<G>>(
  group: G,
  endpoint: E,
  request: RequestOf<G, E>,
): Promise<SuccessOf<G, E>> => {
  const c = await client();
  const fn = c[group][endpoint] as (r: unknown) => Effect.Effect<SuccessOf<G, E>, unknown>;
  const exit = await Effect.runPromiseExit(fn(request));
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.findErrorOption(exit.cause);
  const error = Option.isSome(failure) ? failure.value : Cause.squash(exit.cause);
  throw isApiError(error) ? error : new RequestFailed(error);
};

export const queryOptions = <G extends Group, E extends EndpointOf<G>>(
  group: G,
  endpoint: E,
  request: RequestOf<G, E>,
) => ({
  queryKey: [group, endpoint, request ?? null] as const,
  queryFn: () => call(group, endpoint, request),
});

export const describeError = (error: unknown): string =>
  isApiError(error) ? errorMessage(error) : 'Something went wrong. Nothing was changed.';

export const isUnauthorized = (error: unknown) =>
  isApiError(error) && error._tag === 'Unauthorized';
export const isNotFound = (error: unknown) => isApiError(error) && error._tag === 'NotFound';

const redirectToSignIn = (error: unknown) => {
  if (isUnauthorized(error) && !window.location.pathname.startsWith('/sign-in')) {
    const next = window.location.pathname + window.location.search;
    window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`);
  }
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: redirectToSignIn }),
  mutationCache: new MutationCache({
    onError: (error, _v, _c, mutation) => {
      redirectToSignIn(error);
      if (!mutation.options.onError) toast.error(describeError(error));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !isApiError(error) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * A mutation for any endpoint. On success it invalidates the listed groups
 * (default: every query — the app is small and correctness beats cleverness).
 */
export const useApiMutation = <G extends Group, E extends EndpointOf<G>>(
  group: G,
  endpoint: E,
  options: Omit<UseMutationOptions<SuccessOf<G, E>, unknown, RequestOf<G, E>>, 'mutationFn'> & {
    readonly invalidates?: ReadonlyArray<Group>;
  } = {},
) => {
  const qc = useQueryClient();
  const { invalidates, onSuccess, ...rest } = options;
  return useMutation<SuccessOf<G, E>, unknown, RequestOf<G, E>>({
    mutationFn: (request) => call(group, endpoint, request),
    onSuccess: async (data, variables, result, context) => {
      await (invalidates
        ? Promise.all(invalidates.map((g) => qc.invalidateQueries({ queryKey: [g] })))
        : qc.invalidateQueries());
      await onSuccess?.(data, variables, result, context);
    },
    ...rest,
  });
};
