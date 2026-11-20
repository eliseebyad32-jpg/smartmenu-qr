import { Category, MenuItem, Restaurant } from '../types/menu';
import {
  clearOutbox,
  loadOutbox,
  PendingSyncMutation,
  PlatformState,
  replaceOutbox,
  savePlatformState,
  setLastSyncedAt,
} from './offlineStore';

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'conflict' | 'error';

export interface LocalServerInfo {
  active: boolean;
  port?: number;
  lanUrls?: string[];
  primaryLanUrl?: string;
  configuredPublicUrl?: string | null;
  restaurantId?: string | null;
  restaurantSlug?: string | null;
  lastCloudSyncAt?: string | null;
}

export interface SyncResult {
  status: SyncStatus;
  mergedState?: PlatformState;
  serverConflictState?: PlatformState;
  pendingCount: number;
  lastSyncedAt?: string;
  errorMessage?: string;
  localServerActive?: boolean;
}

export async function fetchLocalServerInfo(): Promise<LocalServerInfo> {
  if (typeof window === 'undefined') return { active: false };
  try {
    const res = await fetch('/api/server-info', {
      method: 'GET',
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return { active: false };
    }
    const body = (await res.json()) as Partial<LocalServerInfo> & { ok?: boolean };
    if (!body.ok) return { active: false };
    return {
      active: true,
      port: body.port,
      lanUrls: body.lanUrls,
      primaryLanUrl: body.primaryLanUrl,
      configuredPublicUrl: body.configuredPublicUrl,
      restaurantId: body.restaurantId,
      restaurantSlug: body.restaurantSlug,
      lastCloudSyncAt: body.lastCloudSyncAt,
    };
  } catch {
    return { active: false };
  }
}

export async function uploadAssetToLocalServer(
  restaurantId: string,
  folder: 'dishes' | 'logos',
  fileName: string,
  dataUrl: string
): Promise<string | null> {
  try {
    const res = await fetch('/api/assets/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId, folder, fileName, dataUrl }),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    const data = (await res.json()) as { url?: string };
    return data.url || null;
  } catch {
    return null;
  }
}

async function resolveImageForCloudSync(
  rawUrl: string,
  restaurantId: string,
  folder: 'dishes' | 'logos',
  entityId: string,
  uploadFn: (
    restId: string,
    dir: 'dishes' | 'logos',
    fileName: string,
    blob: Blob,
    contentType?: string
  ) => Promise<string>
): Promise<string> {
  if (!rawUrl) return '';
  if (!rawUrl.startsWith('data:') && !rawUrl.startsWith('/local-uploads/')) {
    return rawUrl;
  }
  const response = await fetch(rawUrl);
  if (!response.ok) {
    throw new Error('Impossible de lire le média local pour synchronisation');
  }
  const blob = await response.blob();
  const mime = blob.type || 'image/jpeg';
  const ext = mime.includes('webp') ? 'webp' : mime.includes('png') ? 'png' : 'jpg';
  return uploadFn(restaurantId, folder, `${entityId}.${ext}`, blob, mime);
}

/**
 * Replays queued offline mutations against Supabase (including deferred image uploads
 * to Supabase Storage), prevents duplicate records via upsert, detects timestamp conflicts,
 * and preserves un-synced mutations safely if the network drops mid-way.
 */
export async function syncPendingOutboxWithSupabase(
  localState: PlatformState,
  forceOverwrite = false
): Promise<SyncResult> {
  const outbox = await loadOutbox();
  if (outbox.length === 0) {
    return {
      status: 'online',
      pendingCount: 0,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      status: 'offline',
      pendingCount: outbox.length,
    };
  }

  const sb = await import('./supabaseData');

  try {
    const cloud = await sb.fetchSupabaseCatalog(true);

    if (!forceOverwrite) {
      for (const mut of outbox) {
        if (mut.isNew || mut.operation === 'delete' || !mut.baseUpdatedAt) continue;

        if (mut.entityType === 'menu_item' && mut.entityId) {
          const remoteItem = cloud.menuItems.find((m) => m.id === mut.entityId);
          if (remoteItem?.updatedAt && remoteItem.updatedAt > mut.baseUpdatedAt) {
            return {
              status: 'conflict',
              serverConflictState: {
                restaurants: cloud.restaurants,
                categories: cloud.categories,
                menuItems: cloud.menuItems,
                users: cloud.users ?? localState.users,
                updatedAt: new Date().toISOString(),
              },
              pendingCount: outbox.length,
              errorMessage: 'Conflit détecté sur un plat modifié hors ligne et en ligne.',
            };
          }
        } else if (mut.entityType === 'restaurant' && mut.entityId) {
          const remoteRest = cloud.restaurants.find((r) => r.id === mut.entityId);
          if (remoteRest?.updatedAt && remoteRest.updatedAt > mut.baseUpdatedAt) {
            return {
              status: 'conflict',
              serverConflictState: {
                restaurants: cloud.restaurants,
                categories: cloud.categories,
                menuItems: cloud.menuItems,
                users: cloud.users ?? localState.users,
                updatedAt: new Date().toISOString(),
              },
              pendingCount: outbox.length,
              errorMessage: 'Conflit détecté sur les paramètres du restaurant.',
            };
          }
        }
      }
    }

    let remaining: PendingSyncMutation[] = [...outbox];
    let updatedRestaurants = [...localState.restaurants];
    let updatedItems = [...localState.menuItems];

    for (const mut of outbox) {
      try {
        if (mut.entityType === 'category' && mut.operation === 'upsert' && mut.payload) {
          await sb.insertCategoryInSupabase(mut.payload as Category);
        } else if (mut.entityType === 'restaurant' && mut.operation === 'upsert' && mut.payload) {
          const draft = mut.payload as Restaurant;
          const syncedLogo = draft.logoUrl
            ? await resolveImageForCloudSync(
                draft.logoUrl,
                draft.id,
                'logos',
                'logo',
                sb.uploadAssetToSupabaseStorage
              )
            : '';
          const saved = await sb.upsertRestaurantInSupabase(
            { ...draft, logoUrl: syncedLogo },
            Boolean(mut.isNew)
          );
          updatedRestaurants = updatedRestaurants.map((r) => (r.id === saved.id ? saved : r));
        } else if (mut.entityType === 'menu_item') {
          if (mut.operation === 'delete' && mut.entityId) {
            await sb.deleteMenuItemInSupabase(mut.entityId);
          } else if (mut.operation === 'toggle_availability' && mut.entityId && mut.payload) {
            const p = mut.payload as { isAvailable: boolean };
            await sb.toggleMenuItemAvailabilityInSupabase(mut.entityId, p.isAvailable);
          } else if (mut.operation === 'upsert' && mut.payload) {
            const draft = mut.payload as MenuItem;
            const syncedImage = draft.image
              ? await resolveImageForCloudSync(
                  draft.image,
                  draft.restaurantId,
                  'dishes',
                  draft.id,
                  sb.uploadAssetToSupabaseStorage
                )
              : '';
            const saved = await sb.upsertMenuItemInSupabase(
              { ...draft, image: syncedImage },
              Boolean(mut.isNew)
            );
            updatedItems = updatedItems.map((m) => (m.id === saved.id ? saved : m));
          }
        }

        remaining = remaining.filter((entry) => entry.id !== mut.id);
        await replaceOutbox(remaining);
      } catch (err) {
        // Keep remaining mutations safely in IndexedDB on failure
        await replaceOutbox(remaining);
        return {
          status: 'error',
          pendingCount: remaining.length,
          errorMessage: err instanceof Error ? err.message : 'Erreur de synchronisation Supabase',
        };
      }
    }

    sb.invalidateSupabaseCatalogCache();
    const freshCloud = await sb.fetchSupabaseCatalog(true);
    const now = new Date().toISOString();
    setLastSyncedAt(now);

    const committed = await savePlatformState({
      restaurants: freshCloud.restaurants,
      categories: freshCloud.categories,
      menuItems: freshCloud.menuItems,
      users: freshCloud.users ?? localState.users,
      updatedAt: now,
      baseUpdatedAt: now,
    });
    await clearOutbox();

    return {
      status: 'online',
      mergedState: committed,
      pendingCount: 0,
      lastSyncedAt: now,
    };
  } catch (err) {
    return {
      status: 'error',
      pendingCount: outbox.length,
      errorMessage: err instanceof Error ? err.message : 'Erreur de synchronisation cloud',
    };
  }
}

/**
 * Attempts to synchronize local IndexedDB state with a local Windows LAN server (/api/catalog)
 * when present, preserving pending mutations safely in IndexedDB if offline or on error,
 * and surfacing 409 conflicts explicitly so data is never silently lost.
 */
export async function syncWithServer(
  localState: PlatformState,
  forceOverwrite = false,
  options?: { lastCloudSyncAt?: string | null; pushOnlyToLocal?: boolean }
): Promise<SyncResult> {
  const outbox = await loadOutbox();

  if (typeof navigator !== 'undefined' && !navigator.onLine && typeof window !== 'undefined') {
    // Still probe local LAN server even when browser thinks there's no WAN Internet:
    // on a restaurant Wi-Fi without Internet, /api/health on the local PC IP can still respond!
    const probeLocal = await fetchLocalServerInfo();
    if (!probeLocal.active) {
      return {
        status: 'offline',
        pendingCount: outbox.length,
        localServerActive: false,
      };
    }
  }

  try {
    const healthRes = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
    });

    const contentType = healthRes.headers.get('content-type') || '';
    if (!healthRes.ok || !contentType.includes('application/json')) {
      return {
        status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
        pendingCount: outbox.length,
        lastSyncedAt: new Date().toISOString(),
        localServerActive: false,
      };
    }

    // Push local catalog to Windows LAN PC server when needed
    if (outbox.length > 0 || options?.pushOnlyToLocal || forceOverwrite) {
      const pushRes = await fetch('/api/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: localState,
          baseUpdatedAt: forceOverwrite ? undefined : localState.baseUpdatedAt,
          lastCloudSyncAt: options?.lastCloudSyncAt,
        }),
      });

      if (pushRes.status === 409) {
        const conflictBody = (await pushRes.json()) as { serverState?: PlatformState };
        return {
          status: 'conflict',
          serverConflictState: conflictBody.serverState,
          pendingCount: outbox.length,
          localServerActive: true,
          errorMessage: 'Conflit détecté entre les modifications locales et le serveur local.',
        };
      }

      if (!pushRes.ok) {
        return {
          status: 'error',
          pendingCount: outbox.length,
          localServerActive: true,
          errorMessage: `Local LAN sync failed (${pushRes.status})`,
        };
      }

      const saved = (await pushRes.json()) as { state: PlatformState };
      const committed = await savePlatformState({
        ...saved.state,
        baseUpdatedAt: saved.state.updatedAt,
      });

      if (!options?.pushOnlyToLocal) {
        await clearOutbox();
      }
      const now = new Date().toISOString();
      setLastSyncedAt(now);

      return {
        status: 'online',
        mergedState: committed,
        pendingCount: options?.pushOnlyToLocal ? outbox.length : 0,
        lastSyncedAt: now,
        localServerActive: true,
      };
    }

    // Pull latest state from local PC LAN server if newer than browser cache
    const pullRes = await fetch('/api/catalog', { cache: 'no-store' });
    if (pullRes.ok) {
      const body = (await pullRes.json()) as { state?: PlatformState };
      if (
        body.state &&
        body.state.restaurants?.length > 0 &&
        (!localState.restaurants.length || body.state.updatedAt > localState.updatedAt)
      ) {
        const updatedLocal = await savePlatformState({
          ...body.state,
          baseUpdatedAt: body.state.updatedAt,
        });
        const now = new Date().toISOString();
        setLastSyncedAt(now);
        return {
          status: 'online',
          mergedState: updatedLocal,
          pendingCount: 0,
          lastSyncedAt: now,
          localServerActive: true,
        };
      }
    }

    return {
      status: 'online',
      pendingCount: outbox.length,
      lastSyncedAt: new Date().toISOString(),
      localServerActive: true,
    };
  } catch (err) {
    return {
      status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error',
      pendingCount: outbox.length,
      localServerActive: false,
      errorMessage: err instanceof Error ? err.message : 'Network sync error',
    };
  }
}
