import type { Persona } from '@repo/api';
import {
  BrandLockup,
  Button,
  Card,
  CatalystArc,
  PersonChip,
  Pill,
  Separator,
  Skeleton,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';
import { useState } from 'react';
import { call, describeError, queryOptions } from '@/lib/api.ts';
import { entraStartHref, safeReturnPath } from '@/lib/return-to.ts';

const PILLARS = [
  {
    index: '01',
    title: 'Pick 1–3 focus skills',
    detail: 'Choose the client and coaching skills you want to build right now.',
  },
  {
    index: '02',
    title: 'Fast, observed feedback',
    detail: 'Request or share specific coaching notes after real client calls in under a minute.',
  },
  {
    index: '03',
    title: 'Earn verified milestones',
    detail: 'Two verified observations earn a skill badge with the real feedback behind it.',
  },
] as const;

const FEATURED_NAMES = [
  'Maya Chen',
  'Sam Rivera',
  'Leo Okonkwo',
  'Rhea Castillo',
  'Nina Patel',
  'Nadia Brooks',
] as const;

const roleBadge = (summary: string) => {
  const s = summary.toLowerCase();
  if (s.includes('compliance')) return { label: 'Compliance', tone: 'warning' as const };
  if (s.includes('admin')) return { label: 'Admin', tone: 'info' as const };
  if (s.includes('program') || s.includes('head of')) {
    return { label: 'Program', tone: 'info' as const };
  }
  if (s.includes('coach')) return { label: 'Coach', tone: 'primary' as const };
  if (s.includes('leader')) return { label: 'Leader', tone: 'primary' as const };
  return { label: 'Advisor', tone: 'neutral' as const };
};

const SignIn = () => {
  const { next } = Route.useSearch();
  const personas = useQuery({ ...queryOptions('auth', 'devPersonas', undefined), retry: false });
  const [pending, setPending] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allPersonas = personas.data ?? [];
  const featured = FEATURED_NAMES.flatMap((name) =>
    allPersonas.filter((p) => p.person.displayName === name),
  );
  const visiblePersonas = showAll || featured.length === 0 ? allPersonas : featured;
  const hiddenCount = Math.max(0, allPersonas.length - visiblePersonas.length);
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
    <main className="folio-paper grid min-h-dvh place-items-center px-4 py-10 md:px-8">
      <div className="grid w-full max-w-4xl gap-10 lg:grid-cols-[1.08fr_1fr] lg:items-center lg:gap-14">
        <div className="grid gap-7">
          <BrandLockup size="lg" tagline="Observed Advisory Craft" />
          <div className="grid gap-3.5">
            <h1 className="editorial-serif text-[2.25rem] leading-[1.12] font-normal text-ink md:text-[2.65rem]">
              Grow advisor skills through{' '}
              <em className="text-primary-ink italic">real client work.</em>
            </h1>
            <p className="max-w-md text-body text-ink-2">
              A quiet coaching folio for financial advisors, coaches, and branch leaders — built
              around real observed meetings, never vanity CRM counts.
            </p>
          </div>
          <ol className="grid divide-y divide-line border-y border-line">
            {PILLARS.map((p) => (
              <li key={p.index} className="flex items-baseline gap-4 py-3.5">
                <span className="font-mono text-meta font-medium text-primary-ink tabular">
                  {p.index}
                </span>
                <div className="grid gap-0.5">
                  <p className="text-ui font-semibold text-ink">{p.title}</p>
                  <p className="text-meta text-ink-2">{p.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="inline-flex items-center gap-2 text-meta text-ink-3">
            <CatalystArc size={13} />
            <span>Every closed mastery ring quotes the real observation behind it.</span>
          </p>
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
                {visiblePersonas.map((p) => {
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
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="cursor-pointer text-center text-meta font-medium text-primary-ink hover:underline"
                >
                  Show all {allPersonas.length} demo people
                </button>
              ) : null}
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
