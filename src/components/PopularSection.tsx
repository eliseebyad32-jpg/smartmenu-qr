import React from 'react';
import { Flame, Plus } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { Category, MenuItem, Restaurant } from '../types/menu';
import { CulinaryImage, warmImageCache } from './CulinaryImage';

interface PopularSectionProps {
  restaurant: Restaurant;
  items: MenuItem[];
  categories: Category[];
  onSelectDish: (dish: MenuItem) => void;
}

export const PopularSection: React.FC<PopularSectionProps> = ({
  restaurant,
  items,
  categories,
  onSelectDish,
}) => {
  const { t, pick, formatFC } = useLanguage();
  const { addToCart } = useCart();
  const { showToast } = useToast();

  const popular = items.filter((item) => item.isPopular && item.isAvailable).slice(0, 6);
  if (popular.length === 0) return null;

  const primary = restaurant.primaryColor || '#DC2626';
  const secondary = restaurant.secondaryColor || '#F97316';

  const getCategoryName = (id: MenuItem['categoryId']) => {
    const found = categories.find((c) => c.id === id);
    return found ? pick(found.name) : id;
  };

  return (
    <section id="popular" className="py-14 sm:py-18 border-b border-zinc-800/70 bg-[#09090B] cv-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-8">
          <p style={{ color: primary }} className="text-xs sm:text-sm font-semibold tracking-wide">
            {t.popular.eyebrow}
          </p>
          <h2
            style={{ textWrap: 'balance' }}
            className="mt-1 font-display text-3xl sm:text-4xl font-bold text-white tracking-tight"
          >
            {t.popular.title}
          </h2>
          <p className="mt-2 text-sm sm:text-base text-zinc-400 leading-relaxed">
            {t.popular.subtitle}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {popular.map((dish) => (
            <div
              key={dish.id}
              onClick={() => onSelectDish(dish)}
              onMouseEnter={() => warmImageCache(dish.image, 'medium')}
              onFocus={() => warmImageCache(dish.image, 'medium')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectDish(dish);
                }
              }}
              className="group text-left flex items-stretch gap-3.5 rounded-2xl bg-[#141418] border border-zinc-800/90 hover:border-red-500/50 p-3 transition-transform duration-150 hover:-translate-y-0.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-orange-500"
            >
              <div className="w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-zinc-900 self-center">
                <CulinaryImage
                  src={dish.image}
                  alt={pick(dish.name)}
                  variant="thumb"
                  width={96}
                  height={96}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
                />
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 truncate">
                    <span>{getCategoryName(dish.categoryId)}</span>
                    {dish.spiceLevel && dish.spiceLevel > 0 ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-0.5 text-orange-400">
                          <Flame className="w-3 h-3" aria-hidden="true" />
                          <span>{dish.spiceLevel}/3</span>
                        </span>
                      </>
                    ) : null}
                  </div>
                  <h3 className="mt-0.5 text-sm sm:text-base font-semibold text-white group-hover:text-orange-400 transition-colors truncate">
                    {pick(dish.name)}
                  </h3>
                  <p className="mt-1 text-xs text-zinc-400 line-clamp-2 leading-snug">
                    {pick(dish.description)}
                  </p>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span
                    style={{ color: secondary }}
                    className="font-mono text-sm font-bold tabular-nums"
                  >
                    {formatFC(dish.priceFC)}
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addToCart(restaurant.id, dish, 1);
                      showToast(`${t.toast.addedToCart} ${pick(dish.name)}`);
                    }}
                    style={{ backgroundColor: primary }}
                    aria-label={`${t.menu.addToCart} ${pick(dish.name)}`}
                    className="min-h-[34px] px-2.5 rounded-lg inline-flex items-center gap-1 text-xs font-semibold text-white hover:brightness-110 transition cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t.menu.addShort}</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
