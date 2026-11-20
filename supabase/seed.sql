-- SMARTMENU QR — Script SQL de démonstration (NON DESTRUCTIF)
-- À exécuter dans le SQL Editor de votre projet Supabase APRÈS supabase/schema.sql.
-- Ce script n'efface aucune donnée existante (utilise ON CONFLICT DO NOTHING pour la démo)
-- et configure le compte Super Admin pour : eliseebyad32@gmail.com

-- ============================================================================
-- 1. ACTIVATION DU COMPTE SUPER ADMIN (eliseebyad32@gmail.com)
-- Prérequis : créez d'abord l'utilisateur eliseebyad32@gmail.com dans
-- Supabase → Authentication → Users (ou inscrivez-vous avec cet e-mail).
-- ============================================================================
insert into public.profiles (id, full_name, email, role, restaurant_id, is_active)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', 'Admin Principal SMARTMENU QR'),
  u.email,
  'super_admin',
  null,
  true
from auth.users u
where lower(u.email) = lower('eliseebyad32@gmail.com')
on conflict (id) do update
  set role = 'super_admin',
      restaurant_id = null,
      is_active = true,
      email = excluded.email;

-- ============================================================================
-- 2. CATÉGORIES DE BASE POUR LES 4 PLATS DE DÉMONSTRATION
-- ============================================================================
insert into public.categories (id, restaurant_id, name_fr, name_en, description_fr, description_en, sort_order)
values
  (
    'smash-burgers',
    null,
    'Smash Burgers',
    'Smash Burgers',
    'Steaks de bœuf saisis à la plaque brûlante, croûte caramélisée et cheddar fondant.',
    'Blazing flat-top seared beef patties with caramelized edges and melted cheddar.',
    1
  ),
  (
    'pork-ribs',
    null,
    'Côtes de porc',
    'Pork Ribs',
    'Travers cuits lentement et laqués au feu vif de nos sauces fumées.',
    'Slow-braised pork racks flame-finished with our smoky house glazes.',
    2
  ),
  (
    'sides',
    null,
    'Accompagnements',
    'Sides',
    'Frites maison garnies, rondelles d’oignons et maïs grillé aux épices.',
    'Loaded hand-cut fries, crispy onion rings, and spiced charred corn.',
    3
  ),
  (
    'drinks',
    null,
    'Boissons',
    'Drinks',
    'Citronnades pressées, infusions glacées à l’hibiscus et sodas rafraîchissants.',
    'Fresh-pressed coolers, hibiscus iced infusions, and chilled sodas.',
    4
  )
on conflict (id) do nothing;

-- ============================================================================
-- 3. RESTAURANT DE DÉMONSTRATION (1 établissement)
-- Démonstration commerciale indépendante & non officielle — tarifs en FC fictifs.
-- ============================================================================
insert into public.restaurants (
  id,
  slug,
  name,
  city,
  country_fr,
  country_en,
  address_fr,
  address_en,
  hours_fr,
  hours_en,
  phone,
  tagline_fr,
  tagline_en,
  description_fr,
  description_en,
  demo_disclaimer_fr,
  demo_disclaimer_en,
  hero_image,
  logo_url,
  primary_color,
  secondary_color,
  is_active,
  is_demo
)
values (
  'rocomamas-lubumbashi',
  'rocomamas-lubumbashi',
  'RocoMamas Lubumbashi',
  'Lubumbashi',
  'RDC',
  'DRC',
  'Avenue Kasavubu 148, Quartier Makutano, Lubumbashi (Adresse démo)',
  '148 Avenue Kasavubu, Makutano District, Lubumbashi (Demo Address)',
  'Lun – Dim : 11h00 – 23h00',
  'Mon – Sun: 11:00 AM – 11:00 PM',
  '+243 990 000 148',
  'L’art du smash burger urbain et du grill à flamme vive au cœur de Lubumbashi.',
  'Urban smash burgers and open-flame grill craft in the heart of Lubumbashi.',
  'Démonstration SMARTMENU QR : burgers smashés minute, côtes caramélisées et boissons fraîches, consultables à table en ligne ou hors ligne.',
  'SMARTMENU QR demonstration: flat-top smash burgers, caramelized ribs, and chilled craft drinks built for online and offline QR browsing.',
  'Démonstration commerciale indépendante & non officielle · Produits et tarifs en FC fictifs',
  'Independent & unofficial commercial demonstration · Fictional products and FC prices',
  '/src/assets/images/hero_smash_burger_1794942899291.jpg',
  '',
  '#DC2626',
  '#F97316',
  true,
  true
)
on conflict (id) do nothing;

-- ============================================================================
-- 4. QUATRE PLATS DE DÉMONSTRATION (avec photographies individuelles exactes)
-- ============================================================================
insert into public.menu_items (
  id,
  restaurant_id,
  category_id,
  name_fr,
  name_en,
  description_fr,
  description_en,
  ingredients_fr,
  ingredients_en,
  price_fc,
  image_url,
  is_available,
  is_popular,
  is_specialty,
  spice_level,
  prep_minutes
)
values
  (
    'sb-1',
    'rocomamas-lubumbashi',
    'smash-burgers',
    'Katanga Double Smash',
    'Katanga Double Smash',
    'Double steak de bœuf smashé, double cheddar affiné, oignons caramélisés au balsamique et sauce fumée maison.',
    'Double seared beef patties, double aged cheddar, balsamic caramelized onions, and smoky house sauce.',
    'Pain brioché toasté, 2x110g bœuf smashé, cheddar affiné, pickles croquants, oignons confits, sauce signature.',
    'Toasted brioche bun, 2x110g smashed beef, aged cheddar, crisp pickles, caramelized onions, signature sauce.',
    32000,
    '/src/assets/images/hero_smash_burger_1794942899291.jpg',
    true,
    true,
    true,
    1,
    14
  ),
  (
    'pr-1',
    'rocomamas-lubumbashi',
    'pork-ribs',
    'Smoky Bourbon Pork Ribs (600g)',
    'Smoky Bourbon Pork Ribs (600g)',
    'Travers de porc braisés 6 heures, caramélisés au grill avec notre sauce BBQ fumée, sésame grillé et ciboulette.',
    '6-hour slow-braised pork rack flame-caramelized in smoky BBQ glaze, toasted sesame, and fresh chives.',
    '600g côtes de porc tendres, laquage BBQ fumé au poivre noir, graines de sésame, ciboulette.',
    '600g tender pork ribs, black-pepper smoky BBQ glaze, sesame seeds, fresh chives.',
    48000,
    '/src/assets/images/cat_pork_ribs_1794942900135.jpg',
    true,
    true,
    true,
    1,
    20
  ),
  (
    'sd-1',
    'rocomamas-lubumbashi',
    'sides',
    'Loaded Cheese & Bacon Fries',
    'Loaded Cheese & Bacon Fries',
    'Frites allumettes dorées nappées de cheddar chaud, éclats de bacon fumé, jalapeños et oignons verts.',
    'Golden shoestring fries smothered in warm aged cheddar sauce, smoky bacon bits, and jalapeños.',
    'Pommes de terre fraîches, sauce cheddar maison, bacon de bœuf croustillant, jalapeños, ciboule.',
    'Hand-cut potatoes, warm cheddar sauce, crisp beef bacon, jalapeños, scallions.',
    15500,
    '/src/assets/images/cat_sides_1794942900967.jpg',
    true,
    true,
    false,
    1,
    10
  ),
  (
    'dr-1',
    'rocomamas-lubumbashi',
    'drinks',
    'Hibiscus Passion Cooler',
    'Hibiscus Passion Cooler',
    'Infusion glacée de fleurs d’hibiscus, pulpe fraîche de fruit de la passion, menthe et citron vert.',
    'Chilled hibiscus flower infusion, fresh passionfruit pulp, garden mint, and pressed lime.',
    'Bissap infusé à froid, fruit de la passion, citron vert, menthe fraîche, eau pétillante.',
    'Cold-brewed hibiscus, passionfruit, fresh lime, mint leaves, sparkling water.',
    9500,
    '/src/assets/images/dr1_hibiscus_cooler_1794944699262.jpg',
    true,
    true,
    false,
    0,
    4
  )
on conflict (id) do nothing;
