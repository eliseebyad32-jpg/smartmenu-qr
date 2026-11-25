import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  atomicWriteFile,
  AUTH_FILE,
  CONFIG_FILE,
  DATA_FILE,
  ensureDataDirectories,
  extFromMime,
  IMAGE_CACHE_DIR,
  IMAGE_MAP_FILE,
  isMainModule,
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

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function sanitizeAccount(acc) {
  return {
    id: acc.id,
    username: acc.username,
    name: acc.name,
    ...(acc.email ? { email: acc.email } : {}),
    role: acc.role,
    assignedRestaurantId: acc.assignedRestaurantId ?? null,
    isActive: Boolean(acc.isActive),
  };
}

function escapeHtml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSafeConnectPortalHtml({ restaurantName, city, primaryColor, menuHref, tableLabel, ssid }) {
  const safeName = escapeHtml(restaurantName || 'SMARTMENU QR');
  const safeCity = escapeHtml(city || '');
  const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(String(primaryColor || '')) ? primaryColor : '#DC2626';
  const safeHref = escapeHtml(menuHref || '/');
  const safeTable = tableLabel ? ` · Table ${escapeHtml(tableLabel)}` : '';
  const safeSsid = ssid ? escapeHtml(ssid) : 'Wi-Fi Local';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
  <title>${safeName} — Accès Menu Local</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: #09090B;
      color: #F4F4F5;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: #141418;
      border: 1px solid #27272A;
      border-radius: 20px;
      padding: 28px 24px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    }
    .badge {
      display: inline-block;
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.35);
      color: #6EE7B7;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    h1 { font-size: 28px; line-height: 1.15; font-weight: 800; color: #FFFFFF; }
    .sub { margin-top: 8px; font-size: 14px; color: #A1A1AA; line-height: 1.5; }
    .meta {
      margin-top: 16px;
      background: #0F0F13;
      border: 1px solid #27272A;
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 12px;
      color: #D4D4D8;
      text-align: left;
      line-height: 1.5;
    }
    .cta {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 54px;
      margin-top: 22px;
      padding: 14px 18px;
      border-radius: 14px;
      border: none;
      background: ${safeColor};
      color: #FFFFFF;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.02em;
      text-decoration: none;
      cursor: pointer;
    }
    .cta:hover { filter: brightness(1.08); }
    .status { margin-top: 12px; font-size: 12px; color: #A1A1AA; min-height: 18px; }
  </style>
</head>
<body>
  <main class="card">
    <span class="badge">${safeSsid}${safeTable}</span>
    <h1>${safeName}</h1>
    ${safeCity ? `<p class="sub">${safeCity}</p>` : ''}
    <p class="sub">Vous êtes connecté au serveur local du restaurant. Appuyez sur le bouton ci-dessous pour consulter la carte complète, même sans Internet.</p>
    <div class="meta" id="portal-meta">Serveur local prêt — Catégories, plats, prix et images disponibles hors ligne.</div>
    <a class="cta" id="connect-btn" href="${safeHref}">CONNECTER ET ACCÉDER AU MENU</a>
    <p class="status" id="portal-status"></p>
  </main>
  <script>
    (function () {
      var btn = document.getElementById('connect-btn');
      var status = document.getElementById('portal-status');
      fetch('/api/health', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) {
            status.textContent = d.hasLocalSnapshot
              ? 'Menu local synchronisé prêt.'
              : 'Serveur local connecté.';
          }
        })
        .catch(function () {});
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        status.textContent = 'Ouverture du menu local...';
        window.location.assign(btn.getAttribute('href'));
      });
    })();
  </script>
</body>
</html>`;
}

function scoreLanInterface(name, address) {
  const lower = name.toLowerCase();
  let score = 0;
  if (/wi-?fi|wlan|wireless|sans fil|ethernet|eth\d|en\d|reseau local|r[eé]seau local/i.test(lower)) {
    score += 20;
  }
  if (/wi-?fi direct|local area connection\*/i.test(lower) || address.startsWith('192.168.137.')) {
    score += 18;
  }
  if (/virtualbox|vmware|wsl|hyper-v|vethernet|docker|loopback|tailscale|hamachi/i.test(lower)) {
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
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        candidates.push({
          name,
          address: iface.address,
          score: scoreLanInterface(name, iface.address),
        });
      }
    }
  }
  const physicalCandidates = candidates.filter((c) => c.score > -20);
  const selected = physicalCandidates.length > 0 ? physicalCandidates : candidates;
  selected.sort((a, b) => b.score - a.score);
  return [...new Set(selected.map((c) => c.address))];
}

export function createLocalServerApp(customOptions = {}) {
  const config = { ...(customOptions.config ?? loadLocalConfig()) };
  const configFile = customOptions.configFile ?? CONFIG_FILE;
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

  // Ensure any remote dish/logo/hero images in existing catalog snapshot are cached locally on disk
  const bootSnapshot = readJsonSafe(dataFile, null);
  if (bootSnapshot && !customOptions.skipStartupImageMirror) {
    void Promise.resolve(mirrorImagesFn(bootSnapshot)).catch(() => {});
  }

  const revokedJtis = new Set();
  const loginAttemptsByIp = new Map();

  function readAuthRecord() {
    const existing = readJsonSafe(authFile, null);
    if (existing && existing.tokenSecret) {
      return {
        ...existing,
        accounts: Array.isArray(existing.accounts) ? existing.accounts : [],
        refreshTokens: Array.isArray(existing.refreshTokens) ? existing.refreshTokens : [],
      };
    }
    const created = {
      tokenSecret: crypto.randomBytes(32).toString('hex'),
      salt: '',
      pinHash: '',
      role: 'restaurateur',
      restaurantId: config.restaurantId || null,
      accounts: [],
      refreshTokens: [],
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
    const now = Date.now();
    const pruneCutoff = now - 14 * 24 * 60 * 60 * 1000;
    const prunedRefresh = (Array.isArray(next.refreshTokens) ? next.refreshTokens : []).filter(
      (entry) =>
        entry &&
        entry.tokenHash &&
        typeof entry.expiresAt === 'number' &&
        entry.expiresAt > pruneCutoff
    );
    const cleanNext = {
      ...next,
      refreshTokens: prunedRefresh,
    };
    atomicWriteFile(authFile, JSON.stringify(cleanNext, null, 2));
    return cleanNext;
  }

  function createRefreshTokenEntry(existingTokens, meta) {
    const now = Date.now();
    const refreshTtlMs = (config.refreshTtlDays || 7) * 24 * 60 * 60 * 1000;
    const rawToken = base64UrlEncode(crypto.randomBytes(32));
    const refreshExpiresAt = now + refreshTtlMs;
    const entry = {
      id: crypto.randomUUID(),
      familyId: meta.familyId || crypto.randomUUID(),
      tokenHash: hashRefreshToken(rawToken),
      sub: meta.sub ?? null,
      role: meta.role,
      restaurantId: meta.restaurantId ?? null,
      createdAt: now,
      expiresAt: refreshExpiresAt,
      usedAt: null,
      revokedAt: null,
    };
    return {
      refreshToken: rawToken,
      refreshExpiresAt: new Date(refreshExpiresAt).toISOString(),
      nextRefreshTokens: [...(existingTokens || []), entry],
    };
  }

  function revokeRefreshTokenFamilies(tokens, predicate) {
    const now = Date.now();
    const familyIds = new Set();
    for (const entry of tokens || []) {
      if (predicate(entry) && entry.familyId) {
        familyIds.add(entry.familyId);
      }
    }
    if (familyIds.size === 0) return tokens || [];
    return (tokens || []).map((entry) =>
      familyIds.has(entry.familyId) && !entry.revokedAt ? { ...entry, revokedAt: now } : entry
    );
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
      hasPendingLocalChanges: Boolean(state.hasPendingLocalChanges),
      serverSavedAt: state.serverSavedAt || state.updatedAt || null,
    };
  }

  function writeLocalCatalog(state, meta = {}) {
    const now = new Date().toISOString();
    const hasCloudSyncTimestamp = Boolean(meta.lastCloudSyncAt);
    const next = {
      restaurants: state.restaurants || [],
      categories: state.categories || [],
      menuItems: state.menuItems || [],
      users: [],
      updatedAt: state.updatedAt || now,
      baseUpdatedAt: state.baseUpdatedAt || state.updatedAt || now,
      lastCloudSyncAt: meta.lastCloudSyncAt ?? state.lastCloudSyncAt ?? null,
      hasPendingLocalChanges: !hasCloudSyncTimestamp,
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
    const payload = verifySessionToken(token, authRecord.tokenSecret, revokedJtis);
    if (!payload) return null;

    if (payload.sub) {
      const account = (authRecord.accounts || []).find((a) => a.id === payload.sub);
      if (!account || !account.isActive) return null;
      if (account.revokedBefore && payload.iat <= account.revokedBefore) return null;
      return {
        ...payload,
        role: account.role,
        restaurantId: account.assignedRestaurantId ?? null,
        account: sanitizeAccount(account),
      };
    }

    return payload;
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

  function requireSuperAdminAuth(req, res, next) {
    const session = resolveRequestSession(req);
    if (!session || session.role !== 'super_admin') {
      return res.status(session ? 403 : 401).json({
        error: 'Action réservée exclusivement au Super Admin.',
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

  // Public server network metadata (no secrets or wifiPassword exposed)
  app.get('/api/server-info', (_req, res) => {
    const lans = getLanAddresses();
    const state = readLocalCatalog();
    const imageMap = readJsonSafe(imageMapFile, {});
    const authRecord = readAuthRecord();
    const primaryLan = getPrimaryLanUrl();
    const slug =
      config.restaurantSlug ||
      state?.restaurants?.[0]?.slug ||
      '';
    res.json({
      ok: true,
      mode: 'local-lan-server',
      port: config.port,
      lanUrls: lans.map((ip) => `http://${ip}:${config.port}`),
      primaryLanUrl: primaryLan,
      configuredPublicUrl: config.publicLanUrl || null,
      onlineBaseUrl: config.onlineBaseUrl || '',
      wifiSsid: config.wifiSsid || '',
      wifiSecurity: config.wifiSecurity || 'WPA',
      wifiConfigured: Boolean(config.wifiSsid),
      captivePortalEnabled: config.captivePortalEnabled !== false,
      connectUrl: `${primaryLan}/connect${slug ? `?restaurant=${encodeURIComponent(slug)}` : ''}`,
      restaurantId: config.restaurantId || null,
      restaurantSlug: config.restaurantSlug || null,
      hasLocalSnapshot: Boolean(state),
      pinConfigured: Boolean(authRecord.pinHash),
      lastCloudSyncAt: state?.lastCloudSyncAt || null,
      hasPendingLocalChanges: Boolean(state?.hasPendingLocalChanges),
      cachedImagesCount: Object.keys(imageMap).length,
      updatedAt: state?.updatedAt || null,
    });
  });

  // Protected local Wi-Fi & Dual QR settings (Pro session required so wifiPassword stays private)
  app.get('/api/local-wifi-config', requireLocalProAuth, (_req, res) => {
    res.json({
      ok: true,
      wifiSsid: config.wifiSsid || '',
      wifiPassword: config.wifiPassword || '',
      wifiSecurity: config.wifiSecurity || 'WPA',
      onlineBaseUrl: config.onlineBaseUrl || '',
      captivePortalEnabled: config.captivePortalEnabled !== false,
    });
  });

  app.put('/api/local-wifi-config', requireLocalProAuth, (req, res) => {
    const body = req.body || {};
    const nextSsid = String(body.wifiSsid ?? '').trim().slice(0, 64);
    const nextSecurityRaw = String(body.wifiSecurity ?? 'WPA').trim();
    const nextSecurity =
      nextSecurityRaw === 'WEP' || nextSecurityRaw === 'nopass' ? nextSecurityRaw : 'WPA';
    const nextPassword =
      nextSecurity === 'nopass' ? '' : String(body.wifiPassword ?? '').slice(0, 64);
    const rawOnlineUrl = String(body.onlineBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (rawOnlineUrl && !/^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?(\/.*)?$/.test(rawOnlineUrl)) {
      return res.status(400).json({ error: 'URL publique en ligne invalide (http:// ou https:// requis).' });
    }
    const nextCaptive = body.captivePortalEnabled !== false;

    config.wifiSsid = nextSsid;
    config.wifiPassword = nextPassword;
    config.wifiSecurity = nextSecurity;
    config.onlineBaseUrl = rawOnlineUrl;
    config.captivePortalEnabled = nextCaptive;

    const existingFileCfg = readJsonSafe(configFile, {});
    const mergedFileCfg = {
      ...existingFileCfg,
      port: existingFileCfg.port ?? config.port,
      wifiSsid: nextSsid,
      wifiPassword: nextPassword,
      wifiSecurity: nextSecurity,
      onlineBaseUrl: rawOnlineUrl,
      captivePortalEnabled: nextCaptive,
    };
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    atomicWriteFile(configFile, `${JSON.stringify(mergedFileCfg, null, 2)}\n`);

    return res.json({
      ok: true,
      config: {
        wifiSsid: config.wifiSsid,
        wifiPassword: config.wifiPassword,
        wifiSecurity: config.wifiSecurity,
        onlineBaseUrl: config.onlineBaseUrl,
        captivePortalEnabled: config.captivePortalEnabled,
      },
    });
  });

  // Account-based authentication status (safe metadata only)
  app.get('/api/auth/status', (req, res) => {
    const authRecord = readAuthRecord();
    const accounts = authRecord.accounts || [];
    const hasSuperAdmin = accounts.some((a) => a.role === 'super_admin' && a.isActive);
    const session = resolveRequestSession(req);
    res.json({
      ok: true,
      hasSuperAdmin,
      authenticated: Boolean(session?.account),
      user: session?.account ?? null,
      localhostSetupAllowed: isLocalhostRequest(req),
    });
  });

  // First-run Super Admin setup (restricted to localhost PC and zero existing active super_admin)
  app.post('/api/auth/setup-admin', (req, res) => {
    if (!isLocalhostRequest(req)) {
      return res.status(403).json({
        error: 'Création initiale du Super Admin autorisée uniquement depuis le PC serveur (localhost).',
      });
    }

    const authRecord = readAuthRecord();
    const accounts = authRecord.accounts || [];
    if (accounts.some((a) => a.role === 'super_admin' && a.isActive)) {
      return res.status(409).json({
        error: 'Un compte Super Admin principal existe déjà.',
      });
    }

    const { username, name, email, password } = req.body || {};
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const fullName = String(name || '').trim() || normalizedUsername;
    const pwd = String(password || '');

    if (normalizedUsername.length < 2 || normalizedUsername.length > 50) {
      return res.status(400).json({ error: 'Identifiant invalide (2 à 50 caractères).' });
    }
    if (normalizedEmail && !normalizedEmail.includes('@')) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }
    if (pwd.length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
    }
    if (
      accounts.some(
        (a) =>
          a.username.toLowerCase() === normalizedUsername ||
          (normalizedEmail && a.email && a.email.toLowerCase() === normalizedEmail)
      )
    ) {
      return res.status(409).json({ error: 'Cet identifiant ou e-mail est déjà utilisé.' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const nowIso = new Date().toISOString();
    const adminAccount = {
      id: `user-${crypto.randomUUID()}`,
      username: normalizedUsername,
      email: normalizedEmail,
      name: fullName,
      role: 'super_admin',
      assignedRestaurantId: null,
      salt,
      passwordHash: hashPin(pwd, salt),
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      revokedBefore: 0,
    };

    const { refreshToken, refreshExpiresAt, nextRefreshTokens } = createRefreshTokenEntry(
      authRecord.refreshTokens,
      {
        sub: adminAccount.id,
        role: 'super_admin',
        restaurantId: null,
      }
    );

    writeAuthRecord({
      ...authRecord,
      accounts: [...accounts, adminAccount],
      refreshTokens: nextRefreshTokens,
      updatedAt: nowIso,
    });

    const now = Date.now();
    const ttlMs = (config.sessionTtlMinutes || 480) * 60 * 1000;
    const token = signSessionToken(
      {
        jti: crypto.randomUUID(),
        sub: adminAccount.id,
        role: 'super_admin',
        restaurantId: null,
        iat: now,
        exp: now + ttlMs,
      },
      authRecord.tokenSecret
    );

    return res.json({
      ok: true,
      token,
      refreshToken,
      refreshExpiresAt,
      user: sanitizeAccount(adminAccount),
    });
  });

  // Username + Password login -> returns signed HMAC Bearer token + single-use rotating refresh token
  app.post('/api/auth/login', (req, res) => {
    const clientKey = getClientKey(req);
    const limit = checkRateLimit(clientKey);
    if (limit.blocked) {
      return res.status(429).json({
        error: `Trop de tentatives échouées. Réessayez dans ${limit.retryAfterSeconds}s.`,
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    const { identifier, password } = req.body || {};
    const normalized = String(identifier || '').trim().toLowerCase();
    const pwd = String(password || '');
    const authRecord = readAuthRecord();
    const accounts = authRecord.accounts || [];

    const account = accounts.find(
      (a) =>
        a.username.toLowerCase() === normalized ||
        (a.email && a.email.toLowerCase() === normalized)
    );

    if (!account || !account.isActive || !verifyPinHash(pwd, account.salt, account.passwordHash)) {
      const failure = recordFailedAttempt(clientKey);
      if (failure.lockedUntil) {
        return res.status(429).json({
          error: 'Trop de tentatives échouées. Connexion temporairement verrouillée.',
          retryAfterSeconds: Math.ceil((failure.lockedUntil - Date.now()) / 1000),
        });
      }
      return res.status(401).json({
        error: 'Identifiants invalides ou compte suspendu.',
        remainingAttempts: Math.max(0, failure.maxAttempts - failure.count),
      });
    }

    clearFailedAttempts(clientKey);

    const { refreshToken, refreshExpiresAt, nextRefreshTokens } = createRefreshTokenEntry(
      authRecord.refreshTokens,
      {
        sub: account.id,
        role: account.role,
        restaurantId: account.assignedRestaurantId ?? null,
      }
    );
    writeAuthRecord({
      ...authRecord,
      refreshTokens: nextRefreshTokens,
      updatedAt: new Date().toISOString(),
    });

    const now = Date.now();
    const ttlMs = (config.sessionTtlMinutes || 480) * 60 * 1000;
    const token = signSessionToken(
      {
        jti: crypto.randomUUID(),
        sub: account.id,
        role: account.role,
        restaurantId: account.assignedRestaurantId ?? null,
        iat: now,
        exp: now + ttlMs,
      },
      authRecord.tokenSecret
    );

    return res.json({
      ok: true,
      token,
      refreshToken,
      refreshExpiresAt,
      user: sanitizeAccount(account),
    });
  });

  // Single-use refresh token rotation with token-family reuse detection
  app.post('/api/auth/refresh', (req, res) => {
    const clientKey = getClientKey(req);
    const limit = checkRateLimit(clientKey);
    if (limit.blocked) {
      return res.status(429).json({
        error: `Trop de tentatives. Réessayez dans ${limit.retryAfterSeconds}s.`,
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    const rawRefresh = String(req.body?.refreshToken || '').trim();
    if (!rawRefresh) {
      return res.status(400).json({ ok: false, error: 'Jeton de renouvellement manquant.', reason: 'invalid_refresh_token' });
    }

    const authRecord = readAuthRecord();
    const tokenHash = hashRefreshToken(rawRefresh);
    const tokens = authRecord.refreshTokens || [];
    const entry = tokens.find((t) => t.tokenHash === tokenHash);

    if (!entry) {
      return res.status(401).json({ ok: false, error: 'Session expirée ou invalide.', reason: 'invalid_refresh_token' });
    }

    if (entry.usedAt || entry.revokedAt) {
      const revokedTokens = revokeRefreshTokenFamilies(tokens, (t) => t.familyId === entry.familyId);
      writeAuthRecord({
        ...authRecord,
        refreshTokens: revokedTokens,
        updatedAt: new Date().toISOString(),
      });
      return res.status(401).json({ ok: false, error: 'Session révoquée.', reason: 'revoked' });
    }

    const now = Date.now();
    if (now >= entry.expiresAt) {
      return res.status(401).json({ ok: false, error: 'Session expirée.', reason: 'expired' });
    }

    let account = null;
    if (entry.sub) {
      account = (authRecord.accounts || []).find((a) => a.id === entry.sub) || null;
      if (!account || !account.isActive) {
        const revokedTokens = revokeRefreshTokenFamilies(tokens, (t) => t.sub === entry.sub);
        writeAuthRecord({
          ...authRecord,
          refreshTokens: revokedTokens,
          updatedAt: new Date().toISOString(),
        });
        return res.status(401).json({ ok: false, error: 'Compte inactif ou introuvable.', reason: 'inactive' });
      }
      if (account.revokedBefore && entry.createdAt <= account.revokedBefore) {
        const revokedTokens = revokeRefreshTokenFamilies(tokens, (t) => t.familyId === entry.familyId);
        writeAuthRecord({
          ...authRecord,
          refreshTokens: revokedTokens,
          updatedAt: new Date().toISOString(),
        });
        return res.status(401).json({ ok: false, error: 'Session révoquée.', reason: 'revoked' });
      }
    }

    const effectiveRole = account ? account.role : entry.role;
    const effectiveRestaurantId = account ? (account.assignedRestaurantId ?? null) : (entry.restaurantId ?? null);

    const markedUsed = tokens.map((t) => (t.id === entry.id ? { ...t, usedAt: now } : t));
    const { refreshToken, refreshExpiresAt, nextRefreshTokens } = createRefreshTokenEntry(
      markedUsed,
      {
        familyId: entry.familyId,
        sub: entry.sub ?? null,
        role: effectiveRole,
        restaurantId: effectiveRestaurantId,
      }
    );

    writeAuthRecord({
      ...authRecord,
      refreshTokens: nextRefreshTokens,
      updatedAt: new Date(now).toISOString(),
    });

    const ttlMs = (config.sessionTtlMinutes || 480) * 60 * 1000;
    const accessPayload = {
      jti: crypto.randomUUID(),
      ...(entry.sub ? { sub: entry.sub } : {}),
      role: effectiveRole,
      restaurantId: effectiveRestaurantId,
      iat: now,
      exp: now + ttlMs,
    };
    const token = signSessionToken(accessPayload, authRecord.tokenSecret);

    return res.json({
      ok: true,
      token,
      refreshToken,
      refreshExpiresAt,
      user: account ? sanitizeAccount(account) : null,
      role: effectiveRole,
      restaurantId: effectiveRestaurantId,
      expiresAt: new Date(accessPayload.exp).toISOString(),
    });
  });

  app.get('/api/auth/me', (req, res) => {
    const session = resolveRequestSession(req);
    if (!session?.account) {
      return res.status(401).json({ ok: false, user: null });
    }
    return res.json({ ok: true, user: session.account });
  });

  app.post('/api/auth/logout', (req, res) => {
    const session = resolveRequestSession(req);
    if (session?.jti) {
      revokedJtis.add(session.jti);
    }
    const rawRefresh = String(req.body?.refreshToken || '').trim();
    if (rawRefresh) {
      const authRecord = readAuthRecord();
      const targetHash = hashRefreshToken(rawRefresh);
      const nextRefreshTokens = revokeRefreshTokenFamilies(
        authRecord.refreshTokens,
        (t) => t.tokenHash === targetHash
      );
      writeAuthRecord({
        ...authRecord,
        refreshTokens: nextRefreshTokens,
        updatedAt: new Date().toISOString(),
      });
    }
    return res.json({ ok: true });
  });

  app.post('/api/auth/change-credentials', requireSuperAdminAuth, (req, res) => {
    const session = req.localSession;
    if (!session.sub) {
      return res.status(403).json({ error: 'Connectez-vous avec un compte Super Admin.' });
    }
    const { username, email, password, name } = req.body || {};
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const hasEmailField = typeof email === 'string';
    const normalizedEmail = hasEmailField ? email.trim().toLowerCase() : undefined;
    const pwd = String(password || '');
    const fullName = String(name || '').trim();

    if (normalizedUsername.length < 2 || normalizedUsername.length > 50) {
      return res.status(400).json({ error: 'Identifiant invalide (2 à 50 caractères).' });
    }
    if (normalizedEmail && !normalizedEmail.includes('@')) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }
    if (pwd && pwd.length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
    }

    const authRecord = readAuthRecord();
    const accounts = authRecord.accounts || [];
    if (
      accounts.some(
        (a) =>
          a.id !== session.sub &&
          (a.username.toLowerCase() === normalizedUsername ||
            (normalizedEmail && a.email && a.email.toLowerCase() === normalizedEmail))
      )
    ) {
      return res.status(409).json({ error: 'Cet identifiant ou e-mail est déjà utilisé.' });
    }

    let updatedAccount = null;
    const nextAccounts = accounts.map((acc) => {
      if (acc.id !== session.sub) return acc;
      const nextSalt = pwd ? crypto.randomBytes(16).toString('hex') : acc.salt;
      updatedAccount = {
        ...acc,
        username: normalizedUsername,
        email: normalizedEmail !== undefined ? normalizedEmail : acc.email || '',
        name: fullName || acc.name,
        salt: nextSalt,
        passwordHash: pwd ? hashPin(pwd, nextSalt) : acc.passwordHash,
        updatedAt: new Date().toISOString(),
      };
      return updatedAccount;
    });

    if (!updatedAccount) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }

    const nextRefreshTokens = pwd
      ? revokeRefreshTokenFamilies(authRecord.refreshTokens, (t) => t.sub === session.sub)
      : authRecord.refreshTokens;
    writeAuthRecord({
      ...authRecord,
      accounts: nextAccounts,
      refreshTokens: nextRefreshTokens,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ ok: true, user: sanitizeAccount(updatedAccount) });
  });

  // Isolated self-service password change (only updates the caller's own passwordHash)
  app.post('/api/auth/change-password', requireLocalProAuth, (req, res) => {
    const session = req.localSession;
    if (!session.sub) {
      return res.status(403).json({ error: 'Connectez-vous avec un compte utilisateur.' });
    }
    const { currentPassword, newPassword } = req.body || {};
    const curPwd = String(currentPassword || '');
    const nextPwd = String(newPassword || '');

    if (nextPwd.length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
    }

    const authRecord = readAuthRecord();
    const accounts = authRecord.accounts || [];
    const target = accounts.find((a) => a.id === session.sub);
    if (!target || !target.isActive) {
      return res.status(404).json({ error: 'Compte introuvable ou suspendu.' });
    }
    if (!verifyPinHash(curPwd, target.salt, target.passwordHash)) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
    }

    const nextSalt = crypto.randomBytes(16).toString('hex');
    const nextAccounts = accounts.map((acc) =>
      acc.id === session.sub
        ? {
            ...acc,
            salt: nextSalt,
            passwordHash: hashPin(nextPwd, nextSalt),
            updatedAt: new Date().toISOString(),
          }
        : acc
    );

    const nextRefreshTokens = revokeRefreshTokenFamilies(
      authRecord.refreshTokens,
      (t) => t.sub === session.sub
    );
    writeAuthRecord({
      ...authRecord,
      accounts: nextAccounts,
      refreshTokens: nextRefreshTokens,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ ok: true });
  });

  // Super Admin Account Management Endpoints
  app.get('/api/admin/users', requireSuperAdminAuth, (_req, res) => {
    const authRecord = readAuthRecord();
    return res.json({
      ok: true,
      users: (authRecord.accounts || []).map(sanitizeAccount),
    });
  });

  app.post('/api/admin/users', requireSuperAdminAuth, (req, res) => {
    const { username, name, email, password, restaurantId } = req.body || {};
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const fullName = String(name || '').trim() || normalizedUsername;
    const pwd = String(password || '');
    const restId = String(restaurantId || '').trim();

    if (normalizedUsername.length < 2 || normalizedUsername.length > 50) {
      return res.status(400).json({ error: 'Identifiant invalide (2 à 50 caractères).' });
    }
    if (normalizedEmail && !normalizedEmail.includes('@')) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }
    if (pwd.length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
    }
    if (!restId) {
      return res.status(400).json({ error: 'Veuillez sélectionner un restaurant.' });
    }

    const authRecord = readAuthRecord();
    const accounts = authRecord.accounts || [];
    if (
      accounts.some(
        (a) =>
          a.username.toLowerCase() === normalizedUsername ||
          (normalizedEmail && a.email && a.email.toLowerCase() === normalizedEmail)
      )
    ) {
      return res.status(409).json({ error: 'Cet identifiant ou e-mail existe déjà.' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const nowIso = new Date().toISOString();
    const created = {
      id: `user-${crypto.randomUUID()}`,
      username: normalizedUsername,
      email: normalizedEmail,
      name: fullName,
      role: 'restaurateur',
      assignedRestaurantId: restId,
      salt,
      passwordHash: hashPin(pwd, salt),
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
      revokedBefore: 0,
    };

    writeAuthRecord({
      ...authRecord,
      accounts: [...accounts, created],
      updatedAt: nowIso,
    });

    return res.json({ ok: true, user: sanitizeAccount(created) });
  });

  app.patch('/api/admin/users/:id', requireSuperAdminAuth, (req, res) => {
    const targetId = req.params.id;
    const { username, name, email, restaurantId } = req.body || {};
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const fullName = String(name || '').trim() || normalizedUsername;
    const restId = restaurantId ? String(restaurantId).trim() : null;

    if (normalizedUsername.length < 2 || normalizedUsername.length > 50) {
      return res.status(400).json({ error: 'Identifiant invalide (2 à 50 caractères).' });
    }
    if (normalizedEmail && !normalizedEmail.includes('@')) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }

    const authRecord = readAuthRecord();
    const accounts = authRecord.accounts || [];
    if (
      accounts.some(
        (a) =>
          a.id !== targetId &&
          (a.username.toLowerCase() === normalizedUsername ||
            (normalizedEmail && a.email && a.email.toLowerCase() === normalizedEmail))
      )
    ) {
      return res.status(409).json({ error: 'Cet identifiant ou e-mail est déjà utilisé.' });
    }

    let updatedAccount = null;
    const nextAccounts = accounts.map((acc) => {
      if (acc.id !== targetId) return acc;
      updatedAccount = {
        ...acc,
        username: normalizedUsername,
        name: fullName,
        email: normalizedEmail,
        assignedRestaurantId: acc.role === 'restaurateur' ? restId : acc.assignedRestaurantId,
        updatedAt: new Date().toISOString(),
      };
      return updatedAccount;
    });

    if (!updatedAccount) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }

    writeAuthRecord({ ...authRecord, accounts: nextAccounts, updatedAt: new Date().toISOString() });
    return res.json({ ok: true, user: sanitizeAccount(updatedAccount) });
  });

  app.patch('/api/admin/users/:id/password', requireSuperAdminAuth, (req, res) => {
    const targetId = req.params.id;
    const pwd = String(req.body?.newPassword || '');
    if (pwd.length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
    }

    const authRecord = readAuthRecord();
    const accounts = authRecord.accounts || [];
    let found = false;
    const nowMs = Date.now();
    const nextAccounts = accounts.map((acc) => {
      if (acc.id !== targetId) return acc;
      found = true;
      const salt = crypto.randomBytes(16).toString('hex');
      return {
        ...acc,
        salt,
        passwordHash: hashPin(pwd, salt),
        revokedBefore: nowMs,
        updatedAt: new Date(nowMs).toISOString(),
      };
    });

    if (!found) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }

    const nextRefreshTokens = revokeRefreshTokenFamilies(
      authRecord.refreshTokens,
      (t) => t.sub === targetId
    );
    writeAuthRecord({
      ...authRecord,
      accounts: nextAccounts,
      refreshTokens: nextRefreshTokens,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ ok: true });
  });

  app.patch('/api/admin/users/:id/status', requireSuperAdminAuth, (req, res) => {
    const targetId = req.params.id;
    const isActive = Boolean(req.body?.isActive);
    if (targetId === req.localSession.sub && !isActive) {
      return res.status(400).json({ error: 'Impossible de suspendre votre propre compte actif.' });
    }

    const authRecord = readAuthRecord();
    const accounts = authRecord.accounts || [];
    let found = false;
    const nowMs = Date.now();
    const nextAccounts = accounts.map((acc) => {
      if (acc.id !== targetId) return acc;
      found = true;
      return {
        ...acc,
        isActive,
        revokedBefore: isActive ? acc.revokedBefore || 0 : nowMs,
        updatedAt: new Date(nowMs).toISOString(),
      };
    });

    if (!found) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }

    const nextRefreshTokens = !isActive
      ? revokeRefreshTokenFamilies(authRecord.refreshTokens, (t) => t.sub === targetId)
      : authRecord.refreshTokens;

    writeAuthRecord({
      ...authRecord,
      accounts: nextAccounts,
      refreshTokens: nextRefreshTokens,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ ok: true });
  });

  app.patch('/api/admin/users/:id/restaurant', requireSuperAdminAuth, (req, res) => {
    const targetId = req.params.id;
    const nextRestId = req.body?.restaurantId ? String(req.body.restaurantId).trim() : null;

    const authRecord = readAuthRecord();
    const accounts = authRecord.accounts || [];
    let found = false;
    const nextAccounts = accounts.map((acc) => {
      if (acc.id !== targetId || acc.role !== 'restaurateur') return acc;
      found = true;
      return {
        ...acc,
        assignedRestaurantId: nextRestId,
        updatedAt: new Date().toISOString(),
      };
    });

    if (!found) {
      return res.status(404).json({ error: 'Compte restaurateur introuvable.' });
    }

    writeAuthRecord({ ...authRecord, accounts: nextAccounts, updatedAt: new Date().toISOString() });
    return res.json({ ok: true });
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

    const { refreshToken, refreshExpiresAt, nextRefreshTokens } = createRefreshTokenEntry(
      authRecord.refreshTokens,
      {
        sub: null,
        role: 'restaurateur',
        restaurantId: resolvedRestaurantId,
      }
    );
    writeAuthRecord({
      ...authRecord,
      refreshTokens: nextRefreshTokens,
      updatedAt: new Date().toISOString(),
    });

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
      refreshToken,
      refreshExpiresAt,
      role: payload.role,
      restaurantId: payload.restaurantId,
      expiresAt: new Date(payload.exp).toISOString(),
    });
  });

  // Revoke active local session token + refresh family
  app.post('/api/auth/local-logout', (req, res) => {
    const session = resolveRequestSession(req);
    if (session?.jti) {
      revokedJtis.add(session.jti);
    }
    const rawRefresh = String(req.body?.refreshToken || '').trim();
    if (rawRefresh) {
      const authRecord = readAuthRecord();
      const targetHash = hashRefreshToken(rawRefresh);
      const nextRefreshTokens = revokeRefreshTokenFamilies(
        authRecord.refreshTokens,
        (t) => t.tokenHash === targetHash
      );
      writeAuthRecord({
        ...authRecord,
        refreshTokens: nextRefreshTokens,
        updatedAt: new Date().toISOString(),
      });
    }
    return res.json({ ok: true });
  });

  // Protected cloud-to-local pull trigger (authenticated Pro only)
  app.post('/api/sync/pull-cloud', requireLocalProAuth, async (req, res) => {
    const result = await pullCloudFn({
      timeoutMs: 8000,
      quiet: true,
      force: Boolean(req.body?.force),
    });
    if (result.ok) {
      return res.status(200).json(result);
    }
    const status = result.reason === 'local_changes_pending_preserved' ? 409 : 503;
    return res.status(status).json(result);
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

    if (existing && baseUpdatedAt && existing.updatedAt) {
      const existingMs = Date.parse(existing.updatedAt);
      const baseMs = Date.parse(baseUpdatedAt);
      const hasConflict =
        Number.isFinite(existingMs) && Number.isFinite(baseMs)
          ? existingMs > baseMs + 2000
          : existing.updatedAt > baseUpdatedAt;
      if (hasConflict) {
        return res.status(409).json({
          error: 'Conflit : le catalogue du serveur local a été modifié plus récemment.',
          serverState: scopeStateForRestaurant(existing),
        });
      }
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

    const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
    if (!match) {
      return res.status(400).json({ error: 'Format d’image non autorisé (JPEG, PNG ou WebP uniquement).' });
    }

    const safeRestId = String(restaurantId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFolder = folder === 'logos' ? 'logos' : 'dishes';
    const ext = extFromMime(match[1]);
    const baseName = String(fileName || `asset-${Date.now()}`)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.[^.]+$/, '');
    const finalName = `${Date.now()}-${baseName}.${ext}`;

    const destDir = path.resolve(uploadsDir, safeRestId, safeFolder);
    const baseUploadsDir = path.resolve(uploadsDir);
    if (!destDir.startsWith(baseUploadsDir + path.sep)) {
      return res.status(400).json({ error: 'Chemin de destination invalide.' });
    }
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 500_000) {
      return res.status(413).json({ error: 'Image trop volumineuse (max 500 Ko).' });
    }
    const destFile = path.resolve(destDir, finalName);
    if (!destFile.startsWith(destDir + path.sep)) {
      return res.status(400).json({ error: 'Nom de fichier invalide.' });
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(destFile, buffer);

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
    const baseCacheDir = path.resolve(imageCacheDir);
    const fullPath = path.resolve(baseCacheDir, path.basename(fileName));
    if (!fullPath.startsWith(baseCacheDir + path.sep) || !fs.existsSync(fullPath)) {
      return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    return res.sendFile(fullPath);
  });

  // Self-contained Local Wi-Fi Welcome Portal ("CONNECTER ET ACCÉDER AU MENU")
  function resolveConnectPortalContext(req) {
    const state = readLocalCatalog();
    const restaurants = (state?.restaurants || []).filter(isScopedRestaurant);
    const reqSlug = String(req.query.restaurant || '').trim();
    const tableLabel = String(req.query.table || '').trim();
    const target =
      (reqSlug ? restaurants.find((r) => r.slug === reqSlug) : null) ||
      (config.restaurantSlug ? restaurants.find((r) => r.slug === config.restaurantSlug) : null) ||
      restaurants[0] ||
      null;
    const slug = target?.slug || reqSlug || config.restaurantSlug || '';
    const params = new URLSearchParams();
    if (slug) params.set('restaurant', slug);
    if (tableLabel) params.set('table', tableLabel);
    const q = params.toString();
    return {
      restaurantName: target?.name || 'SMARTMENU QR',
      city: target?.city || '',
      primaryColor: target?.primaryColor || '#DC2626',
      menuHref: `/${q ? `?${q}` : ''}`,
      portalHref: `/connect${q ? `?${q}` : ''}`,
      tableLabel,
      ssid: config.wifiSsid || '',
    };
  }

  app.get(['/connect', '/welcome'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const ctx = resolveConnectPortalContext(req);
    return res.status(200).send(buildSafeConnectPortalHtml(ctx));
  });

  // Captive portal probe endpoints (Android / iOS / Windows OS probes when router/DNS points here)
  const captiveProbePaths = [
    '/generate_204',
    '/gen_204',
    '/hotspot-detect.html',
    '/library/test/success.html',
    '/connecttest.txt',
    '/ncsi.txt',
    '/canonical.html',
  ];
  app.all(captiveProbePaths, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    if (config.captivePortalEnabled === false) {
      return res.status(204).end();
    }
    const ctx = resolveConnectPortalContext(req);
    return res.redirect(302, ctx.portalHref);
  });

  app.use('/local-uploads', express.static(uploadsDir, { maxAge: '30d' }));
  app.use('/local-cache', express.static(imageCacheDir, { maxAge: '30d' }));
  app.use(['/local-uploads', '/local-cache'], (_req, res) => res.status(404).end());

  // Serve built Vite PWA static files unless disabled in tests
  if (!customOptions.disableStatic && fs.existsSync(distDir)) {
    const noStoreHeaders = (res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    };

    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          const normalized = filePath.replace(/\\/g, '/');
          const base = path.basename(normalized);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'manifest.webmanifest' ||
            /^workbox-.*\.js$/i.test(base)
          ) {
            noStoreHeaders(res);
          } else if (normalized.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );

    // Never serve index.html for missing JS/CSS/media assets (fixes MIME / blank white screen errors)
    app.use(['/assets', '/src/assets'], (_req, res) => res.status(404).end());
    app.get('*', (req, res) => {
      if (/\.[a-z0-9]{1,8}$/i.test(req.path) && !/\.html?$/i.test(req.path)) {
        return res.status(404).end();
      }
      noStoreHeaders(res);
      return res.sendFile(path.join(distDir, 'index.html'));
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
    console.log('\n==============================================================');
    console.log(`  SMARTMENU QR — Serveur Local Wi-Fi actif (port ${PORT})`);
    console.log('==============================================================');
    if (config.restaurantId || config.restaurantSlug) {
      console.log(`  Mode isole restaurant : ${config.restaurantSlug || config.restaurantId}`);
    } else {
      console.log('  Mode multi-restaurants local actif');
    }
    console.log('');
    console.log(`  [PC]        Adresse locale : http://localhost:${PORT}`);
    if (config.publicLanUrl) {
      console.log(`  [TELEPHONE] Adresse Wi-Fi  : ${config.publicLanUrl}`);
    }
    if (lans.length > 0) {
      for (const ip of lans) {
        console.log(`  [TELEPHONE] Adresse Wi-Fi  : http://${ip}:${PORT}`);
      }
    } else if (!config.publicLanUrl) {
      console.log('  [TELEPHONE] Aucune adresse Wi-Fi detectee (verifiez la connexion Wi-Fi du PC).');
    }
    if (config.restaurantSlug || config.restaurantId) {
      const slug = config.restaurantSlug || config.restaurantId;
      console.log(`  [QR MENU]   Lien direct    : ${primary}/?restaurant=${slug}`);
    }
    console.log('==============================================================');
    console.log('  Laissez cette fenetre ouverte pendant l\'utilisation.');
    console.log('  Appuyez sur Ctrl+C ou lancez stop-windows.bat pour arreter.\n');

    if (config.autoSyncMinutes > 0 && config.supabaseUrl && config.supabaseAnonKey) {
      void pullCloudCatalogToLocal({ timeoutMs: 6000, quiet: true });
      const intervalMs = Math.max(1, config.autoSyncMinutes) * 60 * 1000;
      syncTimer = setInterval(() => {
        void pullCloudCatalogToLocal({ timeoutMs: 6000, quiet: true });
      }, intervalMs);
      syncTimer.unref?.();
    }
  });

  server.on('error', (err) => {
    cleanupPidFile();
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\n[ERREUR] Le port ${PORT} est deja utilise par un autre programme.`);
      console.error('Executez local-server\\stop-windows.bat ou changez "port" dans local-server\\config.json.\n');
    } else if (err && err.code === 'EACCES') {
      console.error(`\n[ERREUR] Permission refusee pour ouvrir le port ${PORT}.\n`);
    } else {
      console.error('\n[ERREUR] Impossible de demarrer le serveur local :', err?.message || err);
    }
    process.exit(1);
  });

  function shutdown() {
    if (syncTimer) clearInterval(syncTimer);
    cleanupPidFile();
    server.close(() => process.exit(0));
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (isMainModule(import.meta.url)) {
  startCliServer();
}
