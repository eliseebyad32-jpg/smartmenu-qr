import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Printer, QrCode, Wifi } from 'lucide-react';
import QRCode from 'qrcode';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { fetchLocalServerInfo } from '../../services/syncService';
import { Category, MenuItem, Restaurant } from '../../types/menu';
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
  const [qrPreview, setQrPreview] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [lanBaseUrl, setLanBaseUrl] = useState<string | null>(null);
  const [preferLanUrl, setPreferLanUrl] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(RESTAURATEUR_TAB_KEY, tab);
    } catch {
      // Ignore storage errors
    }
  }, [tab]);

  useEffect(() => {
    let active = true;
    fetchLocalServerInfo().then((info) => {
      if (!active || !info.active || !info.primaryLanUrl) return;
      setLanBaseUrl(info.primaryLanUrl);
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        setPreferLanUrl(true);
      }
    });
    return () => {
      active = false;
    };
  }, [restaurant.id]);

  const baseOrigin = preferLanUrl && lanBaseUrl ? lanBaseUrl : window.location.origin;
  const directMenuUrl = `${baseOrigin}/?restaurant=${encodeURIComponent(restaurant.slug)}`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(directMenuUrl, {
      width: 320,
      margin: 2,
      color: { dark: '#09090B', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrPreview(url);
      })
      .catch(() => {
        // Keep previously generated QR image intact on transient errors
      });
    return () => {
      active = false;
    };
  }, [directMenuUrl]);

  const scopedItems = menuItems.filter((m) => m.restaurantId === restaurant.id);
  const availableCount = scopedItems.filter((m) => m.isAvailable).length;
  const avgFC =
    scopedItems.length > 0
      ? Math.round(scopedItems.reduce((s, i) => s + i.priceFC, 0) / scopedItems.length)
      : 0;

  const handleDownloadQr = () => {
    if (!qrPreview) return;
    const link = document.createElement('a');
    link.href = qrPreview;
    link.download = `smartmenu-qr-${restaurant.slug}.png`;
    link.click();
    showToast(t.qr.downloadPng);
  };

  const handleCopyPermanentLink = async () => {
    try {
      await navigator.clipboard.writeText(directMenuUrl);
      setCopiedLink(true);
      showToast(t.qr.copied);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

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
                if (
                  restaurant.logoUrl?.startsWith('http') &&
                  !img.dataset.mirrorTried
                ) {
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

      {/* Sub-navigation Tabs (Products & Categories + QR Code only) */}
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
        <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-6 grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-5 flex justify-center">
            <div className="rounded-2xl bg-white p-5 text-center text-zinc-950 shadow-xl">
              <p className="font-display text-xl font-bold">{restaurant.name}</p>
              {qrPreview ? (
                <img
                  src={qrPreview}
                  alt={`QR Code ${restaurant.name}`}
                  className="w-52 h-52 mx-auto my-3"
                />
              ) : (
                <div className="w-52 h-52 bg-zinc-200 animate-pulse my-3" />
              )}
              <p className="text-xs font-medium text-zinc-700">{t.qr.tableScanPrompt}</p>
            </div>
          </div>

          <div className="md:col-span-7 space-y-4">
            <h3 className="font-display text-3xl font-bold text-white">{t.qr.title}</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">{t.qr.subtitle}</p>
            {lanBaseUrl && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setPreferLanUrl((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:underline cursor-pointer"
                >
                  <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{preferLanUrl ? t.qr.useCurrentUrl : t.qr.useLanUrl}</span>
                </button>
              </div>
            )}
            <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-3.5 py-2.5 font-mono text-xs text-zinc-300 break-all">
              {directMenuUrl}
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={handleCopyPermanentLink}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-sm font-medium text-white cursor-pointer"
              >
                {copiedLink ? (
                  <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="w-4 h-4 text-zinc-300" aria-hidden="true" />
                )}
                <span>{copiedLink ? t.qr.copied : t.qr.copyLink}</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadQr}
                className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-semibold text-white cursor-pointer"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>{t.qr.downloadPng}</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenQr(restaurant)}
                className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-sm font-medium text-white cursor-pointer"
              >
                <Printer className="w-4 h-4 text-orange-400" aria-hidden="true" />
                <span>{t.qr.printCard}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
