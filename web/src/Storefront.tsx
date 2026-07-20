import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MealId, MealWindow } from '../../shared/meals';
import type { OrderConfirmation, PublicMenuItem, StoreResponse } from '../../shared/types';
import { api, ApiError } from './api';
import { countdown, inr, istDateTime, istDay } from './format';
import { OtpLogin } from './OtpLogin';

const CART_KEY = 'sb-cart-v1';

interface CartState {
  mealId: MealId;
  items: Record<number, number>;
}

function loadCart(): CartState | null {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CartState;
    return parsed && parsed.mealId && parsed.items ? parsed : null;
  } catch {
    return null;
  }
}

const DISH_EMOJI: Record<string, string> = {
  pongal: '🥣',
  idli: '🍚',
  upma: '🥘',
  meals: '🍛',
  puliyodarai: '🍛',
  thayir: '🥣',
  vada: '🍩',
  kesari: '🍮',
  sundal: '🥜',
  chapati: '🫓',
  adai: '🥞',
};

function DishArt({ imageKey, name }: { imageKey: string; name: string }) {
  const emoji = DISH_EMOJI[imageKey] ?? '🌿';
  return (
    <div className="dish-art" role="img" aria-label={`${name} — pure vegetarian`}>
      <span aria-hidden>{emoji}</span>
    </div>
  );
}

export function Storefront() {
  const [store, setStore] = useState<StoreResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [selectedMeal, setSelectedMeal] = useState<MealId | null>(null);
  const [cart, setCart] = useState<CartState | null>(() => loadCart());
  const [authed, setAuthed] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<OrderConfirmation | null>(null);
  const userPickedMeal = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.store();
      setStore(s);
      setClockOffset(s.serverNow - Date.now());
      setLoadError('');
    } catch {
      setLoadError('Could not load the kitchen. Check your connection and retry.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    void api.me().then((me) => setAuthed(me.authenticated)).catch(() => {});
    const poll = setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  // Server-anchored clock, ticking every second for live countdowns.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + clockOffset), 1000);
    return () => clearInterval(t);
  }, [clockOffset]);

  // Recompute session windows client-side with the corrected clock so the UI
  // locks at the exact boundary; the server independently re-verifies anyway.
  const schedule: MealWindow[] = useMemo(() => {
    if (!store) return [];
    return store.schedule.map((w) => {
      if (now >= w.cutoffAt && w.status === 'open') return { ...w, status: 'upcoming' as const };
      if (now >= w.opensAt && now < w.cutoffAt) return { ...w, status: 'open' as const };
      return { ...w, status: (now >= w.opensAt && now < w.cutoffAt ? 'open' : 'upcoming') as MealWindow['status'] };
    });
  }, [store, now]);

  const slotAvailable = useCallback(
    (mealId: string) => store?.slots.find((s) => s.mealId === mealId)?.available ?? false,
    [store]
  );

  // Default meal selection: first open+available session, else soonest opening.
  useEffect(() => {
    if (!store || schedule.length === 0 || userPickedMeal.current) return;
    const open = schedule.find((w) => w.status === 'open' && slotAvailable(w.mealId));
    const next = [...schedule].sort((a, b) => a.opensAt - b.opensAt).find((w) => slotAvailable(w.mealId));
    setSelectedMeal((cur) => cur ?? open?.mealId ?? next?.mealId ?? schedule[0]?.mealId ?? null);
  }, [store, schedule, slotAvailable]);

  const activeWindow = schedule.find((w) => w.mealId === selectedMeal) ?? null;
  const activeOpen = Boolean(
    activeWindow && activeWindow.status === 'open' && slotAvailable(activeWindow.mealId)
  );
  const menu: PublicMenuItem[] = useMemo(
    () => (store?.menu ?? []).filter((m) => m.mealId === selectedMeal),
    [store, selectedMeal]
  );

  function saveCart(next: CartState | null) {
    setCart(next);
    try {
      if (next) localStorage.setItem(CART_KEY, JSON.stringify(next));
      else localStorage.removeItem(CART_KEY);
    } catch {
      // Storage unavailable — cart lives in memory only.
    }
  }

  function setQty(item: PublicMenuItem, qty: number) {
    if (!activeOpen || !activeWindow) return;
    const base: CartState =
      cart && cart.mealId === item.mealId ? cart : { mealId: item.mealId, items: {} };
    const items = { ...base.items };
    const clamped = Math.max(0, Math.min(qty, item.portions, 10));
    if (clamped === 0) delete items[item.id];
    else items[item.id] = clamped;
    saveCart(Object.keys(items).length === 0 ? null : { mealId: item.mealId, items });
  }

  const cartLines = useMemo(() => {
    if (!cart || !store) return [];
    return Object.entries(cart.items)
      .map(([id, qty]) => {
        const item = store.menu.find((m) => m.id === Number(id));
        return item ? { item, qty } : null;
      })
      .filter((x): x is { item: PublicMenuItem; qty: number } => x !== null);
  }, [cart, store]);
  const cartTotal = cartLines.reduce((sum, l) => sum + l.item.priceInr * l.qty, 0);
  const cartCount = cartLines.reduce((sum, l) => sum + l.qty, 0);
  const cartWindow = schedule.find((w) => w.mealId === cart?.mealId) ?? null;
  const cartOpen = Boolean(cartWindow && cartWindow.status === 'open' && slotAvailable(cartWindow.mealId));

  if (confirmation) {
    return (
      <ConfirmationView
        confirmation={confirmation}
        onDone={() => {
          setConfirmation(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="page">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>🍃</span>
          <div>
            <h1>Sahaana Bhakshanam</h1>
            <p className="tagline">Pure-veg Tamil Brahmin Iyer home kitchen</p>
          </div>
        </div>
        <span className="veg-badge" title="100% vegetarian — no meat, fish or eggs">
          <span className="veg-dot" aria-hidden /> Pure Veg
        </span>
      </header>

      {loadError && (
        <div className="banner error-banner" role="alert">
          <p>{loadError}</p>
          <button className="btn small" onClick={() => void refresh()}>Retry</button>
        </div>
      )}

      {!store && !loadError && <div className="loading">Setting the table…</div>}

      {store && (
        <>
          <section className="kitchen-card">
            <p>
              <strong>{store.profile.chefDisplayName || 'Our chef'}</strong>
              {store.profile.locality ? ` · ${store.profile.locality}` : ''}
            </p>
            <p className="muted">{store.profile.bio}</p>
          </section>

          <nav className="meal-tabs" aria-label="Meal sessions">
            {schedule.map((w) => {
              const isOpen = w.status === 'open' && slotAvailable(w.mealId);
              return (
                <button
                  key={w.mealId}
                  className={`meal-tab ${selectedMeal === w.mealId ? 'active' : ''}`}
                  aria-pressed={selectedMeal === w.mealId}
                  onClick={() => {
                    userPickedMeal.current = true;
                    setSelectedMeal(w.mealId);
                  }}
                >
                  <span className="meal-name">{w.label}</span>
                  <span className={`meal-state ${isOpen ? 'open' : 'closed'}`}>
                    {!slotAvailable(w.mealId) ? 'Unavailable' : isOpen ? 'Open' : 'Opens soon'}
                  </span>
                </button>
              );
            })}
          </nav>

          {activeWindow && (
            <section
              className={`session-banner ${activeOpen ? 'open' : 'closed'}`}
              role="timer"
              aria-label="Ordering window"
            >
              {!slotAvailable(activeWindow.mealId) ? (
                <NextSession schedule={schedule} slotAvailable={slotAvailable} now={now} current={activeWindow} />
              ) : activeWindow.status === 'open' ? (
                <>
                  <p>
                    <strong>{activeWindow.label}</strong> ordering is open · delivery {istDay(activeWindow.date)},{' '}
                    {istDateTime(activeWindow.deliveryStartAt).split(', ')[1]}–
                    {istDateTime(activeWindow.deliveryEndAt).split(', ')[1]} IST
                  </p>
                  <p className="countdown">
                    Cutoff in <strong>{countdown(activeWindow.cutoffAt - now)}</strong>
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <strong>{activeWindow.label}</strong> ordering opens {istDateTime(activeWindow.opensAt)} IST
                  </p>
                  <p className="countdown">
                    Opens in <strong>{countdown(activeWindow.opensAt - now)}</strong>
                  </p>
                </>
              )}
            </section>
          )}

          <section className="menu-grid" aria-label="Menu">
            {menu.length === 0 && <p className="muted empty">No dishes listed for this session yet.</p>}
            {menu.map((item) => {
              const qty = cart?.mealId === item.mealId ? (cart.items[item.id] ?? 0) : 0;
              const soldOut = item.portions <= 0 || !item.available;
              return (
                <article key={item.id} className={`dish-card ${soldOut ? 'sold-out' : ''}`}>
                  <DishArt imageKey={item.imageKey} name={item.name} />
                  <div className="dish-body">
                    <h3>{item.name}</h3>
                    <p className="muted">{item.description}</p>
                    <div className="dish-meta">
                      <span className="price">{inr(item.priceInr)}</span>
                      {soldOut ? (
                        <span className="pill sold">Sold out</span>
                      ) : item.portions <= 5 ? (
                        <span className="pill low">Only {item.portions} left</span>
                      ) : null}
                    </div>
                    <div className="dish-actions">
                      {!activeOpen ? (
                        <span className="pill closed-pill">Session closed</span>
                      ) : soldOut ? null : qty === 0 ? (
                        <button className="btn add" onClick={() => setQty(item, 1)}>
                          Add
                        </button>
                      ) : (
                        <div className="qty" role="group" aria-label={`Quantity of ${item.name}`}>
                          <button className="btn qty-btn" aria-label="Decrease" onClick={() => setQty(item, qty - 1)}>
                            −
                          </button>
                          <span aria-live="polite">{qty}</span>
                          <button
                            className="btn qty-btn"
                            aria-label="Increase"
                            onClick={() => setQty(item, qty + 1)}
                            disabled={qty >= Math.min(item.portions, 10)}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <footer className="site-footer">
            <p>Pay only at delivery — cash or UPI directly to the chef. No online payment, ever.</p>
            <a href="/policies">Privacy &amp; policies</a>
          </footer>

          {cartCount > 0 && (
            <div className="cart-bar">
              <div>
                <strong>{cartCount} item{cartCount > 1 ? 's' : ''}</strong> · {inr(cartTotal)}
                <span className="muted"> · {cartWindow?.label}</span>
              </div>
              <button
                className="btn primary"
                disabled={!cartOpen}
                onClick={() => setCheckoutOpen(true)}
              >
                {cartOpen ? 'Review order' : 'Session closed'}
              </button>
            </div>
          )}

          {checkoutOpen && cart && cartWindow && (
            <CheckoutModal
              cartLines={cartLines}
              cartTotal={cartTotal}
              window={cartWindow}
              open={cartOpen}
              authed={authed}
              now={now}
              onAuthed={() => setAuthed(true)}
              onClose={() => setCheckoutOpen(false)}
              onPlaced={(conf) => {
                saveCart(null);
                setCheckoutOpen(false);
                setConfirmation(conf);
              }}
              onStale={() => void refresh()}
            />
          )}
        </>
      )}
    </div>
  );
}

function NextSession({
  schedule,
  slotAvailable,
  now,
  current,
}: {
  schedule: MealWindow[];
  slotAvailable: (m: string) => boolean;
  now: number;
  current: MealWindow;
}) {
  const next = [...schedule]
    .filter((w) => w.mealId !== current.mealId && slotAvailable(w.mealId))
    .sort((a, b) => a.opensAt - b.opensAt)
    .find((w) => w.status === 'open' || w.opensAt > now);
  return (
    <>
      <p>
        <strong>{current.label}</strong> is unavailable today.
      </p>
      {next && (
        <p className="countdown">
          Next: <strong>{next.label}</strong>{' '}
          {next.status === 'open' ? (
            <>— open now, cutoff in <strong>{countdown(next.cutoffAt - now)}</strong></>
          ) : (
            <>opens in <strong>{countdown(next.opensAt - now)}</strong></>
          )}
        </p>
      )}
    </>
  );
}

function CheckoutModal({
  cartLines,
  cartTotal,
  window: win,
  open,
  authed,
  now,
  onAuthed,
  onClose,
  onPlaced,
  onStale,
}: {
  cartLines: { item: PublicMenuItem; qty: number }[];
  cartTotal: number;
  window: MealWindow;
  open: boolean;
  authed: boolean;
  now: number;
  onAuthed: () => void;
  onClose: () => void;
  onPlaced: (c: OrderConfirmation) => void;
  onStale: () => void;
}) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'upi'>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function placeOrder() {
    setBusy(true);
    setError('');
    try {
      const conf = await api.placeOrder({
        mealId: win.mealId,
        items: cartLines.map((l) => ({ menuItemId: l.item.id, qty: l.qty })),
        customerName: name,
        address,
        landmark,
        payMethod,
      });
      onPlaced(conf);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        if (e.status === 409) onStale();
      } else {
        setError('Could not place the order. Please check your connection and retry.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Checkout">
      <div className="modal">
        <button className="btn ghost close" onClick={onClose} aria-label="Close checkout">
          ✕
        </button>
        <h2>Confirm your {win.label.toLowerCase()} order</h2>
        <p className="muted">
          Delivery {istDay(win.date)} · cutoff in {countdown(win.cutoffAt - now)}
        </p>
        {!open && (
          <p className="error" role="alert">
            This session just closed — ordering is locked.
          </p>
        )}
        <ul className="summary">
          {cartLines.map((l) => (
            <li key={l.item.id}>
              <span>
                {l.item.name} × {l.qty}
              </span>
              <span>{inr(l.item.priceInr * l.qty)}</span>
            </li>
          ))}
          <li className="total">
            <span>Total (payable at delivery)</span>
            <span>{inr(cartTotal)}</span>
          </li>
        </ul>

        {!authed ? (
          <OtpLogin
            purpose="consumer"
            title="Verify your mobile"
            subtitle="We use your number only to confirm and deliver your order."
            onSuccess={onAuthed}
          />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void placeOrder();
            }}
          >
            <label htmlFor="co-name">Your name</label>
            <input id="co-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            <label htmlFor="co-address">Delivery address</label>
            <textarea
              id="co-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              minLength={10}
              rows={3}
              placeholder="Flat / street / area — complete address"
            />
            <label htmlFor="co-landmark">Landmark (optional)</label>
            <input id="co-landmark" value={landmark} onChange={(e) => setLandmark(e.target.value)} />

            <fieldset className="pay-choice">
              <legend>How will you pay at the doorstep?</legend>
              <label className={payMethod === 'cash' ? 'chosen' : ''}>
                <input
                  type="radio"
                  name="pay"
                  checked={payMethod === 'cash'}
                  onChange={() => setPayMethod('cash')}
                />
                Cash at delivery
              </label>
              <label className={payMethod === 'upi' ? 'chosen' : ''}>
                <input
                  type="radio"
                  name="pay"
                  checked={payMethod === 'upi'}
                  onChange={() => setPayMethod('upi')}
                />
                UPI directly to the chef at delivery
              </label>
            </fieldset>
            <p className="muted pay-note">
              No payment is collected online. You pay only when the food reaches you.
            </p>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary big" type="submit" disabled={busy || !open}>
              {busy ? 'Placing order…' : `Confirm order · ${inr(cartTotal)}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ConfirmationView({
  confirmation,
  onDone,
}: {
  confirmation: OrderConfirmation;
  onDone: () => void;
}) {
  return (
    <div className="page confirmation">
      <div className="confirm-card">
        <div className="confirm-icon" aria-hidden>✅</div>
        <h1>Order confirmed</h1>
        <p className="order-id">{confirmation.orderId}</p>
        <ul className="summary">
          <li>
            <span>Total to pay at delivery</span>
            <strong>{inr(confirmation.totalInr)}</strong>
          </li>
          <li>
            <span>Delivery</span>
            <span>
              {istDay(confirmation.mealDate)}, {confirmation.deliveryWindow}
            </span>
          </li>
          <li>
            <span>Payment method</span>
            <span>{confirmation.payMethod === 'upi' ? 'UPI to the chef at delivery' : 'Cash at delivery'}</span>
          </li>
        </ul>
        <p className="pay-note-strong">{confirmation.paymentNote}</p>
        <button className="btn primary" onClick={onDone}>
          Back to the kitchen
        </button>
      </div>
    </div>
  );
}
