import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  atomicWriteFile,
  AUTH_FILE,
  DATA_FILE,
  ensureDataDirectories,
  extFromMime,
  IMAGE_CACHE_DIR,
  IMAGE_MAP_FILE,
  loadLocalConfig,
  mirrorRemoteImagesToDisk,
  PID_FILE,
  pullCloudCatalogToLocal,
  readJsonSafe,
  ROOT_DIR,
  UPLOADS_DIR,
} from './sync-cloud.mjs';

function stableRestaurantSnapshot(r) {
  return JSON.stringify({
    id: r.id,
    slug: r.slug,
    name: r.name,
    city: r.city,
    country: r.country ?? { fr: '', en: '' },
    address: r.address ?? { fr: '', en: '' },
    hours: r.hours ?? { fr: '', en: '' },
    phone: r.phone ?? '',
    tagline: r.tagline ?? { fr: '', en: '' },
    description: r.description ?? { fr: '', en: '' },
    demoDisclaimer: r.demoDisclaimer ?? { fr: '', en: '' },
    heroImage: r.heroImage ?? '',
    logoUrl: r.logoUrl ?? '',
    primaryColor: r.primaryColor ?? '#DC2626',
    secondaryColor: r.secondaryColor ?? '#F97316',
    isActive: Boolean(r.isActive),
    ownerId: r.ownerId ?? '',
    isDemo: Boolean(r.isDemo),
  });
}

function stableCategorySnapshot(c) {
  return JSON.stringify({
    id: c.id,
    restaurantId: c.restaurantId ?? null,
    name: c.name ?? { fr: '', en: '' },
    description: c.description ?? { fr: '', en: '' },
    order: Number(c.order ?? 10),
  });
}

function stableMenuItemSnapshot(item) {
  return JSON.stringify({
    id: item.id,
    restaurantId: item.restaurantId,
    categoryId: item.categoryId,
    name: item.name ?? { fr: '', en: '' },
    description: item.description ?? { fr: '', en: '' },
    ingredients: item.ingredients ?? { fr: '', en: '' },
    priceFC: Number(item.priceFC ?? 0),
    image: item.image ?? '',
    isAvailable: Boolean(item.isAvailable),
    isPopular: Boolean(item.isPopular),
    isSpecialty: Boolean(item.isSpecialty),
    spiceLevel: Number(item.spiceLevel ?? 0),
    prepMinutes: Number(item.prepMinutes ?? 12),
  });
}

function isLocalhostRequest(req) {
  const remote = req.socket?.remoteAddress || '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function getClientKey(req) {
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

function hashPin(pin, saltHex) {
  return crypto.scryptSync(String(pin), saltHex, 64).toString('hex');
}

function verifyPinHash(pin, saltHex, expectedHashHex) {
  if (!pin || !saltHex || !expectedHashHex) return false;
  try {
    const computed = Buffer.from(hashPin(pin, saltHex), 'hex');
    const expected = Buffer.from(expectedHashHex, 'hex');
    if (computed.length !== expected.length) return false;
    return crypto.timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

function base64UrlEncode(strOrBuf) {
  return Buffer.from(strOrBuf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

function signSessionToken(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

function verifySessionToken(token, secret, revokedJtis) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  try {
    const expectedSig = base64UrlEncode(crypto.createHmac('sha256', secret).update(body).digest());
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(base64UrlDecode(body));
    if (!payload || typeof payload.exp !== 'number' || Date.now() >= payload.exp) {
      return null;
    }
    if (payload.jti && revokedJtis.has(payload.jti)) {
      return null;
    }
    if (payload.role !== 'restaurateur' && payload.role !== 'super_admin') {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function scoreLanInterface(name, address) {
  const lower = name.toLowerCase();
  let score = 0;
  if (/wi-?fi|wlan|wireless|ethernet|eth\d|en\d/i.test(lower)) score += 20;
  if (/virtual|vmware|vbox|wsl|hyper-v|vethernet|docker|loopback|tailscale|hamachi/i.test(lower)) {
    score -= 50;
  }
  if (address.startsWith('192.168.')) score += 15;
  else if (address.startsWith('10.')) score += 10;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 5;
  return score;
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({
          name,
          address: iface.address,
          score: scoreLanInterface(name, iface.address),
        });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return [...new Set(candidates.map((c) => c.address))];
}

export function createLocalServerApp(customOptions = {}) {
  const config = customOptions.config ?? loadLocalConfig();
  const dataFile = customOptions.dataFile ?? DATA_FILE;
  const authFile = customOptions.authFile ?? AUTH_FILE;
  const uploadsDir = customOptions.uploadsDir ?? UPLOADS_DIR;
  const imageCacheDir = customOptions.imageCacheDir ?? IMAGE_CACHE_DIR;
  const imageMapFile = customOptions.imageMapFile ?? IMAGE_MAP_FILE;
  const distDir = customOptions.distDir ?? path.join(ROOT_DIR, 'dist');
  const pullCloudFn = customOptions.pullCloudFn ?? pullCloudCatalogToLocal;
  const mirrorImagesFn = customOptions.mirrorImagesFn ?? mirrorRemoteImagesToDisk;

  for (const dir of [path.dirname(dataFile), uploadsDir, imageCacheDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const revokedJtis = new Set();
  const loginAttemptsByIp = new Map();

  function readAuthRecord() {
    const existing = readJsonSafe(authFile, null);
    if (existing && existing.tokenSecret) {
      return existing;
    }
    const created = {
      tokenSecret: crypto.randomBytes(32).toString('hex'),
      salt: '',
      pinHash: '',
      role: 'restaurateur',
      restaurantId: config.restaurantId || null,
      updatedAt: new Date().toISOString(),
    };
    const envPin = String(process.env.LOCAL_PRO_PIN || '').trim();
    if (envPin.length >= 4) {
      const salt = crypto.randomBytes(16).toString('hex');
      created.salt = salt;
      created.pinHash = hashPin(envPin, salt);
    }
    atomicWriteFile(authFile, JSON.stringify(created, null, 2));
    return created;
  }

  function writeAuthRecord(next) {
    atomicWriteFile(authFile, JSON.stringify(next, null, 2));
    return next;
  }

  function readLocalCatalog() {
    return readJsonSafe(dataFile, null);
  }

  function isScopedRestaurant(restaurant) {
    if (!config.restaurantId && !config.restaurantSlug) return true;
    if (config.restaurantId && restaurant.id === config.restaurantId) return true;
    if (config.restaurantSlug && restaurant.slug === config.restaurantSlug) return true;
    return false;
  }

  function scopeStateForRestaurant(state) {
    if (!state) return null;
    const scopedRestaurants = (state.restaurants || []).filter(isScopedRestaurant);
    const allowedIds = new Set(scopedRestaurants.map((r) => r.id));

    const scopedCategories = (state.categories || []).filter(
      (c) => !c.restaurantId || allowedIds.has(c.restaurantId)
    );
    const scopedItems = (state.menuItems || []).filter((item) =>
      allowedIds.has(item.restaurantId)
    );

    // Never expose account credentials over unauthenticated LAN catalog reads
    return {
      restaurants: scopedRestaurants,
      categories: scopedCategories,
      menuItems: scopedItems,
      users: [],
      updatedAt: state.updatedAt,
      baseUpdatedAt: state.baseUpdatedAt || state.updatedAt,
      lastCloudSyncAt: state.lastCloudSyncAt || null,
    };
  }

  function writeLocalCatalog(state, meta = {}) {
    const now = new Date().toISOString();
    const next = {
      restaurants: state.restaurants || [],
      categories: state.categories || [],
      menuItems: state.menuItems || [],
      users: [],
      updatedAt: state.updatedAt || now,
      baseUpdatedAt: state.baseUpdatedAt || state.updatedAt || now,
      lastCloudSyncAt: meta.lastCloudSyncAt ?? state.lastCloudSyncAt ?? null,
      serverSavedAt: now,
    };
    atomicWriteFile(dataFile, JSON.stringify(next, null, 2));
    return next;
  }

  function getPrimaryLanUrl() {
    if (config.publicLanUrl) return config.publicLanUrl;
    const lans = getLanAddresses();
    return lans.length > 0 ? `http://${lans[0]}:${config.port}` : `http://localhost:${config.port}`;
  }

  function extractBearerToken(req) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return null;
    return header.slice(7).trim() || null;
  }

  function resolveRequestSession(req) {
    const token = extractBearerToken(req);
    if (!token) return null;
    const authRecord = readAuthRecord();
    return verifySessionToken(token, authRecord.tokenSecret, revokedJtis);
  }

  function requireLocalProAuth(req, res, next) {
    const session = resolveRequestSession(req);
    if (!session) {
      return res.status(401).json({
        error: 'Authentification Pro locale requise (jeton manquant ou expiré).',
        code: 'LOCAL_AUTH_REQUIRED',
      });
    }
    req.localSession = session;
    return next();
  }

  function checkRateLimit(clientKey) {
    const now = Date.now();
    const entry = loginAttemptsByIp.get(clientKey);
    if (!entry) return { blocked: false };
    if (entry.lockedUntil && now < entry.lockedUntil) {
      return {
        blocked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
      };
    }
    if (entry.lockedUntil && now >= entry.lockedUntil) {
      loginAttemptsByIp.delete(clientKey);
      return { blocked: false };
    }
    return { blocked: false };
  }

  function recordFailedAttempt(clientKey) {
    const now = Date.now();
    const prev = loginAttemptsByIp.get(clientKey) || { count: 0, lockedUntil: 0 };
    const nextCount = prev.count + 1;
    const maxAttempts = config.maxLoginAttempts || 5;
    const lockoutMs = (config.lockoutMinutes || 15) * 60 * 1000;
    const lockedUntil = nextCount >= maxAttempts ? now + lockoutMs : 0;
    loginAttemptsByIp.set(clientKey, { count: nextCount, lockedUntil });
    return { count: nextCount, maxAttempts, lockedUntil };
  }

  function clearFailedAttempts(clientKey) {
    loginAttemptsByIp.delete(clientKey);
  }

  function validateRestaurateurCatalogMutation(incomingState, existingState, session) {
    const allowedRestId = session.restaurantId || config.restaurantId;
    if (!allowedRestId) {
      return 'Session restaurateur sans établissement assigné.';
    }

    const incomingRestaurants = incomingState.restaurants || [];
    const existingRestaurants = existingState?.restaurants || [];

    // 1. Restaurateur can NEVER create, delete, rename, brand, or toggle any restaurant
    if (existingRestaurants.length > 0) {
      if (incomingRestaurants.length !== existingRestaurants.length) {
        return 'Permission refusée : un restaurateur ne peut ni créer ni supprimer de restaurant.';
      }
      const existingById = new Map(existingRestaurants.map((r) => [r.id, stableRestaurantSnapshot(r)]));
      for (const rest of incomingRestaurants) {
        const expected = existingById.get(rest.id);
        if (!expected || expected !== stableRestaurantSnapshot(rest)) {
          return 'Permission refusée : la modification des restaurants et de leur identité visuelle est réservée au Super Admin.';
        }
      }
    } else {
      if (
        incomingRestaurants.length !== 1 ||
        incomingRestaurants[0]?.id !== allowedRestId
      ) {
        return 'Permission refusée : un restaurateur ne peut initialiser que son propre établissement assigné.';
      }
    }

    // 2. Restaurateur can NEVER add, modify, or delete global categories or another restaurant's categories
    const incomingCats = incomingState.categories || [];
    const existingCats = existingState?.categories || [];
    if (existingState) {
      const existingGlobalById = new Map(
        existingCats.filter((c) => !c.restaurantId).map((c) => [c.id, stableCategorySnapshot(c)])
      );
      const incomingGlobal = incomingCats.filter((c) => !c.restaurantId);
      if (incomingGlobal.length !== existingGlobalById.size) {
        return 'Permission refusée : un restaurateur ne peut pas modifier ou supprimer les catégories globales.';
      }
      for (const cat of incomingGlobal) {
        if (existingGlobalById.get(cat.id) !== stableCategorySnapshot(cat)) {
          return 'Permission refusée : les catégories globales sont en lecture seule.';
        }
      }

      const existingOtherCats = new Map(
        existingCats
          .filter((c) => c.restaurantId && c.restaurantId !== allowedRestId)
          .map((c) => [c.id, stableCategorySnapshot(c)])
      );
      const incomingOtherCats = incomingCats.filter(
        (c) => c.restaurantId && c.restaurantId !== allowedRestId
      );
      if (incomingOtherCats.length !== existingOtherCats.size) {
        return 'Permission refusée : impossible de modifier les catégories d’un autre restaurant.';
      }
      for (const cat of incomingOtherCats) {
        if (existingOtherCats.get(cat.id) !== stableCategorySnapshot(cat)) {
          return 'Permission refusée : catégorie appartenant à un autre restaurant.';
        }
      }
    } else {
      const invalidCat = incomingCats.find(
        (c) => c.restaurantId && c.restaurantId !== allowedRestId
      );
      if (invalidCat) {
        return 'Permission refusée : catégorie d’un autre restaurant.';
      }
    }

    // 3. Restaurateur can NEVER add, modify, or delete menu items of another restaurant
    const incomingItems = incomingState.menuItems || [];
    const existingItems = existingState?.menuItems || [];
    if (existingState) {
      const existingOtherItems = new Map(
        existingItems
          .filter((m) => m.restaurantId !== allowedRestId)
          .map((m) => [m.id, stableMenuItemSnapshot(m)])
      );
      const incomingOtherItems = incomingItems.filter((m) => m.restaurantId !== allowedRestId);
      if (incomingOtherItems.length !== existingOtherItems.size) {
        return 'Permission refusée : impossible d’ajouter ou supprimer des plats d’un autre restaurant.';
      }
      for (const item of incomingOtherItems) {
        if (existingOtherItems.get(item.id) !== stableMenuItemSnapshot(item)) {
          return 'Permission refusée : plat appartenant à un autre restaurant.';
        }
      }
    } else {
      const foreignItem = incomingItems.find((m) => m.restaurantId !== allowedRestId);
      if (foreignItem) {
        return 'Permission refusée : plat appartenant à un autre restaurant.';
      }
    }

    return null;
  }

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Public health check for frontend syncService probe (read-only)
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      mode: 'local-lan-server',
      hasLocalSnapshot: fs.existsSync(dataFile),
      restaurantId: config.restaurantId || null,
      restaurantSlug: config.restaurantSlug || null,
      primaryLanUrl: getPrimaryLanUrl(),
      timestamp: new Date().toISOString(),
    });
  });

  // Public server network metadata (no secrets exposed)
  app.get('/api/server-info', (_req, res) => {
    const lans = getLanAddresses();
    const state = readLocalCatalog();
    const imageMap = readJsonSafe(imageMapFile, {});
    const authRecord = readAuthRecord();
    res.json({
      ok: true,
      mode: 'local-lan-server',
      port: config.port,
      lanUrls: lans.map((ip) => `http://${ip}:${config.port}`),
      primaryLanUrl: getPrimaryLanUrl(),
      configuredPublicUrl: config.publicLanUrl || null,
      restaurantId: config.restaurantId || null,
      restaurantSlug: config.restaurantSlug || null,
      hasLocalSnapshot: Boolean(state),
      pinConfigured: Boolean(authRecord.pinHash),
      lastCloudSyncAt: state?.lastCloudSyncAt || null,
      cachedImagesCount: Object.keys(imageMap).length,
      updatedAt: state?.updatedAt || null,
    });
  });

  // Local authentication status check (safe metadata only)
  app.get('/api/auth/local-status', (req, res) => {
    const authRecord = readAuthRecord();
    const session = resolveRequestSession(req);
    res.json({
      ok: true,
      pinConfigured: Boolean(authRecord.pinHash),
      authenticated: Boolean(session),
      role: session?.role ?? null,
      restaurantId: session?.restaurantId ?? null,
      expiresAt: session?.exp ? new Date(session.exp).toISOString() : null,
      localhostSetupAllowed: isLocalhostRequest(req),
    });
  });

  // Configure or update the local Pro PIN (localhost PC only, never from public Wi-Fi clients)
  app.post('/api/auth/setup-pin', (req, res) => {
    if (!isLocalhostRequest(req)) {
      return res.status(403).json({
        error: 'Configuration du PIN local autorisée uniquement depuis le PC serveur (localhost).',
      });
    }

    const clientKey = getClientKey(req);
    const limit = checkRateLimit(clientKey);
    if (limit.blocked) {
      return res.status(429).json({
        error: 'Trop de tentatives. Réessayez plus tard.',
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    const { pin, currentPin, restaurantId } = req.body || {};
    const nextPin = String(pin || '').trim();
    if (nextPin.length < 4 || nextPin.length > 32) {
      return res.status(400).json({
        error: 'Le code PIN local doit contenir entre 4 et 32 caractères.',
      });
    }

    const authRecord = readAuthRecord();
    if (authRecord.pinHash) {
      if (!verifyPinHash(String(currentPin || '').trim(), authRecord.salt, authRecord.pinHash)) {
        const failure = recordFailedAttempt(clientKey);
        return res.status(failure.lockedUntil ? 429 : 401).json({
          error: 'PIN actuel incorrect.',
          remainingAttempts: Math.max(0, failure.maxAttempts - failure.count),
        });
      }
    }

    clearFailedAttempts(clientKey);
    const salt = crypto.randomBytes(16).toString('hex');
    const targetRestId =
      config.restaurantId ||
      String(restaurantId || authRecord.restaurantId || '').trim() ||
      readLocalCatalog()?.restaurants?.[0]?.id ||
      null;

    writeAuthRecord({
      ...authRecord,
      salt,
      pinHash: hashPin(nextPin, salt),
      role: 'restaurateur',
      restaurantId: targetRestId,
      updatedAt: new Date().toISOString(),
    });

    return res.json({
      ok: true,
      pinConfigured: true,
      restaurantId: targetRestId,
    });
  });

  // Authenticate a local Restaurateur session via PIN -> returns short-lived HMAC Bearer token
  app.post('/api/auth/local-login', (req, res) => {
    const clientKey = getClientKey(req);
    const limit = checkRateLimit(clientKey);
    if (limit.blocked) {
      return res.status(429).json({
        error: `Trop de tentatives échouées. Compte verrouillé pendant ${limit.retryAfterSeconds}s.`,
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    const authRecord = readAuthRecord();
    if (!authRecord.pinHash) {
      return res.status(403).json({
        error: 'Aucun PIN local n’est configuré sur ce PC serveur.',
        code: 'PIN_NOT_CONFIGURED',
      });
    }

    const { pin, restaurantId } = req.body || {};
    if (!verifyPinHash(String(pin || '').trim(), authRecord.salt, authRecord.pinHash)) {
      const failure = recordFailedAttempt(clientKey);
      if (failure.lockedUntil) {
        return res.status(429).json({
          error: 'Trop de tentatives échouées. Connexion temporairement verrouillée.',
          retryAfterSeconds: Math.ceil((failure.lockedUntil - Date.now()) / 1000),
        });
      }
      return res.status(401).json({
        error: 'Code PIN local incorrect.',
        remainingAttempts: Math.max(0, failure.maxAttempts - failure.count),
      });
    }

    clearFailedAttempts(clientKey);

    const catalog = readLocalCatalog();
    const resolvedRestaurantId =
      config.restaurantId ||
      authRecord.restaurantId ||
      (typeof restaurantId === 'string' && restaurantId.trim() ? restaurantId.trim() : null) ||
      catalog?.restaurants?.[0]?.id ||
      null;

    if (!resolvedRestaurantId) {
      return res.status(400).json({
        error: 'Aucun établissement n’est associé à ce serveur local.',
      });
    }

    const now = Date.now();
    const ttlMs = (config.sessionTtlMinutes || 480) * 60 * 1000;
    const payload = {
      jti: crypto.randomUUID(),
      role: 'restaurateur', // Never grant super_admin via local PIN login
      restaurantId: resolvedRestaurantId,
      iat: now,
      exp: now + ttlMs,
    };

    const token = signSessionToken(payload, authRecord.tokenSecret);
    return res.json({
      ok: true,
      token,
      role: payload.role,
      restaurantId: payload.restaurantId,
      expiresAt: new Date(payload.exp).toISOString(),
    });
  });

  // Revoke active local session token
  app.post('/api/auth/local-logout', (req, res) => {
    const session = resolveRequestSession(req);
    if (session?.jti) {
      revokedJtis.add(session.jti);
    }
    return res.json({ ok: true });
  });

  // Protected cloud-to-local pull trigger (authenticated Pro only)
  app.post('/api/sync/pull-cloud', requireLocalProAuth, async (_req, res) => {
    const result = await pullCloudFn({ timeoutMs: 8000, quiet: true });
    return res.status(result.ok ? 200 : 503).json(result);
  });

  // Public QR client read endpoint (strictly read-only, zero credentials exposed)
  app.get('/api/catalog', (_req, res) => {
    const raw = readLocalCatalog();
    if (!raw) {
      return res.status(404).json({ error: 'No local catalog snapshot stored yet.' });
    }
    return res.json({ state: scopeStateForRestaurant(raw) });
  });

  // Protected catalog write endpoint (authenticated Pro session + strict RBAC enforcement)
  app.put('/api/catalog', requireLocalProAuth, (req, res) => {
    const session = req.localSession;
    const { state, baseUpdatedAt, lastCloudSyncAt } = req.body || {};
    if (!state || !Array.isArray(state.restaurants) || !Array.isArray(state.menuItems)) {
      return res.status(400).json({ error: 'Invalid catalog payload.' });
    }

    if (config.restaurantId || config.restaurantSlug) {
      const unauthorizedRest = state.restaurants.find((r) => !isScopedRestaurant(r));
      if (unauthorizedRest) {
        return res.status(403).json({
          error: `Isolation stricte : ce serveur local est verrouillé sur ${config.restaurantSlug || config.restaurantId}.`,
        });
      }
      const allowedIds = new Set(state.restaurants.map((r) => r.id));
      const unauthorizedItem = state.menuItems.find((item) => !allowedIds.has(item.restaurantId));
      if (unauthorizedItem) {
        return res.status(403).json({
          error: 'Isolation stricte : un plat appartient à un autre restaurant.',
        });
      }
    }

    const existing = readLocalCatalog();

    if (session.role !== 'super_admin') {
      const violation = validateRestaurateurCatalogMutation(state, existing, session);
      if (violation) {
        return res.status(403).json({ error: violation });
      }
    }

    if (
      existing &&
      baseUpdatedAt &&
      existing.updatedAt &&
      existing.updatedAt > baseUpdatedAt
    ) {
      return res.status(409).json({
        error: 'Conflit : le catalogue du serveur local a été modifié plus récemment.',
        serverState: scopeStateForRestaurant(existing),
      });
    }

    const committed = writeLocalCatalog(state, { lastCloudSyncAt });
    void mirrorImagesFn(committed);

    return res.json({ state: scopeStateForRestaurant(committed) });
  });

  // Protected local image upload endpoint (dish photos only for restaurateur)
  app.post('/api/assets/upload', requireLocalProAuth, (req, res) => {
    const session = req.localSession;
    const { restaurantId, folder, fileName, dataUrl } = req.body || {};
    if (!restaurantId || !dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Missing restaurantId or dataUrl.' });
    }
    if (config.restaurantId && restaurantId !== config.restaurantId) {
      return res.status(403).json({ error: 'Strict isolation: invalid restaurantId.' });
    }

    if (session.role !== 'super_admin') {
      if (restaurantId !== session.restaurantId) {
        return res.status(403).json({
          error: 'Permission refusée : upload interdit pour un autre restaurant.',
        });
      }
      if (folder !== 'dishes') {
        return res.status(403).json({
          error: 'Permission refusée : seul le Super Admin peut modifier le logo du restaurant.',
        });
      }
    }

    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid base64 image dataUrl.' });
    }

    const safeRestId = String(restaurantId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFolder = folder === 'logos' ? 'logos' : 'dishes';
    const ext = extFromMime(match[1]);
    const baseName = String(fileName || `asset-${Date.now()}`)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.[^.]+$/, '');
    const finalName = `${Date.now()}-${baseName}.${ext}`;

    const destDir = path.join(uploadsDir, safeRestId, safeFolder);
    fs.mkdirSync(destDir, { recursive: true });
    const buffer = Buffer.from(match[2], 'base64');
    fs.writeFileSync(path.join(destDir, finalName), buffer);

    return res.json({
      url: `/local-uploads/${safeRestId}/${safeFolder}/${finalName}`,
    });
  });

  // Public cached image mirror for offline LAN clients
  app.get('/api/cached-image', (req, res) => {
    const targetUrl = String(req.query.url || '');
    if (!targetUrl) {
      return res.status(400).end();
    }
    const imageMap = readJsonSafe(imageMapFile, {});
    const fileName = imageMap[targetUrl];
    if (!fileName) {
      return res.status(404).end();
    }
    const fullPath = path.join(imageCacheDir, path.basename(fileName));
    if (!fs.existsSync(fullPath)) {
      return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    return res.sendFile(fullPath);
  });

  app.use('/local-uploads', express.static(uploadsDir, { maxAge: '30d' }));
  app.use('/local-cache', express.static(imageCacheDir, { maxAge: '30d' }));

  // Serve built Vite PWA static files unless disabled in tests
  if (!customOptions.disableStatic && fs.existsSync(distDir)) {
    app.use(express.static(distDir, { maxAge: '1d' }));
    app.use('/src/assets', (_req, res) => res.status(404).end());
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else if (!customOptions.disableStatic) {
    app.get('/', (_req, res) => {
      res
        .status(503)
        .send('Build dist/ manquant. Lancez "npm run build" avant de démarrer le serveur local.');
    });
  }

  return { app, config, getPrimaryLanUrl };
}

function startCliServer() {
  ensureDataDirectories();
  const { app, config, getPrimaryLanUrl } = createLocalServerApp();
  const PORT = config.port;
  const HOST = '0.0.0.0';

  function cleanupPidFile() {
    try {
      if (fs.existsSync(PID_FILE)) {
        const stored = fs.readFileSync(PID_FILE, 'utf8').trim();
        if (stored === String(process.pid)) {
          fs.unlinkSync(PID_FILE);
        }
      }
    } catch {
      // Ignore
    }
  }

  let syncTimer = null;

  const server = app.listen(PORT, HOST, () => {
    try {
      fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
    } catch {
      // Ignore PID file error
    }

    const lans = getLanAddresses();
    const primary = getPrimaryLanUrl();
    console.log(`\nSMARTMENU QR — Serveur Local Wi-Fi actif sur le port ${PORT}`);
    if (config.restaurantId || config.restaurantSlug) {
      console.log(`- Mode isolé restaurant : ${config.restaurantSlug || config.restaurantId}`);
    } else {
      console.log('- Mode multi-restaurants local (aucun restaurantId verrouillé dans config.json)');
    }
    console.log(`- Sur ce PC : http://localhost:${PORT}`);
    if (lans.length > 0) {
      for (const ip of lans) {
        console.log(`- Sur le réseau Wi-Fi local : http://${ip}:${PORT}`);
      }
    } else {
      console.log('- Aucune adresse Wi-Fi/LAN détectée.');
    }
    if (config.restaurantSlug || config.restaurantId) {
      const slug = config.restaurantSlug || config.restaurantId;
      console.log(`- Lien QR client recommandé : ${primary}/?restaurant=${slug}`);
    }
    console.log('Appuyez sur Ctrl+C ou exécutez stop-windows.bat pour arrêter.\n');

    if (config.autoSyncMinutes > 0 && config.supabaseUrl && config.supabaseAnonKey) {
      const intervalMs = Math.max(1, config.autoSyncMinutes) * 60 * 1000;
      syncTimer = setInterval(() => {
        void pullCloudCatalogToLocal({ timeoutMs: 6000, quiet: true });
      }, intervalMs);
      syncTimer.unref?.();
    }
  });

  function shutdown() {
    if (syncTimer) clearInterval(syncTimer);
    cleanupPidFile();
    server.close(() => process.exit(0));
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  startCliServer();
}
