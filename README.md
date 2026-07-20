# Sahaana Bhakshanam

Pure-vegetarian, home-cooked **Tamil Brahmin Iyer food** from **one home kitchen, one business** — not a marketplace. Customers order per meal session and **pay only at delivery** (cash or UPI directly to the chef). No money ever moves through this application.

This monorepo contains everything: the customer storefront, the chef dashboard, the API, the database schema, the Android app, CI/CD and documentation.

| Piece | Where |
| --- | --- |
| Customer storefront (React, mobile-first) | `web/` → served at `/` |
| Chef/admin dashboard | `web/` → served at `/admin` |
| API (Cloudflare Worker, Hono) | `src/worker/` |
| Shared meal-session logic (IST, fixed) | `shared/` |
| D1 database migrations | `migrations/` |
| Android WebView app (`in.sahanabhakshanam.app`) | `android/` |
| CI, deploy and APK workflows | `.github/workflows/` |
| Architecture & deployment docs | `docs/` |

## Fixed meal sessions (Asia/Kolkata — cannot be edited)

| Meal | Ordering opens | Hard cutoff | Delivery window |
| --- | --- | --- | --- |
| Breakfast | Previous day, 6:00 PM | 7:00 AM | 7:30–9:30 AM |
| Lunch | 8:00 AM | 11:00 AM | 12:30–2:00 PM |
| Evening Snacks | 12:00 PM | 4:00 PM | 4:30–6:00 PM |
| Dinner | 3:00 PM | 7:30 PM | 7:30–9:30 PM |

The server recomputes the window on every order confirmation; the browser clock never decides eligibility. The chef can mark a session unavailable but can never change its times.

## Security model (short version)

- **OTP sign-in** via Twilio Verify (production). Fail-closed: if no SMS provider is configured, sign-in returns *“SMS OTP is not configured”* — it never silently authenticates. Rate limits: 3 requests / 10 min per number+purpose, 5-minute expiry, locked after 5 wrong attempts, single-use.
- **Chef allowlist** lives only in hosted secrets (`CHEF_PHONE_E164_LIST`). It is re-checked on every session restore and every admin API call, so removing a number revokes its chef access immediately. A consumer OTP never grants chef access.
- **Sessions**: 256-bit random token, only its SHA-256 hash stored, delivered as an `HttpOnly; Secure; SameSite=Strict` cookie.
- **Pure vegetarian is a database invariant** (`menu_items.is_veg CHECK`), enforced again at checkout and in every public menu query. The dashboard has no non-veg option.
- **Totals, prices, stock** are recomputed server-side inside a transaction; stale carts, closed sessions, sold-out and cross-session items are rejected with `409`.
- **Chef notification**: order is persisted first; the dashboard (5-second authenticated polling) is the guaranteed channel. The optional WhatsApp-Business/direct-message relay receives an HMAC-SHA256-signed (`X-SB-Signature`), idempotent (order-ID key) server-to-server payload. Relay failure never loses an order.
- Phone numbers are masked everywhere outside authenticated chef surfaces; OTPs, tokens and addresses are never logged.

## Local development

```bash
npm ci
cp .dev.vars.example .dev.vars    # fill in local test values (never commit)
npm run db:migrate:local          # apply D1 migrations locally
npm run dev                       # build web + wrangler dev on :8787
```

Local OTP uses demo mode (`OTP_DEMO_MODE=true` + private `OTP_DEMO_CODE` in `.dev.vars` only). **Production keeps `OTP_DEMO_MODE=false`** and no fixed code exists in any build.

Checks: `npm run lint` · `npm run typecheck` · `npm test` · `npm run build`

## Deployment (Cloudflare Workers + D1)

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full runbook: creating the D1 database, setting `database_id` in `wrangler.toml`, configuring secrets (chef allowlist, OTP hash secret, Twilio Verify, order relay), GitHub secrets for the deploy workflow, custom-domain migration and the Android release keystore.

Required hosted secrets: `CHEF_PHONE_E164_LIST`, `OTP_HASH_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, and optionally `ORDER_RELAY_URL` + `ORDER_RELAY_SECRET`.

## Android app

`android/` is a hardened WebView shell (`in.sahanabhakshanam.app`): HTTPS-only, no cleartext/mixed content/file access, first-party cookies only, external links open in the browser, offline retry screen, branded icon and splash. The web host comes from the `WEB_APP_URL` repository variable — nothing is hardcoded.

The **Android APK** workflow builds the APK entirely in GitHub Actions (no local tooling needed), uploads it as an artifact and publishes `Sahaana-Bhakshanam.apk` in the latest GitHub Release. Without keystore secrets it is debug-signed (sideload testing); Play-Store builds require the permanent keystore secrets described in the deployment doc.

## Honest status of external integrations

- Real SMS OTP **will not send** until Twilio Verify production credentials are configured as secrets. Until then the API fails closed.
- Automatic WhatsApp delivery **will not work** until an approved WhatsApp Business Cloud API/BSP relay URL and signing secret are configured; orders are marked `needs_setup` and remain fully visible in the dashboard. A personal WhatsApp number via `wa.me` cannot receive silent automated messages.
- Privacy/cancellation policy text, FSSAI/GST details, service radius and capacity rules must be completed by the owner before commercial launch (`/policies` holds the placeholders).
