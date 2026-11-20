import React from 'react';
import { Clock, MapPin, Phone, QrCode, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { SyncStatus } from '../services/syncService';
import { Restaurant } from '../types/menu';
import { PWAInstallButton } from './PWAInstallButton';

interface LocationSectionProps {
  restaurant: Restaurant;
  syncStatus: SyncStatus;
  onSyncNow: () => void;
  onOpenQr: () => void;
}

export const LocationSection: React.FC<LocationSectionProps> = ({
  restaurant,
  syncStatus,
  onSyncNow,
  onOpenQr,
}) => {
  const { t, pick } = useLanguage();

  return (
    <section id="location" className="py-16 sm:py-20 bg-[#09090B] border-b border-zinc-800/70 cv-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Column: Lubumbashi Demo Location */}
          <div className="lg:col-span-7 rounded-2xl bg-[#141418] border border-zinc-800 p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <p className="text-xs sm:text-sm font-semibold text-orange-400 tracking-wide">
                {t.location.eyebrow}
              </p>
              <h2
                style={{ textWrap: 'balance' }}
                className="mt-1.5 font-display text-3xl sm:text-4xl font-bold text-white tracking-tight"
              >
                {restaurant.name}
              </h2>
              <p className="mt-2.5 text-sm sm:text-base text-zinc-400 leading-relaxed">
                {t.location.subtitle}
              </p>

              <div className="mt-8 space-y-5">
                <div className="flex items-start gap-3.5">
                  <MapPin className="w-5 h-5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="text-xs font-medium text-zinc-400">{t.location.addressLabel}</p>
                    <p className="mt-0.5 text-sm sm:text-base font-medium text-zinc-100">
                      {pick(restaurant.address)}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5">
                  <Clock className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="text-xs font-medium text-zinc-400">{t.location.hoursLabel}</p>
                    <p className="mt-0.5 text-sm sm:text-base font-medium text-zinc-100">
                      {pick(restaurant.hours)}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3.5">
                  <Phone className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="text-xs font-medium text-zinc-400">{t.location.phoneLabel}</p>
                    <p className="mt-0.5 font-mono text-sm sm:text-base text-zinc-100 tabular-nums">
                      {restaurant.phone}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-zinc-800/80 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onOpenQr}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-semibold text-white transition-colors cursor-pointer"
              >
                <QrCode className="w-4 h-4" aria-hidden="true" />
                <span>{t.hero.ctaQr}</span>
              </button>
              <PWAInstallButton />
            </div>
          </div>

          {/* Right Column: Online + Offline PWA & Sync Status Card */}
          <div className="lg:col-span-5 rounded-2xl bg-[#141418] border border-zinc-800 p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="w-11 h-11 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center">
                  {syncStatus === 'offline' ? (
                    <WifiOff className="w-5 h-5 text-orange-400" aria-hidden="true" />
                  ) : syncStatus === 'syncing' ? (
                    <RefreshCw className="w-5 h-5 text-orange-400 animate-spin" aria-hidden="true" />
                  ) : (
                    <Wifi className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                  )}
                </div>

                <button
                  type="button"
                  onClick={onSyncNow}
                  className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
                  <span>{t.sync.syncNow}</span>
                </button>
              </div>

              <h3 className="mt-5 font-display text-2xl sm:text-3xl font-bold text-white">
                {t.location.offlineTitle}
              </h3>

              <p className="mt-2 text-xs font-medium text-zinc-300">
                {syncStatus === 'offline'
                  ? t.sync.statusOffline
                  : syncStatus === 'syncing'
                  ? t.sync.statusSyncing
                  : syncStatus === 'error'
                  ? t.sync.statusError
                  : t.sync.statusOnline}
              </p>

              <p className="mt-2.5 text-sm sm:text-base text-zinc-300 leading-relaxed">
                {t.location.offlineBody}
              </p>
            </div>

            <div className="mt-8 pt-6 border-t border-zinc-800/80 text-xs sm:text-sm text-zinc-400 leading-relaxed">
              <p className="font-semibold text-zinc-200">{t.footer.disclaimerTitle}</p>
              <p className="mt-1">{t.footer.disclaimerBody}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
