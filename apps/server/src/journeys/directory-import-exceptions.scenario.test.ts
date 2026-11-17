import { Api } from '@repo/api';
import { Db, schema } from '@repo/db';
import { assert, layer } from '@effect/vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiTest } from 'effect/http-api';
import { seedWorld } from '../scripts/seed-world.ts';
import { ScenarioLayer, atScenarioTime, signInAs } from '../test/harness.ts';

/**
 * Journey: a tenant admin imports the HR file (ADR 0006). Protects I29: a dry
 * run shows the diff and exceptions and writes nothing; an applied import
 * moves a manager with effective dating (the old line ends on the effective
 * date, the new one starts on it); a rule violation such as a coach reporting
 * to a coach is applied and queued as an exception, never a failure.
 */
const client = HttpApiTest.groups(Api, ['directory']);

const at = (name: string) => `${name.toLowerCase().replace(' ', '.')}@northwind.example`;
const row = (
  name: string,
  title: string,
  fn: string,
  manager: string | null,
  jobFamily = '',
  location = 'Boston',
) => [at(name), name, title, location, fn, manager ? at(manager) : '', jobFamily].join(',');

/** The seeded firm as HR sees it today, with this week's changes. */
const HR_FILE = [
  'email,display_name,title,location,business_function,manager_email,job_family',
  row('Rhea Castillo', 'Managing Director', 'Leadership', null),
  row('Leo Okonkwo', 'Branch Leader', 'Leadership', 'Rhea Castillo'),
  row('Priya Raman', 'Branch Leader', 'Leadership', 'Rhea Castillo', '', 'Hartford'),
  row('Sam Rivera', 'Senior Practice Coach', 'Practice Development', 'Rhea Castillo'),
  // HR moves Jordan under Sam: both hold the coach grant.
  row('Jordan Blake', 'Practice Coach', 'Practice Development', 'Sam Rivera', '', 'Hartford'),
  row('Nina Patel', 'Compliance Principal', 'Compliance', 'Rhea Castillo'),
  // Maya moves from Leo's branch to Priya's.
  row('Maya Chen', 'Financial Advisor', 'Advisory', 'Priya Raman', 'Financial advisor'),
  // Daniel's manager is not in the file: his current line is kept.
  [
    at('Daniel Okafor'),
    'Daniel Okafor',
    'Associate Advisor',
    'Boston',
    'Advisory',
    'nobody@northwind.example',
    '',
  ].join(','),
  row('Aisha Bello', 'Financial Advisor', 'Advisory', 'Leo Okonkwo'),
  row('Tom Whitaker', 'Senior Financial Advisor', 'Advisory', 'Priya Raman', '', 'Hartford'),
  row('Tom Whitaker', 'Senior Financial Advisor', 'Advisory', 'Priya Raman', '', 'Hartford'),
  row('Marcus Hill', 'Financial Advisor', 'Advisory', 'Priya Raman', '', 'Hartford'),
  row('Grace Liu', 'Client Service Lead', 'Client Service', 'Priya Raman', '', 'Hartford'),
  row('Noah Park', 'Associate Advisor', 'Advisory', 'Priya Raman', 'Financial advisor', 'Hartford'),
  // Elena is missing: a departure candidate, not departed without applyDepartures.
].join('\n');

const TABLES = [
  schema.auditEvent,
  schema.person,
  schema.reportingLine,
  schema.personPosition,
  schema.businessFunction,
  schema.jobFamily,
  schema.directoryException,
  schema.note,
] as const;

const counts = Effect.gen(function* () {
  const db = yield* Db;
  return yield* Effect.forEach(TABLES, (table) =>
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .pipe(Effect.map(([r]) => r?.n ?? 0)),
  );
});

layer(ScenarioLayer, { timeout: 60_000 })('directory import and exceptions', (it) => {
  it.effect(
    'I29: a dry run writes nothing; applying moves a manager with effective dating and queues rule violations',
    () =>
      Effect.gen(function* () {
        yield* atScenarioTime;
        yield* seedWorld;
        const api = yield* client;
        const db = yield* Db;
        const leo = yield* signInAs('Leo Okonkwo');
        const priya = yield* signInAs('Priya Raman');
        const maya = yield* signInAs('Maya Chen');

        // Only a tenant admin may run it, even as a dry run.
        const refused = yield* api.directory
          .importDirectory({ payload: { csv: HR_FILE, dryRun: true } })
          .pipe(Effect.flip);
        assert.strictEqual(refused._tag, 'Forbidden');

        yield* signInAs('Rhea Castillo');
        // A file without the expected header is refused outright; that is not a rule violation.
        const malformed = yield* api.directory
          .importDirectory({ payload: { csv: 'name,email\nA,a@example.com', dryRun: true } })
          .pipe(Effect.flip);
        assert.strictEqual(malformed._tag, 'Unprocessable');

        const before = yield* counts;
        const preview = yield* api.directory.importDirectory({
          payload: { csv: HR_FILE, dryRun: true },
        });
        assert.deepStrictEqual(yield* counts, before, 'a dry run writes nothing, not even audit');
        assert.isFalse(preview.applied);
        assert.deepStrictEqual(
          preview.diff.added.map((a) => [a.email, a.managerEmail]),
          [[at('Noah Park'), at('Priya Raman')]],
        );
        assert.sameDeepMembers(
          preview.diff.managerChanges.map((c) => [c.email, c.fromManagerEmail, c.toManagerEmail]),
          [
            [at('Jordan Blake'), at('Rhea Castillo'), at('Sam Rivera')],
            [at('Maya Chen'), at('Leo Okonkwo'), at('Priya Raman')],
          ],
        );
        assert.deepStrictEqual(
          preview.diff.updated.map((u) => [u.email, u.changes.map((c) => c.field)]),
          [[at('Grace Liu'), ['title']]],
        );
        assert.deepStrictEqual(
          preview.diff.departed.map((d) => d.email),
          [at('Elena Brooks')],
        );
        assert.deepInclude(preview.diff.taxonomyAdded, {
          kind: 'job_family',
          name: 'Financial advisor',
        });
        assert.sameDeepMembers(
          preview.exceptions.map((e) => [e.kind, e.personEmail]),
          [
            ['coach_reports_to_coach', at('Jordan Blake')],
            ['manager_not_found', at('Daniel Okafor')],
            ['duplicate_email', at('Tom Whitaker')],
          ],
        );

        // Apply: the same plan, written and audited.
        const applied = yield* api.directory.importDirectory({
          payload: { csv: HR_FILE, dryRun: false },
        });
        assert.isTrue(applied.applied);
        assert.deepStrictEqual(applied.diff, preview.diff);
        assert.strictEqual(applied.departuresApplied, 0);

        const mayaLines = yield* db
          .select()
          .from(schema.reportingLine)
          .where(eq(schema.reportingLine.reportId, maya));
        const ended = mayaLines.find((l) => l.managerId === leo);
        const opened = mayaLines.find((l) => l.managerId === priya);
        assert.strictEqual(ended?.validTo, applied.effectiveOn, 'Leo led Maya until the move');
        assert.strictEqual(opened?.validFrom, applied.effectiveOn, 'Priya leads her from the move');
        assert.isDefined(opened);
        assert.isNull(opened.validTo);
        const lineAudit = yield* db
          .select()
          .from(schema.auditEvent)
          .where(eq(schema.auditEvent.entityType, 'reporting_line'));
        assert.includeMembers(
          lineAudit.map((e) => `${e.entityId}:${e.event}:${e.reasonCode}`),
          [`${ended?.id}:END:directory_change`, `${opened?.id}:START:directory_change`],
        );

        // HR is the truth: Jordan now reports to Sam, and the violation waits for an admin.
        const jordan = (yield* db
          .select()
          .from(schema.person)
          .where(eq(schema.person.displayName, 'Jordan Blake')))[0];
        const sam = (yield* db
          .select()
          .from(schema.person)
          .where(eq(schema.person.displayName, 'Sam Rivera')))[0];
        const [jordanLine] = yield* db
          .select()
          .from(schema.reportingLine)
          .where(
            and(
              eq(schema.reportingLine.reportId, jordan!.id),
              isNull(schema.reportingLine.validTo),
            ),
          );
        assert.strictEqual(jordanLine?.managerId, sam?.id);
        // Daniel's line was kept; Elena is still active.
        const [danielLine] = yield* db
          .select()
          .from(schema.reportingLine)
          .where(
            and(
              eq(schema.reportingLine.reportId, yield* signInAs('Daniel Okafor')),
              isNull(schema.reportingLine.validTo),
            ),
          );
        assert.strictEqual(danielLine?.managerId, leo);
        const [elena] = yield* db
          .select()
          .from(schema.person)
          .where(eq(schema.person.displayName, 'Elena Brooks'));
        assert.strictEqual(elena?.status, 'active');
        // Every person in the file now has an open, dated position.
        const positions = yield* db
          .select()
          .from(schema.personPosition)
          .where(isNull(schema.personPosition.validTo));
        assert.lengthOf(positions, 13);

        yield* signInAs('Rhea Castillo');
        const queue = yield* api.directory.exceptions({ query: {} });
        const coachToCoach = queue.find((e) => e.kind === 'coach_reports_to_coach');
        assert.isDefined(coachToCoach);
        assert.strictEqual(coachToCoach.person?.id, jordan?.id);
        assert.include(coachToCoach.detail, at('Sam Rivera'));
        assert.deepStrictEqual(coachToCoach.actions, ['ACKNOWLEDGE']);
        const acknowledged = yield* api.directory.acknowledgeException({
          params: { id: coachToCoach.id },
        });
        assert.strictEqual(acknowledged.status, 'acknowledged');
        assert.deepStrictEqual(acknowledged.actions, []);

        // Re-running the same file changes nothing and duplicates no exception.
        const exceptionsBefore = (yield* counts)[6];
        const rerun = yield* api.directory.importDirectory({
          payload: { csv: HR_FILE, dryRun: false },
        });
        assert.lengthOf(rerun.diff.managerChanges, 0);
        assert.lengthOf(rerun.diff.positionChanges, 0);
        assert.lengthOf(rerun.diff.added, 0);
        assert.strictEqual((yield* counts)[6], exceptionsBefore);
        const stillAcknowledged = yield* api.directory.exceptions({
          query: { status: 'acknowledged' },
        });
        assert.deepStrictEqual(
          stillAcknowledged.map((e) => e.id),
          [coachToCoach.id],
        );

        // HR fixes Jordan's line: the next import resolves the exception.
        const fixed = HR_FILE.replace(
          row(
            'Jordan Blake',
            'Practice Coach',
            'Practice Development',
            'Sam Rivera',
            '',
            'Hartford',
          ),
          row(
            'Jordan Blake',
            'Practice Coach',
            'Practice Development',
            'Rhea Castillo',
            '',
            'Hartford',
          ),
        );
        yield* api.directory.importDirectory({ payload: { csv: fixed, dryRun: false } });
        const resolved = yield* api.directory.exceptions({ query: { status: 'resolved' } });
        assert.include(
          resolved.map((e) => e.id),
          coachToCoach.id,
        );

        // Departures happen only when asked for, and then through the same deprovisioning.
        const withDepartures = yield* api.directory.importDirectory({
          payload: { csv: fixed, dryRun: false, applyDepartures: true },
        });
        assert.strictEqual(withDepartures.departuresApplied, 1);
        const [gone] = yield* db
          .select()
          .from(schema.person)
          .where(eq(schema.person.displayName, 'Elena Brooks'));
        assert.strictEqual(gone?.status, 'departed');
        const grants = yield* db
          .select()
          .from(schema.roleGrant)
          .where(and(eq(schema.roleGrant.personId, gone!.id), isNull(schema.roleGrant.validTo)));
        assert.lengthOf(grants, 0);
      }),
  );
});
