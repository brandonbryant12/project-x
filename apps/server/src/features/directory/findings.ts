import type { DirectoryExceptionFinding } from '@repo/api';
import type { DirectoryExceptionKind, PersonId } from '@repo/domain';

/**
 * A directory exception before it is stored (ADR 0006). The explanation is
 * rendered from `kind` and structured `data`, so the stored row holds no
 * free text.
 */
export interface Finding {
  readonly kind: DirectoryExceptionKind;
  readonly email: string | null;
  readonly personId: PersonId | null;
  readonly data: Readonly<Record<string, unknown>>;
  /** One live exception per (kind, subject). */
  readonly dedupeKey: string;
}

export const finding = (
  kind: DirectoryExceptionKind,
  subject: { readonly email: string | null; readonly personId: PersonId | null },
  data: Readonly<Record<string, unknown>> = {},
): Finding => ({
  kind,
  email: subject.email,
  personId: subject.personId,
  data,
  dedupeKey: `${kind}:${subject.email ?? subject.personId ?? `line-${String(data['line'] ?? '0')}`}`,
});

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '?';

/** Plain-language explanation for a tenant admin. */
export const describeFinding = (
  kind: DirectoryExceptionKind,
  email: string | null,
  data: Readonly<Record<string, unknown>>,
): string => {
  const who = email ?? 'This person';
  switch (kind) {
    case 'coach_reports_to_coach':
      return `${who} holds the coach grant and reports to ${text(data['managerEmail'])}, who also holds it. Coaches should report to leaders; fix it in HR or acknowledge it.`;
    case 'manager_not_found':
      return `Line ${text(data['line'])} names ${text(data['managerEmail'])} as manager, but nobody in the file has that address. The current reporting line was kept.`;
    case 'cycle':
      return `Reporting lines form a loop: ${Array.isArray(data['cycle']) ? [...data['cycle'], data['cycle'][0]].map(text).join(' → ') : '?'}. Leader chains stop at the loop until HR fixes it.`;
    case 'self_manager':
      return `Line ${text(data['line'])} names ${who} as their own manager. The current reporting line was kept.`;
    case 'duplicate_email':
      return `${who} appears again on line ${text(data['line'])} (first on line ${text(data['firstLine'])}). Only the first row was used.`;
    case 'manager_departed':
      return `${who}'s manager, ${text(data['managerEmail'])}, has departed. They have no leader in the app until HR records a new manager.`;
    case 'invalid_row':
      return `Line ${text(data['line'])} has no valid email address or display name, so it was skipped.`;
    case 'self_departure':
      return `${who} is not in the file but ran this import. You cannot depart yourself; another tenant admin must.`;
  }
};

export const toFindingView = (f: Finding): DirectoryExceptionFinding => ({
  kind: f.kind,
  personEmail: f.email,
  detail: describeFinding(f.kind, f.email, f.data),
});

/** Keeps the first finding per dedupe key. */
export const uniqueFindings = (findings: ReadonlyArray<Finding>): ReadonlyArray<Finding> => {
  const seen = new Set<string>();
  return findings.filter((f) => !seen.has(f.dedupeKey) && seen.add(f.dedupeKey));
};
