import { Api, errorMessage, isApiError, isApiErrorTag, type ApiError } from '@repo/api';
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

export type ApiClientError = ApiError | RequestFailed;

/** Effect-native API call returning a typed Effect (no thrown promises). */
export const callEffect = <G extends Group, E extends EndpointOf<G>>(
  group: G,
  endpoint: E,
  request: RequestOf<G, E>,
): Effect.Effect<SuccessOf<G, E>, ApiClientError> =>
  Effect.gen(function* () {
    const c = yield* Effect.tryPromise({
      try: () => client(),
      catch: (cause) => new RequestFailed(cause),
    });
    const fn = c[group][endpoint] as (r: unknown) => Effect.Effect<SuccessOf<G, E>, unknown>;
    return yield* fn(request).pipe(
      Effect.mapError((error): ApiClientError =>
        isApiError(error) ? error : new RequestFailed(error),
      ),
    );
  });

export const call = async <G extends Group, E extends EndpointOf<G>>(
  group: G,
  endpoint: E,
  request: RequestOf<G, E>,
): Promise<SuccessOf<G, E>> => {
  const exit = await Effect.runPromiseExit(callEffect(group, endpoint, request));
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.findErrorOption(exit.cause);
  throw Option.isSome(failure) ? failure.value : new RequestFailed(Cause.squash(exit.cause));
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

export const isUnauthorized = (error: unknown) => isApiErrorTag(error, 'Unauthorized');
export const isNotFound = (error: unknown) => isApiErrorTag(error, 'NotFound');
export const isConflict = (error: unknown) => isApiErrorTag(error, 'Conflict');

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
  options: Omit<
    UseMutationOptions<SuccessOf<G, E>, ApiClientError, RequestOf<G, E>>,
    'mutationFn'
  > & {
    readonly invalidates?: ReadonlyArray<Group>;
  } = {},
) => {
  const qc = useQueryClient();
  const { invalidates, onSuccess, ...rest } = options;
  return useMutation<SuccessOf<G, E>, ApiClientError, RequestOf<G, E>>({
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
