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

async function cacheImageUrlIfMissing(url: string): Promise<boolean> {
  if (!url || url.startsWith('data:') || typeof window === 'undefined' || !('caches' in window)) {
    return true;
  }

  try {
    const cacheName = getTargetCacheName(url);
    const cache = await window.caches.open(cacheName);
    const existing = await cache.match(url);
    if (existing) return true;

    // Local thumbnails are already precached by Workbox under ?__WB_REVISION__
    if (url.startsWith('/src/assets/images/') && url.endsWith('-thumb.webp')) {
      const precached = await window.caches.match(url, { ignoreSearch: true });
      if (precached) return true;
    }

    const isCrossOrigin = url.startsWith('http') && !url.startsWith(window.location.origin);
    try {
      const response = await fetch(url, {
        mode: isCrossOrigin ? 'cors' : 'same-origin',
        credentials: 'omit',
      });
      if (response.ok || response.type === 'opaque') {
        await cache.put(url, response.clone());
        return true;
      }
      return false;
    } catch {
      if (!isCrossOrigin) return false;
      // Retry cross-origin images without CORS so <img> still works offline via opaque cache
      const opaqueResponse = await fetch(url, {
        mode: 'no-cors',
        credentials: 'omit',
      });
      if (opaqueResponse.type === 'opaque' || opaqueResponse.ok) {
        await cache.put(url, opaqueResponse.clone());
        return true;
      }
      return false;
    }
  } catch {
    // Never interrupt rendering on optional offline media prefetch failure
    return false;
  }
}

const activePrefetches = new Set<string>();

export function resetMediaPrefetchState(): void {
  activePrefetches.clear();
}

/**
 * Downloads and stores menu photos (hero, logo, and dish WebPs or Supabase/local assets)
 * in Cache Storage right after initial render so subsequent offline QR scans render complete visuals.
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

  const scopedItems = items.filter((item) => item.restaurantId === restaurant.id);
  const imageDigest = scopedItems.map((item) => `${item.id}:${item.image}`).join('|');
  const signature = `${restaurant.id}:${restaurant.updatedAt ?? ''}:${restaurant.heroImage}:${restaurant.logoUrl ?? ''}:${imageDigest}`;
  if (activePrefetches.has(signature)) return;
  activePrefetches.add(signature);

  const priorityUrls = new Set<string>();
  const secondaryUrls = new Set<string>();

  if (restaurant.heroImage) {
    priorityUrls.add(resolvePreferredImageUrl(restaurant.heroImage, 'hero'));
    priorityUrls.add(resolvePreferredImageUrl(restaurant.heroImage, 'thumb'));
    priorityUrls.add(restaurant.heroImage);
  }
  if (restaurant.logoUrl) {
    priorityUrls.add(restaurant.logoUrl);
  }

  for (const item of scopedItems) {
    if (!item.image) continue;
    priorityUrls.add(resolvePreferredImageUrl(item.image, 'thumb'));
    secondaryUrls.add(resolvePreferredImageUrl(item.image, 'medium'));
    if (item.image.startsWith('http') || item.image.startsWith('/local-uploads/')) {
      priorityUrls.add(item.image);
    }
  }

  const queue = [...priorityUrls, ...secondaryUrls];
  const runQueue = async () => {
    let hasFailure = false;
    const concurrency = 4;
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length > 0 && navigator.onLine) {
        const nextUrl = queue.shift();
        if (nextUrl) {
          const ok = await cacheImageUrlIfMissing(nextUrl);
          if (!ok) hasFailure = true;
        }
      }
    });
    await Promise.all(workers);
    if (hasFailure || queue.length > 0) {
      activePrefetches.delete(signature);
    }
  };

  window.setTimeout(() => {
    void runQueue();
  }, 150);
}
