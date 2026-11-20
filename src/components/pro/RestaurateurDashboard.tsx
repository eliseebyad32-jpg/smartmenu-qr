import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, ImagePlus, Palette, Printer, QrCode, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { uploadAssetToSupabaseStorage } from '../../services/supabaseData';
import { uploadAssetToLocalServer } from '../../services/syncService';
import { Category, MenuItem, Restaurant } from '../../types/menu';
import { readAndOptimizeImageBlob } from '../../utils/imageUpload';
import { ProductManager } from './ProductManager';

interface RestaurateurDashboardProps {
  restaurant: Restaurant;
  categories: Category[];
  menuItems: MenuItem[];
  onUpdateRestaurant: (restaurant: Restaurant) => void;
  onSaveItem: (item: MenuItem, isNew: boolean) => void;
  onDeleteItem: (itemId: string) => void;
  onToggleAvailability: (itemId: string) => void;
  onAddCategory: (category: Category) => void;
  onOpenQr: (restaurant: Restaurant) => void;
  onOpenCustomerMenu: (restaurantId: string) => void;
}

const COLOR_SWATCHES = ['#DC2626', '#EA580C', '#E11D48', '#D97706', '#059669', '#2563EB'];

export const RestaurateurDashboard: React.FC<RestaurateurDashboardProps> = ({
  restaurant,
  categories,
  menuItems,
  onUpdateRestaurant,
  onSaveItem,
  onDeleteItem,
  onToggleAvailability,
  onAddCategory,
  onOpenQr,
  onOpenCustomerMenu,
}) => {
  const { t, formatFC } = useLanguage();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'products' | 'branding' | 'qr'>('products');
  const [name, setName] = useState(restaurant.name);
  const [logoUrl, setLogoUrl] = useState(restaurant.logoUrl || '');
  const [primaryColor, setPrimaryColor] = useState(restaurant.primaryColor || '#DC2626');
  const [secondaryColor, setSecondaryColor] = useState(restaurant.secondaryColor || '#F97316');
  const [qrPreview, setQrPreview] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    setName(restaurant.name);
    setLogoUrl(restaurant.logoUrl || '');
    setPrimaryColor(restaurant.primaryColor || '#DC2626');
    setSecondaryColor(restaurant.secondaryColor || '#F97316');
  }, [restaurant]);

  const directMenuUrl = `${window.location.origin}/?restaurant=${encodeURIComponent(
    restaurant.slug
  )}`;

  useEffect(() => {
    QRCode.toDataURL(directMenuUrl, {
      width: 320,
      margin: 2,
      color: { dark: '#09090B', light: '#FFFFFF' },
    })
      .then(setQrPreview)
      .catch(() => setQrPreview(''));
  }, [directMenuUrl]);

  const scopedItems = menuItems.filter((m) => m.restaurantId === restaurant.id);
  const availableCount = scopedItems.filter((m) => m.isAvailable).length;
  const avgFC =
    scopedItems.length > 0
      ? Math.round(scopedItems.reduce((s, i) => s + i.priceFC, 0) / scopedItems.length)
      : 0;

  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const optimized = await readAndOptimizeImageBlob(file, 400);
      if (isSupabaseConfigured() && navigator.onLine) {
        try {
          const publicUrl = await uploadAssetToSupabaseStorage(
            restaurant.id,
            'logos',
            `logo.${optimized.extension}`,
            optimized.blob,
            optimized.contentType
          );
          setLogoUrl(publicUrl);
          showToast(t.toast.uploadSuccess);
          return;
        } catch {
          // Fall through to local PC server or inline dataUrl
        }
      }
      const localUrl = await uploadAssetToLocalServer(
        restaurant.id,
        'logos',
        `logo.${optimized.extension}`,
        optimized.dataUrl
      );
      setLogoUrl(localUrl ?? optimized.dataUrl);
      showToast(t.toast.uploadLocalFallback);
    } catch {
      showToast(t.toast.validationError, 'error');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSaveBranding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast(t.toast.validationError, 'error');
      return;
    }
    onUpdateRestaurant({
      ...restaurant,
      name: name.trim(),
      logoUrl: logoUrl.trim(),
      primaryColor,
      secondaryColor,
    });
    showToast(t.toast.brandingSaved);
  };

  const handleDownloadQr = () => {
    if (!qrPreview) return;
    const link = document.createElement('a');
    link.href = qrPreview;
    link.download = `smartmenu-qr-${restaurant.slug}.png`;
    link.click();
    showToast(t.qr.downloadPng);
  };

  return (
    <div className="space-y-6">
      {/* Venue Summary Strip */}
      <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {restaurant.logoUrl ? (
            <img
              src={restaurant.logoUrl}
              alt={restaurant.name}
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

      {/* Sub-navigation Tabs */}
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
          onClick={() => setTab('branding')}
          className={`inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl text-sm font-medium cursor-pointer ${
            tab === 'branding'
              ? 'bg-red-600 text-white'
              : 'bg-[#141418] border border-zinc-800 text-zinc-300 hover:text-white'
          }`}
        >
          <Palette className="w-4 h-4" aria-hidden="true" />
          <span>{t.pro.tabBranding}</span>
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
        />
      )}

      {tab === 'branding' && (
        <form
          onSubmit={handleSaveBranding}
          className="rounded-2xl bg-[#141418] border border-zinc-800 p-6 space-y-6 max-w-2xl"
        >
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              {t.pro.restaurantName}
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-zinc-900 border border-zinc-700 text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">
              {t.pro.logoLabel}
            </label>
            <div className="flex flex-wrap items-center gap-4">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={name}
                  className="w-16 h-16 rounded-xl object-cover border border-zinc-700"
                />
              ) : (
                <div
                  style={{ backgroundColor: primaryColor }}
                  className="w-16 h-16 rounded-xl flex items-center justify-center font-display text-2xl font-bold text-white"
                >
                  {name.charAt(0)}
                </div>
              )}

              <label className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-white cursor-pointer">
                <ImagePlus className="w-4 h-4 text-orange-400" aria-hidden="true" />
                <span>{uploadingLogo ? t.pro.uploadingAsset : t.pro.uploadLogo}</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingLogo}
                  onChange={handleLogoFile}
                  className="sr-only"
                />
              </label>

              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl('')}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-red-300 hover:text-red-200 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t.pro.removeLogo}</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2">
                {t.pro.primaryColorLabel}
              </label>
              <div className="flex items-center gap-2.5 flex-wrap">
                {COLOR_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setPrimaryColor(hex)}
                    style={{ backgroundColor: hex }}
                    aria-label={hex}
                    className={`w-8 h-8 rounded-lg border-2 cursor-pointer ${
                      primaryColor.toUpperCase() === hex
                        ? 'border-white scale-110'
                        : 'border-transparent'
                    }`}
                  />
                ))}
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-9 h-9 rounded bg-transparent cursor-pointer"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2">
                {t.pro.secondaryColorLabel}
              </label>
              <div className="flex items-center gap-2.5 flex-wrap">
                {['#F97316', '#F59E0B', '#EC4899', '#10B981', '#38BDF8', '#FAFAFA'].map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setSecondaryColor(hex)}
                    style={{ backgroundColor: hex }}
                    aria-label={hex}
                    className={`w-8 h-8 rounded-lg border-2 cursor-pointer ${
                      secondaryColor.toUpperCase() === hex
                        ? 'border-white scale-110'
                        : 'border-transparent'
                    }`}
                  />
                ))}
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="w-9 h-9 rounded bg-transparent cursor-pointer"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="min-h-[44px] px-6 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-semibold text-white cursor-pointer"
          >
            {t.pro.saveBranding}
          </button>
        </form>
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
            <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-3.5 py-2.5 font-mono text-xs text-zinc-300 break-all">
              {directMenuUrl}
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
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
