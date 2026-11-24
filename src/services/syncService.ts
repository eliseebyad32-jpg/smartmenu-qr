import { Category, MenuItem, PlatformUser, Restaurant } from '../types/menu';
import { isSafeRasterDataUrl, optimizeBlobToBoundedImage } from '../utils/imageUpload';
import {
  clearOutbox,
  loadOutbox,
  PendingSyncMutation,
  PlatformState,
  recordOutboxMutationFailure,
  replaceOutbox,
  savePlatformState,
  setLastSyncedAt,
  sortOutboxForReplay,
} from './offlineStore';
import {
  canCreateRestaurant,
  canDeleteRestaurant,
  canEditRestaurant,
  canManageCategory,
  canManageMenuForRestaurant,
  canToggleRestaurantStatus,
} from './permissions';
import {
  clearRenewableRefreshToken,
  readRenewableRefreshToken,
  saveRenewableRefreshToken,
} from './secureSessionStore';

const LEGACY_LOCAL_AUTH_TOKEN_KEY = 'smartmenu_qr_local_token_v1';
let memoryLocalAuthToken: string | null = null;
let inFlightLocalRestore: Promise<{
  ok: boolean;
  user?: PlatformUser | null;
  role?: 'restaurateur' | 'super_admin';
  restaurantId?: string | null;
}> | null = null;

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
  hasPendingLocalChanges?: boolean;
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

export interface SyncConflictDetail {
  mutationId: string;
  entityType: 'restaurant' | 'menu_item';
  entityId: string;
  label: string;
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
}

export interface SyncResult {
  status: SyncStatus;
  mergedState?: PlatformState;
  serverConflictState?: PlatformState;
  conflicts?: SyncConflictDetail[];
  pendingCount: number;
  lastSyncedAt?: string;
  errorMessage?: string;
  localServerActive?: boolean;
  localAuthRequired?: boolean;
  retryable?: boolean;
  nextRetryAt?: string;
}

let lastKnownLocalServerVersion: string | null = null;

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
      hasPendingLocalChanges: Boolean(body.hasPendingLocalChanges),
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
      refreshToken?: string;
      refreshExpiresAt?: string;
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
    if (body.refreshToken) {
      await saveRenewableRefreshToken('local_server', body.refreshToken, body.refreshExpiresAt);
    }
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
  localhostSetupAllowed?: boolean;
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
      localhostSetupAllowed: Boolean(data.localhostSetupAllowed),
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
      refreshToken?: string;
      refreshExpiresAt?: string;
      user?: PlatformUser;
      error?: string;
    };
    if (!res.ok || !body.ok || !body.token || !body.user) {
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    setLocalAuthToken(body.token);
    if (body.refreshToken) {
      await saveRenewableRefreshToken('local_server', body.refreshToken, body.refreshExpiresAt);
    }
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
      refreshToken?: string;
      refreshExpiresAt?: string;
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
    if (body.refreshToken) {
      await saveRenewableRefreshToken('local_server', body.refreshToken, body.refreshExpiresAt);
    }
    return { ok: true, user: body.user };
  } catch {
    return { ok: false, error: 'Serveur local inaccessible.' };
  }
}

export async function restoreLocalServerSession(): Promise<{
  ok: boolean;
  user?: PlatformUser | null;
  role?: 'restaurateur' | 'super_admin';
  restaurantId?: string | null;
}> {
  if (typeof window === 'undefined') return { ok: false };
  if (inFlightLocalRestore) return inFlightLocalRestore;

  inFlightLocalRestore = (async () => {
    const currentAccess = getLocalAuthToken();
    if (currentAccess) {
      try {
        const meRes = await fetch('/api/auth/me', {
          method: 'GET',
          headers: buildLocalAuthHeaders(),
          cache: 'no-store',
        });
        if (meRes.ok) {
          const meBody = (await meRes.json().catch(() => ({}))) as {
            ok?: boolean;
            user?: PlatformUser;
          };
          if (meBody.ok && meBody.user) {
            return {
              ok: true,
              user: meBody.user,
              role: meBody.user.role,
              restaurantId: meBody.user.assignedRestaurantId ?? null,
            };
          }
        }
        const statusRes = await fetch('/api/auth/local-status', {
          method: 'GET',
          headers: buildLocalAuthHeaders(),
          cache: 'no-store',
        });
        if (statusRes.ok) {
          const st = (await statusRes.json().catch(() => ({}))) as {
            ok?: boolean;
            authenticated?: boolean;
            role?: 'restaurateur' | 'super_admin' | null;
            restaurantId?: string | null;
          };
          if (st.ok && st.authenticated && st.role) {
            return {
              ok: true,
              user: null,
              role: st.role,
              restaurantId: st.restaurantId ?? null,
            };
          }
        }
        clearLocalAuthToken();
      } catch {
        return { ok: false };
      }
    }

    const storedRefresh = await readRenewableRefreshToken('local_server');
    if (!storedRefresh) {
      return { ok: false };
    }

    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: storedRefresh }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return { ok: false };
      }
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        token?: string;
        refreshToken?: string;
        refreshExpiresAt?: string;
        user?: PlatformUser | null;
        role?: 'restaurateur' | 'super_admin';
        restaurantId?: string | null;
        reason?: string;
      };
      if (res.ok && body.ok && body.token) {
        setLocalAuthToken(body.token);
        if (body.refreshToken) {
          await saveRenewableRefreshToken('local_server', body.refreshToken, body.refreshExpiresAt);
        }
        return {
          ok: true,
          user: body.user ?? null,
          role: body.role ?? body.user?.role,
          restaurantId: body.restaurantId ?? body.user?.assignedRestaurantId ?? null,
        };
      }
      if (
        res.status === 401 &&
        (body.reason === 'invalid_refresh_token' ||
          body.reason === 'revoked' ||
          body.reason === 'expired' ||
          body.reason === 'inactive')
      ) {
        await clearRenewableRefreshToken('local_server');
      }
      return { ok: false };
    } catch {
      // Preserve stored refresh token while local server is unreachable
      return { ok: false };
    }
  })().finally(() => {
    inFlightLocalRestore = null;
  });

  return inFlightLocalRestore;
}

export async function fetchLocalServerCurrentUser(): Promise<PlatformUser | null> {
  const restored = await restoreLocalServerSession();
  return restored.ok && restored.user ? restored.user : null;
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
  const refreshToken = await readRenewableRefreshToken('local_server');
  clearLocalAuthToken();
  await clearRenewableRefreshToken('local_server');
  if (!token && !refreshToken) return;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const payload = JSON.stringify({ refreshToken: refreshToken || undefined });
    await Promise.allSettled([
      fetch('/api/auth/logout', { method: 'POST', headers, body: payload }),
      fetch('/api/auth/local-logout', { method: 'POST', headers, body: payload }),
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

export function isRetryableSyncError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err || '').toLowerCase();
  if (!msg) return true;
  if (
    msg.includes('permission denied') ||
    msg.includes('permission refusée') ||
    msg.includes('42501') ||
    msg.includes('trop volumineuse') ||
    msg.includes('format de média non autorisé') ||
    msg.includes('format non autorisé') ||
    msg.includes('cannot move item across restaurants') ||
    msg.includes('cannot modify global or foreign category') ||
    msg.includes('pgrst202')
  ) {
    return false;
  }
  return true;
}

function isAuthRefreshableError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err || '').toLowerCase();
  return (
    msg.includes('authentification requise') ||
    msg.includes('session invalide') ||
    msg.includes('jwt expired') ||
    msg.includes('invalid jwt') ||
    msg.includes('401')
  );
}

export function canActorReplayMutation(
  actor: PlatformUser | null | undefined,
  mut: PendingSyncMutation,
  localState?: Pick<PlatformState, 'categories' | 'menuItems'>
): boolean {
  if (!actor || !actor.isActive) return false;
  if (mut.authorUserId && mut.authorUserId !== actor.id) return false;

  if (mut.entityType === 'restaurant') {
    if (mut.operation === 'delete') return canDeleteRestaurant(actor);
    if (mut.operation === 'toggle_status') return canToggleRestaurantStatus(actor);
    if (mut.isNew) return canCreateRestaurant(actor);
    return canEditRestaurant(actor);
  }

  if (mut.entityType === 'category') {
    const payloadCat = mut.payload as Category | undefined;
    const existingCat = localState?.categories.find((c) => c.id === mut.entityId);
    if (payloadCat) return canManageCategory(actor, payloadCat);
    if (existingCat) return canManageCategory(actor, existingCat);
    if (actor.role === 'super_admin') return true;
    return Boolean(mut.authorRestaurantId && mut.authorRestaurantId === actor.assignedRestaurantId);
  }

  if (mut.entityType === 'menu_item') {
    const payloadItem = mut.payload as MenuItem | undefined;
    const existingItem = localState?.menuItems.find((m) => m.id === mut.entityId);
    const targetRestId =
      payloadItem?.restaurantId ?? existingItem?.restaurantId ?? mut.authorRestaurantId ?? null;
    return canManageMenuForRestaurant(actor, targetRestId);
  }

  return Boolean(mut.authorUserId && mut.authorUserId === actor.id);
}

async function resolveImageForCloudSync(
  rawUrl: string,
  restaurantId: string,
  folder: 'dishes' | 'logos',
  entityId: string,
  hasJwtSession: boolean,
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
  const mime = (blob.type || 'image/jpeg').toLowerCase();
  if (!mime.startsWith('image/') || mime.includes('svg')) {
    throw new Error('Format de média non autorisé');
  }

  if (hasJwtSession) {
    const ext = mime.includes('webp') ? 'webp' : mime.includes('png') ? 'png' : 'jpg';
    try {
      return await uploadFn(restaurantId, folder, `${entityId}.${ext}`, blob, mime);
    } catch {
      // Fall back to bounded safe raster data URL below
    }
  }

  if (rawUrl.startsWith('data:') && isSafeRasterDataUrl(rawUrl)) {
    return rawUrl;
  }

  const maxDim = folder === 'logos' ? 400 : 900;
  const optimized = await optimizeBlobToBoundedImage(blob, maxDim);
  if (!isSafeRasterDataUrl(optimized.dataUrl)) {
    throw new Error('Image trop volumineuse ou format non autorisé');
  }
  return optimized.dataUrl;
}

/**
 * Replays queued offline mutations against Supabase (author-scoped, dependency-ordered & RBAC-verified),
 * prevents duplicate records via upsert, detects timestamp conflicts, records retry backoff on transient
 * failures, and preserves un-synced or foreign-author mutations safely in IndexedDB.
 */
export async function syncPendingOutboxWithSupabase(
  localState: PlatformState,
  forceOverwrite = false,
  actor?: PlatformUser | null,
  options?: { respectBackoff?: boolean }
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

  const rawAuthorized = outbox.filter((mut) => canActorReplayMutation(actor, mut, localState));
  const foreignOrUnauthorized = outbox.filter(
    (mut) => !canActorReplayMutation(actor, mut, localState)
  );

  // Never replay or wipe mutations belonging to another user when unauthenticated or switched user
  if (rawAuthorized.length === 0) {
    return {
      status: 'online',
      pendingCount: outbox.length,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  const authorizedMutations = sortOutboxForReplay(rawAuthorized);

  if (options?.respectBackoff) {
    const nowMs = Date.now();
    const readyNow = authorizedMutations.some(
      (m) => !m.nextRetryAt || Date.parse(m.nextRetryAt) <= nowMs
    );
    if (!readyNow) {
      const nextRetryAt = authorizedMutations
        .map((m) => m.nextRetryAt)
        .filter((v): v is string => Boolean(v))
        .sort()[0];
      return {
        status: 'error',
        pendingCount: outbox.length,
        retryable: true,
        nextRetryAt,
        errorMessage: authorizedMutations.find((m) => m.lastError)?.lastError,
      };
    }
  }

  const sb = await import('./supabaseData');

  try {
    const [cloud, hasJwtSession] = await Promise.all([
      sb.fetchSupabaseCatalog(true),
      sb.hasSupabaseAuthSession(),
    ]);

    if (!forceOverwrite) {
      const conflicts: SyncConflictDetail[] = [];
      for (const mut of authorizedMutations) {
        if (mut.isNew || mut.operation === 'delete' || !mut.baseUpdatedAt) continue;
        const baseMs = Date.parse(mut.baseUpdatedAt);
        if (!Number.isFinite(baseMs)) continue;

        if (mut.entityType === 'menu_item' && mut.entityId) {
          const remoteItem = cloud.menuItems.find((m) => m.id === mut.entityId);
          const remoteMs = remoteItem?.updatedAt ? Date.parse(remoteItem.updatedAt) : NaN;
          if (Number.isFinite(remoteMs) && remoteMs > baseMs + 2000) {
            const draft = mut.payload as Partial<MenuItem> | undefined;
            conflicts.push({
              mutationId: mut.id,
              entityType: 'menu_item',
              entityId: mut.entityId,
              label:
                remoteItem?.name?.fr ||
                draft?.name?.fr ||
                remoteItem?.name?.en ||
                draft?.name?.en ||
                mut.entityId,
              localUpdatedAt: mut.baseUpdatedAt,
              remoteUpdatedAt: remoteItem?.updatedAt,
            });
          }
        } else if (mut.entityType === 'restaurant' && mut.entityId) {
          const remoteRest = cloud.restaurants.find((r) => r.id === mut.entityId);
          const remoteMs = remoteRest?.updatedAt ? Date.parse(remoteRest.updatedAt) : NaN;
          if (Number.isFinite(remoteMs) && remoteMs > baseMs + 2000) {
            const draft = mut.payload as Partial<Restaurant> | undefined;
            conflicts.push({
              mutationId: mut.id,
              entityType: 'restaurant',
              entityId: mut.entityId,
              label: remoteRest?.name || draft?.name || mut.entityId,
              localUpdatedAt: mut.baseUpdatedAt,
              remoteUpdatedAt: remoteRest?.updatedAt,
            });
          }
        }
      }

      if (conflicts.length > 0) {
        const namesPreview = conflicts
          .slice(0, 2)
          .map((c) => c.label)
          .join(', ');
        return {
          status: 'conflict',
          serverConflictState: {
            restaurants: cloud.restaurants,
            categories: cloud.categories,
            menuItems: cloud.menuItems,
            users: cloud.users ?? localState.users,
            updatedAt: new Date().toISOString(),
          },
          conflicts,
          pendingCount: outbox.length,
          errorMessage: `Conflit détecté sur : ${namesPreview}`,
        };
      }
    }

    let remaining: PendingSyncMutation[] = [...outbox];
    let updatedRestaurants = [...localState.restaurants];
    let updatedItems = [...localState.menuItems];
    let attemptedSessionRefresh = false;

    const executeSingleMutation = async (mut: PendingSyncMutation) => {
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
        } else if (mut.operation === 'toggle_status' && mut.entityId && mut.payload) {
          const p = mut.payload as { isActive: boolean };
          await sb.toggleRestaurantStatusInSupabase(mut.entityId, p.isActive);
        } else if (mut.operation === 'upsert' && mut.payload) {
          const draft = mut.payload as Restaurant;
          const syncedLogo = draft.logoUrl
            ? await resolveImageForCloudSync(
                draft.logoUrl,
                draft.id,
                'logos',
                'logo',
                hasJwtSession,
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
                hasJwtSession,
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
    };

    for (const mut of authorizedMutations) {
      try {
        try {
          await executeSingleMutation(mut);
        } catch (firstErr) {
          if (isAuthRefreshableError(firstErr) && !attemptedSessionRefresh) {
            attemptedSessionRefresh = true;
            const refreshedUser = await sb.restoreSupabaseSession().catch(() => null);
            if (refreshedUser) {
              await executeSingleMutation(mut);
            } else {
              throw firstErr;
            }
          } else {
            throw firstErr;
          }
        }

        remaining = remaining.filter((entry) => entry.id !== mut.id);
        await replaceOutbox(remaining);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur de synchronisation Supabase';
        const retryable = isRetryableSyncError(err);
        await replaceOutbox(remaining);
        const updatedOutbox = await recordOutboxMutationFailure(mut.id, message, retryable);
        const failedEntry = updatedOutbox.find((entry) => entry.id === mut.id);
        return {
          status: 'error',
          pendingCount: updatedOutbox.length,
          retryable,
          nextRetryAt: failedEntry?.nextRetryAt,
          errorMessage: message,
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
      users: [],
      updatedAt: now,
      baseUpdatedAt: now,
    });

    if (foreignOrUnauthorized.length === 0) {
      await clearOutbox();
    } else {
      await replaceOutbox(foreignOrUnauthorized);
    }

    return {
      status: 'online',
      mergedState: {
        ...committed,
        users: freshCloud.users ?? localState.users,
      },
      pendingCount: foreignOrUnauthorized.length,
      lastSyncedAt: now,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur de synchronisation cloud';
    return {
      status: 'error',
      pendingCount: outbox.length,
      retryable: isRetryableSyncError(err),
      errorMessage: message,
    };
  }
}

/**
 * Synchronizes local IndexedDB state with the local Windows LAN server (/api/catalog)
 * when present. Public customer sessions must pass pullOnly: true so they never push writes;
 * authenticated Pro writes attach a valid Bearer token and preserve foreign outbox items.
 */
export async function syncWithServer(
  localState: PlatformState,
  forceOverwrite = false,
  options?: {
    lastCloudSyncAt?: string | null;
    pushOnlyToLocal?: boolean;
    pullOnly?: boolean;
    actor?: PlatformUser | null;
  }
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

    const authorizedMutations = options?.actor
      ? outbox.filter((mut) => canActorReplayMutation(options.actor, mut, localState))
      : [];
    const foreignMutations = options?.actor
      ? outbox.filter((mut) => !canActorReplayMutation(options.actor, mut, localState))
      : outbox;

    const canPushWrites =
      !options?.pullOnly &&
      (options?.pushOnlyToLocal ||
        authorizedMutations.length > 0 ||
        (forceOverwrite && foreignMutations.length === 0));

    // Push local catalog to Windows LAN PC server only for authenticated Pro flows
    if (canPushWrites) {
      const pushRes = await fetch('/api/catalog', {
        method: 'PUT',
        headers: buildLocalAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          state: { ...localState, users: [] },
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

      const saved = (await pushRes.json()) as {
        state: PlatformState & { serverSavedAt?: string };
      };
      lastKnownLocalServerVersion = saved.state.serverSavedAt ?? saved.state.updatedAt ?? null;
      const committed = await savePlatformState({
        ...saved.state,
        users: [],
        baseUpdatedAt: saved.state.updatedAt,
      });

      let remainingCount = outbox.length;
      if (!options?.pushOnlyToLocal) {
        if (foreignMutations.length === 0) {
          await clearOutbox();
          remainingCount = 0;
        } else {
          await replaceOutbox(foreignMutations);
          remainingCount = foreignMutations.length;
        }
      }
      const now = new Date().toISOString();
      setLastSyncedAt(now);

      return {
        status: 'online',
        mergedState: committed,
        pendingCount: remainingCount,
        lastSyncedAt: now,
        localServerActive: true,
      };
    }

    // Pull latest state from local PC LAN server if newer than browser cache (safe read-only)
    const pullRes = await fetch('/api/catalog', { cache: 'no-store' });
    if (pullRes.ok) {
      const body = (await pullRes.json()) as {
        state?: PlatformState & { serverSavedAt?: string };
      };
      const serverVersion = body.state?.serverSavedAt ?? body.state?.updatedAt ?? null;
      const versionChanged =
        Boolean(serverVersion) &&
        lastKnownLocalServerVersion !== null &&
        serverVersion !== lastKnownLocalServerVersion;
      if (
        body.state &&
        body.state.restaurants?.length > 0 &&
        (!localState.restaurants.length ||
          body.state.updatedAt > localState.updatedAt ||
          (outbox.length === 0 && versionChanged))
      ) {
        lastKnownLocalServerVersion = serverVersion;
        const updatedLocal = await savePlatformState({
          ...body.state,
          users: [],
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
      if (serverVersion && lastKnownLocalServerVersion === null) {
        lastKnownLocalServerVersion = serverVersion;
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

/**
 * Applies server state for conflicting items while preserving remaining non-conflicting
 * pending mutations so choosing "Use server" never silently drops unrelated offline edits.
 */
export function buildNonConflictingServerMerge(
  serverState: PlatformState,
  remainingMutations: PendingSyncMutation[]
): PlatformState {
  let restaurants = [...serverState.restaurants];
  let categories = [...serverState.categories];
  let menuItems = [...serverState.menuItems];

  for (const mut of sortOutboxForReplay(remainingMutations)) {
    if (mut.entityType === 'restaurant' && mut.entityId) {
      if (mut.operation === 'delete') {
        restaurants = restaurants.filter((r) => r.id !== mut.entityId);
      } else if (mut.operation === 'toggle_status' && mut.payload) {
        const p = mut.payload as { isActive: boolean };
        restaurants = restaurants.map((r) =>
          r.id === mut.entityId ? { ...r, isActive: p.isActive } : r
        );
      } else if (mut.operation === 'upsert' && mut.payload) {
        const draft = mut.payload as Restaurant;
        const exists = restaurants.some((r) => r.id === draft.id);
        restaurants = exists
          ? restaurants.map((r) => (r.id === draft.id ? draft : r))
          : [...restaurants, draft];
      }
    } else if (mut.entityType === 'category' && mut.entityId) {
      if (mut.operation === 'delete') {
        categories = categories.filter((c) => c.id !== mut.entityId);
      } else if (mut.operation === 'upsert' && mut.payload) {
        const draft = mut.payload as Category;
        const exists = categories.some((c) => c.id === draft.id);
        categories = exists
          ? categories.map((c) => (c.id === draft.id ? draft : c))
          : [...categories, draft];
      }
    } else if (mut.entityType === 'menu_item' && mut.entityId) {
      if (mut.operation === 'delete') {
        menuItems = menuItems.filter((m) => m.id !== mut.entityId);
      } else if (mut.operation === 'toggle_availability' && mut.payload) {
        const p = mut.payload as { isAvailable: boolean };
        menuItems = menuItems.map((m) =>
          m.id === mut.entityId ? { ...m, isAvailable: p.isAvailable } : m
        );
      } else if (mut.operation === 'upsert' && mut.payload) {
        const draft = mut.payload as MenuItem;
        const exists = menuItems.some((m) => m.id === draft.id);
        menuItems = exists
          ? menuItems.map((m) => (m.id === draft.id ? draft : m))
          : [draft, ...menuItems];
      }
    }
  }

  return {
    ...serverState,
    restaurants,
    categories,
    menuItems,
  };
}
