import { assert, it } from '@effect/vitest';
import { Clock, Effect } from 'effect';
import { BusinessTimeZone, fixedClock, startOfBusinessDay, today } from './time.ts';

// I32: business dates are the tenant's calendar day, not UTC's. At 23:30 in
// New York (04:30Z) it is still the 16th there.
const at = (iso: string, zone: string) =>
  today.pipe(
    Effect.provideService(Clock.Clock, fixedClock(Date.parse(iso))),
    Effect.provideService(BusinessTimeZone, zone),
  );

it.effect('I32: today is the tenant’s business date', () =>
  Effect.gen(function* () {
    assert.strictEqual(yield* at('2026-11-17T04:30:00Z', 'America/New_York'), '2026-11-16');
    assert.strictEqual(yield* at('2026-11-17T04:30:00Z', 'Europe/London'), '2026-11-17');
    assert.strictEqual(yield* at('2026-11-16T23:30:00Z', 'Asia/Tokyo'), '2026-11-17');
  }),
);

const start = (on: string, zone: string) => startOfBusinessDay(on as never, zone).toISOString();

it('I32: a business day starts at local midnight, across daylight-saving changes', () => {
  assert.strictEqual(start('2026-11-16', 'America/New_York'), '2026-11-16T05:00:00.000Z');
  assert.strictEqual(start('2026-07-16', 'America/New_York'), '2026-07-16T04:00:00.000Z');
  // The day the clocks go back in New York (2026-11-01) still starts at EDT midnight.
  assert.strictEqual(start('2026-11-01', 'America/New_York'), '2026-11-01T04:00:00.000Z');
  assert.strictEqual(start('2026-11-16', 'Asia/Tokyo'), '2026-11-15T15:00:00.000Z');
});
