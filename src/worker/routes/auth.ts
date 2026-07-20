import { Hono } from 'hono';
import type { Env } from '../env';
import type { AuthContext } from '../auth';
import {
  createSession,
  destroySession,
  isChefNumber,
  setSessionCookie,
} from '../auth';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_REQUESTS_PER_WINDOW,
  OTP_RATE_WINDOW_MS,
  OTP_TTL_MS,
  activeProvider,
  demoCheckCode,
  demoCodeHash,
  twilioCheckOtp,
  twilioSendOtp,
} from '../otp';
import { maskPhone, normalizeIndianPhone } from '../util/phone';

type Purpose = 'consumer' | 'chef';

function parsePurpose(v: unknown): Purpose | null {
  return v === 'consumer' || v === 'chef' ? (v as Purpose) : null;
}

interface ChallengeRow {
  id: number;
  provider: 'twilio' | 'demo';
  code_hash: string | null;
  attempts: number;
  consumed: number;
  expires_at: number;
}

export const authRoutes = new Hono<{ Bindings: Env; Variables: { auth?: AuthContext } }>();

authRoutes.post('/request-otp', async (c) => {
  let body: { phone?: unknown; purpose?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request.' }, 400);
  }
  const phone = normalizeIndianPhone(body.phone);
  const purpose = parsePurpose(body.purpose);
  if (!phone || !purpose) {
    return c.json({ error: 'Enter a valid Indian mobile number.' }, 400);
  }

  // Chef OTPs only exist for allowlisted numbers; everyone else gets a
  // generic rejection with no hint about the allowlist.
  if (purpose === 'chef' && !isChefNumber(c.env, phone)) {
    return c.json({ error: 'Chef access is not available for this number.' }, 403);
  }

  const provider = activeProvider(c.env);
  if (!provider) {
    return c.json(
      { error: 'SMS OTP is not configured. Ordering sign-in is temporarily unavailable.' },
      503
    );
  }

  const now = Date.now();
  const recent = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM otp_challenges WHERE phone_e164 = ?1 AND purpose = ?2 AND created_at > ?3'
  )
    .bind(phone, purpose, now - OTP_RATE_WINDOW_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= OTP_MAX_REQUESTS_PER_WINDOW) {
    return c.json({ error: 'Too many OTP requests. Please try again in a few minutes.' }, 429);
  }

  let codeHash: string | null = null;
  if (provider === 'twilio') {
    try {
      await twilioSendOtp(c.env, phone);
    } catch {
      return c.json({ error: 'Could not send the OTP right now. Please try again.' }, 502);
    }
  } else {
    codeHash = await demoCodeHash(c.env);
  }

  await c.env.DB.prepare(
    `INSERT INTO otp_challenges (phone_e164, purpose, provider, code_hash, attempts, consumed, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6)`
  )
    .bind(phone, purpose, provider, codeHash, now + OTP_TTL_MS, now)
    .run();

  return c.json({ ok: true, phoneMasked: maskPhone(phone), expiresInSec: OTP_TTL_MS / 1000 });
});

authRoutes.post('/verify-otp', async (c) => {
  let body: { phone?: unknown; purpose?: unknown; code?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request.' }, 400);
  }
  const phone = normalizeIndianPhone(body.phone);
  const purpose = parsePurpose(body.purpose);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!phone || !purpose || !/^\d{4,8}$/.test(code)) {
    return c.json({ error: 'Invalid verification request.' }, 400);
  }

  // Allowlist is authoritative at verification time too.
  if (purpose === 'chef' && !isChefNumber(c.env, phone)) {
    return c.json({ error: 'Chef access is not available for this number.' }, 403);
  }

  const now = Date.now();
  const challenge = await c.env.DB.prepare(
    `SELECT id, provider, code_hash, attempts, consumed, expires_at
     FROM otp_challenges
     WHERE phone_e164 = ?1 AND purpose = ?2 AND consumed = 0
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(phone, purpose)
    .first<ChallengeRow>();

  if (!challenge || challenge.expires_at <= now) {
    return c.json({ error: 'OTP expired or not found. Request a new one.' }, 400);
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    return c.json({ error: 'Too many incorrect attempts. Request a new OTP.' }, 429);
  }

  // Count the attempt before verifying so failures can't be replayed forever.
  await c.env.DB.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?1')
    .bind(challenge.id)
    .run();

  let verified = false;
  if (challenge.provider === 'twilio') {
    verified = await twilioCheckOtp(c.env, phone, code);
  } else if (challenge.code_hash) {
    verified = await demoCheckCode(c.env, challenge.code_hash, code);
  }
  if (!verified) {
    const left = OTP_MAX_ATTEMPTS - (challenge.attempts + 1);
    return c.json(
      { error: left > 0 ? 'Incorrect OTP. Please check and try again.' : 'Too many incorrect attempts. Request a new OTP.' },
      left > 0 ? 400 : 429
    );
  }

  // Single-use: consume the challenge.
  await c.env.DB.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?1')
    .bind(challenge.id)
    .run();

  // Session role comes from the verified purpose; a consumer OTP never grants
  // chef access even for an allowlisted number.
  const role = purpose === 'chef' ? 'chef' : 'consumer';
  const userRole = isChefNumber(c.env, phone) ? 'chef' : 'consumer';
  await c.env.DB.prepare(
    `INSERT INTO users (phone_e164, role, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (phone_e164) DO UPDATE SET role = ?2`
  )
    .bind(phone, userRole, now)
    .run();
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE phone_e164 = ?1')
    .bind(phone)
    .first<{ id: number }>();
  if (!user) return c.json({ error: 'Could not create the account.' }, 500);

  const { token, expiresAt } = await createSession(c.env, user.id, phone, role);
  setSessionCookie(c, token, expiresAt);
  return c.json({ ok: true, role, phoneMasked: maskPhone(phone) });
});

authRoutes.get('/me', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ authenticated: false });
  return c.json({ authenticated: true, role: auth.role, phoneMasked: maskPhone(auth.phone) });
});

authRoutes.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});
