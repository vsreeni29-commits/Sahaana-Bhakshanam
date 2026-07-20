import { Hono } from 'hono';
import type { Env } from '../env';
import type { AuthContext } from '../auth';
import { requireAuth } from '../auth';
import { deliveryWindowLabel, isOrderingOpen, mealDef } from '../../../shared/meals';
import { notifyChef, type RelayOrderPayload } from '../notify';

const MAX_LINE_ITEMS = 20;
const MAX_QTY_PER_ITEM = 10;

interface MenuRow {
  id: number;
  name: string;
  meal_id: string;
  price_inr: number;
  portions: number;
  available: number;
  is_veg: number;
}

function orderId(now: number): string {
  const d = new Date(now + 330 * 60 * 1000);
  const yymmdd =
    String(d.getUTCFullYear()).slice(2) +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0');
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const rand = new Uint8Array(4);
  crypto.getRandomValues(rand);
  let suffix = '';
  for (const b of rand) suffix += alphabet[b % alphabet.length];
  return `SB-${yymmdd}-${suffix}`;
}

function cleanText(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length >= min && t.length <= max ? t : null;
}

export const orderRoutes = new Hono<{ Bindings: Env; Variables: { auth?: AuthContext } }>();

orderRoutes.post('/', async (c) => {
  const auth = requireAuth(c);
  if (auth instanceof Response) return auth;

  let body: {
    mealId?: unknown;
    items?: unknown;
    customerName?: unknown;
    address?: unknown;
    landmark?: unknown;
    payMethod?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request.' }, 400);
  }

  const mealId = typeof body.mealId === 'string' ? body.mealId : '';
  if (!mealDef(mealId)) return c.json({ error: 'Unknown meal session.' }, 400);
  const customerName = cleanText(body.customerName, 2, 80);
  const address = cleanText(body.address, 10, 500);
  const landmark = cleanText(body.landmark ?? '', 0, 120) ?? '';
  const payMethod = body.payMethod === 'cash' || body.payMethod === 'upi' ? body.payMethod : null;
  if (!customerName) return c.json({ error: 'Please enter your name.' }, 400);
  if (!address) return c.json({ error: 'Please enter a complete delivery address.' }, 400);
  if (!payMethod) return c.json({ error: 'Choose how you will pay at delivery.' }, 400);

  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_LINE_ITEMS) {
    return c.json({ error: 'Your bag is empty or invalid.' }, 400);
  }
  const wanted = new Map<number, number>();
  for (const raw of body.items) {
    const item = raw as { menuItemId?: unknown; qty?: unknown };
    const id = Number(item.menuItemId);
    const qty = Number(item.qty);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM) {
      return c.json({ error: 'Your bag contains an invalid item.' }, 400);
    }
    wanted.set(id, (wanted.get(id) ?? 0) + qty);
  }

  // The server clock is authoritative. A request that crosses the cutoff
  // boundary fails here with 409 no matter what the browser showed.
  const now = Date.now();
  const window = isOrderingOpen(mealId, now);
  if (!window) {
    return c.json({ error: 'Ordering for this meal session is closed.', code: 'SESSION_CLOSED' }, 409);
  }

  const slot = await c.env.DB.prepare('SELECT available FROM meal_slots WHERE id = ?1')
    .bind(mealId)
    .first<{ available: number }>();
  if (!slot || slot.available !== 1) {
    return c.json({ error: 'This meal session is unavailable today.', code: 'SESSION_UNAVAILABLE' }, 409);
  }

  // Reread authoritative price / meal / stock / vegetarian state.
  const ids = [...wanted.keys()];
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
  const rows = await c.env.DB.prepare(
    `SELECT id, name, meal_id, price_inr, portions, available, is_veg
     FROM menu_items WHERE id IN (${placeholders})`
  )
    .bind(...ids)
    .all<MenuRow>();
  const byId = new Map((rows.results ?? []).map((r) => [r.id, r]));

  for (const [id, qty] of wanted) {
    const row = byId.get(id);
    if (!row || row.is_veg !== 1) {
      return c.json({ error: 'An item in your bag is no longer on the menu.', code: 'STALE_CART' }, 409);
    }
    if (row.meal_id !== mealId) {
      return c.json({ error: `“${row.name}” belongs to a different meal session.`, code: 'STALE_CART' }, 409);
    }
    if (row.available !== 1) {
      return c.json({ error: `“${row.name}” is not available right now.`, code: 'UNAVAILABLE' }, 409);
    }
    if (row.portions < qty) {
      return c.json(
        { error: `Only ${row.portions} portion(s) of “${row.name}” left.`, code: 'SOLD_OUT' },
        409
      );
    }
  }

  // The authoritative total is computed here, from database prices only.
  let totalInr = 0;
  for (const [id, qty] of wanted) totalInr += (byId.get(id) as MenuRow).price_inr * qty;

  // Phase 1 — conditional stock decrements (one D1 transaction). A decrement
  // that matches no row means a concurrent order beat us: roll the batch's
  // successful siblings back and reject.
  const decrements = [...wanted.entries()].map(([id, qty]) =>
    c.env.DB.prepare(
      `UPDATE menu_items SET portions = portions - ?1
       WHERE id = ?2 AND available = 1 AND is_veg = 1 AND meal_id = ?3 AND portions >= ?1`
    ).bind(qty, id, mealId)
  );
  const decResults = await c.env.DB.batch(decrements);
  const failedIdx = decResults.findIndex((r) => (r.meta?.changes ?? 0) !== 1);
  if (failedIdx >= 0) {
    const entries = [...wanted.entries()];
    const compensations = entries
      .filter((_, i) => i < decResults.length && (decResults[i]?.meta?.changes ?? 0) === 1)
      .map(([id, qty]) =>
        c.env.DB.prepare('UPDATE menu_items SET portions = portions + ?1 WHERE id = ?2').bind(qty, id)
      );
    if (compensations.length > 0) await c.env.DB.batch(compensations);
    return c.json({ error: 'Some portions just sold out. Please review your bag.', code: 'SOLD_OUT' }, 409);
  }

  // Phase 2 — persist the order and its immutable line-item snapshot in one
  // transaction. The database is the source of truth for notifications.
  const id = orderId(now);
  const insertOrder = c.env.DB.prepare(
    `INSERT INTO orders (id, user_id, customer_name, phone_e164, address, landmark, meal_id, meal_date,
                         total_inr, pay_method, status, notify_status, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'new', 'pending', ?11)`
  ).bind(
    id,
    auth.userId,
    customerName,
    auth.phone,
    address,
    landmark,
    mealId,
    window.date,
    totalInr,
    payMethod,
    now
  );
  const insertItems = [...wanted.entries()].map(([itemId, qty]) => {
    const row = byId.get(itemId) as MenuRow;
    return c.env.DB.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name, qty, unit_price_inr)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ).bind(id, itemId, row.name, qty, row.price_inr);
  });
  try {
    await c.env.DB.batch([insertOrder, ...insertItems]);
  } catch {
    // Extremely unlikely (e.g. order-id collision): restore stock and report.
    const compensations = [...wanted.entries()].map(([itemId, qty]) =>
      c.env.DB.prepare('UPDATE menu_items SET portions = portions + ?1 WHERE id = ?2').bind(qty, itemId)
    );
    await c.env.DB.batch(compensations);
    return c.json({ error: 'Could not place the order. Please try again.' }, 500);
  }

  // Notify after commit; failure here never affects the stored order.
  const payload: RelayOrderPayload = {
    orderId: id,
    customerName,
    phone: auth.phone,
    address,
    landmark,
    meal: window.label,
    mealDate: window.date,
    items: [...wanted.entries()].map(([itemId, qty]) => {
      const row = byId.get(itemId) as MenuRow;
      return { name: row.name, qty, unitPriceInr: row.price_inr };
    }),
    totalInr,
    payMethod,
    createdAt: now,
  };
  c.executionCtx.waitUntil(notifyChef(c.env, payload));

  return c.json(
    {
      orderId: id,
      totalInr,
      mealId,
      mealDate: window.date,
      deliveryWindow: deliveryWindowLabel(window),
      payMethod,
      paymentNote:
        'No payment has been collected online. Please pay ' +
        (payMethod === 'upi' ? 'via UPI directly to the chef' : 'in cash') +
        ' when your food is delivered.',
    },
    201
  );
});
