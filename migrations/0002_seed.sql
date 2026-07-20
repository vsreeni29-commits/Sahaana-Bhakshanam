-- Seed: fixed meal slots, placeholder kitchen profile, and a starting
-- pure-vegetarian Iyer menu. No personal data — the chef edits the profile
-- (WhatsApp number, UPI ID) from the authenticated dashboard only.

INSERT INTO meal_slots (id, label, available, sort) VALUES
  ('breakfast', 'Breakfast', 1, 1),
  ('lunch', 'Lunch', 1, 2),
  ('snacks', 'Evening Snacks', 1, 3),
  ('dinner', 'Dinner', 1, 4);

INSERT INTO chef_profiles (id, kitchen_name, chef_display_name, locality, bio, whatsapp_number, upi_id, updated_at)
VALUES (
  1,
  'Sahaana Bhakshanam',
  'Sahaana',
  'Chennai',
  'Pure-vegetarian, home-cooked Tamil Brahmin Iyer food — sattvic recipes made fresh for every meal, delivered to your doorstep. Pay only when your food arrives.',
  '',
  '',
  0
);

INSERT INTO menu_items (name, description, meal_id, price_inr, portions, available, is_veg, image_key, created_at) VALUES
  ('Ven Pongal', 'Creamy rice and moong dal tempered with ghee, pepper, cumin and cashew. Served with coconut chutney and gothsu.', 'breakfast', 90, 20, 1, 1, 'pongal', 0),
  ('Idli with Chutney & Sambar', 'Four soft steamed idlis with coconut chutney and tiffin sambar.', 'breakfast', 70, 30, 1, 1, 'idli', 0),
  ('Rava Upma', 'Roasted semolina upma with vegetables, ginger and curry leaves.', 'breakfast', 60, 20, 1, 1, 'upma', 0),
  ('Full Meals (Sappadu)', 'Rice, sambar, rasam, kootu, poriyal, appalam, pickle and curd — a complete Iyer lunch on the leaf.', 'lunch', 150, 25, 1, 1, 'meals', 0),
  ('Puliyodarai', 'Temple-style tamarind rice with roasted peanuts and appalam.', 'lunch', 90, 20, 1, 1, 'puliyodarai', 0),
  ('Thayir Sadam', 'Cooling curd rice tempered with mustard, ginger and curry leaves, with pickle.', 'lunch', 70, 20, 1, 1, 'thayir', 0),
  ('Medu Vada (2 pcs)', 'Crisp urad dal vadas with coconut chutney.', 'snacks', 50, 30, 1, 1, 'vada', 0),
  ('Rava Kesari', 'Ghee-rich semolina kesari with saffron, cashew and raisins.', 'snacks', 60, 25, 1, 1, 'kesari', 0),
  ('Sundal', 'Steamed chickpea sundal with coconut, a light evening tiffin classic.', 'snacks', 40, 25, 1, 1, 'sundal', 0),
  ('Chapati with Kurma', 'Soft chapatis with vegetable kurma.', 'dinner', 90, 20, 1, 1, 'chapati', 0),
  ('Adai with Avial', 'Protein-rich lentil adai with traditional avial.', 'dinner', 100, 20, 1, 1, 'adai', 0),
  ('Curd Rice & Poriyal Combo', 'Light dinner combo of thayir sadam and seasonal poriyal.', 'dinner', 80, 20, 1, 1, 'thayir', 0);
