import React from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { Category, MenuItem, Restaurant } from '../types/menu';
import { CulinaryImage, warmImageCache } from './CulinaryImage';

interface SpecialtiesSectionProps {
  restaurant: Restaurant;
  items: MenuItem[];
  categories: Category[];
  onSelectDish: (dish: MenuItem) => void;
}

export const SpecialtiesSection: React.FC<SpecialtiesSectionProps> = ({
  restaurant,
  items,
  categories,
  onSelectDish,
}) => {
  const { t, pick, formatFC } = useLanguage();
  const { addToCart } = useCart();
  const { showToast } = useToast();

  const specialties = items.filter((item) => item.isSpecialty && item.isAvailable).slice(0, 4);
  if (specialties.length === 0) return null;

  const primary = restaurant.primaryColor || '#DC2626';
  const secondary = restaurant.secondaryColor || '#F97316';

  const getCategoryName = (id: MenuItem['categoryId']) => {
    const found = categories.find((c) => c.id === id);
    return found ? pick(found.name) : id;
  };

  return (
    <section id="specialties" className="py-14 sm:py-18 border-b border-zinc-800/70 bg-[#0C0C0F]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-8">
          <p style={{ color: secondary }} className="text-xs sm:text-sm font-semibold tracking-wide">
            {t.specialties.eyebrow}
          </p>
          <h2
            style={{ textWrap: 'balance' }}
            className="mt-1 font-display text-3xl sm:text-4xl font-bold text-white tracking-tight"
          >
            {t.specialties.title}
          </h2>
          <p className="mt-2 text-sm sm:text-base text-zinc-400 leading-relaxed">
            {t.specialties.subtitle}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {specialties.map((dish) => (
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
              className="group text-left flex items-stretch gap-4 rounded-2xl bg-[#141418] border border-zinc-800/90 hover:border-orange-500/50 p-3.5 transition-transform duration-150 hover:-translate-y-0.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-orange-500"
            >
              <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-xl overflow-hidden bg-zinc-900 self-center">
                <CulinaryImage
                  src={dish.image}
                  alt={pick(dish.name)}
                  variant="thumb"
                  width={112}
                  height={112}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
                />
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                    <span className="truncate">{getCategoryName(dish.categoryId)}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-zinc-500 group-hover:text-white" aria-hidden="true" />
                  </div>
                  <h3 className="mt-1 text-base sm:text-lg font-semibold text-white group-hover:text-orange-400 transition-colors leading-snug truncate">
                    {pick(dish.name)}
                  </h3>
                  <p className="mt-1 text-xs sm:text-sm text-zinc-400 line-clamp-2 leading-snug">
                    {pick(dish.description)}
                  </p>
                </div>

                <div className="mt-2.5 pt-2 border-t border-zinc-800/70 flex items-center justify-between gap-2">
                  <span
                    style={{ color: secondary }}
                    className="font-mono text-sm sm:text-base font-bold tabular-nums"
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
                    className="min-h-[36px] px-3 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold text-white hover:brightness-110 transition cursor-pointer shrink-0"
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
