import type { Persona } from '@repo/api';
import { Button, Card, PersonChip, Pill, Separator, Skeleton } from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';
import { AwardIcon, CompassIcon, MessageSquareHeartIcon } from 'lucide-react';
import { useState } from 'react';
import { call, describeError, queryOptions } from '@/lib/api.ts';
import { PRODUCT_NAME } from '@/lib/brand.ts';
import { entraStartHref, safeReturnPath } from '@/lib/return-to.ts';

const PILLARS = [
  {
    icon: CompassIcon,
    title: 'Pick 1–3 focus skills',
    detail: 'Choose the client and coaching skills you want to build right now.',
  },
  {
    icon: MessageSquareHeartIcon,
    title: 'Fast, real feedback',
    detail: 'Request or give specific feedback after real client calls in under a minute.',
  },
  {
    icon: AwardIcon,
    title: 'Earn skill milestones',
    detail: 'Two verified observations earn a skill badge with the real feedback behind it.',
  },
] as const;

const roleBadge = (summary: string) => {
  const s = summary.toLowerCase();
  if (s.includes('compliance')) return { label: 'Compliance', tone: 'warning' as const };
  if (s.includes('admin')) return { label: 'Admin', tone: 'info' as const };
  if (s.includes('coach')) return { label: 'Coach', tone: 'primary' as const };
  if (s.includes('leader')) return { label: 'Leader', tone: 'primary' as const };
  return { label: 'Advisor', tone: 'neutral' as const };
};

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
    <main className="grid min-h-dvh place-items-center px-4 py-10 md:px-8">
      <div className="grid w-full max-w-4xl gap-8 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12">
        <div className="grid gap-6">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-full border-2 border-primary bg-primary-soft"
            >
              <span className="size-3 rounded-full bg-primary" />
            </span>
            <span className="font-serif text-h2 font-medium text-ink">{PRODUCT_NAME}</span>
          </div>
          <div className="grid gap-3">
            <h1 className="font-serif text-display font-medium text-ink">
              Grow advisor skills through real client work.
            </h1>
            <p className="text-body text-ink-2">
              A simple coaching workspace for financial advisors, coaches, and branch leaders —
              built around real observed meetings, not CRM activity counts.
            </p>
          </div>
          <ul className="grid gap-3">
            {PILLARS.map((p) => (
              <li key={p.title} className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-control bg-primary-soft text-primary-ink">
                  <p.icon className="size-4" aria-hidden />
                </span>
                <div className="grid gap-0.5">
                  <p className="text-ui font-medium text-ink">{p.title}</p>
                  <p className="text-meta text-ink-2">{p.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <Card className="grid gap-5 p-6">
          <div className="grid gap-1">
            <h2 className="font-serif text-h1 font-medium text-ink">Sign in</h2>
            <p className="text-ui text-ink-2">
              Continue with your firm account, or pick a demo role below.
            </p>
          </div>
          <Button asChild variant="primary" size="lg">
            <a href={entraStartHref(next)}>Continue with Microsoft</a>
          </Button>
          {personas.isSuccess && personas.data.length > 0 ? (
            <>
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-meta text-ink-3">Demo workspace · pick a role</span>
                <Separator className="flex-1" />
              </div>
              <ul
                className="grid max-h-[360px] gap-1 overflow-y-auto pr-1"
                aria-label="Sign in as a demo person"
              >
                {personas.data.map((p) => {
                  const badge = roleBadge(p.summary);
                  return (
                    <li key={p.person.id}>
                      <button
                        type="button"
                        disabled={pending !== null}
                        onClick={() => void signInAs(p)}
                        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-control px-2.5 py-2 text-left transition-colors hover:bg-sunken disabled:opacity-60"
                      >
                        <PersonChip person={p.person} subtitle={p.summary} />
                        {pending === p.person.id ? (
                          <span className="text-meta text-ink-3">Signing in…</span>
                        ) : (
                          <Pill tone={badge.tone}>{badge.label}</Pill>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          {personas.isPending ? <Skeleton className="h-44" /> : null}
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
