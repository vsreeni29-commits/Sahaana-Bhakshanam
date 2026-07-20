/**
 * Normalize an Indian mobile number to E.164 (+91XXXXXXXXXX).
 * Accepts "9876543210", "09876543210", "919876543210", "+91 98765 43210" etc.
 * Returns null for anything that is not a valid Indian mobile number.
 */
export function normalizeIndianPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[\s\-().]/g, '');
  const m = cleaned.match(/^(?:\+91|91|0)?([6-9]\d{9})$/);
  return m ? `+91${m[1]}` : null;
}

/** Mask for display/logs: +91••••••135 (never log or echo full numbers). */
export function maskPhone(e164: string): string {
  if (e164.length < 4) return '••••';
  return `${e164.slice(0, 3)}••••••${e164.slice(-3)}`;
}
