import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Info,
  Printer,
  QrCode,
  Save,
  Wifi,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import {
  fetchLocalServerInfo,
  fetchLocalWifiConfig,
  saveLocalWifiConfig,
} from '../../services/syncService';
import { Category, MenuItem, Restaurant } from '../../types/menu';
import {
  buildLocalConnectUrl,
  buildOnlineMenuUrl,
  buildWifiQrPayload,
  DualQrSettings,
  isRunningOnLocalOrigin,
  persistStoredDualQrSettings,
  readStoredDualQrSettings,
  WifiSecurityMode,
} from '../../utils/dualQr';
import { ProductManager } from './ProductManager';

interface RestaurateurDashboardProps {
  restaurant: Restaurant;
  categories: Category[];
  menuItems: MenuItem[];
  onSaveItem: (item: MenuItem, isNew: boolean) => void;
  onDeleteItem: (itemId: string) => void;
  onToggleAvailability: (itemId: string) => void;
  onAddCategory: (category: Category) => void;
  onUpdateCategory: (category: Category) => void;
  onDeleteCategory: (categoryId: string) => void;
  onOpenQr: (restaurant: Restaurant) => void;
  onOpenCustomerMenu: (restaurantId: string) => void;
}

const RESTAURATEUR_TAB_KEY = 'smartmenu_qr_restaurateur_tab_v1';

function readStoredDashboardTab(): 'products' | 'qr' {
  if (typeof window === 'undefined') return 'products';
  try {
    const raw = window.localStorage.getItem(RESTAURATEUR_TAB_KEY);
    return raw === 'qr' ? 'qr' : 'products';
  } catch {
    return 'products';
  }
}

export const RestaurateurDashboard: React.FC<RestaurateurDashboardProps> = ({
  restaurant,
  categories,
  menuItems,
  onSaveItem,
  onDeleteItem,
  onToggleAvailability,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onOpenQr,
  onOpenCustomerMenu,
}) => {
  const { t, formatFC } = useLanguage();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'products' | 'qr'>(() => readStoredDashboardTab());
  const [qrOnlinePreview, setQrOnlinePreview] = useState('');
  const [qrWifiPreview, setQrWifiPreview] = useState('');
  const [qrPortalPreview, setQrPortalPreview] = useState('');
  const [copiedKey, setCopiedKey] = useState<'online' | 'portal' | null>(null);
  const [lanBaseUrl, setLanBaseUrl] = useState<string | null>(null);
  const [localServerActive, setLocalServerActive] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const [settings, setSettings] = useState<DualQrSettings>(() =>
    readStoredDualQrSettings(restaurant.id)
  );

  useEffect(() => {
    setSettings(readStoredDualQrSettings(restaurant.id));
  }, [restaurant.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RESTAURATEUR_TAB_KEY, tab);
    } catch {
      // Ignore storage errors
    }
  }, [tab]);

  useEffect(() => {
    let active = true;
    fetchLocalServerInfo().then(async (info) => {
      if (!active || !info.active) return;
      setLocalServerActive(true);
      if (info.primaryLanUrl) {
        setLanBaseUrl(info.primaryLanUrl);
      }
      const serverCfg = await fetchLocalWifiConfig();
      if (!active) return;
      if (serverCfg) {
        setSettings((prev) => ({
          onlineBaseUrl: serverCfg.onlineBaseUrl || prev.onlineBaseUrl,
          wifiSsid: serverCfg.wifiSsid || prev.wifiSsid,
          wifiPassword: serverCfg.wifiPassword || prev.wifiPassword,
          wifiSecurity: serverCfg.wifiSecurity || prev.wifiSecurity,
          captivePortalEnabled: serverCfg.captivePortalEnabled,
        }));
      } else {
        setSettings((prev) => ({
          ...prev,
          onlineBaseUrl: prev.onlineBaseUrl || info.onlineBaseUrl || '',
          wifiSsid: prev.wifiSsid || info.wifiSsid || '',
          wifiSecurity: info.wifiSecurity || prev.wifiSecurity,
          captivePortalEnabled: info.captivePortalEnabled ?? prev.captivePortalEnabled,
        }));
      }
    });
    return () => {
      active = false;
    };
  }, [restaurant.id]);

  const onlineMenuUrl = buildOnlineMenuUrl(restaurant.slug, settings.onlineBaseUrl);
  const localPortalUrl = buildLocalConnectUrl(restaurant.slug, lanBaseUrl);
  const wifiPayload = buildWifiQrPayload(
    settings.wifiSsid,
    settings.wifiPassword,
    settings.wifiSecurity
  );

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(onlineMenuUrl, {
      width: 320,
      margin: 2,
      color: { dark: '#09090B', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrOnlinePreview(url);
      })
      .catch(() => {
        // Keep previously generated QR image intact
      });
    return () => {
      active = false;
    };
  }, [onlineMenuUrl]);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(localPortalUrl, {
      width: 320,
      margin: 2,
      color: { dark: '#09090B', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrPortalPreview(url);
      })
      .catch(() => {
        // Keep previously generated QR image intact
      });
    return () => {
      active = false;
    };
  }, [localPortalUrl]);

  useEffect(() => {
    if (!wifiPayload) {
      setQrWifiPreview('');
      return;
    }
    let active = true;
    QRCode.toDataURL(wifiPayload, {
      width: 320,
      margin: 2,
      color: { dark: '#09090B', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrWifiPreview(url);
      })
      .catch(() => {
        if (active) setQrWifiPreview('');
      });
    return () => {
      active = false;
    };
  }, [wifiPayload]);

  const scopedItems = menuItems.filter((m) => m.restaurantId === restaurant.id);
  const availableCount = scopedItems.filter((m) => m.isAvailable).length;
  const avgFC =
    scopedItems.length > 0
      ? Math.round(scopedItems.reduce((s, i) => s + i.priceFC, 0) / scopedItems.length)
      : 0;

  const handleDownloadPng = (dataUrl: string, filename: string) => {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
    showToast(t.qr.downloadPng);
  };

  const handleCopy = async (value: string, key: 'online' | 'portal') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      showToast(t.qr.copied);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleSaveDualQrConfig = async () => {
    persistStoredDualQrSettings(restaurant.id, settings);
    if (!localServerActive) {
      showToast(t.qr.configSavedLocalOnly);
      return;
    }
    setSavingConfig(true);
    try {
      const res = await saveLocalWifiConfig({
        wifiSsid: settings.wifiSsid.trim(),
        wifiPassword: settings.wifiPassword,
        wifiSecurity: settings.wifiSecurity,
        onlineBaseUrl: settings.onlineBaseUrl.trim(),
        captivePortalEnabled: settings.captivePortalEnabled,
      });
      if (res.ok) {
        showToast(t.qr.configSavedServer);
      } else {
        showToast(t.qr.configSavedLocalOnly);
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const localWithoutOnlineUrl = isRunningOnLocalOrigin() && !settings.onlineBaseUrl.trim();

  return (
    <div className="space-y-6">
      {/* Venue Summary Strip (read-only restaurant identity controlled by Super Admin) */}
      <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {restaurant.logoUrl ? (
            <img
              src={restaurant.logoUrl}
              alt={restaurant.name}
              onError={(e) => {
                const img = e.currentTarget;
                if (restaurant.logoUrl?.startsWith('http') && !img.dataset.mirrorTried) {
                  img.dataset.mirrorTried = '1';
                  img.src = `/api/cached-image?url=${encodeURIComponent(restaurant.logoUrl)}`;
                  return;
                }
                img.style.display = 'none';
              }}
              className="w-14 h-14 rounded-xl object-cover border border-zinc-700"
            />
          ) : (
            <div
              style={{ backgroundColor: restaurant.primaryColor }}
              className="w-14 h-14 rounded-xl flex items-center justify-center font-display text-2xl font-bold text-white"
            >
              {restaurant.name.charAt(0)}
            </div>
          )}
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
              {restaurant.name}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 tabular-nums">
              {scopedItems.length} {t.hero.statDishes} · {availableCount} {t.menu.available} ·{' '}
              {formatFC(avgFC)} ({t.pro.statsAvgPrice})
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenCustomerMenu(restaurant.id)}
          className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-500 text-xs sm:text-sm font-semibold text-white cursor-pointer shrink-0"
        >
          <span>{t.pro.viewCustomerMenu}</span>
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Sub-navigation Tabs (Products & Categories + Dual QR Codes) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-4">
        <button
          type="button"
          onClick={() => setTab('products')}
          className={`min-h-[42px] px-4 rounded-xl text-sm font-medium cursor-pointer ${
            tab === 'products'
              ? 'bg-red-600 text-white'
              : 'bg-[#141418] border border-zinc-800 text-zinc-300 hover:text-white'
          }`}
        >
          {t.pro.tabProducts}
        </button>

        <button
          type="button"
          onClick={() => setTab('qr')}
          className={`inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl text-sm font-medium cursor-pointer ${
            tab === 'qr'
              ? 'bg-red-600 text-white'
              : 'bg-[#141418] border border-zinc-800 text-zinc-300 hover:text-white'
          }`}
        >
          <QrCode className="w-4 h-4" aria-hidden="true" />
          <span>{t.pro.tabQr}</span>
        </button>
      </div>

      {tab === 'products' && (
        <ProductManager
          restaurant={restaurant}
          categories={categories}
          items={menuItems}
          onSaveItem={onSaveItem}
          onDeleteItem={onDeleteItem}
          onToggleAvailability={onToggleAvailability}
          onAddCategory={onAddCategory}
          onUpdateCategory={onUpdateCategory}
          onDeleteCategory={onDeleteCategory}
        />
      )}

      {tab === 'qr' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-2xl sm:text-3xl font-bold text-white">
                  {t.qr.title}
                </h3>
                <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{t.qr.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => onOpenQr(restaurant)}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-sm font-medium text-white cursor-pointer shrink-0"
              >
                <Printer className="w-4 h-4 text-orange-400" aria-hidden="true" />
                <span>{t.qr.printCard}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* QR 1 — Online Menu */}
              <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col justify-between gap-4">
                <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
                  <div className="rounded-2xl bg-white p-3.5 text-center text-zinc-950 shadow-xl shrink-0">
                    {qrOnlinePreview ? (
                      <img
                        src={qrOnlinePreview}
                        alt={`QR 1 ${restaurant.name}`}
                        className="w-40 h-40 block"
                      />
                    ) : (
                      <div className="w-40 h-40 bg-zinc-200 animate-pulse" />
                    )}
                  </div>
                  <div className="space-y-2 text-center sm:text-left">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 border border-red-500/30 px-3 py-0.5 text-[11px] font-bold text-red-300">
                      <Globe className="w-3 h-3" aria-hidden="true" />
                      <span>{t.qr.qr1Badge}</span>
                    </span>
                    <h4 className="font-display text-xl font-bold text-white">{t.qr.qr1Title}</h4>
                    <p className="text-xs text-zinc-400 leading-relaxed">{t.qr.qr1Subtitle}</p>
                  </div>
                </div>

                <div className="rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 font-mono text-xs text-zinc-300 break-all">
                  {onlineMenuUrl}
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleCopy(onlineMenuUrl, 'online')}
                    className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-white cursor-pointer"
                  >
                    {copiedKey === 'online' ? (
                      <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                    ) : (
                      <Copy className="w-4 h-4 text-zinc-300" aria-hidden="true" />
                    )}
                    <span>{copiedKey === 'online' ? t.qr.copied : t.qr.copyLink}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadPng(qrOnlinePreview, `smartmenu-qr1-online-${restaurant.slug}.png`)
                    }
                    className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-semibold text-white cursor-pointer"
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                    <span>{t.qr.downloadPng} (QR 1)</span>
                  </button>
                </div>
              </div>

              {/* QR 2 — Wi-Fi + Local Welcome Portal (/connect) */}
              <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-5 flex flex-col justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-0.5 text-[11px] font-bold text-emerald-300">
                      <Wifi className="w-3 h-3" aria-hidden="true" />
                      <span>{t.qr.qr2Badge}</span>
                    </span>
                    {settings.wifiSsid.trim() && (
                      <span className="text-xs font-mono text-emerald-300">
                        SSID: {settings.wifiSsid.trim()}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white p-3 text-center text-zinc-950 shadow">
                      <p className="text-[11px] font-bold text-zinc-700 mb-1.5">
                        {t.qr.wifiJoinTab}
                      </p>
                      {qrWifiPreview ? (
                        <img
                          src={qrWifiPreview}
                          alt={`QR Wi-Fi ${settings.wifiSsid}`}
                          className="w-32 h-32 mx-auto block"
                        />
                      ) : (
                        <div className="w-32 h-32 mx-auto flex items-center justify-center rounded-lg border border-dashed border-zinc-300 text-[11px] text-zinc-500 p-2">
                          {t.qr.wifiMissingSsid}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl bg-white p-3 text-center text-zinc-950 shadow">
                      <p className="text-[11px] font-bold text-zinc-700 mb-1.5">
                        {t.qr.wifiPortalTab}
                      </p>
                      {qrPortalPreview ? (
                        <img
                          src={qrPortalPreview}
                          alt={`QR Portail ${restaurant.name}`}
                          className="w-32 h-32 mx-auto block"
                        />
                      ) : (
                        <div className="w-32 h-32 mx-auto bg-zinc-200 animate-pulse" />
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 font-mono text-xs text-zinc-300 break-all">
                  {localPortalUrl}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(localPortalUrl, 'portal')}
                    className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-white cursor-pointer"
                  >
                    {copiedKey === 'portal' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-zinc-300" aria-hidden="true" />
                    )}
                    <span>{copiedKey === 'portal' ? t.qr.copied : t.qr.copyLink}</span>
                  </button>
                  <button
                    type="button"
                    disabled={!qrWifiPreview}
                    onClick={() =>
                      handleDownloadPng(qrWifiPreview, `smartmenu-qr2-wifi-${restaurant.slug}.png`)
                    }
                    className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>PNG Wi-Fi</span>
                  </button>
                  <button
                    type="button"
                    disabled={!qrPortalPreview}
                    onClick={() =>
                      handleDownloadPng(
                        qrPortalPreview,
                        `smartmenu-qr2-portal-${restaurant.slug}.png`
                      )
                    }
                    className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-xs font-semibold text-white cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>PNG Portail</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Dual QR & Local Wi-Fi Configuration Form */}
            <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800 p-5 space-y-4">
              {localWithoutOnlineUrl && (
                <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                  {t.qr.qr1LocalWarning}
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    {t.qr.qr1UrlLabel}
                  </label>
                  <input
                    type="url"
                    value={settings.onlineBaseUrl}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, onlineBaseUrl: e.target.value }))
                    }
                    placeholder={t.qr.qr1UrlPlaceholder}
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    {t.qr.wifiSsidLabel}
                  </label>
                  <input
                    type="text"
                    value={settings.wifiSsid}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, wifiSsid: e.target.value }))
                    }
                    placeholder={t.qr.wifiSsidPlaceholder}
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    {t.qr.wifiSecurityLabel}
                  </label>
                  <select
                    value={settings.wifiSecurity}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        wifiSecurity: e.target.value as WifiSecurityMode,
                      }))
                    }
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white focus:outline-none focus:border-orange-500"
                  >
                    <option value="WPA">{t.qr.wifiSecurityWpa}</option>
                    <option value="WEP">{t.qr.wifiSecurityWep}</option>
                    <option value="nopass">{t.qr.wifiSecurityOpen}</option>
                  </select>
                </div>

                {settings.wifiSecurity !== 'nopass' && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      {t.qr.wifiPasswordLabel}
                    </label>
                    <input
                      type="text"
                      value={settings.wifiPassword}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, wifiPassword: e.target.value }))
                      }
                      placeholder={t.qr.wifiPasswordPlaceholder}
                      className="w-full min-h-[42px] px-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2 pt-4">
                  <input
                    id="dash-captive-toggle"
                    type="checkbox"
                    checked={settings.captivePortalEnabled}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        captivePortalEnabled: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 accent-orange-500"
                  />
                  <label htmlFor="dash-captive-toggle" className="text-xs text-zinc-300">
                    {t.qr.captiveRedirectLabel}
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <a
                  href={localPortalUrl}
                  target="_self"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{localPortalUrl}</span>
                </a>

                <button
                  type="button"
                  disabled={savingConfig}
                  onClick={handleSaveDualQrConfig}
                  className="inline-flex items-center gap-2 min-h-[42px] px-5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs sm:text-sm font-semibold text-white cursor-pointer"
                >
                  <Save className="w-4 h-4" aria-hidden="true" />
                  <span>{savingConfig ? t.qr.savingConfig : t.qr.saveDualQrConfig}</span>
                </button>
              </div>
            </div>

            {/* Honest Windows 11 Captive Portal Explanation */}
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800 p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-zinc-200">{t.qr.captiveNoteTitle}</p>
                <p className="text-xs text-zinc-400 leading-relaxed">{t.qr.captiveNoteBody}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
