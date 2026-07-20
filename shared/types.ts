import type { MealId, MealWindow } from './meals';

export type PayMethod = 'cash' | 'upi';

export type OrderStatus =
  | 'new'
  | 'accepted'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export type NotifyStatus = 'pending' | 'sent' | 'needs_setup' | 'failed';

export interface PublicProfile {
  kitchenName: string;
  chefDisplayName: string;
  locality: string;
  bio: string;
}

export interface PublicMenuItem {
  id: number;
  name: string;
  description: string;
  mealId: MealId;
  priceInr: number;
  portions: number;
  available: boolean;
  imageKey: string;
}

export interface SlotState {
  mealId: MealId;
  available: boolean;
}

export interface StoreResponse {
  serverNow: number;
  profile: PublicProfile;
  slots: SlotState[];
  schedule: MealWindow[];
  menu: PublicMenuItem[];
}

export interface CartItemInput {
  menuItemId: number;
  qty: number;
}

export interface OrderRequest {
  mealId: MealId;
  items: CartItemInput[];
  customerName: string;
  address: string;
  landmark?: string;
  payMethod: PayMethod;
}

export interface OrderConfirmation {
  orderId: string;
  totalInr: number;
  mealId: MealId;
  mealDate: string;
  deliveryWindow: string;
  payMethod: PayMethod;
  paymentNote: string;
}

export interface AdminOrderItem {
  name: string;
  qty: number;
  unitPriceInr: number;
}

export interface AdminOrder {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  landmark: string;
  mealId: MealId;
  mealDate: string;
  totalInr: number;
  payMethod: PayMethod;
  status: OrderStatus;
  notifyStatus: NotifyStatus;
  createdAt: number;
  items: AdminOrderItem[];
}

export interface AdminProfile extends PublicProfile {
  whatsappNumber: string;
  upiId: string;
}

export interface MeResponse {
  authenticated: boolean;
  role?: 'consumer' | 'chef';
  phoneMasked?: string;
}
