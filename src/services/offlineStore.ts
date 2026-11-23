import {
  INITIAL_CATEGORIES,
  INITIAL_MENU_ITEMS,
  INITIAL_RESTAURANTS,
  INITIAL_USERS,
} from '../data/seedData';
import { Category, MenuItem, PlatformUser, Restaurant } from '../types/menu';

const DB_NAME = 'smartmenu_qr_offline_db';
const DB_VERSION = 3;
const STORE_NAME = 'platform_state';
const OUTBOX_STORE = 'sync_outbox';
const RECORD_KEY = 'catalog_v2';
const LS_FALLBACK_KEY = 'smartmenu_qr_catalog_v2';
const LS_OUTBOX_KEY = 'smartmenu_qr_outbox_v1';
const LS_LAST_SYNC_KEY = 'smartmenu_qr_last_synced_at_v1';

export type SyncEntityType = 'restaurant' | 'category' | 'menu_item';
export type SyncOperation = 'upsert' | 'delete' | 'toggle_availability';

export interface PlatformState {
  restaurants: Restaurant[];
  categories: Category[];
  menuItems: MenuItem[];
  users: PlatformUser[];
  updatedAt: string;
  baseUpdatedAt?: string;
}

export interface PendingSyncMutation {
  id: string;
  action: string;
  entityType?: SyncEntityType;
  entityId?: string;
  operation?: SyncOperation;
  isNew?: boolean;
  payload?: unknown;
  createdAt: string;
  baseUpdatedAt: string;
}

const DEFAULT_STATE: PlatformState = {
  restaurants: INITIAL_RESTAURANTS,
  categories: INITIAL_CATEGORIES,
  menuItems: INITIAL_MENU_ITEMS,
  users: INITIAL_USERS,
  updatedAt: new Date().toISOString(),
  baseUpdatedAt: new Date().toISOString(),
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB error'));
  });
}

const LEGACY_SHARED_IMAGES = new Set([
  '/src/assets/images/hero_smash_burger_1794942899291.jpg',
  '/src/assets/images/cat_smash_burgers_1794942900172.jpg',
  '/src/assets/images/cat_chicken_burgers_1794942900217.jpg',
  '/src/assets/images/cat_pork_ribs_1794942900135.jpg',
  '/src/assets/images/cat_chicken_wings_1794942900800.jpg',
  '/src/assets/images/cat_sides_1794942900967.jpg',
  '/src/assets/images/cat_salads_1794942901254.jpg',
  '/src/assets/images/cat_desserts_1794942901404.jpg',
  '/src/assets/images/cat_milkshakes_1794942901787.jpg',
  '/src/assets/images/cat_drinks_1794942902601.jpg',
]);

const SEED_ITEM_IMAGE_BY_ID = new Map(INITIAL_MENU_ITEMS.map((item) => [item.id, item.image]));
const SEED_RESTAURANT_HERO_BY_ID = new Map(
  INITIAL_RESTAURANTS.map((rest) => [rest.id, rest.heroImage])
);

const SEED_USER_IDS = new Set(['user-super-admin', 'user-roco-owner', 'user-kin-owner']);

function hasLegacySeedSecrets(rawUsers: Array<Partial<PlatformUser> & { password?: string }> | undefined): boolean {
  if (!Array.isArray(rawUsers)) return false;
  return rawUsers.some(
    (u) =>
      (u.id && SEED_USER_IDS.has(u.id)) ||
      typeof u.password === 'string'
  );
}

function scrubSeedUsers(rawUsers: Array<Partial<PlatformUser> & { password?: string }>): PlatformUser[] {
  return rawUsers
    .filter((u) => !u.id || !SEED_USER_IDS.has(u.id))
    .map((u) => ({
      id: String(u.id || ''),
      username: String(u.username || u.email || ''),
      name: String(u.name || u.username || u.email || ''),
      ...(u.email ? { email: String(u.email) } : {}),
      role: u.role === 'super_admin' ? 'super_admin' : 'restaurateur',
      assignedRestaurantId: u.assignedRestaurantId ?? null,
      isActive: Boolean(u.isActive ?? true),
    }));
}

function normalizeState(
  raw: Partial<PlatformState> | undefined,
  allowSeedUsers = true
): PlatformState | null {
  if (!raw || !Array.isArray(raw.restaurants) || !Array.isArray(raw.menuItems)) {
    return null;
  }
  const now = new Date().toISOString();
  const normalizedUsers =
    Array.isArray(raw.users) && raw.users.length > 0
      ? scrubSeedUsers(raw.users as Array<Partial<PlatformUser> & { password?: string }>)
      : allowSeedUsers
      ? INITIAL_USERS
      : [];

  return {
    restaurants: raw.restaurants.map((r) => {
      const seedHero = SEED_RESTAURANT_HERO_BY_ID.get(r.id);
      const heroImage =
        seedHero && LEGACY_SHARED_IMAGES.has(r.heroImage) ? seedHero : r.heroImage;
      return {
        ...r,
        heroImage,
        primaryColor: r.primaryColor || '#DC2626',
        secondaryColor: r.secondaryColor || '#F97316',
      };
    }),
    categories:
      Array.isArray(raw.categories) && raw.categories.length > 0
        ? raw.categories
        : INITIAL_CATEGORIES,
    menuItems: raw.menuItems.map((item) => {
      const seedImage = SEED_ITEM_IMAGE_BY_ID.get(item.id);
      if (seedImage && LEGACY_SHARED_IMAGES.has(item.image)) {
        return { ...item, image: seedImage };
      }
      return item;
    }),
    users: normalizedUsers,
    updatedAt: raw.updatedAt || now,
    baseUpdatedAt: raw.baseUpdatedAt || raw.updatedAt || now,
  };
}

export function getLastSyncedAt(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LS_LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

export function setLastSyncedAt(iso: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_LAST_SYNC_KEY, iso);
  } catch {
    // Ignore
  }
}

export function loadCachedSnapshotSync(allowSeedUsers = false): PlatformState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PlatformState>;
    const normalized = normalizeState(parsed, allowSeedUsers);
    if (normalized && hasLegacySeedSecrets(parsed.users)) {
      window.localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return null;
  }
}

export async function loadPlatformState(allowSeedFallback = true): Promise<PlatformState> {
  try {
    const db = await openDatabase();
    const record = await new Promise<Partial<PlatformState> | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(RECORD_KEY);
      req.onsuccess = () => resolve(req.result as Partial<PlatformState> | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const normalized = normalizeState(record, allowSeedFallback);
    if (normalized) {
      if (hasLegacySeedSecrets(record?.users)) {
        await savePlatformState(normalized);
      } else {
        // Also ensure legacy localStorage fallback doesn't retain old seed secrets
        try {
          const lsRaw = window.localStorage.getItem(LS_FALLBACK_KEY);
          if (lsRaw) {
            const lsParsed = JSON.parse(lsRaw) as Partial<PlatformState>;
            if (hasLegacySeedSecrets(lsParsed.users)) {
              const lsNormalized = normalizeState(lsParsed, allowSeedFallback);
              if (lsNormalized) {
                window.localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(lsNormalized));
              }
            }
          }
        } catch {
          // Ignore localStorage fallback read/parse error
        }
      }
      return normalized;
    }
  } catch {
    // Fallback to localStorage below
  }

  try {
    const raw = window.localStorage.getItem(LS_FALLBACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlatformState>;
      const normalized = normalizeState(parsed, allowSeedFallback);
      if (normalized) {
        if (hasLegacySeedSecrets(parsed.users)) {
          await savePlatformState(normalized);
        }
        return normalized;
      }
    }
  } catch {
    // Use seed defaults
  }

  if (!allowSeedFallback) {
    return {
      restaurants: [],
      categories: [],
      menuItems: [],
      users: [],
      updatedAt: new Date().toISOString(),
      baseUpdatedAt: new Date().toISOString(),
    };
  }

  await savePlatformState(DEFAULT_STATE);
  return DEFAULT_STATE;
}

export async function savePlatformState(state: PlatformState): Promise<PlatformState> {
  const payload: PlatformState = {
    ...state,
    updatedAt: state.updatedAt || new Date().toISOString(),
    baseUpdatedAt: state.baseUpdatedAt || state.updatedAt || new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota issues on fallback
  }

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(payload, RECORD_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    // localStorage already persisted
  }

  return payload;
}

async function persistOutboxList(next: PendingSyncMutation[]): Promise<void> {
  try {
    window.localStorage.setItem(LS_OUTBOX_KEY, JSON.stringify(next));
  } catch {
    // Ignore fallback error
  }

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      const store = tx.objectStore(OUTBOX_STORE);
      store.clear();
      for (const item of next) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Fallback saved
  }
}

export async function loadOutbox(): Promise<PendingSyncMutation[]> {
  try {
    const db = await openDatabase();
    const items = await new Promise<PendingSyncMutation[]>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, 'readonly');
      const store = tx.objectStore(OUTBOX_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as PendingSyncMutation[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    try {
      const raw = window.localStorage.getItem(LS_OUTBOX_KEY);
      return raw ? (JSON.parse(raw) as PendingSyncMutation[]) : [];
    } catch {
      return [];
    }
  }
}

export async function enqueueOutboxMutation(
  action: string,
  baseUpdatedAt: string,
  details?: {
    entityType: SyncEntityType;
    entityId: string;
    operation: SyncOperation;
    isNew?: boolean;
    payload?: unknown;
  }
): Promise<PendingSyncMutation[]> {
  const current = await loadOutbox();

  if (details) {
    const existingIdx = current.findIndex(
      (m) => m.entityType === details.entityType && m.entityId === details.entityId
    );
    const existing = existingIdx >= 0 ? current[existingIdx] : undefined;

    // If created offline and then deleted before ever reaching cloud, cancel out completely
    if (existing?.isNew && details.operation === 'delete') {
      const pruned = current.filter((_, idx) => idx !== existingIdx);
      await persistOutboxList(pruned);
      return pruned;
    }

    const merged: PendingSyncMutation = {
      id: existing?.id ?? `mut-${details.entityType}-${details.entityId}`,
      action,
      entityType: details.entityType,
      entityId: details.entityId,
      operation:
        existing?.isNew && details.operation === 'toggle_availability'
          ? 'upsert'
          : details.operation,
      isNew: Boolean(existing?.isNew || details.isNew),
      payload:
        existing?.isNew && details.operation === 'toggle_availability' && existing.payload
          ? {
              ...(existing.payload as Record<string, unknown>),
              ...(details.payload as Record<string, unknown>),
            }
          : details.payload,
      createdAt: new Date().toISOString(),
      baseUpdatedAt: existing?.baseUpdatedAt || baseUpdatedAt,
    };

    const next =
      existingIdx >= 0
        ? current.map((item, idx) => (idx === existingIdx ? merged : item))
        : [...current, merged];
    await persistOutboxList(next);
    return next;
  }

  const mutation: PendingSyncMutation = {
    id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    action,
    createdAt: new Date().toISOString(),
    baseUpdatedAt,
  };
  const next = [...current, mutation];
  await persistOutboxList(next);
  return next;
}

export async function replaceOutbox(mutations: PendingSyncMutation[]): Promise<PendingSyncMutation[]> {
  await persistOutboxList(mutations);
  return mutations;
}

export async function clearOutbox(): Promise<void> {
  try {
    window.localStorage.removeItem(LS_OUTBOX_KEY);
  } catch {
    // Ignore
  }
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite');
      const store = tx.objectStore(OUTBOX_STORE);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}

export async function resetPlatformState(): Promise<PlatformState> {
  const now = new Date().toISOString();
  const fresh: PlatformState = {
    restaurants: INITIAL_RESTAURANTS,
    categories: INITIAL_CATEGORIES,
    menuItems: INITIAL_MENU_ITEMS,
    users: INITIAL_USERS,
    updatedAt: now,
    baseUpdatedAt: now,
  };
  await clearOutbox();
  await savePlatformState(fresh);
  return fresh;
}
