-- SMARTMENU QR — Multi-Restaurant PostgreSQL Schema, Credential Security & RLS (Supabase)
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
  owner_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. PROFILES TABLE (RBAC: super_admin | restaurateur)
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  username text,
  full_name text not null,
  email text not null default '',
  role text not null check (role in ('super_admin', 'restaurateur')),
  restaurant_id text references public.restaurants(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Upgrade existing profiles/restaurants tables non-destructively so accounts can use simple usernames
-- without requiring a separate auth.users signup or valid email address.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column if not exists username text;
alter table public.profiles alter column email set default '';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.restaurants drop constraint if exists restaurants_owner_id_fkey;
update public.restaurants r
set owner_id = null
where owner_id is not null
  and not exists (select 1 from public.profiles p where p.id = r.owner_id);
alter table public.restaurants
  add constraint restaurants_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete set null;

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

-- 5. PRIVATE CREDENTIALS, SESSIONS & LOGIN RATE-LIMIT TABLES (zero direct client API access)
create table if not exists public.app_credentials (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '12 hours'),
  created_at timestamptz not null default now()
);

create table if not exists public.auth_attempts (
  attempt_key text primary key,
  fail_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Ensure nullable/default compatibility if tables already existed from an earlier version
alter table public.restaurants alter column hero_image set default '';
alter table public.menu_items alter column image_url set default '';

-- PERFORMANCE & UNIQUENESS INDEXES
create index if not exists idx_menu_items_restaurant_id on public.menu_items(restaurant_id);
create index if not exists idx_menu_items_category_id on public.menu_items(category_id);
create index if not exists idx_categories_restaurant_id on public.categories(restaurant_id);
create index if not exists idx_profiles_restaurant_id on public.profiles(restaurant_id);
create index if not exists idx_profiles_email_lower on public.profiles(lower(email));
create unique index if not exists idx_profiles_username_lower
  on public.profiles (lower(trim(username)))
  where username is not null and trim(username) <> '';
create index if not exists idx_app_sessions_profile_id on public.app_sessions(profile_id);
create index if not exists idx_app_sessions_expires_at on public.app_sessions(expires_at);

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
create or replace function public.resolve_actor_profile_id(p_session_token text default null)
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
  v_token text;
  v_token_hash text;
begin
  v_uid := auth.uid();
  if v_uid is not null then
    return v_uid;
  end if;

  v_token := nullif(trim(coalesce(p_session_token, '')), '');
  if v_token is null then
    return null;
  end if;

  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');
  select s.profile_id
    into v_uid
  from public.app_sessions s
  join public.profiles p on p.id = s.profile_id
  where s.token_hash = v_token_hash
    and s.expires_at > now()
    and p.is_active = true
  limit 1;

  return v_uid;
end;
$$;

create or replace function public.is_super_admin_actor(p_session_token text default null)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.profiles
    where id = public.resolve_actor_profile_id(p_session_token)
      and lower(trim(role)) = 'super_admin'
      and is_active = true
  );
$$;

create or replace function public.owns_restaurant_actor(
  target_restaurant_id text,
  p_session_token text default null
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.profiles
    where id = public.resolve_actor_profile_id(p_session_token)
      and lower(trim(role)) = 'restaurateur'
      and restaurant_id = target_restaurant_id
      and is_active = true
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.is_super_admin_actor(null);
$$;

create or replace function public.owns_restaurant(target_restaurant_id text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.owns_restaurant_actor(target_restaurant_id, null);
$$;

create or replace function public.serialize_profile(p public.profiles)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p.id,
    'username', coalesce(nullif(trim(p.username), ''), nullif(trim(p.email), ''), ''),
    'full_name', p.full_name,
    'email', coalesce(p.email, ''),
    'role', p.role,
    'restaurant_id', p.restaurant_id,
    'is_active', p.is_active
  );
$$;

-- AUTO-BOOTSTRAP SUPER ADMIN PROFILE FOR DESIGNATED OWNER EMAILS IF SIGNED UP VIA SUPABASE AUTH
create or replace function public.handle_designated_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.email, '')) in ('fandé@gmail.com', 'fande@gmail.com', 'eliseebyad32@gmail.com') then
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
          email = coalesce(nullif(trim(public.profiles.email), ''), excluded.email);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_super_admin on auth.users;
create trigger on_auth_user_created_super_admin
  after insert on auth.users
  for each row execute function public.handle_designated_super_admin();

-- AUTHENTICATION & FIRST-RUN SETUP RPCS
create or replace function public.get_auth_bootstrap_status()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'has_super_admin',
    exists (
      select 1 from public.profiles
      where lower(trim(role)) = 'super_admin'
        and is_active = true
    )
  );
$$;

drop function if exists public.setup_initial_super_admin(text, text, text);
create or replace function public.setup_initial_super_admin(
  p_username text,
  p_full_name text,
  p_password text,
  p_email text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_username text;
  v_full_name text;
  v_email text;
  v_profile public.profiles;
  v_token text;
begin
  -- Serialize first-run setup so only the very first request can claim Super Admin
  perform pg_advisory_xact_lock(948271);

  if exists (
    select 1 from public.profiles
    where lower(trim(role)) = 'super_admin'
      and is_active = true
  ) then
    raise exception 'Un compte Super Admin principal existe déjà.';
  end if;

  v_username := lower(trim(coalesce(p_username, '')));
  v_full_name := trim(coalesce(p_full_name, ''));
  v_email := lower(trim(coalesce(p_email, '')));
  if length(v_username) < 2 or length(v_username) > 50 then
    raise exception 'Identifiant invalide (2 à 50 caractères).';
  end if;
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'Le mot de passe doit contenir au moins 4 caractères.';
  end if;
  if v_email <> '' and position('@' in v_email) = 0 then
    raise exception 'Adresse e-mail invalide.';
  end if;
  if v_full_name = '' then
    v_full_name := v_username;
  end if;

  if exists (
    select 1 from public.profiles
    where lower(trim(username)) = v_username
       or (v_email <> '' and lower(trim(email)) = v_email)
  ) then
    raise exception 'Cet identifiant ou cette adresse e-mail est déjà utilisé.';
  end if;

  insert into public.profiles (id, username, full_name, email, role, restaurant_id, is_active)
  values (gen_random_uuid(), v_username, v_full_name, v_email, 'super_admin', null, true)
  returning * into v_profile;

  insert into public.app_credentials (profile_id, password_hash)
  values (v_profile.id, crypt(p_password, gen_salt('bf', 10)));

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.app_sessions (token_hash, profile_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), v_profile.id, now() + interval '12 hours');

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'user', public.serialize_profile(v_profile)
  );
end;
$$;

create or replace function public.login_with_identifier(
  p_identifier text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_attempt public.auth_attempts;
  v_next_fail int;
  v_locked_until timestamptz;
  v_profile public.profiles;
  v_hash text;
  v_token text;
begin
  v_key := lower(trim(coalesce(p_identifier, '')));
  if v_key = '' or coalesce(p_password, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  select * into v_attempt from public.auth_attempts where attempt_key = v_key;
  if found and v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'reason', 'locked',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_attempt.locked_until - now())))::int)
    );
  end if;

  select p.*
    into v_profile
  from public.profiles p
  where (
    (p.username is not null and lower(trim(p.username)) = v_key)
    or (p.email <> '' and lower(trim(p.email)) = v_key)
  )
  limit 1;

  if v_profile.id is not null then
    select c.password_hash
      into v_hash
    from public.app_credentials c
    where c.profile_id = v_profile.id;
  end if;

  -- Legacy Supabase Auth account that has not yet set a custom app_credentials hash:
  -- delegate verification directly to supabase.auth.signInWithPassword without penalizing auth_attempts.
  if v_profile.id is not null and v_profile.is_active and v_hash is null and position('@' in v_key) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'use_supabase_auth');
  end if;

  if v_profile.id is null or not v_profile.is_active or v_hash is null or crypt(p_password, v_hash) <> v_hash then
    v_next_fail := case
      when v_attempt.locked_until is not null and v_attempt.locked_until <= now() then 1
      else coalesce(v_attempt.fail_count, 0) + 1
    end;
    v_locked_until := case when v_next_fail >= 5 then now() + interval '5 minutes' else null end;

    insert into public.auth_attempts (attempt_key, fail_count, locked_until, updated_at)
    values (v_key, v_next_fail, v_locked_until, now())
    on conflict (attempt_key) do update
      set fail_count = excluded.fail_count,
          locked_until = excluded.locked_until,
          updated_at = now();

    if v_locked_until is not null then
      return jsonb_build_object(
        'ok', false,
        'reason', 'locked',
        'retry_after_seconds', 300
      );
    end if;

    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  delete from public.auth_attempts where attempt_key = v_key;
  delete from public.app_sessions where expires_at <= now();

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.app_sessions (token_hash, profile_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), v_profile.id, now() + interval '12 hours');

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'user', public.serialize_profile(v_profile)
  );
end;
$$;

create or replace function public.get_session_user(p_session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_actor_id uuid;
  v_profile public.profiles;
begin
  v_actor_id := public.resolve_actor_profile_id(p_session_token);
  if v_actor_id is null then
    return null;
  end if;
  select * into v_profile from public.profiles where id = v_actor_id and is_active = true;
  if not found then
    return null;
  end if;
  return public.serialize_profile(v_profile);
end;
$$;

create or replace function public.logout_session(p_session_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  v_token := nullif(trim(coalesce(p_session_token, '')), '');
  if v_token is null then
    return;
  end if;
  delete from public.app_sessions where token_hash = encode(digest(v_token, 'sha256'), 'hex');
end;
$$;

drop function if exists public.update_own_credentials(text, text, text, text);
create or replace function public.update_own_credentials(
  p_username text,
  p_new_password text default null,
  p_full_name text default null,
  p_email text default null,
  p_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor_id uuid;
  v_existing public.profiles;
  v_username text;
  v_email text;
  v_profile public.profiles;
begin
  v_actor_id := public.resolve_actor_profile_id(p_session_token);
  if v_actor_id is null then
    raise exception 'Authentification requise.';
  end if;

  select * into v_existing from public.profiles where id = v_actor_id and is_active = true;
  if not found then
    raise exception 'Compte introuvable ou suspendu.';
  end if;

  if p_new_password is not null and p_new_password <> '' and length(p_new_password) < 4 then
    raise exception 'Le mot de passe doit contenir au moins 4 caractères.';
  end if;

  if lower(trim(v_existing.role)) <> 'super_admin' then
    raise exception 'Utilisez le formulaire dédié pour modifier uniquement votre mot de passe.';
  end if;

  v_username := lower(trim(coalesce(p_username, '')));
  if length(v_username) < 2 or length(v_username) > 50 then
    raise exception 'Identifiant invalide (2 à 50 caractères).';
  end if;

  if exists (
    select 1 from public.profiles
    where lower(trim(username)) = v_username
      and id <> v_actor_id
  ) then
    raise exception 'Cet identifiant est déjà utilisé par un autre compte.';
  end if;

  if p_email is not null then
    v_email := lower(trim(p_email));
    if v_email <> '' and position('@' in v_email) = 0 then
      raise exception 'Adresse e-mail invalide.';
    end if;
    if v_email <> '' and exists (
      select 1 from public.profiles
      where lower(trim(email)) = v_email
        and id <> v_actor_id
    ) then
      raise exception 'Cette adresse e-mail est déjà utilisée par un autre compte.';
    end if;
  else
    v_email := v_existing.email;
  end if;

  update public.profiles
  set username = v_username,
      email = coalesce(v_email, email),
      full_name = coalesce(nullif(trim(coalesce(p_full_name, '')), ''), full_name),
      updated_at = now()
  where id = v_actor_id
  returning * into v_profile;

  if p_new_password is not null and p_new_password <> '' then
    insert into public.app_credentials (profile_id, password_hash, updated_at)
    values (v_actor_id, crypt(p_new_password, gen_salt('bf', 10)), now())
    on conflict (profile_id) do update
      set password_hash = excluded.password_hash,
          updated_at = now();
  end if;

  return public.serialize_profile(v_profile);
end;
$$;

create or replace function public.change_own_password(
  p_current_password text,
  p_new_password text,
  p_session_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor_id uuid;
  v_existing_hash text;
begin
  v_actor_id := public.resolve_actor_profile_id(p_session_token);
  if v_actor_id is null then
    raise exception 'Authentification requise.';
  end if;

  if length(coalesce(p_new_password, '')) < 4 then
    raise exception 'Le mot de passe doit contenir au moins 4 caractères.';
  end if;

  select password_hash into v_existing_hash
  from public.app_credentials
  where profile_id = v_actor_id;

  if found and v_existing_hash is not null then
    if coalesce(p_current_password, '') = '' or crypt(p_current_password, v_existing_hash) <> v_existing_hash then
      raise exception 'Mot de passe actuel incorrect.';
    end if;
  elsif auth.uid() is null then
    raise exception 'Session invalide pour modifier ce mot de passe.';
  end if;

  insert into public.app_credentials (profile_id, password_hash, updated_at)
  values (v_actor_id, crypt(p_new_password, gen_salt('bf', 10)), now())
  on conflict (profile_id) do update
    set password_hash = excluded.password_hash,
        updated_at = now();
end;
$$;

-- ADMIN ACCOUNT & RESTAURANT MANAGEMENT RPCS
create or replace function public.admin_list_profiles(p_session_token text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_super_admin_actor(p_session_token) then
    raise exception 'Permission denied: super_admin only';
  end if;

  return coalesce(
    (
      select jsonb_agg(public.serialize_profile(p) order by p.created_at asc)
      from public.profiles p
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_create_restaurateur(
  p_username text,
  p_full_name text,
  p_password text,
  p_restaurant_id text,
  p_email text default '',
  p_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_username text;
  v_full_name text;
  v_profile public.profiles;
begin
  if not public.is_super_admin_actor(p_session_token) then
    raise exception 'Permission denied: super_admin only';
  end if;

  v_username := lower(trim(coalesce(p_username, '')));
  v_full_name := trim(coalesce(p_full_name, ''));
  if length(v_username) < 2 or length(v_username) > 50 then
    raise exception 'Identifiant invalide (2 à 50 caractères).';
  end if;
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'Le mot de passe doit contenir au moins 4 caractères.';
  end if;
  if v_full_name = '' then
    v_full_name := v_username;
  end if;

  if not exists (select 1 from public.restaurants where id = p_restaurant_id) then
    raise exception 'Restaurant assigné introuvable.';
  end if;

  if exists (
    select 1 from public.profiles
    where lower(trim(username)) = v_username
       or (coalesce(trim(p_email), '') <> '' and lower(trim(email)) = lower(trim(p_email)))
  ) then
    raise exception 'Cet identifiant est déjà utilisé.';
  end if;

  insert into public.profiles (id, username, full_name, email, role, restaurant_id, is_active)
  values (
    gen_random_uuid(),
    v_username,
    v_full_name,
    trim(coalesce(p_email, '')),
    'restaurateur',
    p_restaurant_id,
    true
  )
  returning * into v_profile;

  insert into public.app_credentials (profile_id, password_hash)
  values (v_profile.id, crypt(p_password, gen_salt('bf', 10)));

  update public.restaurants
  set owner_id = v_profile.id
  where id = p_restaurant_id
    and owner_id is null;

  return public.serialize_profile(v_profile);
end;
$$;

create or replace function public.admin_reset_user_password(
  p_user_id uuid,
  p_new_password text,
  p_session_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_super_admin_actor(p_session_token) then
    raise exception 'Permission denied: super_admin only';
  end if;
  if length(coalesce(p_new_password, '')) < 4 then
    raise exception 'Le mot de passe doit contenir au moins 4 caractères.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Compte introuvable.';
  end if;

  insert into public.app_credentials (profile_id, password_hash, updated_at)
  values (p_user_id, crypt(p_new_password, gen_salt('bf', 10)), now())
  on conflict (profile_id) do update
    set password_hash = excluded.password_hash,
        updated_at = now();

  delete from public.app_sessions where profile_id = p_user_id;
end;
$$;

create or replace function public.admin_toggle_user_active(
  p_user_id uuid,
  p_is_active boolean,
  p_session_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor_id uuid;
begin
  if not public.is_super_admin_actor(p_session_token) then
    raise exception 'Permission denied: super_admin only';
  end if;
  v_actor_id := public.resolve_actor_profile_id(p_session_token);
  if p_user_id = v_actor_id and not p_is_active then
    raise exception 'Impossible de désactiver votre propre compte Super Admin actif.';
  end if;

  update public.profiles set is_active = p_is_active, updated_at = now() where id = p_user_id;
  if not p_is_active then
    delete from public.app_sessions where profile_id = p_user_id;
  end if;
end;
$$;

create or replace function public.admin_reassign_owner(
  p_user_id uuid,
  p_restaurant_id text,
  p_session_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rest_id text;
begin
  if not public.is_super_admin_actor(p_session_token) then
    raise exception 'Permission denied: super_admin only';
  end if;

  v_rest_id := nullif(trim(coalesce(p_restaurant_id, '')), '');

  update public.profiles
  set restaurant_id = v_rest_id,
      updated_at = now()
  where id = p_user_id
    and role = 'restaurateur';

  update public.restaurants
  set owner_id = null
  where owner_id = p_user_id
    and id is distinct from v_rest_id;

  if v_rest_id is not null then
    update public.restaurants
    set owner_id = p_user_id
    where id = v_rest_id
      and owner_id is null;
  end if;
end;
$$;

create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_username text,
  p_full_name text,
  p_email text default '',
  p_restaurant_id text default null,
  p_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existing public.profiles;
  v_username text;
  v_full_name text;
  v_email text;
  v_rest_id text;
  v_updated public.profiles;
begin
  if not public.is_super_admin_actor(p_session_token) then
    raise exception 'Permission denied: super_admin only';
  end if;

  select * into v_existing from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Compte introuvable.';
  end if;

  v_username := lower(trim(coalesce(p_username, '')));
  v_full_name := trim(coalesce(p_full_name, ''));
  v_email := lower(trim(coalesce(p_email, '')));
  v_rest_id := nullif(trim(coalesce(p_restaurant_id, '')), '');

  if length(v_username) < 2 or length(v_username) > 50 then
    raise exception 'Identifiant invalide (2 à 50 caractères).';
  end if;
  if v_email <> '' and position('@' in v_email) = 0 then
    raise exception 'Adresse e-mail invalide.';
  end if;
  if v_full_name = '' then
    v_full_name := v_username;
  end if;

  if exists (
    select 1 from public.profiles
    where lower(trim(username)) = v_username
      and id <> p_user_id
  ) then
    raise exception 'Cet identifiant est déjà utilisé.';
  end if;

  if v_email <> '' and exists (
    select 1 from public.profiles
    where lower(trim(email)) = v_email
      and id <> p_user_id
  ) then
    raise exception 'Cette adresse e-mail est déjà utilisée.';
  end if;

  if v_existing.role = 'restaurateur' and v_rest_id is not null then
    if not exists (select 1 from public.restaurants where id = v_rest_id) then
      raise exception 'Restaurant assigné introuvable.';
    end if;
  end if;

  update public.profiles
  set username = v_username,
      full_name = v_full_name,
      email = v_email,
      restaurant_id = case when role = 'restaurateur' then v_rest_id else restaurant_id end,
      updated_at = now()
  where id = p_user_id
  returning * into v_updated;

  if v_updated.role = 'restaurateur' then
    update public.restaurants
    set owner_id = null
    where owner_id = p_user_id
      and id is distinct from v_rest_id;

    if v_rest_id is not null then
      update public.restaurants
      set owner_id = p_user_id
      where id = v_rest_id
        and owner_id is null;
    end if;
  end if;

  return public.serialize_profile(v_updated);
end;
$$;

create or replace function public.admin_upsert_restaurant(
  p_row jsonb,
  p_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner_id uuid;
  v_raw_owner text;
  v_saved public.restaurants;
begin
  if not public.is_super_admin_actor(p_session_token) then
    raise exception 'Permission denied: super_admin only';
  end if;

  v_raw_owner := trim(coalesce(p_row->>'owner_id', ''));
  if v_raw_owner ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select id into v_owner_id from public.profiles where id = v_raw_owner::uuid;
  else
    v_owner_id := null;
  end if;

  insert into public.restaurants (
    id, slug, name, city, country_fr, country_en, address_fr, address_en,
    hours_fr, hours_en, phone, tagline_fr, tagline_en, description_fr, description_en,
    demo_disclaimer_fr, demo_disclaimer_en, hero_image, logo_url,
    primary_color, secondary_color, is_active, is_demo, owner_id
  )
  values (
    p_row->>'id',
    p_row->>'slug',
    p_row->>'name',
    p_row->>'city',
    coalesce(p_row->>'country_fr', 'RDC'),
    coalesce(p_row->>'country_en', 'DRC'),
    coalesce(p_row->>'address_fr', ''),
    coalesce(p_row->>'address_en', ''),
    coalesce(p_row->>'hours_fr', 'Lun – Dim : 11h00 – 23h00'),
    coalesce(p_row->>'hours_en', 'Mon – Sun: 11:00 AM – 11:00 PM'),
    coalesce(p_row->>'phone', ''),
    coalesce(p_row->>'tagline_fr', ''),
    coalesce(p_row->>'tagline_en', ''),
    coalesce(p_row->>'description_fr', ''),
    coalesce(p_row->>'description_en', ''),
    coalesce(p_row->>'demo_disclaimer_fr', ''),
    coalesce(p_row->>'demo_disclaimer_en', ''),
    coalesce(p_row->>'hero_image', ''),
    coalesce(p_row->>'logo_url', ''),
    coalesce(p_row->>'primary_color', '#DC2626'),
    coalesce(p_row->>'secondary_color', '#F97316'),
    coalesce((p_row->>'is_active')::boolean, true),
    coalesce((p_row->>'is_demo')::boolean, false),
    v_owner_id
  )
  on conflict (id) do update
    set slug = excluded.slug,
        name = excluded.name,
        city = excluded.city,
        country_fr = excluded.country_fr,
        country_en = excluded.country_en,
        address_fr = excluded.address_fr,
        address_en = excluded.address_en,
        hours_fr = excluded.hours_fr,
        hours_en = excluded.hours_en,
        phone = excluded.phone,
        tagline_fr = excluded.tagline_fr,
        tagline_en = excluded.tagline_en,
        description_fr = excluded.description_fr,
        description_en = excluded.description_en,
        demo_disclaimer_fr = excluded.demo_disclaimer_fr,
        demo_disclaimer_en = excluded.demo_disclaimer_en,
        hero_image = excluded.hero_image,
        logo_url = excluded.logo_url,
        primary_color = excluded.primary_color,
        secondary_color = excluded.secondary_color,
        is_active = excluded.is_active,
        is_demo = excluded.is_demo,
        owner_id = coalesce(excluded.owner_id, public.restaurants.owner_id)
  returning * into v_saved;

  return to_jsonb(v_saved);
end;
$$;

create or replace function public.admin_toggle_restaurant_status(
  p_restaurant_id text,
  p_is_active boolean,
  p_session_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_super_admin_actor(p_session_token) then
    raise exception 'Permission denied: super_admin only';
  end if;
  update public.restaurants set is_active = p_is_active where id = p_restaurant_id;
end;
$$;

-- ATOMIC SUPER ADMIN CASCADE DELETE FOR RESTAURANTS (avoids category on delete restrict deadlock)
drop function if exists public.delete_restaurant_cascade(text);
create or replace function public.delete_restaurant_cascade(
  target_restaurant_id text,
  p_session_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_super_admin_actor(p_session_token) then
    raise exception 'Permission denied: only super_admin can delete a restaurant';
  end if;

  delete from public.menu_items where restaurant_id = target_restaurant_id;
  delete from public.categories where restaurant_id = target_restaurant_id;
  update public.profiles set restaurant_id = null where restaurant_id = target_restaurant_id;
  delete from public.restaurants where id = target_restaurant_id;
end;
$$;

-- MENU ITEM & CATEGORY RPCS (enforcing strict per-restaurant RBAC for both session modes)
create or replace function public.manage_upsert_menu_item(
  p_row jsonb,
  p_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_item_id text;
  v_target_rest_id text;
  v_existing_rest_id text;
  v_saved public.menu_items;
begin
  v_item_id := p_row->>'id';
  v_target_rest_id := p_row->>'restaurant_id';

  if not (
    public.is_super_admin_actor(p_session_token)
    or public.owns_restaurant_actor(v_target_rest_id, p_session_token)
  ) then
    raise exception 'Permission denied for target restaurant';
  end if;

  select restaurant_id into v_existing_rest_id from public.menu_items where id = v_item_id;
  if found and v_existing_rest_id is distinct from v_target_rest_id then
    if not public.is_super_admin_actor(p_session_token) then
      raise exception 'Permission denied: cannot move item across restaurants';
    end if;
  end if;

  insert into public.menu_items (
    id, restaurant_id, category_id, name_fr, name_en,
    description_fr, description_en, ingredients_fr, ingredients_en,
    price_fc, image_url, is_available, is_popular, is_specialty,
    spice_level, prep_minutes
  )
  values (
    v_item_id,
    v_target_rest_id,
    p_row->>'category_id',
    p_row->>'name_fr',
    p_row->>'name_en',
    coalesce(p_row->>'description_fr', ''),
    coalesce(p_row->>'description_en', ''),
    coalesce(p_row->>'ingredients_fr', ''),
    coalesce(p_row->>'ingredients_en', ''),
    greatest(0, coalesce((p_row->>'price_fc')::numeric(12,0), 0)),
    coalesce(p_row->>'image_url', ''),
    coalesce((p_row->>'is_available')::boolean, true),
    coalesce((p_row->>'is_popular')::boolean, false),
    coalesce((p_row->>'is_specialty')::boolean, false),
    least(3, greatest(0, coalesce((p_row->>'spice_level')::smallint, 0))),
    greatest(1, coalesce((p_row->>'prep_minutes')::smallint, 12))
  )
  on conflict (id) do update
    set category_id = excluded.category_id,
        name_fr = excluded.name_fr,
        name_en = excluded.name_en,
        description_fr = excluded.description_fr,
        description_en = excluded.description_en,
        ingredients_fr = excluded.ingredients_fr,
        ingredients_en = excluded.ingredients_en,
        price_fc = excluded.price_fc,
        image_url = excluded.image_url,
        is_available = excluded.is_available,
        is_popular = excluded.is_popular,
        is_specialty = excluded.is_specialty,
        spice_level = excluded.spice_level,
        prep_minutes = excluded.prep_minutes
  returning * into v_saved;

  return to_jsonb(v_saved);
end;
$$;

create or replace function public.manage_delete_menu_item(
  p_item_id text,
  p_session_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rest_id text;
begin
  select restaurant_id into v_rest_id from public.menu_items where id = p_item_id;
  if not found then
    return;
  end if;

  if not (
    public.is_super_admin_actor(p_session_token)
    or public.owns_restaurant_actor(v_rest_id, p_session_token)
  ) then
    raise exception 'Permission denied';
  end if;

  delete from public.menu_items where id = p_item_id;
end;
$$;

create or replace function public.manage_toggle_item_availability(
  p_item_id text,
  p_is_available boolean,
  p_session_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rest_id text;
begin
  select restaurant_id into v_rest_id from public.menu_items where id = p_item_id;
  if not found then
    return;
  end if;

  if not (
    public.is_super_admin_actor(p_session_token)
    or public.owns_restaurant_actor(v_rest_id, p_session_token)
  ) then
    raise exception 'Permission denied';
  end if;

  update public.menu_items set is_available = p_is_available where id = p_item_id;
end;
$$;

create or replace function public.manage_upsert_category(
  p_row jsonb,
  p_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cat_id text;
  v_target_rest_id text;
  v_existing_rest_id text;
  v_has_existing boolean := false;
  v_saved public.categories;
begin
  v_cat_id := p_row->>'id';
  v_target_rest_id := nullif(trim(coalesce(p_row->>'restaurant_id', '')), '');

  if not (
    public.is_super_admin_actor(p_session_token)
    or (v_target_rest_id is not null and public.owns_restaurant_actor(v_target_rest_id, p_session_token))
  ) then
    raise exception 'Permission denied';
  end if;

  select restaurant_id into v_existing_rest_id from public.categories where id = v_cat_id;
  v_has_existing := found;
  if v_has_existing then
    if not public.is_super_admin_actor(p_session_token) and (
      v_existing_rest_id is null or v_existing_rest_id is distinct from v_target_rest_id
    ) then
      raise exception 'Permission denied: cannot modify global or foreign category';
    end if;
  end if;

  insert into public.categories (
    id, restaurant_id, name_fr, name_en, description_fr, description_en, sort_order
  )
  values (
    v_cat_id,
    v_target_rest_id,
    p_row->>'name_fr',
    p_row->>'name_en',
    coalesce(p_row->>'description_fr', ''),
    coalesce(p_row->>'description_en', ''),
    coalesce((p_row->>'sort_order')::int, 10)
  )
  on conflict (id) do update
    set name_fr = excluded.name_fr,
        name_en = excluded.name_en,
        description_fr = excluded.description_fr,
        description_en = excluded.description_en,
        sort_order = excluded.sort_order
  returning * into v_saved;

  return to_jsonb(v_saved);
end;
$$;

create or replace function public.manage_delete_category(
  p_category_id text,
  p_session_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rest_id text;
begin
  select restaurant_id into v_rest_id from public.categories where id = p_category_id;
  if not found then
    return;
  end if;

  if not (
    public.is_super_admin_actor(p_session_token)
    or (v_rest_id is not null and public.owns_restaurant_actor(v_rest_id, p_session_token))
  ) then
    raise exception 'Permission denied';
  end if;

  delete from public.categories where id = p_category_id;
end;
$$;

-- ENABLE ROW LEVEL SECURITY
alter table public.restaurants enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.app_credentials enable row level security;
alter table public.app_sessions enable row level security;
alter table public.auth_attempts enable row level security;

-- LOCK DOWN PRIVATE CREDENTIAL/SESSION TABLES COMPLETELY FROM DIRECT POSTGREST ACCESS
revoke all on public.app_credentials from public, anon, authenticated;
revoke all on public.app_sessions from public, anon, authenticated;
revoke all on public.auth_attempts from public, anon, authenticated;

-- EXPLICIT POSTGRESQL PRIVILEGES (REQUIRED FOR ANON & AUTHENTICATED UNDER RLS)
grant usage on schema public to anon, authenticated;
grant select on public.restaurants, public.categories, public.menu_items to anon, authenticated;
grant insert, update, delete on public.restaurants, public.categories, public.menu_items to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant execute on function public.is_super_admin() to anon, authenticated;
grant execute on function public.owns_restaurant(text) to anon, authenticated;
grant execute on function public.get_auth_bootstrap_status() to anon, authenticated;
grant execute on function public.setup_initial_super_admin(text, text, text, text) to anon, authenticated;
grant execute on function public.login_with_identifier(text, text) to anon, authenticated;
grant execute on function public.get_session_user(text) to anon, authenticated;
grant execute on function public.logout_session(text) to anon, authenticated;
grant execute on function public.update_own_credentials(text, text, text, text, text) to anon, authenticated;
grant execute on function public.change_own_password(text, text, text) to anon, authenticated;
grant execute on function public.admin_list_profiles(text) to anon, authenticated;
grant execute on function public.admin_create_restaurateur(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_reset_user_password(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_toggle_user_active(uuid, boolean, text) to anon, authenticated;
grant execute on function public.admin_reassign_owner(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_update_profile(uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_upsert_restaurant(jsonb, text) to anon, authenticated;
grant execute on function public.admin_toggle_restaurant_status(text, boolean, text) to anon, authenticated;
grant execute on function public.delete_restaurant_cascade(text, text) to anon, authenticated;
grant execute on function public.manage_upsert_menu_item(jsonb, text) to anon, authenticated;
grant execute on function public.manage_delete_menu_item(text, text) to anon, authenticated;
grant execute on function public.manage_toggle_item_availability(text, boolean, text) to anon, authenticated;
grant execute on function public.manage_upsert_category(jsonb, text) to anon, authenticated;
grant execute on function public.manage_delete_category(text, text) to anon, authenticated;

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
drop policy if exists "Only super admins can update restaurants" on public.restaurants;
create policy "Only super admins can update restaurants"
  on public.restaurants for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

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

create or replace function public.prevent_non_admin_profile_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    if new.role is distinct from old.role
       or new.restaurant_id is distinct from old.restaurant_id
       or new.is_active is distinct from old.is_active then
      raise exception 'Permission denied: only super_admin can change role, restaurant_id, or is_active';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_prevent_escalation on public.profiles;
create trigger trg_profiles_prevent_escalation
  before update on public.profiles
  for each row execute function public.prevent_non_admin_profile_escalation();

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
      or (
        public.owns_restaurant((storage.foldername(name))[1])
        and (storage.foldername(name))[2] = 'dishes'
      )
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
      or (
        public.owns_restaurant((storage.foldername(name))[1])
        and (storage.foldername(name))[2] = 'dishes'
      )
    )
  )
  with check (
    bucket_id = 'restaurant-assets'
    and (
      public.is_super_admin()
      or (
        public.owns_restaurant((storage.foldername(name))[1])
        and (storage.foldername(name))[2] = 'dishes'
      )
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
      or (
        public.owns_restaurant((storage.foldername(name))[1])
        and (storage.foldername(name))[2] = 'dishes'
      )
    )
  );

-- NON-DESTRUCTIVE RECONCILIATION FOR PRIMARY SUPER ADMIN (Fandé@gmail.com / eliseebyad32@gmail.com)
-- Ensures the owner account in auth.users always maps to an active super_admin profile
-- without duplicating super_admin accounts, altering their email, or deleting existing data.
do $$
declare
  v_auth_user record;
  v_stale_profile public.profiles;
begin
  select id, email, raw_user_meta_data
    into v_auth_user
  from auth.users
  where lower(email) in ('fandé@gmail.com', 'fande@gmail.com', 'eliseebyad32@gmail.com')
  order by
    case when lower(email) in ('fandé@gmail.com', 'fande@gmail.com') then 0 else 1 end,
    created_at asc
  limit 1;

  if found then
    select * into v_stale_profile
    from public.profiles
    where lower(trim(email)) = lower(trim(v_auth_user.email))
      and id <> v_auth_user.id
    limit 1;

    if found then
      update public.restaurants set owner_id = v_auth_user.id where owner_id = v_stale_profile.id;
      delete from public.profiles where id = v_stale_profile.id;
    end if;

    insert into public.profiles (id, username, full_name, email, role, restaurant_id, is_active)
    values (
      v_auth_user.id,
      coalesce(nullif(trim(v_stale_profile.username), ''), 'admin'),
      coalesce(
        nullif(trim(v_auth_user.raw_user_meta_data->>'full_name'), ''),
        nullif(trim(v_stale_profile.full_name), ''),
        'Super Admin SMARTMENU QR'
      ),
      v_auth_user.email,
      'super_admin',
      null,
      true
    )
    on conflict (id) do update
      set role = 'super_admin',
          restaurant_id = null,
          is_active = true,
          email = coalesce(nullif(trim(public.profiles.email), ''), excluded.email),
          username = coalesce(nullif(trim(public.profiles.username), ''), excluded.username);
  end if;
end
$$;
