import { Effect, Redacted } from 'effect';
import { layerPg } from '../src/index.ts';

const url = process.env['DATABASE_URL'] ?? 'postgres://app:app@localhost:5442/app';

await Effect.runPromise(
  Effect.void.pipe(Effect.provide(layerPg({ url: Redacted.make(url), migrate: true }))),
);
console.log('migrations applied');
