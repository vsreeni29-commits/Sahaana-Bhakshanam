import { Hono } from 'hono';
import type { Env } from '../env';
import type { AuthContext } from '../auth';
import { requireChef } from '../auth';
import { mealDef } from '../../../shared/meals';
import { normalizeIndianPhone } from '../util/phone';

const ORDER_STATUSES = ['new', 'accepted', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

const MAX_PRICE_INR = 10_000;
const MAX_PORTIONS = 500;

function cleanText(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length >= min && t.length <= max ? t : null;
}

export const adminRoutes = new Hono<{ Bindings: Env; Variables: { auth?: AuthContext } }>();

// Every admin route passes the same server-side chef guard. Hiding UI
// controls is not authorization; this is.
adminRoutes.use('*', async (c, next) => {
  const guard = requireChef(c);
  if (guard instanceof Response) return guard;
  await next();
});

adminRoutes.get('/menu', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, description, meal_id, price_inr, portions, available, image_key
     FROM menu_items WHERE is_veg = 1 ORDER BY meal_id, name`
  ).all<{
    id: number;
    name: string;
    description: string;
    meal_id: string;
    price_inr: number;
    portions: number;
    available: number;
    image_key: string;
  }>();
  return c.json({
    menu: (rows.results ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      mealId: m.meal_id,
      priceInr: m.price_inr,
      portions: m.portions,
      available: m.available === 1,
      imageKey: m.image_key,
    })),
  });
});

adminRoutes.post('/menu', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request.' }, 400);
  }
  const name = cleanText(body.name, 2, 80);
  const description = cleanText(body.description ?? '', 0, 300) ?? '';
  const mealId = typeof body.mealId === 'string' && mealDef(body.mealId) ? body.mealId : null;
  const priceInr = Number(body.priceInr);
  const portions = Number(body.portions);
  if (!name || !mealId) return c.json({ error: 'Dish name and meal session are required.' }, 400);
  if (!Number.isInteger(priceInr) || priceInr < 0 || priceInr > MAX_PRICE_INR) {
    return c.json({ error: 'Enter a valid price in rupees.' }, 400);
  }
  if (!Number.isInteger(portions) || portions < 0 || portions > MAX_PORTIONS) {
    return c.json({ error: 'Enter a valid portion count.' }, 400);
  }
  // Vegetarian status is automatic and non-negotiable: is_veg is always 1
  // (also enforced by a database CHECK constraint).
  const res = await c.env.DB.prepare(
    `INSERT INTO menu_items (name, description, meal_id, price_inr, portions, available, is_veg, image_key, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, 1, '', ?6)`
  )
    .bind(name, description, mealId, priceInr, portions, Date.now())
    .run();
  return c.json({ ok: true, id: res.meta.last_row_id }, 201);
});

adminRoutes.patch('/menu', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request.' }, 400);
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Unknown dish.' }, 400);

  const sets: string[] = [];
  const binds: (string | number)[] = [];
  let n = 0;
  if (body.available !== undefined) {
    if (typeof body.available !== 'boolean') return c.json({ error: 'Invalid availability.' }, 400);
    sets.push(`available = ?${++n}`);
    binds.push(body.available ? 1 : 0);
  }
  if (body.portions !== undefined) {
    const portions = Number(body.portions);
    if (!Number.isInteger(portions) || portions < 0 || portions > MAX_PORTIONS) {
      return c.json({ error: 'Enter a valid portion count.' }, 400);
    }
    sets.push(`portions = ?${++n}`);
    binds.push(portions);
  }
  if (body.priceInr !== undefined) {
    const priceInr = Number(body.priceInr);
    if (!Number.isInteger(priceInr) || priceInr < 0 || priceInr > MAX_PRICE_INR) {
      return c.json({ error: 'Enter a valid price in rupees.' }, 400);
    }
    sets.push(`price_inr = ?${++n}`);
    binds.push(priceInr);
  }
  if (body.name !== undefined) {
    const name = cleanText(body.name, 2, 80);
    if (!name) return c.json({ error: 'Enter a valid dish name.' }, 400);
    sets.push(`name = ?${++n}`);
    binds.push(name);
  }
  if (body.description !== undefined) {
    const description = cleanText(body.description, 0, 300);
    if (description === null) return c.json({ error: 'Description is too long.' }, 400);
    sets.push(`description = ?${++n}`);
    binds.push(description);
  }
  // is_veg is intentionally not updatable — there is no non-veg option.
  if (sets.length === 0) return c.json({ error: 'Nothing to update.' }, 400);

  const res = await c.env.DB.prepare(
    `UPDATE menu_items SET ${sets.join(', ')} WHERE id = ?${n + 1} AND is_veg = 1`
  )
    .bind(...binds, id)
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'Dish not found.' }, 404);
  return c.json({ ok: true });
});

adminRoutes.patch('/slots', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request.' }, 400);
  }
  const mealId = typeof body.mealId === 'string' && mealDef(body.mealId) ? body.mealId : null;
  if (!mealId || typeof body.available !== 'boolean') {
    return c.json({ error: 'Invalid session update.' }, 400);
  }
  // Only availability is mutable — opening time, cutoff and delivery window
  // are fixed in code and cannot be edited from the dashboard.
  await c.env.DB.prepare('UPDATE meal_slots SET available = ?1 WHERE id = ?2')
    .bind(body.available ? 1 : 0, mealId)
    .run();
  return c.json({ ok: true });
});

adminRoutes.get('/orders', async (c) => {
  const sinceParam = Number(c.req.query('since') ?? 0);
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : 0;
  const orders = await c.env.DB.prepare(
    `SELECT id, customer_name, phone_e164, address, landmark, meal_id, meal_date, total_inr,
            pay_method, status, notify_status, created_at
     FROM orders WHERE created_at > ?1 ORDER BY created_at DESC LIMIT 200`
  )
    .bind(since)
    .all<{
      id: string;
      customer_name: string;
      phone_e164: string;
      address: string;
      landmark: string;
      meal_id: string;
      meal_date: string;
      total_inr: number;
      pay_method: string;
      status: string;
      notify_status: string;
      created_at: number;
    }>();
  const orderRows = orders.results ?? [];
  const itemsByOrder = new Map<string, { name: string; qty: number; unitPriceInr: number }[]>();
  if (orderRows.length > 0) {
    const placeholders = orderRows.map((_, i) => `?${i + 1}`).join(', ');
    const items = await c.env.DB.prepare(
      `SELECT order_id, name, qty, unit_price_inr FROM order_items WHERE order_id IN (${placeholders})`
    )
      .bind(...orderRows.map((o) => o.id))
      .all<{ order_id: string; name: string; qty: number; unit_price_inr: number }>();
    for (const it of items.results ?? []) {
      const list = itemsByOrder.get(it.order_id) ?? [];
      list.push({ name: it.name, qty: it.qty, unitPriceInr: it.unit_price_inr });
      itemsByOrder.set(it.order_id, list);
    }
  }
  return c.json({
    serverNow: Date.now(),
    orders: orderRows.map((o) => ({
      id: o.id,
      customerName: o.customer_name,
      phone: o.phone_e164,
      address: o.address,
      landmark: o.landmark,
      mealId: o.meal_id,
      mealDate: o.meal_date,
      totalInr: o.total_inr,
      payMethod: o.pay_method,
      status: o.status,
      notifyStatus: o.notify_status,
      createdAt: o.created_at,
      items: itemsByOrder.get(o.id) ?? [],
    })),
  });
});

adminRoutes.patch('/orders', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request.' }, 400);
  }
  const id = typeof body.id === 'string' && /^SB-[A-Z0-9-]{4,20}$/.test(body.id) ? body.id : null;
  const status = ORDER_STATUSES.includes(body.status as OrderStatus)
    ? (body.status as OrderStatus)
    : null;
  if (!id || !status) return c.json({ error: 'Invalid order update.' }, 400);
  const res = await c.env.DB.prepare('UPDATE orders SET status = ?1 WHERE id = ?2')
    .bind(status, id)
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'Order not found.' }, 404);
  return c.json({ ok: true });
});

adminRoutes.get('/profile', async (c) => {
  const p = await c.env.DB.prepare(
    `SELECT kitchen_name, chef_display_name, locality, bio, whatsapp_number, upi_id
     FROM chef_profiles WHERE id = 1`
  ).first<{
    kitchen_name: string;
    chef_display_name: string;
    locality: string;
    bio: string;
    whatsapp_number: string;
    upi_id: string;
  }>();
  return c.json({
    profile: {
      kitchenName: p?.kitchen_name ?? '',
      chefDisplayName: p?.chef_display_name ?? '',
      locality: p?.locality ?? '',
      bio: p?.bio ?? '',
      whatsappNumber: p?.whatsapp_number ?? '',
      upiId: p?.upi_id ?? '',
    },
  });
});

adminRoutes.put('/profile', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request.' }, 400);
  }
  const kitchenName = cleanText(body.kitchenName, 2, 80);
  const chefDisplayName = cleanText(body.chefDisplayName, 1, 80);
  const locality = cleanText(body.locality, 2, 120);
  const bio = cleanText(body.bio ?? '', 0, 600) ?? '';
  if (!kitchenName || !chefDisplayName || !locality) {
    return c.json({ error: 'Kitchen name, chef name and locality are required.' }, 400);
  }
  let whatsappNumber = '';
  if (typeof body.whatsappNumber === 'string' && body.whatsappNumber.trim() !== '') {
    const normalized = normalizeIndianPhone(body.whatsappNumber);
    if (!normalized) return c.json({ error: 'Enter a valid WhatsApp number.' }, 400);
    whatsappNumber = normalized;
  }
  let upiId = '';
  if (typeof body.upiId === 'string' && body.upiId.trim() !== '') {
    const t = body.upiId.trim();
    if (!/^[\w.-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,31}$/.test(t)) {
      return c.json({ error: 'Enter a valid UPI ID.' }, 400);
    }
    upiId = t;
  }
  await c.env.DB.prepare(
    `UPDATE chef_profiles
     SET kitchen_name = ?1, chef_display_name = ?2, locality = ?3, bio = ?4,
         whatsapp_number = ?5, upi_id = ?6, updated_at = ?7
     WHERE id = 1`
  )
    .bind(kitchenName, chefDisplayName, locality, bio, whatsappNumber, upiId, Date.now())
    .run();
  return c.json({ ok: true });
});
