import { describe, expect, it } from 'vitest';
import { entraStartHref, safeReturnPath } from './return-to.ts';

describe('safeReturnPath', () => {
  it.each([
    ['/observations/obs_1?from=email', '/observations/obs_1?from=email'],
    ['/inbox#drafts', '/inbox#drafts'],
    [undefined, '/'],
    ['', '/'],
    ['https://evil.example/x', '/'],
    ['//evil.example/x', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/sign-in?next=/inbox', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });
});

describe('entraStartHref', () => {
  it('carries a deep link as returnTo', () => {
    expect(entraStartHref('/observations/obs_1')).toBe(
      '/api/auth/entra/start?returnTo=%2Fobservations%2Fobs_1',
    );
  });
  it('omits returnTo for Home or an unsafe path', () => {
    expect(entraStartHref(undefined)).toBe('/api/auth/entra/start');
    expect(entraStartHref('//evil.example')).toBe('/api/auth/entra/start');
  });
});
