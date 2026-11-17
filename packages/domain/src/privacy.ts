/**
 * Deterministic local privacy screen (ADR 0012). Runs on every reflection and
 * narrative regardless of AI availability, and fails closed: any match holds
 * the text. The AI privacy screen (Decisions) is additive, catching what
 * patterns cannot (e.g. bare client names).
 */
export interface LocalScreenResult {
  readonly held: boolean;
  readonly reasons: ReadonlyArray<string>;
}

const RULES: ReadonlyArray<{ readonly reason: string; readonly pattern: RegExp }> = [
  { reason: 'Looks like a Social Security number', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { reason: 'Looks like an account or card number', pattern: /\b(?:\d[ -]?){8,19}\b/ },
  { reason: 'Contains an email address', pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/ },
  { reason: 'Contains a phone number', pattern: /\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/ },
  {
    reason: 'Appears to name a client',
    pattern: /\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+/,
  },
  { reason: 'Mentions an account number', pattern: /\b(?:acct|account)\s*(?:no\.?|number|#)/i },
  { reason: 'Contains a date of birth', pattern: /\b(?:DOB|date of birth)\b/i },
];

export const screenLocally = (text: string): LocalScreenResult => {
  const reasons = RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.reason);
  return { held: reasons.length > 0, reasons };
};
