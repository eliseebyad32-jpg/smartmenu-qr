-- SMARTMENU QR — Multi-Restaurant PostgreSQL Schema & Row Level Security (Supabase)
-- Non-destructive & idempotent: safe to run on your SmartMenu-QR Supabase project
-- without overwriting or deleting existing data.

create extension if not exists "pgcrypto";

-- 1. RESTAURANTS TABLE
create table if not exists public.restaurants (
  id text primary key,
  slug text unique not null,
  name text not null,
  city text not null,
  country_fr text not null default 'RDC',
  country_en text not null default 'DRC',
  address_fr text not null,
  address_en text not null,
  hours_fr text not null default 'Lun – Dim : 11h00 – 23h00',
  hours_en text not null default 'Mon – Sun: 11:00 AM – 11:00 PM',
  phone text not null default '',
  tagline_fr text not null default '',
  tagline_en text not null default '',
  description_fr text not null default '',
  description_en text not null default '',
  demo_disclaimer_fr text not null default '',
  demo_disclaimer_en text not null default '',
  hero_image text not null default '',
  logo_url text default '',
  primary_color text not null default '#DC2626',
  secondary_color text not null default '#F97316',
  is_active boolean not null default true,
  is_demo boolean not null default false,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. PROFILES TABLE (RBAC: super_admin | restaurateur)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null check (role in ('super_admin', 'restaurateur')),
  restaurant_id text references public.restaurants(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. CATEGORIES TABLE (Global or restaurant-specific)
create table if not exists public.categories (
  id text primary key,
  restaurant_id text references public.restaurants(id) on delete cascade,
  name_fr text not null,
  name_en text not null,
  description_fr text not null default '',
  description_en text not null default '',
  sort_order int not null default 10,
  created_at timestamptz not null default now()
);

-- 4. MENU ITEMS TABLE (Strictly scoped per restaurant_id)
create table if not exists public.menu_items (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  category_id text not null references public.categories(id) on delete restrict,
  name_fr text not null,
  name_en text not null,
  description_fr text not null,
  description_en text not null,
  ingredients_fr text not null default '',
  ingredients_en text not null default '',
  price_fc numeric(12, 0) not null check (price_fc >= 0),
  image_url text not null default '',
  is_available boolean not null default true,
  is_popular boolean not null default false,
  is_specialty boolean not null default false,
  spice_level smallint not null default 0 check (spice_level between 0 and 3),
  prep_minutes smallint not null default 12,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure nullable/default compatibility if tables already existed from an earlier version
alter table public.restaurants alter column hero_image set default '';
alter table public.menu_items alter column image_url set default '';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- PERFORMANCE INDEXES
create index if not exists idx_menu_items_restaurant_id on public.menu_items(restaurant_id);
create index if not exists idx_menu_items_category_id on public.menu_items(category_id);
create index if not exists idx_categories_restaurant_id on public.categories(restaurant_id);
create index if not exists idx_profiles_restaurant_id on public.profiles(restaurant_id);
create index if not exists idx_profiles_email_lower on public.profiles(lower(email));

-- AUTOMATIC UPDATED_AT TRIGGER
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_restaurants_updated_at on public.restaurants;
create trigger trg_restaurants_updated_at
  before update on public.restaurants
  for each row execute function public.set_updated_at();

drop trigger if exists trg_menu_items_updated_at on public.menu_items;
create trigger trg_menu_items_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- HELPER SECURITY FUNCTIONS
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and lower(trim(role)) = 'super_admin'
      and is_active = true
  );
$$;

create or replace function public.owns_restaurant(target_restaurant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and lower(trim(role)) = 'restaurateur'
      and restaurant_id = target_restaurant_id
      and is_active = true
  );
$$;

-- AUTO-BOOTSTRAP SUPER ADMIN PROFILE FOR eliseebyad32@gmail.com ON AUTH SIGNUP
create or replace function public.handle_designated_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.email, '')) = 'eliseebyad32@gmail.com' then
    insert into public.profiles (id, full_name, email, role, restaurant_id, is_active)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', 'Super Admin SMARTMENU QR'),
      new.email,
      'super_admin',
      null,
      true
    )
    on conflict (id) do update
      set role = 'super_admin',
          restaurant_id = null,
          is_active = true,
          email = excluded.email;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_super_admin on auth.users;
create trigger on_auth_user_created_super_admin
  after insert on auth.users
  for each row execute function public.handle_designated_super_admin();

-- ENABLE ROW LEVEL SECURITY
alter table public.restaurants enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.menu_items enable row level security;

-- EXPLICIT POSTGRESQL PRIVILEGES (REQUIRED FOR ANON & AUTHENTICATED UNDER RLS)
grant usage on schema public to anon, authenticated;
grant select on public.restaurants, public.categories, public.menu_items to anon, authenticated;
grant insert, update, delete on public.restaurants, public.categories, public.menu_items to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant execute on function public.is_super_admin() to anon, authenticated;
grant execute on function public.owns_restaurant(text) to anon, authenticated;

-- RLS POLICIES: RESTAURANTS
drop policy if exists "Public can read active restaurants" on public.restaurants;
create policy "Public can read active restaurants"
  on public.restaurants for select
  using (is_active = true or public.is_super_admin() or public.owns_restaurant(id));

drop policy if exists "Super admins can insert restaurants" on public.restaurants;
create policy "Super admins can insert restaurants"
  on public.restaurants for insert
  with check (public.is_super_admin());

drop policy if exists "Super admins or assigned restaurateur can update restaurant" on public.restaurants;
create policy "Super admins or assigned restaurateur can update restaurant"
  on public.restaurants for update
  using (public.is_super_admin() or public.owns_restaurant(id))
  with check (public.is_super_admin() or public.owns_restaurant(id));

drop policy if exists "Super admins can delete restaurants" on public.restaurants;
create policy "Super admins can delete restaurants"
  on public.restaurants for delete
  using (public.is_super_admin());

-- RLS POLICIES: PROFILES
drop policy if exists "Users can view own profile or super admin views all" on public.profiles;
create policy "Users can view own profile or super admin views all"
  on public.profiles for select
  using (id = auth.uid() or public.is_super_admin());

drop policy if exists "Only super admins manage profiles" on public.profiles;
create policy "Only super admins manage profiles"
  on public.profiles for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- RLS POLICIES: CATEGORIES
drop policy if exists "Public can read categories" on public.categories;
create policy "Public can read categories"
  on public.categories for select
  using (
    restaurant_id is null
    or exists (
      select 1 from public.restaurants r
      where r.id = restaurant_id
        and (r.is_active = true or public.is_super_admin() or public.owns_restaurant(r.id))
    )
  );

drop policy if exists "Owners or super admin manage categories" on public.categories;
create policy "Owners or super admin manage categories"
  on public.categories for all
  using (
    public.is_super_admin()
    or (restaurant_id is not null and public.owns_restaurant(restaurant_id))
  )
  with check (
    public.is_super_admin()
    or (restaurant_id is not null and public.owns_restaurant(restaurant_id))
  );

-- RLS POLICIES: MENU ITEMS
drop policy if exists "Public can read menu items of active restaurants" on public.menu_items;
create policy "Public can read menu items of active restaurants"
  on public.menu_items for select
  using (
    exists (
      select 1 from public.restaurants r
      where r.id = restaurant_id
        and (r.is_active = true or public.is_super_admin() or public.owns_restaurant(r.id))
    )
  );

drop policy if exists "Restaurateur manages own menu items or super admin manages all" on public.menu_items;
create policy "Restaurateur manages own menu items or super admin manages all"
  on public.menu_items for all
  using (public.is_super_admin() or public.owns_restaurant(restaurant_id))
  with check (public.is_super_admin() or public.owns_restaurant(restaurant_id));

-- STORAGE BUCKET FOR LOGOS & DISH PHOTOS
insert into storage.buckets (id, name, public)
values ('restaurant-assets', 'restaurant-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read access for restaurant assets" on storage.objects;
create policy "Public read access for restaurant assets"
  on storage.objects for select
  using (bucket_id = 'restaurant-assets');

drop policy if exists "Authenticated owners upload within their restaurant folder" on storage.objects;
create policy "Authenticated owners upload within their restaurant folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'restaurant-assets'
    and (
      public.is_super_admin()
      or public.owns_restaurant((storage.foldername(name))[1])
    )
  );

drop policy if exists "Authenticated owners update within their restaurant folder" on storage.objects;
create policy "Authenticated owners update within their restaurant folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and (
      public.is_super_admin()
      or public.owns_restaurant((storage.foldername(name))[1])
    )
  )
  with check (
    bucket_id = 'restaurant-assets'
    and (
      public.is_super_admin()
      or public.owns_restaurant((storage.foldername(name))[1])
    )
  );

drop policy if exists "Authenticated owners delete within their restaurant folder" on storage.objects;
create policy "Authenticated owners delete within their restaurant folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'restaurant-assets'
    and (
      public.is_super_admin()
      or public.owns_restaurant((storage.foldername(name))[1])
    )
  );
