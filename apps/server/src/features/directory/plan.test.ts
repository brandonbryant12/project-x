import type { BusinessFunctionId, IsoDate, PersonId, ReportingLineId } from '@repo/domain';
import { describe, expect, it } from 'vitest';
import { parseDirectoryCsv } from './csv.ts';
import { planImport, type DirectorySnapshot } from './plan.ts';

/**
 * I29, the rules a journey test does not reach: loops, own-manager rows,
 * unusable rows and quoted CSV fields. HR is the truth, so each is a finding
 * and never a refusal.
 */
const person = (key: string, coach = false) => ({
  id: `per_${key.padEnd(16, '0')}` as PersonId,
  email: `${key}@example.com`,
  displayName: key,
  title: null,
  location: null,
  businessFunctionId: null as BusinessFunctionId | null,
  entraObjectId: null,
  status: 'active',
  coach,
});

const snapshotOf = (
  people: ReadonlyArray<ReturnType<typeof person>>,
  lines: ReadonlyArray<[manager: string, report: string]> = [],
): DirectorySnapshot => {
  const id = (key: string) => people.find((p) => p.displayName === key)!.id;
  return {
    people,
    businessFunctions: [],
    jobFamilies: [],
    openLines: lines.map(([m, r], i) => ({
      id: `rpl_${String(i).padEnd(16, '0')}` as ReportingLineId,
      managerId: id(m),
      reportId: id(r),
      validFrom: '2025-01-01' as IsoDate,
    })),
    openPositions: [],
    coachIds: new Set(people.filter((p) => p.coach).map((p) => p.id)),
  };
};

const HEADER = 'email,display_name,title,location,business_function,manager_email,job_family';
const plan = (csv: string, snapshot: DirectorySnapshot) => {
  const parsed = parseDirectoryCsv(`${HEADER}\n${csv}`);
  if (!parsed.ok) throw new Error(parsed.message);
  return planImport({
    rows: parsed.rows,
    snapshot,
    applyDepartures: false,
    actorId: 'per_actor00000000000' as PersonId,
  });
};
const kinds = (p: ReturnType<typeof plan>) => p.findings.map((f) => `${f.kind}:${f.email}`);

describe('directory import plan', () => {
  it('I29: a loop is applied and reported once per person on it', () => {
    const p = plan(
      ['a@example.com,a,,,,b@example.com,', 'b@example.com,b,,,,a@example.com,'].join('\n'),
      snapshotOf([person('a'), person('b')]),
    );
    expect(kinds(p).toSorted()).toEqual(['cycle:a@example.com', 'cycle:b@example.com']);
    expect(p.lines.map((l) => [l.email, l.managerEmail])).toEqual([
      ['a@example.com', 'b@example.com'],
      ['b@example.com', 'a@example.com'],
    ]);
  });

  it('I29: an own-manager row keeps the current line; an unusable row is skipped', () => {
    const p = plan(
      ['a@example.com,a,,,,,', 'b@example.com,b,,,,b@example.com,', ',nobody,,,,,'].join('\n'),
      snapshotOf([person('a'), person('b')], [['a', 'b']]),
    );
    expect(kinds(p)).toEqual(['invalid_row:null', 'self_manager:b@example.com']);
    expect(p.lines).toEqual([]);
  });

  it('I29: a coach under a coach is applied and reported; quoted fields keep their commas', () => {
    const p = plan(
      [
        'a@example.com,"Lee, A",Coach,,,,',
        'b@example.com,b,"Coach, ""senior""",,,a@example.com,',
      ].join('\n'),
      snapshotOf([person('a', true), person('b', true)]),
    );
    expect(kinds(p)).toEqual(['coach_reports_to_coach:b@example.com']);
    expect(p.people.map((x) => x.values.displayName)).toEqual(['Lee, A', 'b']);
    expect(p.people[1]?.values.title).toBe('Coach, "senior"');
    expect(p.diff.managerChanges).toHaveLength(1);
  });
});
