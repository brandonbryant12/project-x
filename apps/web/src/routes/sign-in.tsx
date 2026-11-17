import type { Persona } from '@repo/api';
import { Button, Card, PersonChip, Separator, Skeleton } from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';
import { useState } from 'react';
import { call, describeError, queryOptions } from '@/lib/api.ts';
import { PRODUCT_NAME } from '@/lib/brand.ts';
import { entraStartHref, safeReturnPath } from '@/lib/return-to.ts';

const SignIn = () => {
  const { next } = Route.useSearch();
  const personas = useQuery({ ...queryOptions('auth', 'devPersonas', undefined), retry: false });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signInAs = async (persona: Persona) => {
    setPending(persona.person.id);
    setError(null);
    try {
      await call('auth', 'devSignIn', { payload: { personId: persona.person.id } });
      window.location.assign(safeReturnPath(next));
    } catch (e) {
      setError(describeError(e));
      setPending(null);
    }
  };
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="grid w-full max-w-md gap-8">
        <div className="grid gap-2">
          <h1 className="font-serif text-display font-medium">{PRODUCT_NAME}</h1>
          <p className="text-body text-ink-2">
            Skills that grow through work, observed and confirmed.
          </p>
        </div>
        <Card className="grid gap-5 p-6">
          <Button asChild variant="primary" size="lg">
            <a href={entraStartHref(next)}>Continue with Microsoft</a>
          </Button>
          {personas.isSuccess && personas.data.length > 0 ? (
            <>
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-meta text-ink-3">Development sign-in</span>
                <Separator className="flex-1" />
              </div>
              <ul className="grid gap-1" aria-label="Sign in as a demo person">
                {personas.data.map((p) => (
                  <li key={p.person.id}>
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void signInAs(p)}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-control px-2 py-2 text-left transition-colors hover:bg-sunken disabled:opacity-60"
                    >
                      <PersonChip person={p.person} subtitle={p.summary} />
                      {pending === p.person.id ? (
                        <span className="text-meta text-ink-3">Signing in…</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {personas.isPending ? <Skeleton className="h-40" /> : null}
          {error ? (
            <p role="alert" className="text-ui text-danger-ink">
              {error}
            </p>
          ) : null}
        </Card>
      </div>
    </main>
  );
};

export const Route = createFileRoute('/sign-in')({
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ next: Schema.optional(Schema.String) }),
  ),
  component: SignIn,
});
