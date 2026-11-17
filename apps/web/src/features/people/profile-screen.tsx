import type { BadgeReceiptView, ProfileView } from '@repo/api';
import { OBSERVATION_MODE_LABELS } from '@repo/domain';
import {
  BadgeSeal,
  Button,
  Card,
  CreditFacts,
  EmptyState,
  Field,
  FieldHint,
  Label,
  PersonAvatar,
  Pill,
  SectionLabel,
  SegmentedControl,
  SegmentedItem,
  Textarea,
  toast,
} from '@repo/ui';
import { Link } from '@tanstack/react-router';
import { ArrowLeftIcon, LockIcon } from 'lucide-react';
import { useState } from 'react';
import { Page } from '@/components/page.tsx';
import { ResponsiveDialog } from '@/components/responsive-dialog.tsx';
import { useApiMutation } from '@/lib/api.ts';
import { formatDate, formatLongDate } from '@/lib/format.ts';
import { useSession } from '@/lib/session.ts';
import { ProgressBlock } from '@/features/development/development-screen.tsx';
import { DesignationsSection } from './designations.tsx';

type CoachingDirection = ProfileView['coachingDirections'][number];

/** Each direction, from the viewer's side, in plain words. */
const DIRECTION_COPY: Record<
  CoachingDirection,
  {
    readonly button: string;
    readonly choice: (first: string) => string;
    readonly title: (first: string) => string;
  }
> = {
  coach_them: {
    button: 'Offer coaching',
    choice: (first) => `I coach ${first}`,
    title: (first) => `Offer to coach ${first}`,
  },
  coach_me: {
    button: 'Ask to coach me',
    choice: (first) => `${first} coaches me`,
    title: (first) => `Ask ${first} to coach you`,
  },
};

/** The profile's coaching button: one direction names itself; two open a choice. */
const proposeLabel = (directions: ProfileView['coachingDirections']) =>
  directions.length === 1 && directions[0]
    ? DIRECTION_COPY[directions[0]].button
    : 'Propose coaching';

/** Offers only the directions the server says are possible for this viewer and person. */
const ProposeEngagementDialog = ({
  profile,
  open,
  onClose,
}: {
  readonly profile: ProfileView;
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const session = useSession();
  const [note, setNote] = useState('');
  const directions = profile.coachingDirections;
  const [chosen, setChosen] = useState<CoachingDirection | null>(null);
  const direction = chosen && directions.includes(chosen) ? chosen : (directions[0] ?? null);
  const first = profile.person.displayName.split(' ')[0] ?? profile.person.displayName;
  const propose = useApiMutation('support', 'proposeEngagement', {
    onSuccess: () => {
      toast.success(`Proposed. ${first} can accept or decline.`);
      onClose();
    },
  });
  if (!direction) return null;
  const iCoach = direction === 'coach_them';
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={
        directions.length > 1 ? `Coaching with ${first}` : DIRECTION_COPY[direction].title(first)
      }
      description="Coaching carries no reporting relationship. Either of you can end it."
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          propose.mutate({
            payload: {
              coachId: iCoach ? session.person.id : profile.person.id,
              coacheeId: iCoach ? profile.person.id : session.person.id,
              note: note.trim() || null,
            },
          });
        }}
      >
        {directions.length > 1 ? (
          <Field>
            <Label>Who coaches whom</Label>
            <SegmentedControl
              type="single"
              value={direction}
              onValueChange={(v) => v && setChosen(v as CoachingDirection)}
              aria-label="Who coaches whom"
            >
              {directions.map((d) => (
                <SegmentedItem key={d} value={d}>
                  {DIRECTION_COPY[d].choice(first)}
                </SegmentedItem>
              ))}
            </SegmentedControl>
          </Field>
        ) : null}
        <Field>
          <Label htmlFor="engagement-note">What you would like to work on · optional</Label>
          <Textarea
            id="engagement-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <FieldHint>The proposal stays open for 14 days.</FieldHint>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={propose.isPending}>
            {DIRECTION_COPY[direction].title(first)}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};

/** Profile relation labels that make the viewer a designator (ADR 0020). */
const DESIGNATORS = new Set(['Your report', 'You coach them']);

const SharedWith = ({ text }: { readonly text: string }) => (
  <span className="inline-flex items-center gap-1 text-meta text-ink-3" title={text}>
    <LockIcon aria-hidden className="size-3" /> {text}
  </span>
);

export const ProfileScreen = ({ profile }: { readonly profile: ProfileView }) => {
  const session = useSession();
  const [proposing, setProposing] = useState(false);
  const self = session.person.id === profile.person.id;
  const first = profile.person.displayName.split(' ')[0];
  return (
    <Page>
      <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-5">
          <PersonAvatar person={profile.person} size="lg" />
          <div className="grid gap-1">
            <h1 className="font-serif text-h1 font-medium text-ink md:text-display">
              {profile.person.displayName}
            </h1>
            <p className="text-body text-ink-2">
              {[profile.person.title, profile.businessFunction, profile.location]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {profile.relations.length > 0 ? (
              <div className="mt-1 flex gap-1.5">
                {profile.relations.map((r) => (
                  <Pill key={r} tone="outline">
                    {r}
                  </Pill>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {profile.canObserve ? (
            <Button variant="primary" asChild>
              <Link to="/observations/new" search={{ for: profile.person.id }}>
                I saw this
              </Link>
            </Button>
          ) : null}
          {profile.developmentVisible && !self ? (
            <Button variant="secondary" asChild>
              <Link to="/team/$personId" params={{ personId: profile.person.id }}>
                {first}’s plan
              </Link>
            </Button>
          ) : null}
          {profile.coachingDirections.length > 0 ? (
            <Button variant="secondary" onClick={() => setProposing(true)}>
              {proposeLabel(profile.coachingDirections)}
            </Button>
          ) : null}
        </div>
      </header>

      <section className="grid gap-4" aria-labelledby="badges">
        <div className="flex items-baseline justify-between">
          <SectionLabel id="badges">Badges</SectionLabel>
          <span className="text-meta text-ink-3">Visible to everyone</span>
        </div>
        {profile.badges.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profile.badges.map((b) => (
              <Link
                key={b.id}
                to="/people/$id/badges/$badgeId"
                params={{ id: profile.person.id, badgeId: b.id }}
                className="group flex items-center gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong"
              >
                <BadgeSeal level={b.level as 2 | 3 | 4} domain={b.skill.domain} size={56} />
                <span className="grid gap-0.5">
                  <span className="text-ui font-medium text-ink group-hover:underline">
                    {b.skill.name}
                  </span>
                  <span className="text-meta text-ink-3">
                    {b.levelName} · {formatDate(b.awardedAt, { year: 'numeric' })}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState>
            {self
              ? 'No badges yet. They come from observations by more than one person, over time.'
              : `${first} has no badges yet.`}
          </EmptyState>
        )}
      </section>

      {profile.developmentVisible && profile.progress.length > 0 ? (
        <section className="mt-12 grid gap-4" aria-labelledby="progress">
          <div className="flex items-baseline justify-between">
            <SectionLabel id="progress">In progress</SectionLabel>
            <SharedWith
              text={
                self
                  ? 'Shared with your coaches and leaders'
                  : `Visible to ${first}, their coaches and leaders`
              }
            />
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {profile.progress.map((p) => (
              <ProgressBlock key={p.skill.id} progress={p} />
            ))}
          </div>
        </section>
      ) : null}
      {/* Designated observers are off unless the tenant turns them on (server config). */}
      {self || !session.features.designatedObservers ? null : (
        <DesignationsSection
          subject={profile.person}
          // The direct leader or an engaged coach may name one (the server re-checks).
          canDesignate={profile.relations.some((r) => DESIGNATORS.has(r))}
        />
      )}
      <ProposeEngagementDialog
        profile={profile}
        open={proposing}
        onClose={() => setProposing(false)}
      />
    </Page>
  );
};

type ReceiptWork = BadgeReceiptView['work'][number];

/** Why a credit on the receipt did not add its points, if it did not. */
const creditNote = (c: ReceiptWork['credits'][number], shared: boolean) => {
  if (c.reversed) return 'reversed after the award (observation voided), not counted';
  if (shared && !c.counted) return 'same work, not added again';
  return null;
};

/** One piece of work on the receipt: every observer who saw it; it counted once. */
const ReceiptWorkItem = ({ work }: { readonly work: ReceiptWork }) => {
  const shared = work.credits.length > 1;
  return (
    <li>
      <Card className="grid gap-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-ui font-medium text-ink">
            {formatDate(work.occurredOn, { year: 'numeric' })}
          </span>
          <span className="text-meta text-ink-3 tabular">
            Counted {work.points} {work.points === 1 ? 'point' : 'points'}
            {shared ? ` · seen by ${work.credits.length} observers, counted once` : ''}
          </span>
        </div>
        {work.credits.map((c) => (
          <div key={c.id} className="grid gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <PersonAvatar person={c.observer} size="sm" />
              <span className="text-ui font-medium text-ink">{c.observer.displayName}</span>
              <span className="text-meta text-ink-3">
                {c.levelName} · {OBSERVATION_MODE_LABELS[c.mode]}
              </span>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <CreditFacts role={c.role} points={c.points} source={c.pointsSource} />
              {creditNote(c, shared) ? (
                <span className="text-meta text-ink-3">· {creditNote(c, shared)}</span>
              ) : null}
            </p>
            {c.narrativeSaw ? (
              <blockquote className="narrative border-l-2 border-brass pl-4 text-ink">
                {c.narrativeSaw}
              </blockquote>
            ) : null}
          </div>
        ))}
      </Card>
    </li>
  );
};

/**
 * "How this was earned": each piece of work once, with every observer who saw
 * it, the role and value of each credit, and the total against what the badge
 * needed when it was awarded.
 */
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** Every criterion the award was judged by, in plain words. */
const neededSentence = (required: NonNullable<BadgeReceiptView['required']>) =>
  [
    `${required.points} points from at least ${many(required.interactions, 'piece', 'pieces')} of work`,
    many(required.observers, 'observer', 'observers'),
    `at least ${Math.round(required.firstHandShare * 100)}% of the work seen or reviewed first-hand`,
    `${many(required.spanDays, 'day', 'days')} between the first and last`,
    ...(required.primaryPoints > 0
      ? [`${required.primaryPoints} points with it as the primary skill`]
      : []),
  ]
    .join(', ')
    .replace(/, ([^,]*)$/, ' and $1');

export const BadgeReceiptScreen = ({ receipt }: { readonly receipt: BadgeReceiptView }) => {
  const first = receipt.holder.displayName.split(' ')[0];
  const legacy = receipt.work.some((w) => w.credits.some((c) => c.role === 'unclassified'));
  return (
    <Page width="reading">
      <Button variant="ghost" size="sm" asChild className="mb-6 -ml-2">
        <Link to="/people/$id" params={{ id: receipt.holder.id }}>
          <ArrowLeftIcon /> {receipt.holder.displayName}
        </Link>
      </Button>
      <header className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <BadgeSeal
          level={receipt.badge.level as 2 | 3 | 4}
          domain={receipt.badge.skill.domain}
          size={96}
        />
        <div className="grid gap-1">
          <p className="text-meta text-ink-3">Earned {formatLongDate(receipt.badge.awardedAt)}</p>
          <h1 className="font-serif text-h1 font-medium text-ink md:text-display">
            {receipt.badge.skill.name}
          </h1>
          <p className="text-body text-brass-ink">{receipt.badge.levelName}</p>
        </div>
      </header>
      <p className="mt-6 text-body text-ink-2">{receipt.facts}</p>
      {receipt.required && receipt.points !== null ? (
        <p className="mt-2 text-ui text-ink-2 tabular">
          {receipt.points} points count now. When it was awarded, this badge needed{' '}
          {neededSentence(receipt.required)}.
        </p>
      ) : null}
      {receipt.detailVisible ? null : (
        <p className="mt-2 text-ui text-ink-3">
          How it was earned, observation by observation, is visible to {first}, their coaches and
          their leaders.
        </p>
      )}
      {receipt.detailVisible ? (
        <section className="mt-10 grid gap-4" aria-labelledby="receipt">
          <SectionLabel id="receipt">How this was earned</SectionLabel>
          <ol className="grid gap-4">
            {receipt.work.map((w) => (
              <ReceiptWorkItem key={w.interactionId} work={w} />
            ))}
          </ol>
          {legacy ? (
            <p className="text-meta text-ink-3">
              Observed before roles: credit signed before skills had a primary or secondary role. It
              counts its value but never as primary.
            </p>
          ) : null}
          {receipt.narrativesVisible ? null : (
            <p className="text-ui text-ink-3">
              Narratives are visible to {first}, their coaches and their direct leader.
            </p>
          )}
        </section>
      ) : null}
    </Page>
  );
};
