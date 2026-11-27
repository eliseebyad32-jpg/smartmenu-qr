import React from 'react';
import { ArrowDown, QrCode } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { Restaurant } from '../types/menu';
import { CulinaryImage } from './CulinaryImage';

interface HeroSectionProps {
  restaurant: Restaurant;
  dishCount: number;
  categoryCount: number;
  onExploreMenu: () => void;
  onOpenQr: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  restaurant,
  dishCount,
  categoryCount,
  onExploreMenu,
  onOpenQr,
}) => {
  const { t, pick, language } = useLanguage();
  const primary = restaurant.primaryColor || '#DC2626';
  const secondary = restaurant.secondaryColor || '#F97316';

  return (
    <section
      id="top"
      className="relative overflow-hidden border-b border-zinc-800/80 bg-[#09090B]"
    >
      <div className="relative min-h-[540px] lg:min-h-[640px] flex items-center">
        <div className="absolute inset-0">
          <CulinaryImage
            src={restaurant.heroImage}
            alt={restaurant.name}
            variant="hero"
            priority
            className="w-full h-full object-cover object-center"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-r from-[#09090B]/90 via-[#09090B]/50 to-[#09090B]/15 pointer-events-none"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-[#09090B]/75 via-transparent to-[#09090B]/20 pointer-events-none"
          />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="max-w-2xl animate-hero-in">
            {restaurant.logoUrl && (
              <div className="mb-5">
                <img
                  src={restaurant.logoUrl}
                  alt={restaurant.name}
                  width={64}
                  height={64}
                  decoding="async"
                  fetchPriority="high"
                  referrerPolicy="no-referrer"
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
                  className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl object-cover border border-zinc-700 bg-zinc-900 shadow-lg"
                />
              </div>
            )}

            <p
              style={{ color: secondary }}
              className="text-xs sm:text-sm font-medium tracking-wide mb-3"
            >
              {pick(restaurant.demoDisclaimer)}
            </p>

            <h1
              style={{ textWrap: 'balance' }}
              className="font-display text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[0.98]"
            >
              {restaurant.name}
            </h1>

            <p
              style={{ textWrap: 'balance' }}
              className="mt-4 text-lg sm:text-xl font-medium text-zinc-100 leading-snug"
            >
              {pick(restaurant.tagline)}
            </p>

            <p className="mt-4 text-sm sm:text-base text-zinc-300 leading-relaxed max-w-xl">
              {pick(restaurant.description)}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <button
                type="button"
                onClick={onExploreMenu}
                style={{
                  backgroundImage: `linear-gradient(to right, ${primary}, ${secondary})`,
                }}
                className="inline-flex items-center justify-center gap-2.5 min-h-[48px] px-7 py-3 rounded-lg text-sm sm:text-base font-semibold text-white shadow-lg transition-transform active:scale-[0.98] hover:brightness-110 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-orange-400"
              >
                <span>{t.hero.ctaMenu}</span>
                <ArrowDown className="w-4 h-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={onOpenQr}
                className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700 text-sm sm:text-base font-medium text-zinc-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-orange-400"
              >
                <QrCode className="w-4 h-4" style={{ color: secondary }} aria-hidden="true" />
                <span>{t.hero.ctaQr}</span>
              </button>
            </div>

            <div className="mt-8 pt-6 border-t border-zinc-800/80 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm text-zinc-400 tabular-nums">
              <span>
                {categoryCount} {language === 'fr' ? 'catégories' : 'categories'}
              </span>
              <span aria-hidden="true" className="text-zinc-600">
                ·
              </span>
              <span>
                {dishCount} {language === 'fr' ? 'produits' : 'dishes'}
              </span>
              <span aria-hidden="true" className="text-zinc-600">
                ·
              </span>
              <span>{t.hero.statOffline}</span>
              <span aria-hidden="true" className="text-zinc-600">
                ·
              </span>
              <span>
                {restaurant.city}, {pick(restaurant.country)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
