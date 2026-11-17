import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './entra.ts';

// I28: sign-in returns people to a notification's deep link, and can never be
// turned into an open redirect (ADR 0018, CC6.6).
describe('sign-in return path', () => {
  it.each([
    ['/observations/obs_0123456789abcdef', '/observations/obs_0123456789abcdef'],
    ['/team/per_x?tab=plan', '/team/per_x?tab=plan'],
    [undefined, '/'],
    ['observations/1', '/'],
    ['//evil.example/x', '/'],
    ['https://evil.example/x', '/'],
    ['/\\evil.example', '/'],
    ['/ok\u0000', '/'],
    [`/${'a'.repeat(600)}`, '/'],
  ])('%s → %s', (raw, expected) => {
    expect(safeReturnPath(raw)).toBe(expected);
  });
});
