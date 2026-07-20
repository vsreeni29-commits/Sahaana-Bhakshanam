import type { Env } from './env';
import { hmacSha256Hex, timingSafeEqualStr } from './util/crypto';

export const OTP_TTL_MS = 5 * 60 * 1000; // challenges expire after 5 minutes
export const OTP_RATE_WINDOW_MS = 10 * 60 * 1000; // rate-limit window
export const OTP_MAX_REQUESTS_PER_WINDOW = 3;
export const OTP_MAX_ATTEMPTS = 5; // challenge locks after 5 wrong codes

export type OtpProvider = 'twilio' | 'demo';

export function twilioConfigured(env: Env): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID);
}

export function demoConfigured(env: Env): boolean {
  return (
    env.OTP_DEMO_MODE === 'true' &&
    Boolean(env.OTP_DEMO_CODE && /^\d{6}$/.test(env.OTP_DEMO_CODE)) &&
    Boolean(env.OTP_HASH_SECRET)
  );
}

/** Which provider will serve OTPs, or null → fail closed. */
export function activeProvider(env: Env): OtpProvider | null {
  if (twilioConfigured(env)) return 'twilio';
  if (demoConfigured(env)) return 'demo';
  return null;
}

function twilioAuthHeader(env: Env): string {
  return 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
}

/** Ask Twilio Verify to send an SMS OTP. Throws on transport/API failure. */
export async function twilioSendOtp(env: Env, phoneE164: string): Promise<void> {
  const url = `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: twilioAuthHeader(env),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phoneE164, Channel: 'sms' }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Do not surface provider details (or the number) to the client or logs.
    throw new Error(`OTP provider send failed (${res.status})`);
  }
}

/** Check a code against Twilio Verify. Returns true only on 'approved'. */
export async function twilioCheckOtp(env: Env, phoneE164: string, code: string): Promise<boolean> {
  const url = `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: twilioAuthHeader(env),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phoneE164, Code: code }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { status?: string };
  return body.status === 'approved';
}

/**
 * Hash for the demo (local development) code. The code itself is never stored
 * or returned by any API — only this keyed hash goes to the database.
 */
export async function demoCodeHash(env: Env): Promise<string> {
  return hmacSha256Hex(env.OTP_HASH_SECRET as string, env.OTP_DEMO_CODE as string);
}

export async function demoCheckCode(env: Env, storedHash: string, code: string): Promise<boolean> {
  const candidate = await hmacSha256Hex(env.OTP_HASH_SECRET as string, code);
  return timingSafeEqualStr(candidate, storedHash);
}
