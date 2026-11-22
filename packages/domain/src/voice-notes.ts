import { screenLocally, type LocalScreenResult } from './privacy.ts';

export interface StructuredVoiceNote {
  readonly saw: string;
  readonly next: string;
  readonly privacy: LocalScreenResult;
}

const NEXT_CUE_PATTERN =
  /(?:^|[.!?]\s+|,\s+)(?:next time|for next time|one thing to try(?: next(?: time)?)?|to try next|try next time|something to try|going forward|opportunity(?: is)?|next step(?: is)?|for the next (?:call|meeting)|next meeting|work on|could try)\b[:,-]?\s*/i;

const cleanSentence = (raw: string): string => {
  const trimmed = raw.replaceAll(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
};

/**
 * Pure parser that turns spoken post-meeting coaching dictation into structured
 * "What went well" (`saw`) and "Try next time" (`next`) fields while running
 * local client-PII screening immediately.
 */
export const structureVoiceTranscript = (rawTranscript: string): StructuredVoiceNote => {
  const normalized = rawTranscript.replaceAll(/\s+/g, ' ').trim();
  if (!normalized) {
    return { saw: '', next: '', privacy: { held: false, reasons: [] } };
  }

  const match = NEXT_CUE_PATTERN.exec(normalized);
  let sawRaw = normalized;
  let nextRaw = '';

  if (match && match.index !== undefined) {
    const splitAt = match.index;
    const matchedText = match[0];
    // Preserve terminal punctuation on the first half if matched after [.!?]
    const leadingPunct = /^[.!?]/.test(matchedText) ? matchedText.charAt(0) : '';
    sawRaw = (normalized.slice(0, splitAt) + leadingPunct).trim();
    nextRaw = normalized.slice(splitAt + matchedText.length).trim();
    // If speaker started directly with "Next time ...", keep full text in saw if sawRaw is tiny.
    if (sawRaw.length < 8) {
      sawRaw = normalized;
      nextRaw = '';
    }
  }

  const saw = cleanSentence(sawRaw);
  const next = cleanSentence(nextRaw);
  const privacy = screenLocally(`${saw} ${next}`.trim());

  return { saw, next, privacy };
};
