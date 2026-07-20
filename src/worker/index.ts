import { Hono } from 'hono';
import type { Env } from './env';
import type { AuthContext } from './auth';
import { authMiddleware } from './auth';
import { authRoutes } from './routes/auth';
import { storeRoutes } from './routes/store';
import { orderRoutes } from './routes/orders';
import { adminRoutes } from './routes/admin';

const app = new Hono<{ Bindings: Env; Variables: { auth?: AuthContext } }>();

app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});

app.use('/api/*', authMiddleware);

app.route('/api/auth', authRoutes);
app.route('/api/store', storeRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/admin', adminRoutes);

app.get('/api/health', (c) => c.json({ ok: true, serverNow: Date.now() }));

app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    return c.json({ error: 'Not found.' }, 404);
  }
  // Static assets (including the SPA fallback) are handled by the assets
  // binding; only /api/* is routed to the Worker first.
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  // Never leak implementation details (or any request data) to the client.
  console.error('unhandled_error', err instanceof Error ? err.message : 'unknown');
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});

export default app;
