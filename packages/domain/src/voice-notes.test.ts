import { describe, expect, it } from 'vitest';
import { structureVoiceTranscript } from './voice-notes.ts';

describe('structureVoiceTranscript (voice-to-structured coaching notes)', () => {
  it('splits spoken dictation into saw and next fields on natural coaching cues', () => {
    const result = structureVoiceTranscript(
      'maya paused after asking about retirement priorities and reflected back both spouses goals. next time, ask which trade-off matters most before opening the projection',
    );
    expect(result.saw).toBe(
      'Maya paused after asking about retirement priorities and reflected back both spouses goals.',
    );
    expect(result.next).toBe('Ask which trade-off matters most before opening the projection.');
    expect(result.privacy.held).toBe(false);
  });

  it('keeps single-thought dictation in saw when no transition cue is spoken', () => {
    const result = structureVoiceTranscript(
      'explained the fee structure in plain language without jargon',
    );
    expect(result.saw).toBe('Explained the fee structure in plain language without jargon.');
    expect(result.next).toBe('');
  });

  it('flags client PII spoken into the transcript immediately', () => {
    const result = structureVoiceTranscript(
      'Great call with Mrs. Patterson reviewing account number 4417 2291. Next time summarize faster.',
    );
    expect(result.privacy.held).toBe(true);
    expect(result.privacy.reasons.length).toBeGreaterThan(0);
  });
});
