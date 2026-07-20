export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  // Chef/admin allowlist — hosted secrets, never committed.
  CHEF_PHONE_E164?: string;
  CHEF_PHONE_E164_LIST?: string;

  // OTP configuration.
  OTP_HASH_SECRET?: string;
  OTP_DEMO_MODE?: string; // must be "false" in production
  OTP_DEMO_CODE?: string; // local development only
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;

  // Order notification relay (WhatsApp Business / direct-message bridge).
  ORDER_RELAY_URL?: string;
  ORDER_RELAY_SECRET?: string;
}
