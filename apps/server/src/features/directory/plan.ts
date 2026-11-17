import type { DirectoryDiff } from '@repo/api';
import type {
  BusinessFunctionId,
  IsoDate,
  JobFamilyId,
  PersonId,
  PositionId,
  ReportingLineId,
} from '@repo/domain';
import type { CsvRow } from './csv.ts';
import { finding, type Finding } from './findings.ts';

/**
 * Plans a directory import (ADR 0006): compares a full HR snapshot with the
 * directory as it stands and returns the diff, the exceptions and the writes.
 * Pure, so a dry run and an applied run see exactly the same plan.
 *
 * HR is the source of truth. A rule violation (a coach reporting to a coach, a
 * loop) is applied and recorded; a row that cannot be applied (no such
 * manager, own manager, duplicate) keeps what the directory had and is
 * recorded. Nothing here fails the import.
 */
export interface SnapshotPerson {
  readonly id: PersonId;
  readonly email: string;
  readonly displayName: string;
  readonly title: string | null;
  readonly location: string | null;
  readonly businessFunctionId: BusinessFunctionId | null;
  readonly entraObjectId: string | null;
  readonly status: string;
}

export interface DirectorySnapshot {
  readonly people: ReadonlyArray<SnapshotPerson>;
  readonly businessFunctions: ReadonlyArray<{
    readonly id: BusinessFunctionId;
    readonly name: string;
  }>;
  readonly jobFamilies: ReadonlyArray<{ readonly id: JobFamilyId; readonly name: string }>;
  /** Reporting lines with no end date. */
  readonly openLines: ReadonlyArray<{
    readonly id: ReportingLineId;
    readonly managerId: PersonId;
    readonly reportId: PersonId;
    readonly validFrom: IsoDate;
  }>;
  /** Positions with no end date. */
  readonly openPositions: ReadonlyArray<{
    readonly id: PositionId;
    readonly personId: PersonId;
    readonly jobFamilyId: JobFamilyId | null;
    readonly title: string | null;
    readonly businessFunctionId: BusinessFunctionId | null;
    readonly validFrom: IsoDate;
  }>;
  /** People holding the coach grant on the effective date. */
  readonly coachIds: ReadonlySet<PersonId>;
}

export interface PositionValues {
  readonly title: string | null;
  readonly jobFamily: string | null;
  readonly businessFunction: string | null;
}

export interface PlannedPerson {
  readonly email: string;
  readonly row: CsvRow;
  /** Null for someone new to the directory. */
  readonly existing: SnapshotPerson | null;
  /** Column values the person row should hold (business function by name). */
  readonly values: {
    readonly email: string;
    readonly displayName: string;
    readonly title: string | null;
    readonly location: string | null;
    readonly businessFunction: string | null;
    readonly entraObjectId: string | null;
    readonly status: 'active' | null;
  };
  /** Field-by-field differences from the directory (empty for someone new). */
  readonly changes: ReadonlyArray<{
    readonly field: string;
    readonly from: string | null;
    readonly to: string | null;
  }>;
}

export interface ImportPlan {
  readonly rows: number;
  readonly diff: DirectoryDiff;
  readonly findings: ReadonlyArray<Finding>;
  readonly newBusinessFunctions: ReadonlyArray<string>;
  readonly newJobFamilies: ReadonlyArray<string>;
  readonly people: ReadonlyArray<PlannedPerson>;
  /** New reporting lines (and the open line each one ends), keyed by the report's email. */
  readonly lines: ReadonlyArray<{
    readonly email: string;
    readonly endLineId: ReportingLineId | null;
    readonly managerEmail: string | null;
  }>;
  readonly positions: ReadonlyArray<{
    readonly email: string;
    readonly endPositionId: PositionId | null;
    readonly to: PositionValues;
  }>;
  readonly departures: ReadonlyArray<PersonId>;
}

const EMAIL = /^[^\s@,]+@[^\s@,]+$/;

/** Case-insensitive taxonomy lookup that keeps the stored spelling. */
const taxonomy = (existing: ReadonlyArray<{ readonly name: string }>) => {
  const known = new Map(existing.map((e) => [e.name.toLowerCase(), e.name]));
  const added: Array<string> = [];
  return {
    added,
    canonical: (name: string | null): string | null => {
      if (name === null) return null;
      const found = known.get(name.toLowerCase());
      if (found !== undefined) return found;
      known.set(name.toLowerCase(), name);
      added.push(name);
      return name;
    },
  };
};

const samePosition = (a: PositionValues, b: PositionValues) =>
  a.title === b.title && a.jobFamily === b.jobFamily && a.businessFunction === b.businessFunction;

type Taxonomy = ReturnType<typeof taxonomy>;

/** Valid, unique rows, each matched to at most one existing person (by Entra id, then email). */
const matchRows = (
  rows: ReadonlyArray<CsvRow>,
  snapshot: DirectorySnapshot,
  functions: Taxonomy,
  families: Taxonomy,
  findings: Array<Finding>,
) => {
  const functionNames = new Map(snapshot.businessFunctions.map((f) => [f.id, f.name]));
  const byOid = new Map(
    snapshot.people.flatMap((p) => (p.entraObjectId ? [[p.entraObjectId, p] as const] : [])),
  );
  const byEmail = new Map(
    snapshot.people
      .filter((p) => p.status !== 'departed')
      .map((p) => [p.email.toLowerCase(), p] as const),
  );
  const firstLine = new Map<string, number>();
  const matched = new Map<PersonId, number>();
  const people: Array<PlannedPerson> = [];
  for (const row of rows) {
    if (row.email === null || !EMAIL.test(row.email) || row.displayName === null) {
      findings.push(finding('invalid_row', { email: null, personId: null }, { line: row.line }));
      continue;
    }
    const existing =
      (row.entraObjectId ? byOid.get(row.entraObjectId) : undefined) ?? byEmail.get(row.email);
    const first = firstLine.get(row.email) ?? (existing ? matched.get(existing.id) : undefined);
    if (first !== undefined) {
      findings.push(
        finding(
          'duplicate_email',
          { email: row.email, personId: existing?.id ?? null },
          { line: row.line, firstLine: first },
        ),
      );
      continue;
    }
    firstLine.set(row.email, row.line);
    if (existing) matched.set(existing.id, row.line);
    const values: PlannedPerson['values'] = {
      email: row.email,
      displayName: row.displayName,
      title: row.title,
      location: row.location,
      businessFunction: functions.canonical(row.businessFunction),
      entraObjectId: row.entraObjectId ?? existing?.entraObjectId ?? null,
      status: existing && existing.status === 'departed' ? 'active' : null,
    };
    families.canonical(row.jobFamily);
    const before: Record<string, string | null> = existing
      ? {
          email: existing.email.toLowerCase(),
          displayName: existing.displayName,
          title: existing.title,
          location: existing.location,
          businessFunction: existing.businessFunctionId
            ? (functionNames.get(existing.businessFunctionId) ?? null)
            : null,
          entraObjectId: existing.entraObjectId,
          status: existing.status,
        }
      : {};
    const after: Record<string, string | null> = {
      ...values,
      status: values.status ?? (existing?.status as string | undefined) ?? 'active',
    };
    const changes = Object.keys(before)
      .filter((field) => before[field] !== after[field])
      .map((field) => ({ field, from: before[field] ?? null, to: after[field] ?? null }));
    people.push({ email: row.email, row, existing: existing ?? null, values, changes });
  }
  return { people, matched };
};

/** Every loop in the manager graph (each person has at most one manager). */
const findCycles = (finalManager: ReadonlyMap<string, string | null>) => {
  const cycles: Array<Array<string>> = [];
  const state = new Map<string, 'visiting' | 'done'>();
  for (const start of finalManager.keys()) {
    const path: Array<string> = [];
    let node: string | null | undefined = start;
    while (node && finalManager.has(node) && !state.has(node)) {
      state.set(node, 'visiting');
      path.push(node);
      node = finalManager.get(node);
    }
    if (node && state.get(node) === 'visiting') {
      cycles.push(path.slice(path.indexOf(node)));
    }
    for (const visited of path) state.set(visited, 'done');
  }
  return cycles;
};

/** A change of title, job family or business function is a new dated position. */
const planPositions = (
  people: ReadonlyArray<PlannedPerson>,
  snapshot: DirectorySnapshot,
  families: Taxonomy,
) => {
  const functionNames = new Map(snapshot.businessFunctions.map((f) => [f.id, f.name]));
  const familyNames = new Map(snapshot.jobFamilies.map((f) => [f.id, f.name]));
  const openPositionOf = new Map(snapshot.openPositions.map((p) => [p.personId, p]));
  const positions: Array<ImportPlan['positions'][number]> = [];
  const positionChanges: Array<DirectoryDiff['positionChanges'][number]> = [];
  for (const person of people) {
    const to: PositionValues = {
      title: person.values.title,
      jobFamily: families.canonical(person.row.jobFamily),
      businessFunction: person.values.businessFunction,
    };
    const open = person.existing ? openPositionOf.get(person.existing.id) : undefined;
    const from: PositionValues | null = open
      ? {
          title: open.title,
          jobFamily: open.jobFamilyId ? (familyNames.get(open.jobFamilyId) ?? null) : null,
          businessFunction: open.businessFunctionId
            ? (functionNames.get(open.businessFunctionId) ?? null)
            : null,
        }
      : null;
    if (from && samePosition(from, to)) continue;
    positions.push({ email: person.email, endPositionId: open?.id ?? null, to });
    if (person.existing) {
      positionChanges.push({
        email: person.email,
        displayName: person.values.displayName,
        from,
        to,
      });
    }
  }
  return { positions, positionChanges };
};

export const planImport = (input: {
  readonly rows: ReadonlyArray<CsvRow>;
  readonly snapshot: DirectorySnapshot;
  readonly applyDepartures: boolean;
  readonly actorId: PersonId;
}): ImportPlan => {
  const { snapshot } = input;
  const findings: Array<Finding> = [];
  const functions = taxonomy(snapshot.businessFunctions);
  const families = taxonomy(snapshot.jobFamilies);
  const byId = new Map(snapshot.people.map((p) => [p.id, p]));
  const { people, matched } = matchRows(input.rows, snapshot, functions, families, findings);
  const inFile = new Map(people.map((p) => [p.email, p]));
  const fileKeyOf = new Map(
    people.flatMap((p) => (p.existing ? [[p.existing.id, p.email] as const] : [])),
  );
  const emailOf = (id: PersonId) => byId.get(id)?.email.toLowerCase() ?? null;

  // 2. Departure candidates: in the directory, not in the file.
  const missing = snapshot.people
    .filter((p) => p.status !== 'departed' && !matched.has(p.id))
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName));
  const departures = input.applyDepartures
    ? missing.filter((p) => {
        if (p.id !== input.actorId) return true;
        findings.push(finding('self_departure', { email: p.email.toLowerCase(), personId: p.id }));
        return false;
      })
    : [];
  const departing = new Set(departures.map((p) => p.id));

  // 3. Managers. Final edges are keyed by email; `id:` marks a manager outside the file.
  const openLineOf = new Map(snapshot.openLines.map((l) => [l.reportId, l]));
  const finalManager = new Map<string, string | null>();
  const lines: Array<ImportPlan['lines'][number]> = [];
  const managerChanges: Array<DirectoryDiff['managerChanges'][number]> = [];
  for (const person of people) {
    const current = person.existing ? openLineOf.get(person.existing.id) : undefined;
    const currentKey = current
      ? (fileKeyOf.get(current.managerId) ?? `id:${current.managerId}`)
      : null;
    const wanted = person.row.managerEmail;
    const subject = { email: person.email, personId: person.existing?.id ?? null };
    let keep = false;
    if (wanted === person.email) {
      findings.push(finding('self_manager', subject, { line: person.row.line }));
      keep = true;
    } else if (wanted !== null && !inFile.has(wanted)) {
      findings.push(
        finding('manager_not_found', subject, { line: person.row.line, managerEmail: wanted }),
      );
      keep = true;
    }
    if (keep) {
      finalManager.set(person.email, currentKey);
      continue;
    }
    finalManager.set(person.email, wanted);
    if (currentKey === wanted) continue;
    lines.push({ email: person.email, endLineId: current?.id ?? null, managerEmail: wanted });
    if (person.existing) {
      managerChanges.push({
        email: person.email,
        displayName: person.values.displayName,
        fromManagerEmail: current ? emailOf(current.managerId) : null,
        toManagerEmail: wanted,
      });
    }
  }

  // 4. Structural rules on the resulting graph: recorded, never refused.
  const personIdOfKey = (key: string): PersonId | null =>
    key.startsWith('id:') ? (key.slice(3) as PersonId) : (inFile.get(key)?.existing?.id ?? null);
  for (const [email, managerKey] of finalManager) {
    if (managerKey === null) continue;
    const reportId = inFile.get(email)?.existing?.id ?? null;
    const managerId = personIdOfKey(managerKey);
    const subject = { email, personId: reportId };
    if (
      reportId &&
      managerId &&
      snapshot.coachIds.has(reportId) &&
      snapshot.coachIds.has(managerId)
    ) {
      findings.push(
        finding('coach_reports_to_coach', subject, {
          managerEmail: managerKey.startsWith('id:') ? emailOf(managerId) : managerKey,
        }),
      );
    }
    if (managerId && departing.has(managerId)) {
      findings.push(finding('manager_departed', subject, { managerEmail: emailOf(managerId) }));
    }
  }
  for (const cycle of findCycles(finalManager)) {
    for (const email of cycle) {
      const personId = inFile.get(email)?.existing?.id ?? null;
      findings.push(finding('cycle', { email, personId }, { cycle }));
    }
  }
  const { positions, positionChanges } = planPositions(people, snapshot, families);

  return {
    rows: input.rows.length,
    diff: {
      added: people
        .filter((p) => p.existing === null)
        .map((p) => ({
          email: p.email,
          displayName: p.values.displayName,
          title: p.values.title,
          managerEmail: finalManager.get(p.email) ?? null,
        })),
      updated: people.flatMap((p) =>
        p.existing && p.changes.length > 0
          ? [
              {
                personId: p.existing.id,
                email: p.email,
                displayName: p.values.displayName,
                changes: p.changes,
              },
            ]
          : [],
      ),
      departed: missing.map((p) => ({
        personId: p.id,
        email: p.email.toLowerCase(),
        displayName: p.displayName,
      })),
      managerChanges,
      positionChanges,
      taxonomyAdded: [
        ...functions.added.map((name) => ({ kind: 'business_function' as const, name })),
        ...families.added.map((name) => ({ kind: 'job_family' as const, name })),
      ],
    },
    findings,
    newBusinessFunctions: functions.added,
    newJobFamilies: families.added,
    people,
    lines,
    positions,
    departures: departures.map((p) => p.id),
  };
};
