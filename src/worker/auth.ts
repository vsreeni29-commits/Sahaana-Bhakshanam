import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from './env';
import { sha256Hex, randomToken } from './util/crypto';
import { normalizeIndianPhone } from './util/phone';

export const SESSION_COOKIE = 'sb_session';
export const CONSUMER_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CHEF_SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type Role = 'consumer' | 'chef';

export interface AuthContext {
  userId: number;
  phone: string;
  role: Role;
  sessionId: number;
}

export type AppContext = Context<{ Bindings: Env; Variables: { auth?: AuthContext } }>;

/**
 * Chef/admin allowlist, parsed fresh from hosted secrets on every call so that
 * removing a number takes effect immediately (including for restored sessions).
 */
export function chefAllowlist(env: Env): Set<string> {
  const raw = [env.CHEF_PHONE_E164_LIST ?? '', env.CHEF_PHONE_E164 ?? ''].join(',');
  const list = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const normalized = normalizeIndianPhone(part);
    if (normalized) list.add(normalized);
  }
  return list;
}

export function isChefNumber(env: Env, phoneE164: string): boolean {
  return chefAllowlist(env).has(phoneE164);
}

interface SessionRow {
  id: number;
  user_id: number;
  phone_e164: string;
  role: Role;
  expires_at: number;
}

export async function createSession(
  env: Env,
  userId: number,
  phone: string,
  role: Role
): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const expiresAt = now + (role === 'chef' ? CHEF_SESSION_MS : CONSUMER_SESSION_MS);
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, phone_e164, role, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  )
    .bind(tokenHash, userId, phone, role, expiresAt, now)
    .run();
  return { token, expiresAt };
}

export function setSessionCookie(c: AppContext, token: string, expiresAt: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(c: AppContext): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

async function loadSession(c: AppContext): Promise<{ row: SessionRow; tokenHash: string } | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    'SELECT id, user_id, phone_e164, role, expires_at FROM sessions WHERE token_hash = ?1'
  )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(row.id).run();
    return null;
  }
  return { row, tokenHash };
}

/**
 * Resolve the session (if any) into c.var.auth. Chef sessions are re-validated
 * against the live allowlist on every request; a number removed from the
 * allowlist has its chef session revoked here, immediately.
 */
export async function resolveAuth(c: AppContext): Promise<AuthContext | null> {
  const loaded = await loadSession(c);
  if (!loaded) return null;
  const { row } = loaded;
  if (row.role === 'chef' && !isChefNumber(c.env, row.phone_e164)) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(row.id).run();
    clearSessionCookie(c);
    return null;
  }
  return { userId: row.user_id, phone: row.phone_e164, role: row.role, sessionId: row.id };
}

export async function authMiddleware(c: AppContext, next: Next): Promise<void> {
  const auth = await resolveAuth(c);
  if (auth) c.set('auth', auth);
  await next();
}

export function requireAuth(c: AppContext): AuthContext | Response {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'Sign in required.' }, 401);
  return auth;
}

/** Server-side chef guard used by every /api/admin route. */
export function requireChef(c: AppContext): AuthContext | Response {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'Sign in required.' }, 401);
  // resolveAuth already revoked stale chef sessions; this is the role gate.
  if (auth.role !== 'chef' || !isChefNumber(c.env, auth.phone)) {
    return c.json({ error: 'Chef access is not available for this account.' }, 403);
  }
  return auth;
}

export async function destroySession(c: AppContext): Promise<void> {
  const auth = c.get('auth');
  if (auth) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?1').bind(auth.sessionId).run();
  }
  clearSessionCookie(c);
}
