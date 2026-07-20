# Architecture

One Cloudflare Worker serves everything: `/api/*` runs the Hono application (`src/worker/`), every other path is served from the static assets build (`dist/client`, Vite + React) with an SPA fallback. `wrangler.toml` sets `run_worker_first = ["/api/*"]` so API routes always reach the Worker.

```
Browser / Android WebView
        │ HTTPS
        ▼
Cloudflare Worker (ESM, fetch handler)
 ├── /api/auth/*    OTP + sessions (Twilio Verify | fail-closed)
 ├── /api/store     public menu, profile, schedule, server time
 ├── /api/orders    authenticated order confirmation (transactional)
 ├── /api/admin/*   chef-guarded menu/slots/orders/profile
 └── assets binding SPA (storefront "/", dashboard "/admin")
        │
        ▼
Cloudflare D1 (SQLite) — migrations/ ; prepared statements only
        │ post-commit, HMAC-signed, idempotent
        ▼
WhatsApp Business / direct-message relay (optional, X-SB-Signature)
```

## Time model

All scheduling is IST (UTC+05:30, no DST) computed in `shared/meals.ts`, which is the single source of truth for both the client countdowns and the server checks. The client only *displays* windows (with a server-anchored clock offset); `POST /api/orders` recomputes `isOrderingOpen(meal, Date.now())` on the server and returns `409` at or after the exact cutoff instant.

## Data model (D1)

- `users` — normalized `+91…` phone identity, role.
- `otp_challenges` — purpose (`consumer`/`chef`), provider (`twilio`/`demo`), keyed hash for the local demo code only, attempts (locks at 5), expiry (5 min), single-use `consumed` flag; creation timestamps double as the rate-limit history (3 per 10 min).
- `sessions` — SHA-256 token hash, phone, role, expiry. Raw tokens exist only in the HttpOnly cookie.
- `chef_profiles` — single row (`id = 1`); public fields vs delivery-time contact/payment fields (WhatsApp, UPI) which never appear in `/api/store`.
- `meal_slots` — the four fixed sessions; only `available` is mutable.
- `menu_items` — `is_veg INTEGER CHECK (is_veg = 1)`: the vegetarian invariant lives in the schema. `portions CHECK (portions >= 0)` backstops stock.
- `orders` (+ `order_items` snapshot) — `SB-YYMMDD-XXXX` IDs, authoritative `total_inr`, `pay_method` (`cash`/`upi` at the door only), lifecycle status, `notify_status`.
- `notification_events` — audit trail per channel (`dashboard`, `relay`) with idempotency keys.

## Order confirmation (why it is safe)

1. Validate input bounds, session auth, meal window (server clock), slot availability.
2. Re-read every item: vegetarian, available, right meal, enough portions, current price. Total is computed here — client totals are ignored.
3. **Phase 1**: one D1 batch (transaction) of conditional decrements `SET portions = portions - ? WHERE … AND portions >= ?`. If any statement matched no row (a concurrent order won), the successful siblings are compensated and the request gets `409`.
4. **Phase 2**: one D1 batch inserting the order plus its immutable line-item snapshot.
5. Post-commit (`waitUntil`): notification bookkeeping and the optional signed relay call. Failures mark `notify_status` (`sent`/`needs_setup`/`failed`) but can never roll back the order.

## AuthN/AuthZ

- OTP request/verify is purpose-scoped. Chef purpose is refused up-front (and at verify) for numbers outside `CHEF_PHONE_E164_LIST`; consumers get consumer sessions even if their number is allowlisted.
- `resolveAuth` re-parses the allowlist from environment secrets on **every** request; a chef session whose number was removed is deleted server-side on its next appearance (session restore or admin call).
- Every `/api/admin/*` route passes the same `requireChef` guard middleware. UI hiding is not authorization.

## Android

Hardened WebView shell (`android/`): HTTPS-only (`network_security_config` + mixed-content never), no file/content access, first-party cookies only, external hosts leave the app via Intents, offline retry view, back-navigation, progress bar. `WEB_APP_URL` is injected via BuildConfig from a Gradle property/environment variable — no hardcoded hosts. Note: the published applicationId is `in.sahanabhakshanam.app`, while the code namespace is `app.sahanabhakshanam.android` because `in` is a Java keyword and cannot appear in a source package.

## Operational notes

- Fail-closed everywhere: missing OTP provider → 503; missing chef allowlist → nobody has chef access; missing relay → `needs_setup`, dashboard still shows orders.
- No OTPs, tokens, full phone numbers or addresses are logged; phones are masked (`+91••••••135`) in all client-visible auth responses.
- Monitoring hooks: `notification_events`, `otp_challenges` counters and order `status`/`notify_status` fields are all queryable in D1 for alerting on OTP failure spikes, cutoff rejections, relay failures and orders stuck in `new`.
