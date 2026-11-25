import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Info,
  Printer,
  Save,
  Wifi,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import {
  fetchLocalServerInfo,
  fetchLocalWifiConfig,
  saveLocalWifiConfig,
} from '../services/syncService';
import { Restaurant } from '../types/menu';
import {
  buildLocalConnectUrl,
  buildOnlineMenuUrl,
  buildWifiQrPayload,
  DualQrSettings,
  isRunningOnLocalOrigin,
  persistStoredDualQrSettings,
  readStoredDualQrSettings,
  WifiSecurityMode,
} from '../utils/dualQr';

interface QRCodeModalProps {
  restaurant: Restaurant | null;
  canConfigure?: boolean;
  onClose: () => void;
}

function getTableLabelKey(restaurantId: string): string {
  return `smartmenu_qr_table_label_${restaurantId}`;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  restaurant,
  canConfigure = false,
  onClose,
}) => {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [qrOnlineDataUrl, setQrOnlineDataUrl] = useState<string>('');
  const [qrWifiDataUrl, setQrWifiDataUrl] = useState<string>('');
  const [qrPortalDataUrl, setQrPortalDataUrl] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<'online' | 'portal' | null>(null);
  const [tableLabel, setTableLabel] = useState(() => {
    if (typeof window === 'undefined' || !restaurant) return '';
    try {
      return window.localStorage.getItem(getTableLabelKey(restaurant.id)) ?? '';
    } catch {
      return '';
    }
  });
  const [lanBaseUrl, setLanBaseUrl] = useState<string | null>(null);
  const [localServerActive, setLocalServerActive] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const [settings, setSettings] = useState<DualQrSettings>(() =>
    restaurant
      ? readStoredDualQrSettings(restaurant.id)
      : {
          onlineBaseUrl: '',
          wifiSsid: '',
          wifiPassword: '',
          wifiSecurity: 'WPA',
          captivePortalEnabled: true,
        }
  );

  useEffect(() => {
    if (!restaurant) return;
    try {
      setTableLabel(window.localStorage.getItem(getTableLabelKey(restaurant.id)) ?? '');
    } catch {
      // Ignore storage errors
    }
    setSettings(readStoredDualQrSettings(restaurant.id));
  }, [restaurant?.id]);

  useEffect(() => {
    if (!restaurant) return;
    try {
      if (tableLabel) {
        window.localStorage.setItem(getTableLabelKey(restaurant.id), tableLabel);
      } else {
        window.localStorage.removeItem(getTableLabelKey(restaurant.id));
      }
    } catch {
      // Ignore storage errors
    }
  }, [restaurant?.id, tableLabel]);

  useEffect(() => {
    if (!restaurant) return;
    let active = true;
    fetchLocalServerInfo().then(async (info) => {
      if (!active || !info.active) return;
      setLocalServerActive(true);
      if (info.primaryLanUrl) {
        setLanBaseUrl(info.primaryLanUrl);
      }
      if (canConfigure) {
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
          return;
        }
      }
      setSettings((prev) => ({
        ...prev,
        onlineBaseUrl: prev.onlineBaseUrl || info.onlineBaseUrl || '',
        wifiSsid: prev.wifiSsid || info.wifiSsid || '',
        wifiSecurity: info.wifiSecurity || prev.wifiSecurity,
        captivePortalEnabled: info.captivePortalEnabled ?? prev.captivePortalEnabled,
      }));
    });
    return () => {
      active = false;
    };
  }, [restaurant?.id, canConfigure]);

  const onlineMenuUrl = restaurant
    ? buildOnlineMenuUrl(restaurant.slug, settings.onlineBaseUrl, tableLabel)
    : '';
  const localPortalUrl = restaurant
    ? buildLocalConnectUrl(restaurant.slug, lanBaseUrl, tableLabel)
    : '';
  const wifiPayload = buildWifiQrPayload(
    settings.wifiSsid,
    settings.wifiPassword,
    settings.wifiSecurity
  );

  useEffect(() => {
    if (!restaurant || !onlineMenuUrl) return;
    let active = true;
    QRCode.toDataURL(onlineMenuUrl, {
      width: 420,
      margin: 2,
      color: { dark: '#09090B', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrOnlineDataUrl(url);
      })
      .catch(() => {
        // Keep previous QR on transient error
      });
    return () => {
      active = false;
    };
  }, [restaurant?.id, onlineMenuUrl]);

  useEffect(() => {
    if (!restaurant || !localPortalUrl) return;
    let active = true;
    QRCode.toDataURL(localPortalUrl, {
      width: 420,
      margin: 2,
      color: { dark: '#09090B', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrPortalDataUrl(url);
      })
      .catch(() => {
        // Keep previous QR on transient error
      });
    return () => {
      active = false;
    };
  }, [restaurant?.id, localPortalUrl]);

  useEffect(() => {
    if (!restaurant || !wifiPayload) {
      setQrWifiDataUrl('');
      return;
    }
    let active = true;
    QRCode.toDataURL(wifiPayload, {
      width: 420,
      margin: 2,
      color: { dark: '#09090B', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrWifiDataUrl(url);
      })
      .catch(() => {
        if (active) setQrWifiDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [restaurant?.id, wifiPayload]);

  if (!restaurant) return null;

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

  const handleDownload = (dataUrl: string, filename: string) => {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
    showToast(t.qr.downloadPng);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl my-auto rounded-2xl bg-[#141418] border border-zinc-800 p-5 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto print:max-h-none print:overflow-visible print:border-zinc-300 print:bg-white print:text-black print:shadow-none"
      >
        <div className="flex items-start justify-between gap-4 print:hidden">
          <div>
            <p className="text-xs font-semibold text-orange-400">{restaurant.name}</p>
            <h3 id="qr-modal-title" className="mt-1 font-display text-2xl font-bold text-white">
              {t.qr.title}
            </h3>
            <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{t.qr.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.menu.close}
            className="min-h-[44px] min-w-[44px] -mt-1 -mr-1 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Table label + Print button */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3 print:hidden">
          <div className="flex-1">
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              {t.qr.tableNumber}
            </label>
            <input
              type="text"
              value={tableLabel}
              onChange={(e) => setTableLabel(e.target.value)}
              placeholder="01, 04, VIP..."
              className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
            />
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs sm:text-sm font-medium text-white transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4 text-orange-400" aria-hidden="true" />
            <span>{t.qr.printCard}</span>
          </button>
        </div>

        {/* Printable Dual QR Cards Grid */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* QR 1 — Online Menu */}
          <div className="rounded-2xl bg-white text-zinc-950 p-5 text-center shadow-lg border border-zinc-200 flex flex-col justify-between">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200 px-3 py-0.5 text-[11px] font-bold text-red-700">
                <Globe className="w-3 h-3" aria-hidden="true" />
                <span>{t.qr.qr1Badge}</span>
              </span>
              <p className="mt-2 font-display text-xl font-bold tracking-tight text-zinc-950">
                {restaurant.name}
              </p>
              {tableLabel.trim() && (
                <p className="text-xs font-semibold uppercase tracking-wider text-red-600 mt-0.5">
                  Table {tableLabel.trim()}
                </p>
              )}
              <div className="my-3 flex justify-center">
                {qrOnlineDataUrl ? (
                  <img
                    src={qrOnlineDataUrl}
                    alt={`QR 1 ${restaurant.name}`}
                    className="w-44 h-44 block"
                  />
                ) : (
                  <div className="w-44 h-44 bg-zinc-200 animate-pulse rounded-lg" />
                )}
              </div>
              <p className="text-xs font-semibold text-zinc-800">{t.qr.qr1Title}</p>
              <p className="text-[11px] text-zinc-600 mt-1 leading-snug">{t.qr.qr1Subtitle}</p>
              <p className="mt-2 text-[10px] font-mono text-zinc-500 break-all">{onlineMenuUrl}</p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 print:hidden">
              <button
                type="button"
                onClick={() => handleCopy(onlineMenuUrl, 'online')}
                className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-white cursor-pointer"
              >
                {copiedKey === 'online' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{copiedKey === 'online' ? t.qr.copied : t.qr.copyLink}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleDownload(
                    qrOnlineDataUrl,
                    `smartmenu-qr1-online-${restaurant.slug}${tableLabel ? `-table-${tableLabel}` : ''}.png`
                  )
                }
                disabled={!qrOnlineDataUrl}
                className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>PNG QR 1</span>
              </button>
            </div>
          </div>

          {/* QR 2 — Local Wi-Fi + Welcome Portal (/connect) */}
          <div className="rounded-2xl bg-white text-zinc-950 p-5 text-center shadow-lg border border-zinc-200 flex flex-col justify-between">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-0.5 text-[11px] font-bold text-emerald-700">
                <Wifi className="w-3 h-3" aria-hidden="true" />
                <span>{t.qr.qr2Badge}</span>
              </span>
              <p className="mt-2 font-display text-xl font-bold tracking-tight text-zinc-950">
                {restaurant.name}
              </p>
              {settings.wifiSsid.trim() && (
                <p className="text-xs font-semibold text-emerald-700 mt-0.5">
                  Wi-Fi : {settings.wifiSsid.trim()}
                </p>
              )}

              <div className="my-3 grid grid-cols-2 gap-3 items-start">
                <div className="rounded-xl border border-zinc-200 p-2 bg-zinc-50">
                  <p className="text-[10px] font-bold text-zinc-700 mb-1.5">{t.qr.wifiJoinTab}</p>
                  {qrWifiDataUrl ? (
                    <img
                      src={qrWifiDataUrl}
                      alt={`QR Wi-Fi ${settings.wifiSsid}`}
                      className="w-28 h-28 mx-auto block"
                    />
                  ) : (
                    <div className="w-28 h-28 mx-auto flex items-center justify-center rounded-lg border border-dashed border-zinc-300 text-[10px] text-zinc-500 p-2">
                      {t.qr.wifiMissingSsid}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-zinc-200 p-2 bg-zinc-50">
                  <p className="text-[10px] font-bold text-zinc-700 mb-1.5">
                    {t.qr.wifiPortalTab}
                  </p>
                  {qrPortalDataUrl ? (
                    <img
                      src={qrPortalDataUrl}
                      alt={`QR Portail ${restaurant.name}`}
                      className="w-28 h-28 mx-auto block"
                    />
                  ) : (
                    <div className="w-28 h-28 mx-auto bg-zinc-200 animate-pulse rounded-lg" />
                  )}
                </div>
              </div>

              <p className="text-xs font-semibold text-zinc-800">{t.qr.qr2Title}</p>
              <p className="text-[11px] text-zinc-600 mt-1 leading-snug">{t.qr.qr2Subtitle}</p>
              <p className="mt-2 text-[10px] font-mono text-zinc-500 break-all">
                {localPortalUrl}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-1.5 print:hidden">
              <button
                type="button"
                onClick={() => handleCopy(localPortalUrl, 'portal')}
                className="inline-flex items-center justify-center gap-1 min-h-[38px] px-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-[11px] font-medium text-white cursor-pointer"
              >
                {copiedKey === 'portal' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{t.qr.copyLink}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleDownload(
                    qrWifiDataUrl,
                    `smartmenu-qr2-wifi-${restaurant.slug}.png`
                  )
                }
                disabled={!qrWifiDataUrl}
                className="inline-flex items-center justify-center gap-1 min-h-[38px] px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-[11px] font-semibold text-white cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>PNG Wi-Fi</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleDownload(
                    qrPortalDataUrl,
                    `smartmenu-qr2-portal-${restaurant.slug}${tableLabel ? `-table-${tableLabel}` : ''}.png`
                  )
                }
                disabled={!qrPortalDataUrl}
                className="inline-flex items-center justify-center gap-1 min-h-[38px] px-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-[11px] font-semibold text-white cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>PNG Portail</span>
              </button>
            </div>
          </div>
        </div>

        {/* Pro-only configuration form for QR 1 URL + QR 2 Wi-Fi credentials */}
        {canConfigure && (
          <div className="mt-5 rounded-xl bg-zinc-900/80 border border-zinc-800 p-4 space-y-4 print:hidden">
            {localWithoutOnlineUrl && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                {t.qr.qr1LocalWarning}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
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
                  className="w-full min-h-[40px] px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
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
                  className="w-full min-h-[40px] px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
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
                  className="w-full min-h-[40px] px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-white focus:outline-none focus:border-orange-500"
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
                    className="w-full min-h-[40px] px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 pt-5">
                <input
                  id="modal-captive-toggle"
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
                <label htmlFor="modal-captive-toggle" className="text-xs text-zinc-300">
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
                <span>/connect</span>
              </a>

              <button
                type="button"
                disabled={savingConfig}
                onClick={handleSaveDualQrConfig}
                className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{savingConfig ? t.qr.savingConfig : t.qr.saveDualQrConfig}</span>
              </button>
            </div>
          </div>
        )}

        {/* Windows 11 Captive Portal Honest Technical Note */}
        <div className="mt-4 rounded-xl bg-zinc-900/60 border border-zinc-800 p-3.5 flex items-start gap-2.5 text-left print:hidden">
          <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-zinc-200">{t.qr.captiveNoteTitle}</p>
            <p className="text-[11px] text-zinc-400 leading-relaxed">{t.qr.captiveNoteBody}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
