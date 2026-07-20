import { Hono } from 'hono';
import type { Env } from '../env';
import type { AuthContext } from '../auth';
import { scheduleAt } from '../../../shared/meals';
import type { MealId } from '../../../shared/meals';

interface ProfileRow {
  kitchen_name: string;
  chef_display_name: string;
  locality: string;
  bio: string;
}

interface SlotRow {
  id: MealId;
  available: number;
}

interface MenuRow {
  id: number;
  name: string;
  description: string;
  meal_id: MealId;
  price_inr: number;
  portions: number;
  available: number;
  image_key: string;
}

export const storeRoutes = new Hono<{ Bindings: Env; Variables: { auth?: AuthContext } }>();

storeRoutes.get('/', async (c) => {
  const now = Date.now();
  const [profile, slots, menu] = await Promise.all([
    c.env.DB.prepare(
      'SELECT kitchen_name, chef_display_name, locality, bio FROM chef_profiles WHERE id = 1'
    ).first<ProfileRow>(),
    c.env.DB.prepare('SELECT id, available FROM meal_slots ORDER BY sort').all<SlotRow>(),
    // Pure-vegetarian invariant: the public menu can never include a
    // non-vegetarian row, even a legacy one.
    c.env.DB.prepare(
      `SELECT id, name, description, meal_id, price_inr, portions, available, image_key
       FROM menu_items WHERE is_veg = 1 ORDER BY meal_id, name`
    ).all<MenuRow>(),
  ]);

  return c.json({
    serverNow: now,
    profile: {
      kitchenName: profile?.kitchen_name ?? 'Sahaana Bhakshanam',
      chefDisplayName: profile?.chef_display_name ?? '',
      locality: profile?.locality ?? '',
      bio: profile?.bio ?? '',
    },
    slots: (slots.results ?? []).map((s) => ({ mealId: s.id, available: s.available === 1 })),
    schedule: scheduleAt(now),
    menu: (menu.results ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      mealId: m.meal_id,
      priceInr: m.price_inr,
      portions: m.portions,
      available: m.available === 1,
      imageKey: m.image_key,
    })),
  });
});
