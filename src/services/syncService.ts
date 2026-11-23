import { Category, MenuItem, PlatformUser, Restaurant } from '../types/menu';
import {
  clearOutbox,
  loadOutbox,
  PendingSyncMutation,
  PlatformState,
  replaceOutbox,
  savePlatformState,
  setLastSyncedAt,
} from './offlineStore';

const LEGACY_LOCAL_AUTH_TOKEN_KEY = 'smartmenu_qr_local_token_v1';
let memoryLocalAuthToken: string | null = null;

// Purge any legacy browser sessionStorage token on startup
if (typeof window !== 'undefined') {
  try {
    window.sessionStorage.removeItem(LEGACY_LOCAL_AUTH_TOKEN_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function getLocalAuthToken(): string | null {
  return memoryLocalAuthToken;
}

function setLocalAuthToken(token: string | null): void {
  memoryLocalAuthToken = token;
}

export function clearLocalAuthToken(): void {
  setLocalAuthToken(null);
}

function buildLocalAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getLocalAuthToken();
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'conflict' | 'error';

export interface LocalServerInfo {
  active: boolean;
  port?: number;
  lanUrls?: string[];
  primaryLanUrl?: string;
  configuredPublicUrl?: string | null;
  restaurantId?: string | null;
  restaurantSlug?: string | null;
  pinConfigured?: boolean;
  lastCloudSyncAt?: string | null;
}

export interface LocalAuthStatus {
  pinConfigured: boolean;
  authenticated: boolean;
  role: 'super_admin' | 'restaurateur' | null;
  restaurantId: string | null;
  expiresAt: string | null;
  localhostSetupAllowed: boolean;
}

export interface LocalAuthResult {
  ok: boolean;
  error?: string;
  retryAfterSeconds?: number;
  remainingAttempts?: number;
  role?: 'restaurateur' | 'super_admin';
  restaurantId?: string | null;
}

export interface SyncResult {
  status: SyncStatus;
  mergedState?: PlatformState;
  serverConflictState?: PlatformState;
  pendingCount: number;
  lastSyncedAt?: string;
  errorMessage?: string;
  localServerActive?: boolean;
  localAuthRequired?: boolean;
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
      pinConfigured: body.pinConfigured,
      lastCloudSyncAt: body.lastCloudSyncAt,
    };
  } catch {
    return { active: false };
  }
}

export async function fetchLocalAuthStatus(): Promise<LocalAuthStatus | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch('/api/auth/local-status', {
      method: 'GET',
      headers: buildLocalAuthHeaders(),
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) return null;
    const data = (await res.json()) as LocalAuthStatus & { ok?: boolean };
    if (!data.ok) return null;
    if (!data.authenticated && getLocalAuthToken()) {
      clearLocalAuthToken();
    }
    return {
      pinConfigured: Boolean(data.pinConfigured),
      authenticated: Boolean(data.authenticated),
      role: data.role ?? null,
      restaurantId: data.restaurantId ?? null,
      expiresAt: data.expiresAt ?? null,
      localhostSetupAllowed: Boolean(data.localhostSetupAllowed),
    };
  } catch {
    return null;
  }
}

export async function setupLocalServerPin(
  pin: string,
  currentPin?: string,
  restaurantId?: string
): Promise<LocalAuthResult> {
  try {
    const res = await fetch('/api/auth/setup-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, currentPin, restaurantId }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      retryAfterSeconds?: number;
      remainingAttempts?: number;
      restaurantId?: string | null;
    };
    if (!res.ok || !body.ok) {
      return {
        ok: false,
        error: body.error || `HTTP ${res.status}`,
        retryAfterSeconds: body.retryAfterSeconds,
        remainingAttempts: body.remainingAttempts,
      };
    }
    return {
      ok: true,
      restaurantId: body.restaurantId ?? null,
    };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function loginLocalServerWithPin(
  pin: string,
  restaurantId?: string
): Promise<LocalAuthResult> {
  try {
    const res = await fetch('/api/auth/local-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, restaurantId }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      token?: string;
      role?: 'restaurateur' | 'super_admin';
      restaurantId?: string | null;
      error?: string;
      retryAfterSeconds?: number;
      remainingAttempts?: number;
    };
    if (!res.ok || !body.ok || !body.token) {
      return {
        ok: false,
        error: body.error || `HTTP ${res.status}`,
        retryAfterSeconds: body.retryAfterSeconds,
        remainingAttempts: body.remainingAttempts,
      };
    }
    setLocalAuthToken(body.token);
    return {
      ok: true,
      role: body.role ?? 'restaurateur',
      restaurantId: body.restaurantId ?? null,
    };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export interface LocalServerAccountAuthStatus {
  hasSuperAdmin: boolean;
  authenticated: boolean;
  user: PlatformUser | null;
}

export async function fetchLocalServerAuthStatus(): Promise<LocalServerAccountAuthStatus | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch('/api/auth/status', {
      method: 'GET',
      headers: buildLocalAuthHeaders(),
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) return null;
    const data = (await res.json()) as Partial<LocalServerAccountAuthStatus> & { ok?: boolean };
    if (!data.ok) return null;
    return {
      hasSuperAdmin: Boolean(data.hasSuperAdmin),
      authenticated: Boolean(data.authenticated),
      user: data.user ?? null,
    };
  } catch {
    return null;
  }
}

export async function setupLocalServerSuperAdmin(payload: {
  username: string;
  name: string;
  password: string;
  email?: string;
}): Promise<{ ok: boolean; user?: PlatformUser; error?: string }> {
  try {
    const res = await fetch('/api/auth/setup-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      token?: string;
      user?: PlatformUser;
      error?: string;
    };
    if (!res.ok || !body.ok || !body.token || !body.user) {
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    setLocalAuthToken(body.token);
    return { ok: true, user: body.user };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function loginLocalServerAccount(
  identifier: string,
  password: string
): Promise<{
  ok: boolean;
  user?: PlatformUser;
  error?: string;
  retryAfterSeconds?: number;
}> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      token?: string;
      user?: PlatformUser;
      error?: string;
      retryAfterSeconds?: number;
    };
    if (!res.ok || !body.ok || !body.token || !body.user) {
      return {
        ok: false,
        error: body.error || `HTTP ${res.status}`,
        retryAfterSeconds: body.retryAfterSeconds,
      };
    }
    setLocalAuthToken(body.token);
    return { ok: true, user: body.user };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function fetchLocalServerCurrentUser(): Promise<PlatformUser | null> {
  const token = getLocalAuthToken();
  if (!token) return null;
  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      headers: buildLocalAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) {
      clearLocalAuthToken();
      return null;
    }
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; user?: PlatformUser };
    return body.ok && body.user ? body.user : null;
  } catch {
    return null;
  }
}

export async function updateOwnLocalCredentials(payload: {
  username: string;
  email?: string;
  password?: string;
  name?: string;
}): Promise<{ ok: boolean; user?: PlatformUser; error?: string }> {
  try {
    const res = await fetch('/api/auth/change-credentials', {
      method: 'POST',
      headers: buildLocalAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      user?: PlatformUser;
      error?: string;
    };
    if (!res.ok || !body.ok || !body.user) {
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    return { ok: true, user: body.user };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function changeOwnLocalPassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: buildLocalAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function listLocalServerUsers(): Promise<PlatformUser[]> {
  try {
    const res = await fetch('/api/admin/users', {
      method: 'GET',
      headers: buildLocalAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; users?: PlatformUser[] };
    return body.ok && Array.isArray(body.users) ? body.users : [];
  } catch {
    return [];
  }
}

export async function createLocalServerOwner(payload: {
  username: string;
  name: string;
  password: string;
  restaurantId: string;
  email?: string;
}): Promise<{ ok: boolean; user?: PlatformUser; error?: string }> {
  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: buildLocalAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      user?: PlatformUser;
      error?: string;
    };
    if (!res.ok || !body.ok || !body.user) {
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    return { ok: true, user: body.user };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function updateLocalServerUser(payload: {
  userId: string;
  username: string;
  name: string;
  email?: string;
  restaurantId: string | null;
}): Promise<{ ok: boolean; user?: PlatformUser; error?: string }> {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(payload.userId)}`, {
      method: 'PATCH',
      headers: buildLocalAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username: payload.username,
        name: payload.name,
        email: payload.email,
        restaurantId: payload.restaurantId,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      user?: PlatformUser;
      error?: string;
    };
    if (!res.ok || !body.ok || !body.user) {
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    return { ok: true, user: body.user };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function resetLocalServerUserPassword(
  userId: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
      method: 'PATCH',
      headers: buildLocalAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ newPassword }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function toggleLocalServerUserActive(
  userId: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PATCH',
      headers: buildLocalAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ isActive }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function reassignLocalServerOwner(
  userId: string,
  restaurantId: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/restaurant`, {
      method: 'PATCH',
      headers: buildLocalAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ restaurantId }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function logoutLocalServer(): Promise<void> {
  const token = getLocalAuthToken();
  clearLocalAuthToken();
  if (!token) return;
  try {
    await Promise.allSettled([
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch('/api/auth/local-logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
  } catch {
    // Token already cleared locally
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
      headers: buildLocalAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ restaurantId, folder, fileName, dataUrl }),
    });
    if (res.status === 401) {
      clearLocalAuthToken();
      return null;
    }
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
  try {
    return await uploadFn(restaurantId, folder, `${entityId}.${ext}`, blob, mime);
  } catch {
    // Keep optimized inline data URL if Supabase Storage requires an Auth JWT
    if (rawUrl.startsWith('data:')) {
      return rawUrl;
    }
    throw new Error('Échec de téléversement média vers Storage');
  }
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
        if (mut.entityType === 'category') {
          if (mut.operation === 'delete' && mut.entityId) {
            await sb.deleteCategoryInSupabase(mut.entityId);
          } else if (mut.operation === 'upsert' && mut.payload) {
            if (mut.isNew) {
              await sb.insertCategoryInSupabase(mut.payload as Category);
            } else {
              await sb.updateCategoryInSupabase(mut.payload as Category);
            }
          }
        } else if (mut.entityType === 'restaurant') {
          if (mut.operation === 'delete' && mut.entityId) {
            await sb.deleteRestaurantInSupabase(mut.entityId);
          } else if (mut.operation === 'upsert' && mut.payload) {
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
          }
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
 * Synchronizes local IndexedDB state with the local Windows LAN server (/api/catalog)
 * when present. Public customer sessions must pass pullOnly: true so they never push writes;
 * authenticated Pro writes attach a valid Bearer token and preserve outbox on 401/403/error.
 */
export async function syncWithServer(
  localState: PlatformState,
  forceOverwrite = false,
  options?: { lastCloudSyncAt?: string | null; pushOnlyToLocal?: boolean; pullOnly?: boolean }
): Promise<SyncResult> {
  const outbox = await loadOutbox();

  if (typeof navigator !== 'undefined' && !navigator.onLine && typeof window !== 'undefined') {
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

    const canPushWrites =
      !options?.pullOnly && (outbox.length > 0 || options?.pushOnlyToLocal || forceOverwrite);

    // Push local catalog to Windows LAN PC server only for authenticated Pro flows
    if (canPushWrites) {
      const pushRes = await fetch('/api/catalog', {
        method: 'PUT',
        headers: buildLocalAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          state: localState,
          baseUpdatedAt: forceOverwrite ? undefined : localState.baseUpdatedAt,
          lastCloudSyncAt: options?.lastCloudSyncAt,
        }),
      });

      if (pushRes.status === 401 || pushRes.status === 403) {
        if (pushRes.status === 401) {
          clearLocalAuthToken();
        }
        const errBody = (await pushRes.json().catch(() => ({}))) as { error?: string };
        return {
          status: 'error',
          pendingCount: outbox.length,
          localServerActive: true,
          localAuthRequired: pushRes.status === 401,
          errorMessage: errBody.error || 'Authentification locale Pro requise.',
        };
      }

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

    // Pull latest state from local PC LAN server if newer than browser cache (safe read-only)
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
          pendingCount: outbox.length,
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
