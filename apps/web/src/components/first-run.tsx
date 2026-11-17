import type { PersonSummary } from '@repo/api';
import { Button, Card } from '@repo/ui';
import { Link } from '@tanstack/react-router';

const first = (p: PersonSummary) => p.displayName.split(' ')[0] ?? p.displayName;

/**
 * The first run for someone with no plan: one next step, said plainly, and who
 * will be on the other side of it. Used on Home and on My development.
 */
export const FirstRunStep = ({
  leader,
  coaches,
  onStart,
}: {
  readonly leader: PersonSummary | null;
  readonly coaches: ReadonlyArray<PersonSummary>;
  /** Open the plan dialog in place; without it the button goes to My development. */
  readonly onStart?: () => void;
}) => {
  const coach = coaches[0];
  const who = [
    coach ? `${first(coach)}, your coach, agrees it with you` : null,
    leader ? `${first(leader)}, your leader, can see it and observe that work` : null,
  ].filter(Boolean);
  return (
    <Card className="grid gap-4 p-5 md:p-6">
      <div className="grid gap-2">
        <p className="text-meta text-ink-3">Your first step</p>
        <h2 className="font-serif text-h1 font-medium text-ink">Start a development plan</h2>
        <p className="max-w-[60ch] text-body text-ink-2">
          Choose one to three skills to grow and the real work that will show them: a client
          meeting, an annual review, a call you already have.
          {who.length > 0 ? ` ${who.join('; ')}.` : ''} Your record begins when someone who saw that
          work signs what they saw.
        </p>
      </div>
      {onStart ? (
        <Button variant="primary" className="justify-self-start" onClick={onStart}>
          Start a plan
        </Button>
      ) : (
        <Button variant="primary" className="justify-self-start" asChild>
          <Link to="/development" search={{ start: 'plan' }}>
            Start a plan
          </Link>
        </Button>
      )}
    </Card>
  );
};
