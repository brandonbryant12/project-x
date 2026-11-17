import type { IsoDate, NotificationKind } from '@repo/domain';

/**
 * The closed template set (ADR 0018, invariant I20). Every word a notification
 * can carry is in this file. Parameters are a first name, a colleague's
 * display name, a date, counts and a link; nothing else exists to render.
 */
export interface TemplateParams {
  readonly firstName: string;
  readonly actorName: string | null;
  readonly dueOn: IsoDate | null;
  readonly link: string;
}

export interface DigestCounts {
  readonly toSign: number;
  readonly earliestDue: IsoDate | null;
  readonly plannedForYou: number;
  readonly newAboutYou: number;
  readonly reportsObserved: { readonly observed: number; readonly of: number } | null;
}

export interface Rendered {
  readonly subject: string;
  readonly lines: ReadonlyArray<string>;
  readonly link: string;
}

const day = (iso: IsoDate) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** "1 of your 3 reports was observed…" for the digest. */
export const coverageSentence = (observed: number, of: number): string => {
  if (of === 1) {
    return observed === 1
      ? 'Your report was observed in the last six weeks.'
      : 'Your report has not been observed in the last six weeks.';
  }
  return `${observed} of your ${of} reports ${observed === 1 ? 'was' : 'were'} observed in the last six weeks.`;
};

const someone = (name: string | null) => name ?? 'A colleague';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const renderNotification = (
  kind: Exclude<NotificationKind, 'weekly_digest'>,
  p: TemplateParams,
): Rendered => {
  switch (kind) {
    case 'observation_requested':
      return {
        subject: `${someone(p.actorName)} asked you to observe their work`,
        lines: [
          `Hi ${p.firstName},`,
          `${someone(p.actorName)} asked you to record what you saw.`,
          ...(p.dueOn ? [`The request stays open until ${day(p.dueOn)}.`] : []),
        ],
        link: p.link,
      };
    case 'observation_signed':
      return {
        subject: `${someone(p.actorName)} signed an observation about your work`,
        lines: [
          `Hi ${p.firstName},`,
          `${someone(p.actorName)} wrote down what they saw. Read it in the app.`,
        ],
        link: p.link,
      };
    case 'observation_returned':
      return {
        subject: `${someone(p.actorName)} has a question about your request`,
        lines: [
          `Hi ${p.firstName},`,
          `${someone(p.actorName)} sent your request back with a question.`,
        ],
        link: p.link,
      };
    case 'plan_proposed':
      return {
        subject: `${someone(p.actorName)} proposed a plan`,
        lines: [
          `Hi ${p.firstName},`,
          `${someone(p.actorName)} would like you to agree their plan.`,
        ],
        link: p.link,
      };
    case 'engagement_proposed':
      return {
        subject: `${someone(p.actorName)} proposed a coaching engagement`,
        lines: [`Hi ${p.firstName},`, `${someone(p.actorName)} would like to work with you.`],
        link: p.link,
      };
    case 'request_expiring':
      return {
        subject: 'A request to observe closes soon',
        lines: [
          `Hi ${p.firstName},`,
          `${someone(p.actorName)} is still waiting for what you saw.`,
          ...(p.dueOn ? [`It closes on ${day(p.dueOn)}.`] : []),
        ],
        link: p.link,
      };
  }
};

/**
 * The Monday digest: counts and dates only, one line each, no comparisons.
 * Returns null when there is nothing to say, so the digest is skipped.
 */
export const renderDigest = (firstName: string, c: DigestCounts, link: string): Rendered | null => {
  const lines: Array<string> = [];
  if (c.toSign > 0) {
    lines.push(
      `${plural(c.toSign, 'observation is', 'observations are')} waiting for you${c.earliestDue ? `; the first closes ${day(c.earliestDue)}` : ''}.`,
    );
  }
  if (c.plannedForYou > 0) {
    lines.push(
      `${plural(c.plannedForYou, 'person has', 'people have')} planned work this week that names you as observer.`,
    );
  }
  if (c.newAboutYou > 0) {
    lines.push(
      `${plural(c.newAboutYou, 'new observation', 'new observations')} about your work to read.`,
    );
  }
  if (lines.length === 0) return null;
  if (c.reportsObserved && c.reportsObserved.of > 0) {
    lines.push(coverageSentence(c.reportsObserved.observed, c.reportsObserved.of));
  }
  return { subject: 'Your week', lines: [`Hi ${firstName},`, ...lines], link };
};

/** Where each notification lands: one screen with one primary action. */
export const deepLink = (
  origin: string,
  kind: NotificationKind,
  entityId: string | null,
  extra: { readonly ownerId?: string } = {},
): string => {
  switch (kind) {
    case 'observation_requested':
    case 'observation_signed':
    case 'observation_returned':
    case 'request_expiring':
      return `${origin}/observations/${entityId}`;
    case 'plan_proposed':
      return extra.ownerId ? `${origin}/team/${extra.ownerId}` : `${origin}/`;
    case 'engagement_proposed':
      return `${origin}/coaching`;
    case 'weekly_digest':
      return `${origin}/`;
  }
};
