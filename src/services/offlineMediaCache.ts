import { resolvePreferredImageUrl } from '../components/CulinaryImage';
import { MenuItem, Restaurant } from '../types/menu';

const LOCAL_IMAGES_CACHE = 'smartmenu-local-images-v1';
const LOCAL_UPLOADS_CACHE = 'smartmenu-local-uploads-v1';
const SUPABASE_IMAGES_CACHE = 'smartmenu-supabase-images-v1';
const CONSULTED_SLUGS_KEY = 'smartmenu_qr_consulted_slugs_v1';

interface ConsultedMenuMeta {
  slug: string;
  restaurantId: string;
  cachedAt: string;
}

function getTargetCacheName(url: string): string {
  if (url.includes('.supabase.co/storage/')) return SUPABASE_IMAGES_CACHE;
  if (url.startsWith('/local-uploads/') || url.startsWith('/local-cache/')) {
    return LOCAL_UPLOADS_CACHE;
  }
  return LOCAL_IMAGES_CACHE;
}

function isSaveDataEnabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(conn?.saveData);
}

export function recordConsultedRestaurant(restaurant: Restaurant): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(CONSULTED_SLUGS_KEY);
    const list: ConsultedMenuMeta[] = raw ? (JSON.parse(raw) as ConsultedMenuMeta[]) : [];
    const filtered = list.filter((entry) => entry.slug !== restaurant.slug);
    const next: ConsultedMenuMeta[] = [
      {
        slug: restaurant.slug,
        restaurantId: restaurant.id,
        cachedAt: new Date().toISOString(),
      },
      ...filtered,
    ].slice(0, 20);
    window.localStorage.setItem(CONSULTED_SLUGS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota restrictions
  }
}

export function getLastConsultedRestaurant(): ConsultedMenuMeta | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONSULTED_SLUGS_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw) as ConsultedMenuMeta[];
    return Array.isArray(list) && list.length > 0 ? list[0] : null;
  } catch {
    return null;
  }
}

async function cacheImageUrlIfMissing(url: string): Promise<void> {
  if (!url || url.startsWith('data:') || typeof window === 'undefined' || !('caches' in window)) {
    return;
  }

  try {
    const cacheName = getTargetCacheName(url);
    const cache = await window.caches.open(cacheName);
    const existing = await cache.match(url);
    if (existing) return;

    const isCrossOrigin = url.startsWith('http') && !url.startsWith(window.location.origin);
    const response = await fetch(url, {
      mode: isCrossOrigin ? 'cors' : 'same-origin',
      credentials: 'omit',
    });
    if (response.ok || response.type === 'opaque') {
      await cache.put(url, response.clone());
    }
  } catch {
    // Never interrupt rendering on optional offline media prefetch failure
  }
}

const activePrefetches = new Set<string>();

/**
 * Downloads and stores menu photos (hero, logo, and visible/catalog dish WebPs or Supabase assets)
 * in Cache Storage after initial render so subsequent offline QR scans render complete visuals.
 */
export function scheduleRestaurantMediaCaching(
  restaurant: Restaurant,
  items: MenuItem[]
): void {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.onLine ||
    !('caches' in window)
  ) {
    return;
  }

  recordConsultedRestaurant(restaurant);

  if (isSaveDataEnabled()) return;

  const signature = `${restaurant.id}:${items.length}:${restaurant.heroImage}:${restaurant.logoUrl ?? ''}`;
  if (activePrefetches.has(signature)) return;
  activePrefetches.add(signature);

  const urls = new Set<string>();

  if (restaurant.heroImage) {
    urls.add(resolvePreferredImageUrl(restaurant.heroImage, 'hero'));
  }
  if (restaurant.logoUrl) {
    urls.add(restaurant.logoUrl);
  }

  for (const item of items) {
    if (item.restaurantId !== restaurant.id || !item.image) continue;
    urls.add(resolvePreferredImageUrl(item.image, 'thumb'));
    urls.add(resolvePreferredImageUrl(item.image, 'medium'));
  }

  const queue = [...urls];
  const runQueue = async () => {
    const concurrency = 2;
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length > 0 && navigator.onLine) {
        const nextUrl = queue.shift();
        if (nextUrl) {
          await cacheImageUrlIfMissing(nextUrl);
        }
      }
    });
    await Promise.all(workers);
  };

  const idle = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;

  if (typeof idle === 'function') {
    idle(() => {
      void runQueue();
    }, { timeout: 2500 });
  } else {
    window.setTimeout(() => {
      void runQueue();
    }, 900);
  }
}
