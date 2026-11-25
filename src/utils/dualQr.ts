export type WifiSecurityMode = 'WPA' | 'WEP' | 'nopass';

export interface DualQrSettings {
  onlineBaseUrl: string;
  wifiSsid: string;
  wifiPassword: string;
  wifiSecurity: WifiSecurityMode;
  captivePortalEnabled: boolean;
}

const SETTINGS_STORAGE_PREFIX = 'smartmenu_qr_dual_settings_v1_';

function isLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower.endsWith('.local')
  ) {
    return true;
  }
  if (/^192\.168\.\d+\.\d+$/.test(lower)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(lower)) return true;
  return false;
}

export function getDefaultOnlineBaseUrl(): string {
  const envPublic = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  if (envPublic && /^https?:\/\//i.test(envPublic)) {
    return envPublic.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && !isLocalHostname(window.location.hostname)) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
}

export function isRunningOnLocalOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  return isLocalHostname(window.location.hostname);
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function readStoredDualQrSettings(restaurantId: string): DualQrSettings {
  const defaults: DualQrSettings = {
    onlineBaseUrl: getDefaultOnlineBaseUrl(),
    wifiSsid: '',
    wifiPassword: '',
    wifiSecurity: 'WPA',
    captivePortalEnabled: true,
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(`${SETTINGS_STORAGE_PREFIX}${restaurantId}`);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<DualQrSettings>;
    return {
      onlineBaseUrl:
        typeof parsed.onlineBaseUrl === 'string' && parsed.onlineBaseUrl.trim()
          ? normalizeBaseUrl(parsed.onlineBaseUrl)
          : defaults.onlineBaseUrl,
      wifiSsid: typeof parsed.wifiSsid === 'string' ? parsed.wifiSsid : '',
      wifiPassword: typeof parsed.wifiPassword === 'string' ? parsed.wifiPassword : '',
      wifiSecurity:
        parsed.wifiSecurity === 'WEP' || parsed.wifiSecurity === 'nopass'
          ? parsed.wifiSecurity
          : 'WPA',
      captivePortalEnabled: parsed.captivePortalEnabled !== false,
    };
  } catch {
    return defaults;
  }
}

export function persistStoredDualQrSettings(
  restaurantId: string,
  settings: DualQrSettings
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${SETTINGS_STORAGE_PREFIX}${restaurantId}`,
      JSON.stringify(settings)
    );
  } catch {
    // Ignore storage quota errors
  }
}

function escapeWifiQrValue(raw: string): string {
  return raw.replace(/([\\;,:""])/g, '\\$1');
}

export function buildWifiQrPayload(
  ssid: string,
  password: string,
  security: WifiSecurityMode
): string {
  const cleanSsid = ssid.trim();
  if (!cleanSsid) return '';
  const cleanType: WifiSecurityMode =
    security === 'nopass' || (!password && security === 'WPA')
      ? password
        ? security
        : 'nopass'
      : security;
  const escapedSsid = escapeWifiQrValue(cleanSsid);
  const escapedPass = cleanType === 'nopass' ? '' : escapeWifiQrValue(password);
  return `WIFI:T:${cleanType};S:${escapedSsid};P:${escapedPass};;`;
}

export function buildOnlineMenuUrl(
  slug: string,
  onlineBaseUrl: string,
  tableLabel?: string
): string {
  const base =
    normalizeBaseUrl(onlineBaseUrl) ||
    getDefaultOnlineBaseUrl() ||
    (typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : '');
  const tableSuffix = tableLabel?.trim()
    ? `&table=${encodeURIComponent(tableLabel.trim())}`
    : '';
  return `${base}/?restaurant=${encodeURIComponent(slug)}${tableSuffix}`;
}

export function buildLocalConnectUrl(
  slug: string,
  lanBaseUrl: string | null,
  tableLabel?: string
): string {
  const base =
    (lanBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(
      /\/+$/,
      ''
    );
  const tableSuffix = tableLabel?.trim()
    ? `&table=${encodeURIComponent(tableLabel.trim())}`
    : '';
  return `${base}/connect?restaurant=${encodeURIComponent(slug)}${tableSuffix}`;
}
