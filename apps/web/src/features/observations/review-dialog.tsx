import type { ObservationView } from '@repo/api';
import {
  BadgeSeal,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Kbd,
} from '@repo/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { describeError } from '@/lib/api.ts';
import { formatDate, levelName } from '@/lib/format.ts';
import type { Draft } from './use-observation-draft.ts';

/**
 * Review reads like a statement; signing is permanent and NOT optimistic
 * (ux-brief §2.5). On success the dialog cross-fades into the receipt — the one
 * celebratory moment in the product.
 */
export const ReviewAndSignDialog = ({
  open,
  onOpenChange,
  subjectName,
  occurredOn,
  draft,
  skillName,
  onSign,
  afterSigning = '/inbox',
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly subjectName: string;
  readonly occurredOn: string;
  readonly draft: Draft;
  readonly skillName: (id: string) => string;
  /** Posts the signature. A rejection keeps the dialog open with the reason. */
  readonly onSign: () => Promise<ObservationView>;
  /** Where "Next" goes from the receipt: the inbox queue, or home after a quick capture. */
  readonly afterSigning?: '/inbox' | '/';
}) => {
  const [phase, setPhase] = useState<'review' | 'posting' | 'done'>('review');
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState<ObservationView | null>(null);
  const navigate = useNavigate();
  const first = subjectName.split(' ')[0] ?? subjectName;

  const sign = async () => {
    setPhase('posting');
    setError(null);
    try {
      setSigned(await onSign());
      setPhase('done');
    } catch (e) {
      setError(`Not signed. Nothing was posted. ${describeError(e)}`);
      setPhase('review');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (phase === 'posting') return;
        onOpenChange(o);
        if (!o && phase === 'done') void navigate({ to: afterSigning });
      }}
    >
      <DialogContent className="max-w-[480px]">
        {phase !== 'done' ? (
          <div key="review" className="grid animate-fade-up gap-5">
            <div className="grid gap-1.5 pr-6">
              <DialogTitle className="font-serif text-h1 font-medium">
                You’re signing that you observed {subjectName} on {formatDate(occurredOn)}.
              </DialogTitle>
              <DialogDescription>
                Signing is permanent and posts credit to {first}’s record.
              </DialogDescription>
            </div>
            <ul className="grid gap-2 border-y border-line py-4">
              {draft.ratings.map((r) => (
                <li key={r.skillId} className="flex items-baseline justify-between gap-4 text-ui">
                  <span className="font-medium text-ink">{skillName(r.skillId)}</span>
                  <span className="text-ink-2">
                    {r.level ? levelName(r.level) : '—'}
                    {r.credit ? '' : ' · feedback only'}
                    {r.indicatorIds.length > 0 ? ` · ${r.indicatorIds.length} seen` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <blockquote className="narrative max-h-48 overflow-y-auto text-ink">
              {draft.narrativeSaw}
            </blockquote>
            {error ? (
              <p role="alert" className="text-ui text-danger-ink">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              {/* Initial focus on Go back: signing must be deliberate. */}
              <Button
                variant="ghost"
                autoFocus
                onClick={() => onOpenChange(false)}
                disabled={phase === 'posting'}
              >
                Go back
              </Button>
              <Button variant="primary" onClick={() => void sign()} disabled={phase === 'posting'}>
                {phase === 'posting' ? 'Posting to the record…' : 'Sign observation'}
              </Button>
            </div>
          </div>
        ) : null}
        {phase === 'done' && signed ? (
          <Receipt
            view={signed}
            nextLabel={afterSigning === '/inbox' ? 'Next in inbox' : null}
            onNext={() => void navigate({ to: afterSigning })}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const Receipt = ({
  view,
  nextLabel,
  onNext,
  onDone,
}: {
  readonly view: ObservationView;
  readonly nextLabel: string | null;
  readonly onNext: () => void;
  readonly onDone: () => void;
}) => {
  const first = view.subject.displayName.split(' ')[0] ?? '';
  const badge = view.badgesEarned.at(-1);
  return (
    <div key="receipt" className="grid animate-fade-up gap-5">
      <div className="flex items-center gap-4">
        {badge ? (
          <BadgeSeal level={badge.level as 2 | 3} domain={badge.skill.domain} size={64} settle />
        ) : null}
        <div className="grid gap-1">
          <DialogTitle className="font-serif text-h1 font-medium">Signed.</DialogTitle>
          <DialogDescription>{first} will see your words today.</DialogDescription>
        </div>
      </div>
      {view.credits.length > 0 ? (
        <ul className="grid gap-1.5 border-y border-line py-4">
          {view.credits.map((c) => (
            <li key={c.skill.id} className="flex items-baseline justify-between gap-4 text-ui">
              <span className="text-ink">{c.skill.name}</span>
              <span className="text-ink-2">
                {c.levelName}
                {c.firstHand ? ' · first-hand' : ' · from your discussion'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ui text-ink-2">Feedback only. Nothing was credited this time.</p>
      )}
      {badge ? (
        <p className="rounded-control bg-brass-soft px-3 py-2.5 text-ui text-brass-ink">
          This completed {first}’s {badge.skill.name} · {badge.levelName} badge.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {nextLabel ? (
          <>
            <Button variant="ghost" onClick={onDone}>
              Done
            </Button>
            <Button variant="primary" onClick={onNext}>
              {nextLabel}{' '}
              <Kbd className="ml-1 border-primary-fg/30 bg-transparent text-primary-fg">J</Kbd>
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
};
