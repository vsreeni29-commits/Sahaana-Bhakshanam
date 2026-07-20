import type { Env } from './env';
import { hmacSha256Hex } from './util/crypto';

export interface RelayOrderPayload {
  orderId: string;
  customerName: string;
  phone: string;
  address: string;
  landmark: string;
  meal: string;
  mealDate: string;
  items: { name: string; qty: number; unitPriceInr: number }[];
  totalInr: number;
  payMethod: 'cash' | 'upi';
  createdAt: number;
}

export function relayConfigured(env: Env): boolean {
  return Boolean(env.ORDER_RELAY_URL && env.ORDER_RELAY_SECRET);
}

async function recordEvent(
  env: Env,
  orderId: string,
  channel: 'dashboard' | 'relay',
  state: 'sent' | 'needs_setup' | 'failed',
  detail: string,
  idempotencyKey = ''
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notification_events (order_id, channel, state, detail, idempotency_key, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  )
    .bind(orderId, channel, state, detail, idempotencyKey, Date.now())
    .run();
}

async function setOrderNotifyStatus(
  env: Env,
  orderId: string,
  status: 'sent' | 'needs_setup' | 'failed'
): Promise<void> {
  await env.DB.prepare('UPDATE orders SET notify_status = ?1 WHERE id = ?2')
    .bind(status, orderId)
    .run();
}

/**
 * Notify the chef about a persisted order. The order is already committed —
 * nothing here may fail it. The dashboard (authenticated polling) is the
 * guaranteed channel; the relay (WhatsApp Business / direct-message bridge)
 * is best-effort, HMAC-signed, and idempotent on the order ID.
 */
export async function notifyChef(env: Env, payload: RelayOrderPayload): Promise<void> {
  const { orderId } = payload;
  try {
    // Dashboard visibility is immediate via /api/admin/orders; record it.
    await recordEvent(env, orderId, 'dashboard', 'sent', 'visible in chef dashboard');

    if (!relayConfigured(env)) {
      await setOrderNotifyStatus(env, orderId, 'needs_setup');
      await recordEvent(env, orderId, 'relay', 'needs_setup', 'ORDER_RELAY_URL not configured');
      return;
    }

    // Idempotency: never send the relay message twice for one order.
    const already = await env.DB.prepare(
      `SELECT id FROM notification_events WHERE order_id = ?1 AND channel = 'relay' AND state = 'sent' LIMIT 1`
    )
      .bind(orderId)
      .first();
    if (already) return;

    const body = JSON.stringify(payload);
    const signature = await hmacSha256Hex(env.ORDER_RELAY_SECRET as string, body);
    const res = await fetch(env.ORDER_RELAY_URL as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SB-Signature': `sha256=${signature}`,
        'X-SB-Idempotency-Key': orderId,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      await setOrderNotifyStatus(env, orderId, 'sent');
      await recordEvent(env, orderId, 'relay', 'sent', `relay accepted (${res.status})`, orderId);
    } else {
      await setOrderNotifyStatus(env, orderId, 'failed');
      await recordEvent(env, orderId, 'relay', 'failed', `relay rejected (${res.status})`, orderId);
    }
  } catch {
    // Relay failure never rolls back the order; the dashboard remains the fallback.
    try {
      await setOrderNotifyStatus(env, orderId, 'failed');
      await recordEvent(env, orderId, 'relay', 'failed', 'relay unreachable', orderId);
    } catch {
      // Swallow: notification bookkeeping must never break order flow.
    }
  }
}
