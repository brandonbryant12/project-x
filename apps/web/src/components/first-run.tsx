import type { HomeView, PersonSummary } from '@repo/api';
import { Button, Card } from '@repo/ui';
import { Link } from '@tanstack/react-router';
import { EyeIcon } from 'lucide-react';

const first = (p: PersonSummary) => p.displayName.split(' ')[0] ?? p.displayName;

const FirstRunCard = ({
  eyebrow,
  title,
  children,
  action,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly action: React.ReactNode;
}) => (
  <Card className="grid gap-4 p-5 md:p-6">
    <div className="grid gap-2">
      <p className="text-meta text-ink-3">{eyebrow}</p>
      <h2 className="font-serif text-h1 font-medium text-ink">{title}</h2>
      <div className="grid max-w-[60ch] gap-3 text-body text-ink-2">{children}</div>
    </div>
    {action}
  </Card>
);

const HOW_IT_WORKS = [
  'Pick a skill.',
  'Do the work and ask someone who saw it.',
  'They sign, and it counts.',
] as const;

/**
 * The first run for someone with no plan: one next step, said plainly, and who
 * will be on the other side of it. Used on Home and on My plan.
 */
export const FirstRunStep = ({
  leader,
  coaches,
  onStart,
}: {
  readonly leader: PersonSummary | null;
  readonly coaches: ReadonlyArray<PersonSummary>;
  /** Open the plan dialog in place; without it the button goes to My plan. */
  readonly onStart?: () => void;
}) => {
  const coach = coaches[0];
  const who = [
    coach ? `${first(coach)}, your coach, agrees it with you` : null,
    leader ? `${first(leader)}, your leader, can see it and observe that work` : null,
  ].filter(Boolean);
  return (
    <FirstRunCard
      eyebrow="Your first step"
      title="Start a plan"
      action={
        onStart ? (
          <Button variant="primary" className="justify-self-start" onClick={onStart}>
            Start a plan
          </Button>
        ) : (
          <Button variant="primary" className="justify-self-start" asChild>
            <Link to="/development" search={{ start: 'plan' }}>
              Start a plan
            </Link>
          </Button>
        )
      }
    >
      <p>
        Choose one to three skills to grow and the work that will show them: a client meeting, an
        annual review, a call you already have.
        {who.length > 0 ? ` ${who.join('; ')}.` : ''} Your record begins when someone who saw that
        work signs what they saw.
      </p>
      <ol className="grid gap-1 text-ui text-ink">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step} className="flex gap-2">
            <span className="w-4 shrink-0 text-ink-3 tabular">{i + 1}.</span> {step}
          </li>
        ))}
      </ol>
    </FirstRunCard>
  );
};

/** First run for a leader or coach: the one thing only they can do. */
export const ObserverFirstRun = () => (
  <FirstRunCard
    eyebrow="Your first step"
    title="Seen someone do good work this week?"
    action={
      <Button variant="primary" className="justify-self-start" asChild>
        <Link to="/observations/new">
          <EyeIcon /> I saw this
        </Link>
      </Button>
    }
  >
    <p>
      Write down what you saw in under a minute. Your signature is the only thing that counts toward
      their badge.
    </p>
  </FirstRunCard>
);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** First run for a program owner: the program, not a plan of their own (ADR 0021: no names). */
export const ProgramHealthCard = ({
  health,
}: {
  readonly health: NonNullable<HomeView['programHealth']>;
}) => (
  <FirstRunCard
    eyebrow="Your program"
    title="Program health"
    action={
      <Button variant="primary" className="justify-self-start" asChild>
        <Link to="/adoption">Open</Link>
      </Button>
    }
  >
    <p>
      {count(health.withPlan, 'person has', 'people have')} a plan;{' '}
      {health.observedRecently === null
        ? `fewer than ${health.minimumCell} were`
        : `${health.observedRecently} ${health.observedRecently === 1 ? 'was' : 'were'}`}{' '}
      observed in the last six weeks.
    </p>
  </FirstRunCard>
);
