import { Button, Card, CatalystArc } from '@repo/ui';
import { ShieldCheckIcon } from 'lucide-react';
import { ResponsiveDialog } from './responsive-dialog.tsx';

const STEPS = [
  {
    step: '01',
    title: 'Pick 1–3 focus skills',
    body: 'Choose the client or leadership skills you want to sharpen right now, like Client discovery or Behavioral coaching.',
  },
  {
    step: '02',
    title: 'Get observed in real work',
    body: 'After a real client call, review, or huddle, ask your coach or leader for feedback — or they can log feedback right after watching you.',
  },
  {
    step: '03',
    title: 'Earn verified milestones',
    body: 'Once a coach or leader observes you at a skill level twice (with at least one first-hand observation), you earn that skill badge with their real notes attached.',
  },
] as const;

/** Quick 15-second orientation modal accessible from the top bar anytime. */
export const HowItWorksDialog = ({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) => (
  <ResponsiveDialog
    open={open}
    onOpenChange={onOpenChange}
    title="How Coaching Catalyst works"
    description="Real coaching feedback from real client work — no vanity CRM counts."
  >
    <div className="grid gap-4">
      <ol className="grid gap-2.5">
        {STEPS.map((s) => (
          <li key={s.step}>
            <Card className="flex items-baseline gap-3.5 p-4">
              <span className="font-mono text-meta font-semibold text-primary-ink tabular">
                {s.step}
              </span>
              <div className="grid gap-0.5">
                <p className="text-ui font-semibold text-ink">{s.title}</p>
                <p className="text-ui text-ink-2">{s.body}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      <div className="flex items-start gap-2.5 rounded-card border border-line bg-sunken px-4 py-3 text-meta text-ink-2">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary-ink" aria-hidden />
        <p>
          <span className="font-medium text-ink">Client privacy built in:</span> Describe what the
          advisor did, never client names or account numbers.
        </p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-meta text-ink-3">
          <CatalystArc size={13} /> Close skill rings through real observed coaching.
        </span>
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Got it
        </Button>
      </div>
    </div>
  </ResponsiveDialog>
);
