import { toIsoDate, type IsoDate } from '@repo/domain';
import { Clock, Context, Duration, Effect } from 'effect';

/** Current instant from the Effect Clock, so tests can control time. */
export const now: Effect.Effect<Date> = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms));

/**
 * The IANA zone that defines the business day (`tenant.time_zone`). The auth
 * middleware provides the signed-in tenant's zone for every request; the
 * default matches the column's default for system work outside a request.
 */
export const BusinessTimeZone = Context.Reference<string>('@repo/server/BusinessTimeZone', {
  defaultValue: () => 'America/New_York',
});

/** The calendar date of `at` in `timeZone`. */
export const businessDateIn = (at: Date, timeZone: string): IsoDate =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at) as IsoDate;

/**
 * Today's business date in the tenant's zone, not UTC: at 23:30 in New York it
 * is still today there, though it is already tomorrow in UTC.
 */
export const today: Effect.Effect<IsoDate> = Effect.gen(function* () {
  const zone = yield* BusinessTimeZone;
  return businessDateIn(yield* now, zone);
});

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 86_400_000);

export const addDaysIso = (date: IsoDate, days: number): IsoDate =>
  toIsoDate(addDays(new Date(`${date}T00:00:00Z`), days));

/** A clock frozen at `ms`: lets the seed replay history at the dates it happened. */
export const fixedClock = (ms: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => ms,
  currentTimeMillis: Effect.succeed(ms),
  currentTimeNanosUnsafe: () => BigInt(ms) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(ms) * 1_000_000n),
  monotonicTimeNanosUnsafe: () => BigInt(ms) * 1_000_000n,
  monotonicTimeNanos: Effect.succeed(BigInt(ms) * 1_000_000n),
  // Time stands still for reads, but sleeps and timeouts still take real time,
  // so a connect timeout inside a replayed seed step does not fire at once.
  sleep: (duration) =>
    Effect.promise(
      () => new Promise<void>((resolve) => setTimeout(resolve, Duration.toMillis(duration))),
    ),
});

/** Minutes the zone is ahead of UTC at instant `at` (negative west of Greenwich). */
const offsetMinutes = (at: Date, timeZone: string): number => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
};

/**
 * The instant a business day starts in `timeZone` (local midnight). Day bounds
 * for queries are `[startOfBusinessDay(d), startOfBusinessDay(d + 1))`, never
 * UTC midnights.
 */
export const startOfBusinessDay = (on: IsoDate, timeZone: string): Date => {
  const utcMidnight = Date.parse(`${on}T00:00:00Z`);
  // Two passes settle the offset across a daylight-saving change.
  const first = utcMidnight - offsetMinutes(new Date(utcMidnight), timeZone) * 60_000;
  return new Date(utcMidnight - offsetMinutes(new Date(first), timeZone) * 60_000);
};
