import { Category, MenuItem, PlatformUser, Restaurant } from '../types/menu';
import { createEphemeralSupabaseClient, getSupabaseClient } from './supabaseClient';

export const RESTAURANT_ASSETS_BUCKET = 'restaurant-assets';

interface DbRestaurantRow {
  id: string;
  slug: string;
  name: string;
  city: string;
  country_fr: string;
  country_en: string;
  address_fr: string;
  address_en: string;
  hours_fr: string;
  hours_en: string;
  phone: string;
  tagline_fr: string;
  tagline_en: string;
  description_fr: string;
  description_en: string;
  demo_disclaimer_fr: string;
  demo_disclaimer_en: string;
  hero_image: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  is_active: boolean;
  is_demo: boolean;
  owner_id: string | null;
  updated_at?: string;
}

interface DbProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: 'super_admin' | 'restaurateur';
  restaurant_id: string | null;
  is_active: boolean;
}

interface DbCategoryRow {
  id: string;
  restaurant_id: string | null;
  name_fr: string;
  name_en: string;
  description_fr: string;
  description_en: string;
  sort_order: number;
}

interface DbMenuItemRow {
  id: string;
  restaurant_id: string;
  category_id: string;
  name_fr: string;
  name_en: string;
  description_fr: string;
  description_en: string;
  ingredients_fr: string;
  ingredients_en: string;
  price_fc: number | string;
  image_url: string;
  is_available: boolean;
  is_popular: boolean;
  is_specialty: boolean;
  spice_level: number;
  prep_minutes: number;
  updated_at?: string;
}

function mapRowToRestaurant(row: DbRestaurantRow): Restaurant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    city: row.city,
    country: { fr: row.country_fr || 'RDC', en: row.country_en || 'DRC' },
    address: { fr: row.address_fr || '', en: row.address_en || '' },
    hours: { fr: row.hours_fr || '', en: row.hours_en || '' },
    phone: row.phone || '',
    tagline: { fr: row.tagline_fr || '', en: row.tagline_en || '' },
    description: { fr: row.description_fr || '', en: row.description_en || '' },
    demoDisclaimer: {
      fr: row.demo_disclaimer_fr || '',
      en: row.demo_disclaimer_en || '',
    },
    heroImage: row.hero_image || '',
    logoUrl: row.logo_url || '',
    primaryColor: row.primary_color || '#DC2626',
    secondaryColor: row.secondary_color || '#F97316',
    isActive: row.is_active,
    ownerId: row.owner_id || '',
    isDemo: row.is_demo,
    updatedAt: row.updated_at,
  };
}

function mapRestaurantToRow(rest: Restaurant): Omit<DbRestaurantRow, 'owner_id'> & { owner_id?: string | null } {
  const row: Omit<DbRestaurantRow, 'owner_id'> & { owner_id?: string | null } = {
    id: rest.id,
    slug: rest.slug,
    name: rest.name,
    city: rest.city,
    country_fr: rest.country.fr,
    country_en: rest.country.en,
    address_fr: rest.address.fr,
    address_en: rest.address.en,
    hours_fr: rest.hours.fr,
    hours_en: rest.hours.en,
    phone: rest.phone,
    tagline_fr: rest.tagline.fr,
    tagline_en: rest.tagline.en,
    description_fr: rest.description.fr,
    description_en: rest.description.en,
    demo_disclaimer_fr: rest.demoDisclaimer.fr,
    demo_disclaimer_en: rest.demoDisclaimer.en,
    hero_image: rest.heroImage || '',
    logo_url: rest.logoUrl || '',
    primary_color: rest.primaryColor || '#DC2626',
    secondary_color: rest.secondaryColor || '#F97316',
    is_active: rest.isActive,
    is_demo: rest.isDemo,
  };
  if (isUuid(rest.ownerId)) {
    row.owner_id = rest.ownerId;
  }
  return row;
}

function isUuid(val: string | undefined | null): boolean {
  if (!val) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
}

function mapRowToCategory(row: DbCategoryRow): Category {
  return {
    id: row.id,
    restaurantId: row.restaurant_id ?? undefined,
    name: { fr: row.name_fr, en: row.name_en },
    description: { fr: row.description_fr || '', en: row.description_en || '' },
    order: row.sort_order ?? 10,
  };
}

function mapRowToMenuItem(row: DbMenuItemRow): MenuItem {
  const spice = Math.min(3, Math.max(0, Number(row.spice_level) || 0)) as 0 | 1 | 2 | 3;
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    categoryId: row.category_id,
    name: { fr: row.name_fr, en: row.name_en },
    description: { fr: row.description_fr, en: row.description_en },
    ingredients: { fr: row.ingredients_fr || '', en: row.ingredients_en || '' },
    priceFC: Number(row.price_fc) || 0,
    image: row.image_url || '',
    isAvailable: row.is_available,
    isPopular: row.is_popular,
    isSpecialty: row.is_specialty,
    spiceLevel: spice,
    prepMinutes: Number(row.prep_minutes) || 12,
    updatedAt: row.updated_at,
  };
}

function mapProfileToPlatformUser(row: DbProfileRow): PlatformUser {
  const normalizedRole =
    String(row.role ?? '')
      .trim()
      .toLowerCase() === 'super_admin'
      ? 'super_admin'
      : 'restaurateur';

  const isActive =
    typeof row.is_active === 'boolean'
      ? row.is_active
      : String(row.is_active).trim().toLowerCase() === 'true';

  return {
    id: row.id,
    name: (row.full_name || row.email || '').trim(),
    email: (row.email || '').trim(),
    password: '',
    role: normalizedRole,
    assignedRestaurantId: row.restaurant_id ?? null,
    isActive,
  };
}

export interface SupabaseCatalogResult {
  restaurants: Restaurant[];
  categories: Category[];
  menuItems: MenuItem[];
  users?: PlatformUser[];
}

const RESTAURANT_COLUMNS =
  'id,slug,name,city,country_fr,country_en,address_fr,address_en,hours_fr,hours_en,phone,tagline_fr,tagline_en,description_fr,description_en,demo_disclaimer_fr,demo_disclaimer_en,hero_image,logo_url,primary_color,secondary_color,is_active,is_demo,owner_id,updated_at';
const CATEGORY_COLUMNS = 'id,restaurant_id,name_fr,name_en,description_fr,description_en,sort_order';
const MENU_ITEM_COLUMNS =
  'id,restaurant_id,category_id,name_fr,name_en,description_fr,description_en,ingredients_fr,ingredients_en,price_fc,image_url,is_available,is_popular,is_specialty,spice_level,prep_minutes,updated_at';
const PROFILE_COLUMNS = 'id,full_name,email,role,restaurant_id,is_active';

const CATALOG_CACHE_TTL_MS = 10_000;
let inFlightCatalogFetch: Promise<SupabaseCatalogResult> | null = null;
let lastCatalogCache: { result: SupabaseCatalogResult; timestamp: number } | null = null;

export function invalidateSupabaseCatalogCache(): void {
  lastCatalogCache = null;
}

export async function fetchSupabaseCatalog(force = false): Promise<SupabaseCatalogResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase client is not configured');
  }

  if (
    !force &&
    lastCatalogCache &&
    Date.now() - lastCatalogCache.timestamp < CATALOG_CACHE_TTL_MS
  ) {
    return lastCatalogCache.result;
  }

  if (inFlightCatalogFetch) {
    return inFlightCatalogFetch;
  }

  inFlightCatalogFetch = (async () => {
    const [restRes, catRes, itemRes, sessionRes] = await Promise.all([
      supabase
        .from('restaurants')
        .select(RESTAURANT_COLUMNS)
        .order('created_at', { ascending: true }),
      supabase.from('categories').select(CATEGORY_COLUMNS).order('sort_order', { ascending: true }),
      supabase
        .from('menu_items')
        .select(MENU_ITEM_COLUMNS)
        .order('created_at', { ascending: false }),
      supabase.auth.getSession(),
    ]);

    if (restRes.error) throw restRes.error;
    if (catRes.error) throw catRes.error;
    if (itemRes.error) throw itemRes.error;

    let users: PlatformUser[] | undefined;
    if (sessionRes.data.session?.user) {
      const profRes = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .order('created_at', { ascending: true });
      if (!profRes.error && profRes.data) {
        users = (profRes.data as DbProfileRow[]).map(mapProfileToPlatformUser);
      }
    }

    const result: SupabaseCatalogResult = {
      restaurants: ((restRes.data || []) as DbRestaurantRow[]).map(mapRowToRestaurant),
      categories: ((catRes.data || []) as DbCategoryRow[]).map(mapRowToCategory),
      menuItems: ((itemRes.data || []) as DbMenuItemRow[]).map(mapRowToMenuItem),
      users,
    };

    lastCatalogCache = { result, timestamp: Date.now() };
    return result;
  })().finally(() => {
    inFlightCatalogFetch = null;
  });

  return inFlightCatalogFetch;
}

export async function fetchSupabaseRestaurantCatalogBySlug(
  slug: string
): Promise<SupabaseCatalogResult | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase client is not configured');
  }

  const normalizedSlug = slug.trim();
  if (!normalizedSlug) return null;

  const { data: restRow, error: restErr } = await supabase
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .eq('slug', normalizedSlug)
    .maybeSingle();

  if (restErr) throw restErr;
  if (!restRow) return null;

  const restaurant = mapRowToRestaurant(restRow as DbRestaurantRow);
  const [catRes, itemRes] = await Promise.all([
    supabase
      .from('categories')
      .select(CATEGORY_COLUMNS)
      .or(`restaurant_id.is.null,restaurant_id.eq.${restaurant.id}`)
      .order('sort_order', { ascending: true }),
    supabase
      .from('menu_items')
      .select(MENU_ITEM_COLUMNS)
      .eq('restaurant_id', restaurant.id)
      .order('created_at', { ascending: false }),
  ]);

  if (catRes.error) throw catRes.error;
  if (itemRes.error) throw itemRes.error;

  return {
    restaurants: [restaurant],
    categories: ((catRes.data || []) as DbCategoryRow[]).map(mapRowToCategory),
    menuItems: ((itemRes.data || []) as DbMenuItemRow[]).map(mapRowToMenuItem),
  };
}

export type AuthFailureReason =
  | 'invalid_credentials'
  | 'profile_missing'
  | 'profile_error'
  | 'id_mismatch'
  | 'inactive';

export interface SupabaseAuthResult {
  user: PlatformUser | null;
  reason?: AuthFailureReason;
  errorDetail?: string;
}

function formatSupabaseError(err: { code?: string; message?: string; hint?: string }): string {
  const parts = [err.code, err.message, err.hint].filter(Boolean);
  return parts.join(' — ');
}

async function resolveProfileForAuthUser(
  authUser: { id: string; email?: string | null }
): Promise<SupabaseAuthResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { user: null, reason: 'invalid_credentials' };
  }

  // 1. Primary lookup by primary key: public.profiles.id = auth.users.id
  const { data: byIdRows, error: byIdError } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, restaurant_id, is_active')
    .eq('id', authUser.id)
    .limit(1);

  if (byIdError) {
    console.error('[SmartMenu QR] Error fetching public.profiles by id:', byIdError);
    return {
      user: null,
      reason: 'profile_error',
      errorDetail: formatSupabaseError(byIdError),
    };
  }

  if (byIdRows && byIdRows.length > 0) {
    const mapped = mapProfileToPlatformUser(byIdRows[0] as DbProfileRow);
    if (!mapped.isActive) {
      return { user: null, reason: 'inactive' };
    }
    return { user: mapped };
  }

  // 2. Fallback check by email to detect auth.users.id <-> public.profiles.id mismatch
  const normalizedEmail = authUser.email?.trim().toLowerCase();
  if (normalizedEmail) {
    const { data: byEmailRows, error: byEmailError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, restaurant_id, is_active')
      .ilike('email', normalizedEmail)
      .limit(5);

    if (byEmailError) {
      console.error('[SmartMenu QR] Error checking public.profiles by email:', byEmailError);
      return {
        user: null,
        reason: 'profile_error',
        errorDetail: formatSupabaseError(byEmailError),
      };
    }

    const emailMatch = (byEmailRows || []).find(
      (row) => String(row.email ?? '').trim().toLowerCase() === normalizedEmail
    ) as DbProfileRow | undefined;

    if (emailMatch) {
      return {
        user: null,
        reason: 'id_mismatch',
        errorDetail: `auth.users.id=${authUser.id} ≠ profiles.id=${emailMatch.id}`,
      };
    }
  }

  return { user: null, reason: 'profile_missing' };
}

export async function fetchCurrentSupabaseUser(): Promise<PlatformUser | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr || !sessionData.session?.user) {
    return null;
  }

  const resolved = await resolveProfileForAuthUser(sessionData.session.user);
  return resolved.user;
}

export async function signInWithSupabase(
  email: string,
  password: string
): Promise<SupabaseAuthResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { user: null, reason: 'invalid_credentials' };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    return { user: null, reason: 'invalid_credentials' };
  }

  const resolved = await resolveProfileForAuthUser(data.user);
  if (!resolved.user) {
    await supabase.auth.signOut();
    return resolved;
  }

  return resolved;
}

export async function signOutSupabase(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function upsertRestaurantInSupabase(
  restaurant: Restaurant,
  isNew: boolean
): Promise<Restaurant> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const row = mapRestaurantToRow(restaurant);
  if (isNew) {
    const { data, error } = await supabase
      .from('restaurants')
      .upsert(row, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return mapRowToRestaurant(data as DbRestaurantRow);
  }

  const { data, error } = await supabase
    .from('restaurants')
    .update(row)
    .eq('id', restaurant.id)
    .select()
    .single();
  if (error) throw error;
  return mapRowToRestaurant(data as DbRestaurantRow);
}

export async function toggleRestaurantStatusInSupabase(
  restaurantId: string,
  isActive: boolean
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('restaurants')
    .update({ is_active: isActive })
    .eq('id', restaurantId);
  if (error) throw error;
}

export async function createOwnerAccountInSupabase(payload: {
  name: string;
  email: string;
  password: string;
  restaurantId: string;
}): Promise<PlatformUser> {
  const supabase = getSupabaseClient();
  const ephemeral = createEphemeralSupabaseClient();
  if (!supabase || !ephemeral) throw new Error('Supabase not configured');

  const { data: signUpData, error: signUpError } = await ephemeral.auth.signUp({
    email: payload.email.trim(),
    password: payload.password,
    options: {
      data: {
        full_name: payload.name.trim(),
      },
    },
  });

  if (signUpError || !signUpData.user?.id) {
    throw signUpError || new Error('Unable to register auth user');
  }

  const profileRow: DbProfileRow = {
    id: signUpData.user.id,
    full_name: payload.name.trim(),
    email: payload.email.trim(),
    role: 'restaurateur',
    restaurant_id: payload.restaurantId,
    is_active: true,
  };

  const { data: inserted, error: profError } = await supabase
    .from('profiles')
    .upsert(profileRow)
    .select()
    .single();

  if (profError) throw profError;
  return mapProfileToPlatformUser(inserted as DbProfileRow);
}

export async function toggleUserProfileActiveInSupabase(
  userId: string,
  isActive: boolean
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId);
  if (error) throw error;
}

export async function insertCategoryInSupabase(category: Category): Promise<Category> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('categories')
    .upsert(
      {
        id: category.id,
        restaurant_id: category.restaurantId ?? null,
        name_fr: category.name.fr,
        name_en: category.name.en,
        description_fr: category.description.fr || '',
        description_en: category.description.en || '',
        sort_order: category.order,
      },
      { onConflict: 'id' }
    )
    .select()
    .single();
  if (error) throw error;
  return mapRowToCategory(data as DbCategoryRow);
}

export async function upsertMenuItemInSupabase(
  item: MenuItem,
  isNew: boolean
): Promise<MenuItem> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const row: DbMenuItemRow = {
    id: item.id,
    restaurant_id: item.restaurantId,
    category_id: item.categoryId,
    name_fr: item.name.fr,
    name_en: item.name.en,
    description_fr: item.description.fr,
    description_en: item.description.en,
    ingredients_fr: item.ingredients.fr || '',
    ingredients_en: item.ingredients.en || '',
    price_fc: item.priceFC,
    image_url: item.image || '',
    is_available: item.isAvailable,
    is_popular: Boolean(item.isPopular),
    is_specialty: Boolean(item.isSpecialty),
    spice_level: item.spiceLevel ?? 0,
    prep_minutes: item.prepMinutes ?? 12,
  };

  if (isNew) {
    const { data, error } = await supabase
      .from('menu_items')
      .upsert(row, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return mapRowToMenuItem(data as DbMenuItemRow);
  }

  const { data, error } = await supabase
    .from('menu_items')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return mapRowToMenuItem(data as DbMenuItemRow);
}

export async function deleteMenuItemInSupabase(itemId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('menu_items').delete().eq('id', itemId);
  if (error) throw error;
}

export async function toggleMenuItemAvailabilityInSupabase(
  itemId: string,
  isAvailable: boolean
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('menu_items')
    .update({ is_available: isAvailable })
    .eq('id', itemId);
  if (error) throw error;
}

export async function uploadAssetToSupabaseStorage(
  restaurantId: string,
  folder: 'dishes' | 'logos',
  fileName: string,
  blob: Blob,
  contentType = 'image/jpeg'
): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const safeFile = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectPath = `${restaurantId}/${folder}/${Date.now()}-${safeFile}`;

  const { error } = await supabase.storage
    .from(RESTAURANT_ASSETS_BUCKET)
    .upload(objectPath, blob, {
      contentType,
      cacheControl: '3600',
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from(RESTAURANT_ASSETS_BUCKET)
    .getPublicUrl(objectPath);

  return data.publicUrl;
}
