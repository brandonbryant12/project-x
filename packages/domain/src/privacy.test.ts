import { describe, expect, it } from 'vitest';
import { screenLocally } from './privacy.ts';

describe('local privacy screen', () => {
  it.each([
    ['Walked Mrs. Henderson through the plan', 'Appears to name a client'],
    ['Their SSN 123-45-6789 was on file', 'Looks like a Social Security number'],
    ['Moved funds from 4111 1111 1111 1111', 'Looks like an account or card number'],
    ['Emailed pat@example.com the summary', 'Contains an email address'],
    ['Confirmed the acct # before the call', 'Mentions an account number'],
  ])('holds %s', (text, reason) => {
    expect(screenLocally(text)).toEqual({ held: true, reasons: expect.arrayContaining([reason]) });
  });

  it('passes a reflection about the advisor’s own behavior', () => {
    expect(
      screenLocally(
        'I opened by asking what a good retirement would feel like, then summarized their goals before discussing allocation.',
      ),
    ).toEqual({ held: false, reasons: [] });
  });
});
