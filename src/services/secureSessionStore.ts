const SESSION_DB_NAME = 'smartmenu_qr_session_db';
const SESSION_DB_VERSION = 1;
const KEYS_STORE = 'crypto_keys';
const SESSIONS_STORE = 'refresh_sessions';
const CRYPTO_KEY_ID = 'session_wrapping_key_v1';

export type RefreshBackendKind = 'supabase' | 'local_server';

interface StoredRefreshEnvelope {
  kind: RefreshBackendKind;
  encrypted: boolean;
  iv?: number[];
  ciphertext?: number[];
  plainToken?: string;
  expiresAt: string;
  updatedAt: string;
}

function hasIndexedDb(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function hasSubtleCrypto(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.crypto !== 'undefined' &&
    typeof window.crypto.subtle !== 'undefined'
  );
}

function openSessionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(SESSION_DB_NAME, SESSION_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEYS_STORE)) {
        db.createObjectStore(KEYS_STORE);
      }
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Session IndexedDB error'));
  });
}

async function getOrCreateAesKey(db: IDBDatabase): Promise<CryptoKey | null> {
  if (!hasSubtleCrypto()) return null;

  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const tx = db.transaction(KEYS_STORE, 'readonly');
    const req = tx.objectStore(KEYS_STORE).get(CRYPTO_KEY_ID);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error);
  });

  if (existing) return existing;

  const generated = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // Non-extractable key kept exclusively inside IndexedDB structured clone
    ['encrypt', 'decrypt']
  );

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEYS_STORE, 'readwrite');
    tx.objectStore(KEYS_STORE).put(generated, CRYPTO_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return generated;
}

export async function saveRenewableRefreshToken(
  kind: RefreshBackendKind,
  refreshToken: string,
  expiresAtIso?: string
): Promise<void> {
  if (!hasIndexedDb() || !refreshToken) return;

  const expiresAt =
    expiresAtIso && !Number.isNaN(Date.parse(expiresAtIso))
      ? expiresAtIso
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const db = await openSessionDb();
    let envelope: StoredRefreshEnvelope;

    const aesKey = await getOrCreateAesKey(db).catch(() => null);
    if (aesKey && hasSubtleCrypto()) {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(refreshToken);
      const encryptedBuf = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        encoded
      );
      envelope = {
        kind,
        encrypted: true,
        iv: Array.from(iv),
        ciphertext: Array.from(new Uint8Array(encryptedBuf)),
        expiresAt,
        updatedAt: new Date().toISOString(),
      };
    } else {
      // Plain HTTP LAN fallback (e.g. http://192.168.x.x where SubtleCrypto is disabled):
      // still stored strictly in IndexedDB, never in localStorage/sessionStorage.
      envelope = {
        kind,
        encrypted: false,
        plainToken: refreshToken,
        expiresAt,
        updatedAt: new Date().toISOString(),
      };
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, 'readwrite');
      tx.objectStore(SESSIONS_STORE).put(envelope, kind);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore storage errors gracefully
  }
}

export async function readRenewableRefreshToken(
  kind: RefreshBackendKind
): Promise<string | null> {
  if (!hasIndexedDb()) return null;

  try {
    const db = await openSessionDb();
    const envelope = await new Promise<StoredRefreshEnvelope | undefined>((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, 'readonly');
      const req = tx.objectStore(SESSIONS_STORE).get(kind);
      req.onsuccess = () => resolve(req.result as StoredRefreshEnvelope | undefined);
      req.onerror = () => reject(req.error);
    });

    if (!envelope) {
      db.close();
      return null;
    }

    if (envelope.expiresAt && Date.parse(envelope.expiresAt) <= Date.now()) {
      db.close();
      await clearRenewableRefreshToken(kind);
      return null;
    }

    if (envelope.encrypted && envelope.iv && envelope.ciphertext) {
      const aesKey = await getOrCreateAesKey(db).catch(() => null);
      if (!aesKey || !hasSubtleCrypto()) {
        db.close();
        return null;
      }
      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(envelope.iv) },
        aesKey,
        new Uint8Array(envelope.ciphertext)
      );
      db.close();
      return new TextDecoder().decode(decrypted) || null;
    }

    db.close();
    return envelope.plainToken || null;
  } catch {
    return null;
  }
}

export async function clearRenewableRefreshToken(kind: RefreshBackendKind): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const db = await openSessionDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, 'readwrite');
      tx.objectStore(SESSIONS_STORE).delete(kind);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore cleanup errors
  }
}
