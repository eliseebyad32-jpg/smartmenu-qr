import fs from 'fs';
import path from 'path';

const cfgFile = process.env.SM_CFG_FILE;
const envFile = process.env.SM_ENV_FILE;
const isIsolate = process.env.SM_ISOLATE === '1';
const slug = isIsolate ? String(process.env.SM_SLUG || '').trim() : '';
const parsedPort = Number(process.env.SM_PORT);
const sbUrl = String(process.env.SM_SB_URL || '').trim();
const sbKey = String(process.env.SM_SB_KEY || '').trim();

if (cfgFile) {
  let prev = {};
  try {
    if (fs.existsSync(cfgFile)) {
      prev = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    }
  } catch {
    prev = {};
  }

  const port =
    Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
      ? Math.trunc(parsedPort)
      : prev.port || 3000;

  const nextCfg = {
    ...prev,
    port,
    restaurantId: slug,
    restaurantSlug: slug,
    publicLanUrl: typeof prev.publicLanUrl === 'string' ? prev.publicLanUrl : '',
    onlineBaseUrl: typeof prev.onlineBaseUrl === 'string' ? prev.onlineBaseUrl : '',
    wifiSsid: typeof prev.wifiSsid === 'string' ? prev.wifiSsid : '',
    wifiPassword: typeof prev.wifiPassword === 'string' ? prev.wifiPassword : '',
    wifiSecurity:
      prev.wifiSecurity === 'WEP' || prev.wifiSecurity === 'nopass' ? prev.wifiSecurity : 'WPA',
    captivePortalEnabled: prev.captivePortalEnabled !== false,
    autoSyncMinutes: typeof prev.autoSyncMinutes === 'number' ? prev.autoSyncMinutes : 5,
  };

  fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
  fs.writeFileSync(cfgFile, `${JSON.stringify(nextCfg, null, 2)}\n`, 'utf8');
}

if (envFile) {
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  const hasExisting = fs.existsSync(envFile);
  if (!hasExisting || sbUrl || sbKey) {
    const cleanUrl = sbUrl.replace(/"/g, '');
    const cleanKey = sbKey.replace(/"/g, '');
    const content = `VITE_SUPABASE_URL="${cleanUrl}"\nVITE_SUPABASE_ANON_KEY="${cleanKey}"\n`;
    fs.writeFileSync(envFile, content, 'utf8');
  }
}
