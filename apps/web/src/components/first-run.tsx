import type { HomeView, PersonSummary } from '@repo/api';
import { Button, Card } from '@repo/ui';
import { Link } from '@tanstack/react-router';
import {
  AwardIcon,
  CompassIcon,
  MessageSquareHeartIcon,
  MessageSquarePlusIcon,
} from 'lucide-react';

const first = (p: PersonSummary) => p.displayName.split(' ')[0] ?? p.displayName;

const STEPS = [
  {
    icon: CompassIcon,
    label: '1. Pick 1–3 focus skills',
    hint: 'Choose what you want to sharpen in your client meetings.',
  },
  {
    icon: MessageSquareHeartIcon,
    label: '2. Request or get feedback',
    hint: 'Ask your coach or leader after a real call or review.',
  },
  {
    icon: AwardIcon,
    label: '3. Earn verified milestones',
    hint: 'Two observations earn a skill badge with their real notes.',
  },
] as const;

/**
 * Welcoming, self-explanatory onboarding card for anyone who hasn't picked
 * focus skills yet. Used on Home and My Skills.
 */
export const FirstRunStep = ({
  leader,
  coaches,
  onStart,
}: {
  readonly leader: PersonSummary | null;
  readonly coaches: ReadonlyArray<PersonSummary>;
  readonly onStart?: () => void;
}) => {
  const coach = coaches[0];
  const people = [
    coach ? `${first(coach)} (your coach)` : null,
    leader ? `${first(leader)} (your leader)` : null,
  ].filter(Boolean);
  return (
    <Card className="grid gap-5 border-primary/25 bg-surface p-5 md:p-6">
      <div className="grid gap-1.5">
        <p className="text-meta font-semibold tracking-wider text-primary-ink uppercase">
          Get started in 30 seconds
        </p>
        <h2 className="font-serif text-h1 font-medium text-ink">
          Pick 1–3 skills you want to grow
        </h2>
        <p className="max-w-2xl text-body text-ink-2">
          Coaching Catalyst tracks real coaching feedback from real client work.
          {people.length > 0
            ? ` ${people.join(' and ')} can observe your work and share feedback directly on the skills you pick.`
            : ' Choose the skills you want to focus on, then request feedback after real client meetings.'}
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.label} className="flex items-start gap-2.5 rounded-card bg-sunken/80 p-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-control bg-primary-soft text-primary-ink">
              <s.icon className="size-3.5" aria-hidden />
            </span>
            <div className="grid gap-0.5">
              <p className="text-ui font-medium text-ink">{s.label}</p>
              <p className="text-meta text-ink-3">{s.hint}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2.5">
        {onStart ? (
          <Button variant="primary" onClick={onStart}>
            Pick my focus skills
          </Button>
        ) : (
          <Button variant="primary" asChild>
            <Link to="/development" search={{ start: 'plan' }}>
              Pick my focus skills
            </Link>
          </Button>
        )}
        <Button variant="secondary" asChild>
          <Link to="/catalog/skills">Browse skill catalog</Link>
        </Button>
      </div>
    </Card>
  );
};

/** First run for a leader or coach: highlights giving quick feedback to their people. */
export const ObserverFirstRun = () => (
  <Card className="grid gap-4 border-primary/25 bg-surface p-5 md:p-6">
    <div className="grid gap-1.5">
      <p className="text-meta font-semibold tracking-wider text-primary-ink uppercase">
        Ready to coach
      </p>
      <h2 className="font-serif text-h1 font-medium text-ink">
        Seen someone do great work this week?
      </h2>
      <p className="max-w-2xl text-body text-ink-2">
        Capture quick, specific feedback after a client meeting, call recording, or team huddle. It
        takes under a minute and counts directly toward their skill milestones.
      </p>
    </div>
    <div className="flex flex-wrap gap-2.5">
      <Button variant="primary" asChild>
        <Link to="/observations/new">
          <MessageSquarePlusIcon /> Give feedback
        </Link>
      </Button>
      <Button variant="secondary" asChild>
        <Link to="/development" search={{ start: 'plan' }}>
          Pick my own focus skills
        </Link>
      </Button>
    </div>
  </Card>
);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** First run for a program owner: the program, not a plan of their own (ADR 0021: no names). */
export const ProgramHealthCard = ({
  health,
}: {
  readonly health: NonNullable<HomeView['programHealth']>;
}) => (
  <Card className="grid gap-4 border-primary/25 bg-surface p-5 md:p-6">
    <div className="grid gap-1.5">
      <p className="text-meta font-semibold tracking-wider text-primary-ink uppercase">
        Your program
      </p>
      <h2 className="font-serif text-h1 font-medium text-ink">Program health</h2>
      <p className="max-w-2xl text-body text-ink-2">
        {count(health.withPlan, 'person has', 'people have')} active focus skills;{' '}
        {health.observedRecently === null
          ? `fewer than ${health.minimumCell} were`
          : `${health.observedRecently} ${health.observedRecently === 1 ? 'was' : 'were'}`}{' '}
        observed in the last six weeks.
      </p>
    </div>
    <div>
      <Button variant="primary" asChild>
        <Link to="/adoption">View adoption report</Link>
      </Button>
    </div>
  </Card>
);
