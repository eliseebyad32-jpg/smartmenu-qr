import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  atomicWriteFile,
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

const DIST_DIR = path.join(ROOT_DIR, 'dist');
ensureDataDirectories();

const config = loadLocalConfig();
const PORT = config.port;
const HOST = '0.0.0.0';

function readLocalCatalog() {
  return readJsonSafe(DATA_FILE, null);
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
  atomicWriteFile(DATA_FILE, JSON.stringify(next, null, 2));
  return next;
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

function getPrimaryLanUrl() {
  if (config.publicLanUrl) return config.publicLanUrl;
  const lans = getLanAddresses();
  return lans.length > 0 ? `http://${lans[0]}:${PORT}` : `http://localhost:${PORT}`;
}

const app = express();
app.use(express.json({ limit: '15mb' }));

// Health check for frontend syncService probe
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: 'local-lan-server',
    hasLocalSnapshot: fs.existsSync(DATA_FILE),
    restaurantId: config.restaurantId || null,
    restaurantSlug: config.restaurantSlug || null,
    primaryLanUrl: getPrimaryLanUrl(),
    timestamp: new Date().toISOString(),
  });
});

// Server network & isolation metadata (used by QRCodeModal and OfflineIndicator)
app.get('/api/server-info', (_req, res) => {
  const lans = getLanAddresses();
  const state = readLocalCatalog();
  const imageMap = readJsonSafe(IMAGE_MAP_FILE, {});
  res.json({
    ok: true,
    mode: 'local-lan-server',
    port: PORT,
    lanUrls: lans.map((ip) => `http://${ip}:${PORT}`),
    primaryLanUrl: getPrimaryLanUrl(),
    configuredPublicUrl: config.publicLanUrl || null,
    restaurantId: config.restaurantId || null,
    restaurantSlug: config.restaurantSlug || null,
    hasLocalSnapshot: Boolean(state),
    lastCloudSyncAt: state?.lastCloudSyncAt || null,
    cachedImagesCount: Object.keys(imageMap).length,
    updatedAt: state?.updatedAt || null,
  });
});

// Trigger manual or on-reconnect cloud-to-local pull + image mirror
app.post('/api/sync/pull-cloud', async (_req, res) => {
  const result = await pullCloudCatalogToLocal({ timeoutMs: 8000, quiet: true });
  return res.status(result.ok ? 200 : 503).json(result);
});

// Retrieve local LAN catalog snapshot (strictly scoped to configured restaurant)
app.get('/api/catalog', (_req, res) => {
  const raw = readLocalCatalog();
  if (!raw) {
    return res.status(404).json({ error: 'No local catalog snapshot stored yet.' });
  }
  return res.json({ state: scopeStateForRestaurant(raw) });
});

// Save catalog updates with restaurant isolation & optimistic conflict detection
app.put('/api/catalog', (req, res) => {
  const { state, baseUpdatedAt, lastCloudSyncAt } = req.body || {};
  if (!state || !Array.isArray(state.restaurants) || !Array.isArray(state.menuItems)) {
    return res.status(400).json({ error: 'Invalid catalog payload.' });
  }

  if (config.restaurantId || config.restaurantSlug) {
    const unauthorizedRest = state.restaurants.find((r) => !isScopedRestaurant(r));
    if (unauthorizedRest) {
      return res.status(403).json({
        error: `Strict isolation: this local server is locked to ${config.restaurantSlug || config.restaurantId}.`,
      });
    }
    const allowedIds = new Set(state.restaurants.map((r) => r.id));
    const unauthorizedItem = state.menuItems.find((item) => !allowedIds.has(item.restaurantId));
    if (unauthorizedItem) {
      return res.status(403).json({
        error: 'Strict isolation: menu item belongs to another restaurant.',
      });
    }
  }

  const existing = readLocalCatalog();
  if (
    existing &&
    baseUpdatedAt &&
    existing.updatedAt &&
    existing.updatedAt > baseUpdatedAt
  ) {
    return res.status(409).json({
      error: 'Conflict: local server catalog was modified more recently.',
      serverState: scopeStateForRestaurant(existing),
    });
  }

  const committed = writeLocalCatalog(state, { lastCloudSyncAt });
  // Background mirror any remote Supabase images for offline LAN clients
  void mirrorRemoteImagesToDisk(committed);

  return res.json({ state: scopeStateForRestaurant(committed) });
});

// Local image upload endpoint for offline/LAN operations
app.post('/api/assets/upload', (req, res) => {
  const { restaurantId, folder, fileName, dataUrl } = req.body || {};
  if (!restaurantId || !dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'Missing restaurantId or dataUrl.' });
  }
  if (config.restaurantId && restaurantId !== config.restaurantId) {
    return res.status(403).json({ error: 'Strict isolation: invalid restaurantId.' });
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

  const destDir = path.join(UPLOADS_DIR, safeRestId, safeFolder);
  fs.mkdirSync(destDir, { recursive: true });
  const buffer = Buffer.from(match[2], 'base64');
  fs.writeFileSync(path.join(destDir, finalName), buffer);

  return res.json({
    url: `/local-uploads/${safeRestId}/${safeFolder}/${finalName}`,
  });
});

// Serve locally cached mirror of remote Supabase images when phones lack Internet
app.get('/api/cached-image', (req, res) => {
  const targetUrl = String(req.query.url || '');
  if (!targetUrl) {
    return res.status(400).end();
  }
  const imageMap = readJsonSafe(IMAGE_MAP_FILE, {});
  const fileName = imageMap[targetUrl];
  if (!fileName) {
    return res.status(404).end();
  }
  const fullPath = path.join(IMAGE_CACHE_DIR, path.basename(fileName));
  if (!fs.existsSync(fullPath)) {
    return res.status(404).end();
  }
  res.setHeader('Cache-Control', 'public, max-age=2592000');
  return res.sendFile(fullPath);
});

app.use('/local-uploads', express.static(UPLOADS_DIR, { maxAge: '30d' }));
app.use('/local-cache', express.static(IMAGE_CACHE_DIR, { maxAge: '30d' }));

// Serve built Vite PWA static files
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { maxAge: '1d' }));
  app.use('/src/assets', (_req, res) => res.status(404).end());
  app.get('*', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(503)
      .send('Build dist/ manquant. Lancez "npm run build" avant de démarrer le serveur local.');
  });
}

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
