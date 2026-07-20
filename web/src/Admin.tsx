import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MealId, MealWindow } from '../../shared/meals';
import type { AdminOrder, AdminProfile, PublicMenuItem, StoreResponse } from '../../shared/types';
import { api, ApiError } from './api';
import { countdown, inr, istDateTime } from './format';
import { OtpLogin } from './OtpLogin';

type Tab = 'orders' | 'menu' | 'sessions' | 'profile';

const NEXT_STATUS: Record<string, { label: string; next: string } | undefined> = {
  new: { label: 'Accept', next: 'accepted' },
  accepted: { label: 'Start preparing', next: 'preparing' },
  preparing: { label: 'Out for delivery', next: 'out_for_delivery' },
  out_for_delivery: { label: 'Mark delivered', next: 'delivered' },
};

export function Admin() {
  const [authState, setAuthState] = useState<'loading' | 'anon' | 'chef'>('loading');

  const checkAuth = useCallback(async () => {
    try {
      const me = await api.me();
      setAuthState(me.authenticated && me.role === 'chef' ? 'chef' : 'anon');
    } catch {
      setAuthState('anon');
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  if (authState === 'loading') return <div className="page"><div className="loading">Opening the kitchen…</div></div>;

  if (authState === 'anon') {
    return (
      <div className="page admin-login">
        <header className="site-header">
          <div className="brand">
            <span className="brand-mark" aria-hidden>🍃</span>
            <h1>Sahaana Bhakshanam — Kitchen</h1>
          </div>
        </header>
        <OtpLogin
          purpose="chef"
          title="Chef sign-in"
          subtitle="Only authorized kitchen numbers can sign in here."
          onSuccess={() => void checkAuth()}
        />
        <a className="btn ghost" href="/">← Customer storefront</a>
      </div>
    );
  }

  return <Dashboard onSignedOut={() => setAuthState('anon')} />;
}

function Dashboard({ onSignedOut }: { onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [store, setStore] = useState<StoreResponse | null>(null);
  const [menu, setMenu] = useState<PublicMenuItem[]>([]);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const loadAll = useCallback(async () => {
    try {
      const [o, s, m] = await Promise.all([api.adminOrders(), api.store(), api.adminMenu()]);
      setOrders(o.orders);
      setStore(s);
      setMenu(m.menu);
      setError('');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) onSignedOut();
      else setError('Could not refresh. Retrying…');
    }
  }, [onSignedOut]);

  // Near-real-time: authenticated polling every 5 seconds.
  useEffect(() => {
    void loadAll();
    const poll = setInterval(() => void loadAll(), 5_000);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [loadAll]);

  const openWindow: MealWindow | undefined = useMemo(
    () =>
      store?.schedule.find(
        (w) => w.status === 'open' && store.slots.find((s) => s.mealId === w.mealId)?.available
      ),
    [store]
  );

  const todayStats = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const today = orders.filter((o) => o.createdAt >= dayStart.getTime());
    const active = today.filter((o) => o.status !== 'cancelled');
    return {
      newCount: orders.filter((o) => o.status === 'new').length,
      todayCount: active.length,
      toCollect: active.filter((o) => o.status !== 'delivered').reduce((s, o) => s + o.totalInr, 0),
      portionsLeft: openWindow
        ? menu.filter((m) => m.mealId === openWindow.mealId && m.available).reduce((s, m) => s + m.portions, 0)
        : 0,
    };
  }, [orders, menu, openWindow]);

  return (
    <div className="page admin">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>🍃</span>
          <h1>Kitchen dashboard</h1>
        </div>
        <button
          className="btn ghost"
          onClick={() => {
            void api.logout().then(onSignedOut);
          }}
        >
          Sign out
        </button>
      </header>

      {error && <div className="banner error-banner" role="alert"><p>{error}</p></div>}

      <section className="stats">
        <div className="stat">
          <span className="stat-num">{todayStats.newCount}</span>
          <span className="stat-label">New orders</span>
        </div>
        <div className="stat">
          <span className="stat-num">{todayStats.todayCount}</span>
          <span className="stat-label">Orders today</span>
        </div>
        <div className="stat">
          <span className="stat-num">{inr(todayStats.toCollect)}</span>
          <span className="stat-label">To collect at delivery</span>
        </div>
        <div className="stat">
          <span className="stat-num">{todayStats.portionsLeft}</span>
          <span className="stat-label">
            {openWindow ? `${openWindow.label} portions left` : 'No open session'}
          </span>
        </div>
      </section>

      {openWindow && (
        <p className="muted session-note">
          <strong>{openWindow.label}</strong> ordering open · cutoff in{' '}
          <strong>{countdown(openWindow.cutoffAt - now)}</strong>
        </p>
      )}

      <nav className="admin-tabs" aria-label="Dashboard sections">
        {(['orders', 'menu', 'sessions', 'profile'] as Tab[]).map((t) => (
          <button key={t} className={`btn tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'orders' ? `Orders${todayStats.newCount ? ` (${todayStats.newCount})` : ''}` :
             t === 'menu' ? 'Menu' : t === 'sessions' ? 'Sessions' : 'Profile'}
          </button>
        ))}
      </nav>

      {tab === 'orders' && <OrdersPanel orders={orders} onChanged={loadAll} />}
      {tab === 'menu' && <MenuPanel menu={menu} onChanged={loadAll} />}
      {tab === 'sessions' && store && <SessionsPanel store={store} onChanged={loadAll} />}
      {tab === 'profile' && <ProfilePanel />}
    </div>
  );
}

function OrdersPanel({ orders, onChanged }: { orders: AdminOrder[]; onChanged: () => Promise<void> }) {
  const [busyId, setBusyId] = useState('');

  async function advance(id: string, status: string) {
    setBusyId(id);
    try {
      await api.adminPatchOrder(id, status);
      await onChanged();
    } finally {
      setBusyId('');
    }
  }

  if (orders.length === 0) return <p className="muted empty">No orders yet. They appear here within 5 seconds of confirmation.</p>;

  return (
    <section className="order-list" aria-label="Incoming orders">
      {orders.map((o) => {
        const next = NEXT_STATUS[o.status];
        return (
          <article key={o.id} className={`order-card status-${o.status}`}>
            <header>
              <strong>{o.id}</strong>
              <span className={`pill status-pill ${o.status}`}>{o.status.replace(/_/g, ' ')}</span>
            </header>
            <p>
              <strong>{o.customerName}</strong> · <a href={`tel:${o.phone}`}>{o.phone}</a>
            </p>
            <p className="muted">
              {o.address}
              {o.landmark ? ` (near ${o.landmark})` : ''}
            </p>
            <ul className="summary compact">
              {o.items.map((it, i) => (
                <li key={i}>
                  <span>{it.name} × {it.qty}</span>
                  <span>{inr(it.unitPriceInr * it.qty)}</span>
                </li>
              ))}
              <li className="total">
                <span>
                  Collect {o.payMethod === 'upi' ? 'UPI' : 'cash'} at delivery · {o.mealId} · {o.mealDate}
                </span>
                <strong>{inr(o.totalInr)}</strong>
              </li>
            </ul>
            <footer>
              <span className={`pill notify-${o.notifyStatus}`} title="WhatsApp/relay notification state">
                {o.notifyStatus === 'sent' ? 'notified' : o.notifyStatus === 'needs_setup' ? 'relay not set up' : o.notifyStatus}
              </span>
              <span className="muted">{istDateTime(o.createdAt)} IST</span>
              <span className="spacer" />
              {o.status !== 'delivered' && o.status !== 'cancelled' && (
                <button className="btn small ghost" disabled={busyId === o.id} onClick={() => void advance(o.id, 'cancelled')}>
                  Cancel
                </button>
              )}
              {next && (
                <button className="btn small primary" disabled={busyId === o.id} onClick={() => void advance(o.id, next.next)}>
                  {next.label}
                </button>
              )}
            </footer>
          </article>
        );
      })}
    </section>
  );
}

function MenuPanel({ menu, onChanged }: { menu: PublicMenuItem[]; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', description: '', mealId: 'lunch' as MealId, priceInr: '', portions: '' });
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function addDish() {
    setBusy(true);
    setFormError('');
    try {
      await api.adminAddDish({
        name: form.name,
        description: form.description,
        mealId: form.mealId,
        priceInr: Number(form.priceInr),
        portions: Number(form.portions),
      });
      setForm({ name: '', description: '', mealId: form.mealId, priceInr: '', portions: '' });
      await onChanged();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not add the dish.');
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: number, p: Partial<{ available: boolean; portions: number; priceInr: number }>) {
    await api.adminPatchDish({ id, ...p });
    await onChanged();
  }

  const byMeal = ['breakfast', 'lunch', 'snacks', 'dinner'] as MealId[];

  return (
    <section aria-label="Menu management">
      <form
        className="add-dish"
        onSubmit={(e) => {
          e.preventDefault();
          void addDish();
        }}
      >
        <h3>Add today&rsquo;s special</h3>
        <p className="muted">Every dish is pure vegetarian — automatically. There is no other option.</p>
        <div className="form-row">
          <label>
            Dish name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
          </label>
          <label>
            Meal
            <select value={form.mealId} onChange={(e) => setForm({ ...form, mealId: e.target.value as MealId })}>
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="snacks">Evening Snacks</option>
              <option value="dinner">Dinner</option>
            </select>
          </label>
        </div>
        <label>
          Short description
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <div className="form-row">
          <label>
            Price (₹)
            <input type="number" min={0} max={10000} value={form.priceInr} onChange={(e) => setForm({ ...form, priceInr: e.target.value })} required />
          </label>
          <label>
            Starting portions
            <input type="number" min={0} max={500} value={form.portions} onChange={(e) => setForm({ ...form, portions: e.target.value })} required />
          </label>
        </div>
        {formError && <p className="error" role="alert">{formError}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add dish'}
        </button>
      </form>

      {byMeal.map((mealId) => {
        const items = menu.filter((m) => m.mealId === mealId);
        if (items.length === 0) return null;
        return (
          <div key={mealId} className="menu-section">
            <h3>{mealId === 'snacks' ? 'Evening Snacks' : mealId[0]?.toUpperCase() + mealId.slice(1)}</h3>
            {items.map((m) => (
              <div key={m.id} className="menu-row">
                <div className="menu-row-main">
                  <strong>{m.name}</strong>
                  <span className="muted"> · {inr(m.priceInr)}</span>
                </div>
                <div className="qty" role="group" aria-label={`Portions of ${m.name}`}>
                  <button className="btn qty-btn" aria-label="Fewer portions" onClick={() => void patch(m.id, { portions: Math.max(0, m.portions - 1) })}>
                    −
                  </button>
                  <span>{m.portions}</span>
                  <button className="btn qty-btn" aria-label="More portions" onClick={() => void patch(m.id, { portions: Math.min(500, m.portions + 1) })}>
                    +
                  </button>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={m.available}
                    onChange={(e) => void patch(m.id, { available: e.target.checked })}
                  />
                  <span>{m.available ? 'On' : 'Off'}</span>
                </label>
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

function SessionsPanel({ store, onChanged }: { store: StoreResponse; onChanged: () => Promise<void> }) {
  return (
    <section aria-label="Meal sessions">
      <p className="muted">
        Timings are fixed (IST) and cannot be edited — you can only mark a session unavailable for the day.
      </p>
      {store.schedule.map((w) => {
        const slot = store.slots.find((s) => s.mealId === w.mealId);
        return (
          <div key={w.mealId} className="menu-row">
            <div className="menu-row-main">
              <strong>{w.label}</strong>
              <span className="muted">
                {' '}· cutoff {istDateTime(w.cutoffAt).split(', ')[1]} · delivery{' '}
                {istDateTime(w.deliveryStartAt).split(', ')[1]}–{istDateTime(w.deliveryEndAt).split(', ')[1]} IST
              </span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={slot?.available ?? false}
                onChange={(e) => {
                  void api.adminPatchSlot(w.mealId, e.target.checked).then(onChanged);
                }}
              />
              <span>{slot?.available ? 'Available' : 'Unavailable'}</span>
            </label>
          </div>
        );
      })}
    </section>
  );
}

function ProfilePanel() {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.adminProfile().then((r) => setProfile(r.profile)).catch(() => setError('Could not load the profile.'));
  }, []);

  if (!profile) return <p className="muted">{error || 'Loading profile…'}</p>;

  async function save() {
    if (!profile) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api.adminSaveProfile(profile);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof AdminProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile({ ...profile, [k]: e.target.value });

  return (
    <form
      className="profile-form"
      aria-label="Kitchen profile"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label>
        Kitchen name
        <input value={profile.kitchenName} onChange={set('kitchenName')} required />
      </label>
      <label>
        Chef display name
        <input value={profile.chefDisplayName} onChange={set('chefDisplayName')} required />
      </label>
      <label>
        Locality
        <input value={profile.locality} onChange={set('locality')} required />
      </label>
      <label>
        Short bio
        <textarea rows={3} value={profile.bio} onChange={set('bio')} />
      </label>
      <label>
        WhatsApp Business number (kept private)
        <input type="tel" value={profile.whatsappNumber} onChange={set('whatsappNumber')} />
      </label>
      <label>
        UPI ID for doorstep payment (kept private)
        <input value={profile.upiId} onChange={set('upiId')} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p className="success" role="status">Saved.</p>}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}
