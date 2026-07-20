# Deployment runbook

## 1. One-time Cloudflare setup

```bash
npx wrangler login                       # or use CLOUDFLARE_API_TOKEN
npx wrangler d1 create sahaana-bhakshanam
```

Copy the returned `database_id` into `wrangler.toml` (replacing the zero placeholder), commit, then:

```bash
npm run db:migrate:remote                # apply migrations to the remote D1
```

## 2. Production secrets (never committed)

```bash
npx wrangler secret put CHEF_PHONE_E164_LIST   # +91XXXXXXXXXX,+91XXXXXXXXXX,+91XXXXXXXXXX
npx wrangler secret put OTP_HASH_SECRET        # openssl rand -hex 32
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_VERIFY_SERVICE_SID
# Optional, once an approved WhatsApp Business/BSP relay exists:
npx wrangler secret put ORDER_RELAY_URL
npx wrangler secret put ORDER_RELAY_SECRET
```

Rules:

- The three authorized chef numbers go **only** into `CHEF_PHONE_E164_LIST` (E.164, comma-separated). Removing one there revokes its chef access immediately — no redeploy of code needed beyond the secret update.
- `OTP_DEMO_MODE` stays `"false"` in production (`wrangler.toml` var). Demo mode + `OTP_DEMO_CODE` belong in local `.dev.vars` only.
- Until the Twilio secrets exist, sign-in fails closed with “SMS OTP is not configured”. Do not fake it.

## 3. Continuous deployment

GitHub repository **secrets**: `CLOUDFLARE_API_TOKEN` (Workers + D1 edit permissions), `CLOUDFLARE_ACCOUNT_ID`.
GitHub repository **variable**: `WEB_APP_URL` — the live HTTPS address, consumed by the Android build.

- `CI` (every push/PR): npm ci → lint → typecheck → tests → Vite build → `wrangler deploy --dry-run` (validates the ESM Worker, fetch handler, bindings and assets manifest).
- `Deploy Web` (push to `main` / manual): re-runs validation, applies D1 migrations, `wrangler deploy`. Fails with a clear message when Cloudflare secrets are missing.
- `Android APK` (changes under `android/` / manual): builds `Sahaana-Bhakshanam.apk` in Actions, uploads it as an artifact and publishes a GitHub Release marked *latest*.

## 4. Android signing

Without secrets the APK is **debug-signed** — installable for sideload testing, not for Play Store. For production add repository secrets and re-run the workflow:

- `ANDROID_KEYSTORE_BASE64` — `base64 -w0 release.keystore`
- `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`

Keep the keystore permanent and backed up; Play updates require the same key and an increasing `versionCode` (the workflow uses the run number).

## 5. Custom-domain migration

When a registered domain is available:

1. Add the domain to the Cloudflare account (or delegate DNS), then attach a custom domain to the Worker: dashboard → Workers & Pages → sahaana-bhakshanam → Settings → Domains & Routes → *Add custom domain* (e.g. `order.example.in`). Cloudflare creates the required CNAME/apex records automatically on-zone; for external DNS, add the CNAME it displays.
2. Wait for hostname + SSL status **Active**.
3. Update the GitHub repository variable `WEB_APP_URL` to `https://order.example.in`.
4. Re-run the **Android APK** workflow so new installs use the custom domain.
5. Keep the previous `*.workers.dev` URL serving (it stays attached by default) so existing APK installs continue to work during the transition.

## 6. Before commercial launch

- Replace the `/policies` placeholders: privacy policy, cancellation/refund terms, FSSAI registration (and GST if applicable), service radius and order-capacity rules.
- Test real SMS OTP end-to-end **after** Twilio secrets are set; test the WhatsApp relay **after** an approved Business API/BSP endpoint exists. Neither can be verified before those credentials exist.
