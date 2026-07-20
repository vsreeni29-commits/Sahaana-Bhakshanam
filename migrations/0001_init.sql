-- Sahaana Bhakshanam — initial schema.
-- One home kitchen, one business. Pure-vegetarian is a database invariant
-- (menu_items.is_veg CHECK), not a client concern.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_e164 TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'consumer' CHECK (role IN ('consumer', 'chef')),
  created_at INTEGER NOT NULL
);

CREATE TABLE otp_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_e164 TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('consumer', 'chef')),
  provider TEXT NOT NULL CHECK (provider IN ('twilio', 'demo')),
  -- HMAC-SHA256 of the code (demo/local provider only). Twilio codes never
  -- touch our storage. Plaintext OTPs are never stored anywhere.
  code_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_otp_phone_purpose ON otp_challenges (phone_e164, purpose, created_at);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- SHA-256 hash of the random bearer token; the raw token lives only in the
  -- HttpOnly cookie.
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users (id),
  phone_e164 TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('consumer', 'chef')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

-- Single-row table: one kitchen, one business.
CREATE TABLE chef_profiles (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  kitchen_name TEXT NOT NULL,
  chef_display_name TEXT NOT NULL,
  locality TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  -- Delivery-time contact/payment details: exposed only on authenticated chef
  -- surfaces, never in the public store payload.
  whatsapp_number TEXT NOT NULL DEFAULT '',
  upi_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

-- Fixed sessions; only `available` is mutable from the dashboard.
CREATE TABLE meal_slots (
  id TEXT PRIMARY KEY CHECK (id IN ('breakfast', 'lunch', 'snacks', 'dinner')),
  label TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL
);

CREATE TABLE menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  meal_id TEXT NOT NULL REFERENCES meal_slots (id),
  price_inr INTEGER NOT NULL CHECK (price_inr >= 0),
  portions INTEGER NOT NULL DEFAULT 0 CHECK (portions >= 0),
  available INTEGER NOT NULL DEFAULT 1,
  -- Pure-vegetarian invariant: rows can only ever be vegetarian.
  is_veg INTEGER NOT NULL DEFAULT 1 CHECK (is_veg = 1),
  image_key TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_menu_meal ON menu_items (meal_id, available);

CREATE TABLE orders (
  id TEXT PRIMARY KEY, -- business-prefixed: SB-YYMMDD-XXXX
  user_id INTEGER NOT NULL REFERENCES users (id),
  customer_name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  address TEXT NOT NULL,
  landmark TEXT NOT NULL DEFAULT '',
  meal_id TEXT NOT NULL REFERENCES meal_slots (id),
  meal_date TEXT NOT NULL, -- IST delivery date yyyy-mm-dd
  total_inr INTEGER NOT NULL CHECK (total_inr >= 0),
  pay_method TEXT NOT NULL CHECK (pay_method IN ('cash', 'upi')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'accepted', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')
  ),
  notify_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    notify_status IN ('pending', 'sent', 'needs_setup', 'failed')
  ),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_orders_created ON orders (created_at);
CREATE INDEX idx_orders_status ON orders (status, created_at);

-- Immutable snapshot of what was ordered at what price.
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders (id),
  menu_item_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_inr INTEGER NOT NULL CHECK (unit_price_inr >= 0)
);
CREATE INDEX idx_order_items_order ON order_items (order_id);

-- Audit trail for dashboard visibility and the WhatsApp/direct-message relay.
CREATE TABLE notification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('dashboard', 'relay')),
  state TEXT NOT NULL CHECK (state IN ('sent', 'needs_setup', 'failed')),
  detail TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notify_order ON notification_events (order_id, channel);
