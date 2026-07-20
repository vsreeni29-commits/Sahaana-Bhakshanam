import type {
  AdminOrder,
  AdminProfile,
  MeResponse,
  OrderConfirmation,
  OrderRequest,
  PublicMenuItem,
  StoreResponse,
} from '../../shared/types';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error body
  }
  if (!res.ok) {
    const b = body as { error?: string; code?: string } | null;
    throw new ApiError(res.status, b?.error ?? 'Something went wrong. Please try again.', b?.code);
  }
  return body as T;
}

export const api = {
  store: () => request<StoreResponse>('/api/store'),
  me: () => request<MeResponse>('/api/auth/me'),
  requestOtp: (phone: string, purpose: 'consumer' | 'chef') =>
    request<{ ok: boolean; phoneMasked: string }>('/api/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, purpose }),
    }),
  verifyOtp: (phone: string, purpose: 'consumer' | 'chef', code: string) =>
    request<{ ok: boolean; role: 'consumer' | 'chef' }>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, purpose, code }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  placeOrder: (order: OrderRequest) =>
    request<OrderConfirmation>('/api/orders', { method: 'POST', body: JSON.stringify(order) }),

  adminMenu: () => request<{ menu: PublicMenuItem[] }>('/api/admin/menu'),
  adminAddDish: (dish: { name: string; description: string; mealId: string; priceInr: number; portions: number }) =>
    request<{ ok: boolean }>('/api/admin/menu', { method: 'POST', body: JSON.stringify(dish) }),
  adminPatchDish: (patch: { id: number } & Partial<{ available: boolean; portions: number; priceInr: number }>) =>
    request<{ ok: boolean }>('/api/admin/menu', { method: 'PATCH', body: JSON.stringify(patch) }),
  adminPatchSlot: (mealId: string, available: boolean) =>
    request<{ ok: boolean }>('/api/admin/slots', {
      method: 'PATCH',
      body: JSON.stringify({ mealId, available }),
    }),
  adminOrders: () => request<{ serverNow: number; orders: AdminOrder[] }>('/api/admin/orders'),
  adminPatchOrder: (id: string, status: string) =>
    request<{ ok: boolean }>('/api/admin/orders', {
      method: 'PATCH',
      body: JSON.stringify({ id, status }),
    }),
  adminProfile: () => request<{ profile: AdminProfile }>('/api/admin/profile'),
  adminSaveProfile: (profile: AdminProfile) =>
    request<{ ok: boolean }>('/api/admin/profile', { method: 'PUT', body: JSON.stringify(profile) }),
};
