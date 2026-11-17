import {
  INTERACTION_KIND_LABELS,
  LEVEL_NAMES,
  SKILL_DOMAIN_LABELS,
  type InteractionKind,
} from '@repo/domain';

export const formatDate = (iso: string, opts: Intl.DateTimeFormatOptions = {}) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...opts,
  });

/**
 * Server copy sometimes embeds a calendar date ("Logged for 2026-11-12").
 * People read dates, not ISO strings: rewrite any embedded YYYY-MM-DD.
 */
export const humanizeDates = (text: string) =>
  text.replaceAll(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => formatDate(iso));

/** "Thu 10:30": a scheduled moment in the viewer's own time zone. */
export const formatWhen = (iso: string) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
};

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export const formatLongDate = (iso: string) =>
  formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const relativeDays = (iso: string, now = new Date()) => {
  const then = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return formatDate(iso, { year: 'numeric' });
};

export const levelName = (level: number) => LEVEL_NAMES[level as 1 | 2 | 3 | 4] ?? `Level ${level}`;
export const kindLabel = (kind: InteractionKind) => INTERACTION_KIND_LABELS[kind];
export const domainLabel = (domain: string) =>
  SKILL_DOMAIN_LABELS[domain as keyof typeof SKILL_DOMAIN_LABELS] ?? domain;

export const greeting = (now = new Date()) => {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const daysAgoIso = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
