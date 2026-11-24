import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    const entry = fs.realpathSync(path.resolve(process.argv[1]));
    const self = fs.realpathSync(fileURLToPath(metaUrl));
    return process.platform === 'win32'
      ? entry.toLowerCase() === self.toLowerCase()
      : entry === self;
  } catch {
    return pathToFileURL(path.resolve(process.argv[1])).href === metaUrl;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.SMARTMENU_DATA_DIR
  ? path.resolve(process.env.SMARTMENU_DATA_DIR)
  : path.join(__dirname, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const IMAGE_CACHE_DIR = path.join(DATA_DIR, 'image-cache');
export const IMAGE_MAP_FILE = path.join(DATA_DIR, 'image-map.json');
export const DATA_FILE = path.join(DATA_DIR, 'catalog.json');
export const AUTH_FILE = path.join(DATA_DIR, 'local-auth.json');
export const PID_FILE = path.join(DATA_DIR, 'server.pid');
export const CONFIG_FILE = process.env.SMARTMENU_CONFIG_FILE
  ? path.resolve(process.env.SMARTMENU_CONFIG_FILE)
  : path.join(__dirname, 'config.json');

// Load external Windows installer .env first (if configured), then project .env.local and .env
const externalEnvFile = process.env.SMARTMENU_ENV_FILE
  ? path.resolve(process.env.SMARTMENU_ENV_FILE)
  : null;
for (const envCandidate of [
  externalEnvFile,
  path.join(ROOT_DIR, '.env.local'),
  path.join(ROOT_DIR, '.env'),
]) {
  if (envCandidate && fs.existsSync(envCandidate)) {
    dotenv.config({ path: envCandidate, override: false });
  }
}

export function ensureDataDirectories() {
  for (const dir of [DATA_DIR, UPLOADS_DIR, IMAGE_CACHE_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function atomicWriteFile(filePath, content) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function readJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function loadLocalConfig() {
  const fileConfig = readJsonSafe(CONFIG_FILE, {});
  return {
    port: Number(process.env.LOCAL_PORT || fileConfig.port || 3000),
    restaurantId: String(process.env.RESTAURANT_ID ?? fileConfig.restaurantId ?? '').trim(),
    restaurantSlug: String(process.env.RESTAURANT_SLUG ?? fileConfig.restaurantSlug ?? '').trim(),
    publicLanUrl: String(process.env.PUBLIC_LAN_URL ?? fileConfig.publicLanUrl ?? '')
      .trim()
      .replace(/\/+$/, ''),
    supabaseUrl: String(process.env.VITE_SUPABASE_URL || fileConfig.supabaseUrl || '')
      .trim()
      .replace(/\/+$/, ''),
    supabaseAnonKey: String(
      process.env.VITE_SUPABASE_ANON_KEY || fileConfig.supabaseAnonKey || ''
    ).trim(),
    autoSyncMinutes: Number(process.env.AUTO_SYNC_MINUTES ?? fileConfig.autoSyncMinutes ?? 5),
    sessionTtlMinutes: Math.max(
      15,
      Number(process.env.LOCAL_SESSION_TTL_MINUTES ?? fileConfig.sessionTtlMinutes ?? 480)
    ),
    maxLoginAttempts: Math.max(
      3,
      Number(process.env.LOCAL_MAX_LOGIN_ATTEMPTS ?? fileConfig.maxLoginAttempts ?? 5)
    ),
    lockoutMinutes: Math.max(
      1,
      Number(process.env.LOCAL_LOCKOUT_MINUTES ?? fileConfig.lockoutMinutes ?? 15)
    ),
  };
}

export function extFromMime(mime) {
  if (!mime) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('png')) return 'png';
  if (mime.includes('svg')) return 'svg';
  return 'jpg';
}

export async function mirrorRemoteImagesToDisk(state) {
  ensureDataDirectories();
  const urls = new Set();
  for (const r of state?.restaurants || []) {
    if (r.heroImage && r.heroImage.startsWith('http')) urls.add(r.heroImage);
    if (r.logoUrl && r.logoUrl.startsWith('http')) urls.add(r.logoUrl);
  }
  for (const item of state?.menuItems || []) {
    if (item.image && item.image.startsWith('http')) urls.add(item.image);
  }
  if (urls.size === 0) return { downloaded: 0, total: 0 };

  const imageMap = readJsonSafe(IMAGE_MAP_FILE, {});
  let changed = false;
  let downloaded = 0;

  for (const url of urls) {
    if (imageMap[url] && fs.existsSync(path.join(IMAGE_CACHE_DIR, imageMap[url]))) {
      continue;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const mime = res.headers.get('content-type') || 'image/jpeg';
      if (!mime.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
      const fileName = `${hash}.${extFromMime(mime)}`;
      fs.writeFileSync(path.join(IMAGE_CACHE_DIR, fileName), buf);
      imageMap[url] = fileName;
      changed = true;
      downloaded += 1;
    } catch {
      // Skip unreachable images gracefully when offline
    }
  }

  if (changed) {
    atomicWriteFile(IMAGE_MAP_FILE, JSON.stringify(imageMap, null, 2));
  }

  return { downloaded, total: Object.keys(imageMap).length };
}

function mapDbRestaurant(row) {
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

function mapDbCategory(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id ?? undefined,
    name: { fr: row.name_fr, en: row.name_en },
    description: { fr: row.description_fr || '', en: row.description_en || '' },
    order: row.sort_order ?? 10,
  };
}

function mapDbMenuItem(row) {
  const spice = Math.min(3, Math.max(0, Number(row.spice_level) || 0));
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

async function fetchSupabaseRest(baseUrl, anonKey, resourceQuery, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const cleanBase = baseUrl.replace(/\/rest\/v1\/?$/, '');
    const res = await fetch(`${cleanBase}/rest/v1/${resourceQuery}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 180)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function pullCloudCatalogToLocal({ timeoutMs = 8000, quiet = false, force = false } = {}) {
  ensureDataDirectories();
  const cfg = loadLocalConfig();

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !cfg.supabaseUrl.startsWith('http')) {
    if (!quiet) {
      console.log('[SYNC] Supabase non configure (.env manquant) : conservation des donnees locales.');
    }
    return { ok: false, reason: 'supabase_not_configured' };
  }

  const existing = readJsonSafe(DATA_FILE, null);
  if (!force && existing?.hasPendingLocalChanges) {
    if (!quiet) {
      console.log('[SYNC] Modifications locales en attente : cache local preserve.');
    }
    return { ok: false, reason: 'local_changes_pending_preserved' };
  }

  try {
    const restFilter = cfg.restaurantId
      ? `&id=eq.${encodeURIComponent(cfg.restaurantId)}`
      : cfg.restaurantSlug
      ? `&slug=eq.${encodeURIComponent(cfg.restaurantSlug)}`
      : '';

    const restRows = await fetchSupabaseRest(
      cfg.supabaseUrl,
      cfg.supabaseAnonKey,
      `restaurants?select=*&order=created_at.asc${restFilter}`,
      timeoutMs
    );

    const restaurants = (restRows || []).map(mapDbRestaurant);

    // Never wipe an existing local snapshot if Supabase returns 0 restaurants
    if (restaurants.length === 0 && existing?.restaurants?.length > 0) {
      if (!quiet) {
        console.log('[SYNC] Aucun restaurant retourne par Supabase : cache local preserve.');
      }
      return { ok: false, reason: 'empty_cloud_preserved_local' };
    }

    const allowedIds = restaurants.map((r) => r.id);
    let catQuery = 'categories?select=*&order=sort_order.asc';
    let itemQuery = 'menu_items?select=*&order=created_at.desc';

    if (allowedIds.length === 1 && (cfg.restaurantId || cfg.restaurantSlug)) {
      const targetId = encodeURIComponent(allowedIds[0]);
      catQuery = `categories?select=*&or=(restaurant_id.is.null,restaurant_id.eq.${targetId})&order=sort_order.asc`;
      itemQuery = `menu_items?select=*&restaurant_id=eq.${targetId}&order=created_at.desc`;
    }

    const [catRows, itemRows] = await Promise.all([
      fetchSupabaseRest(cfg.supabaseUrl, cfg.supabaseAnonKey, catQuery, timeoutMs),
      fetchSupabaseRest(cfg.supabaseUrl, cfg.supabaseAnonKey, itemQuery, timeoutMs),
    ]);

    const now = new Date().toISOString();
    const nextState = {
      restaurants,
      categories: (catRows || []).map(mapDbCategory),
      menuItems: (itemRows || []).map(mapDbMenuItem),
      users: [],
      updatedAt: existing?.updatedAt && existing.updatedAt > now ? existing.updatedAt : now,
      baseUpdatedAt: now,
      lastCloudSyncAt: now,
      hasPendingLocalChanges: false,
      serverSavedAt: now,
    };

    atomicWriteFile(DATA_FILE, JSON.stringify(nextState, null, 2));
    const mirrorStats = await mirrorRemoteImagesToDisk(nextState);

    if (!quiet) {
      console.log(
        `[SYNC OK] ${nextState.restaurants.length} restaurant(s), ${nextState.categories.length} categorie(s), ${nextState.menuItems.length} plat(s), ${mirrorStats.total} image(s) en cache local.`
      );
    }

    return {
      ok: true,
      restaurantsCount: nextState.restaurants.length,
      itemsCount: nextState.menuItems.length,
      cachedImagesCount: mirrorStats.total,
      lastCloudSyncAt: now,
    };
  } catch (err) {
    if (!quiet) {
      console.log(
        `[SYNC HORS LIGNE] Supabase inaccessible (${err instanceof Error ? err.message : 'reseau'}). Donnees locales intactes.`
      );
    }
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'network_error',
    };
  }
}

if (isMainModule(import.meta.url)) {
  const quiet = process.argv.includes('--quiet');
  const timeoutArg = process.argv.find((a) => a.startsWith('--timeout='));
  const timeoutMs = timeoutArg ? Number(timeoutArg.split('=')[1]) || 6000 : 8000;
  pullCloudCatalogToLocal({ timeoutMs, quiet }).then((res) => {
    if (!quiet && res.ok) {
      process.exit(0);
    }
    // Always exit 0 on offline network error so start-windows.bat keeps starting the server cleanly
    process.exit(0);
  });
}
