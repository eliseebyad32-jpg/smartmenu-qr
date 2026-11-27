import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, CheckCircle2, Flame, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { Category, CategoryId, MenuItem, Restaurant } from '../types/menu';
import { CulinaryImage, warmImageCache } from './CulinaryImage';

const INITIAL_VISIBLE_DISHES = 16;
const DISH_BATCH_INCREMENT = 16;

interface MenuCatalogProps {
  restaurant: Restaurant;
  items: MenuItem[];
  categories: Category[];
  onSelectDish: (dish: MenuItem) => void;
}

export const MenuCatalog: React.FC<MenuCatalogProps> = ({
  restaurant,
  items,
  categories,
  onSelectDish,
}) => {
  const { t, pick, formatFC } = useLanguage();
  const { addToCart } = useCart();
  const { showToast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState<'all' | CategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_DISHES);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const primary = restaurant.primaryColor || '#DC2626';
  const secondary = restaurant.secondaryColor || '#F97316';

  const sortedCategories = useMemo(
    () =>
      [...categories]
        .filter((c) => !c.restaurantId || c.restaurantId === restaurant.id)
        .sort((a, b) => a.order - b.order),
    [categories, restaurant.id]
  );

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = { all: items.length };
    for (const item of items) {
      map[item.categoryId] = (map[item.categoryId] || 0) + 1;
    }
    return map;
  }, [items]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (selectedCategory !== 'all' && item.categoryId !== selectedCategory) return false;
      if (availableOnly && !item.isAvailable) return false;
      if (!query) return true;
      return (
        item.name.fr.toLowerCase().includes(query) ||
        item.name.en.toLowerCase().includes(query) ||
        item.description.fr.toLowerCase().includes(query) ||
        item.description.en.toLowerCase().includes(query) ||
        item.ingredients.fr.toLowerCase().includes(query) ||
        item.ingredients.en.toLowerCase().includes(query)
      );
    });
  }, [items, selectedCategory, availableOnly, searchQuery]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_DISHES);
  }, [restaurant.id, selectedCategory, availableOnly, searchQuery]);

  useEffect(() => {
    if (visibleCount >= filteredItems.length) return;
    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisibleCount(filteredItems.length);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((prev) => Math.min(filteredItems.length, prev + DISH_BATCH_INCREMENT));
        }
      },
      { rootMargin: '320px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visibleCount, filteredItems.length]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount]
  );

  const activeCategoryObj =
    selectedCategory === 'all'
      ? null
      : sortedCategories.find((c) => c.id === selectedCategory) ?? null;

  const getCategoryName = (id: CategoryId) => {
    const found = sortedCategories.find((c) => c.id === id);
    return found ? pick(found.name) : id;
  };

  const handleQuickAdd = (e: React.MouseEvent, dish: MenuItem) => {
    e.stopPropagation();
    if (!dish.isAvailable) return;
    addToCart(restaurant.id, dish, 1);
    showToast(`${t.toast.addedToCart} ${pick(dish.name)}`);
  };

  return (
    <section id="menu" className="py-12 sm:py-20 border-b border-zinc-800/70 bg-[#0B0B0E]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div className="max-w-2xl">
            <p style={{ color: secondary }} className="text-xs sm:text-sm font-semibold tracking-wide">
              {t.menu.eyebrow}
            </p>
            <h2
              style={{ textWrap: 'balance' }}
              className="mt-1 font-display text-3xl sm:text-5xl font-bold text-white tracking-tight"
            >
              {t.menu.title}
            </h2>
            <p className="mt-2 text-sm sm:text-base text-zinc-400 leading-relaxed">
              {t.menu.subtitle}
            </p>
          </div>

          <p className="text-sm text-zinc-400 tabular-nums shrink-0">
            {filteredItems.length}{' '}
            {filteredItems.length === 1 ? t.menu.itemCountSingle : t.menu.itemsCount}
          </p>
        </div>

        {/* Search & Availability Filter */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-5">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.menu.searchPlaceholder}
              aria-label={t.menu.searchPlaceholder}
              className="w-full min-h-[44px] pl-10 pr-10 rounded-xl bg-[#141418] border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={t.menu.resetFilters}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setAvailableOnly((prev) => !prev)}
            aria-pressed={availableOnly}
            className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              availableOnly
                ? 'bg-red-600/15 border-red-500 text-red-300'
                : 'bg-[#141418] border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
            <span>{t.menu.availableOnly}</span>
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div
          role="tablist"
          aria-label={t.pro.category}
          className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 mb-6"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === 'all'}
            onClick={() => setSelectedCategory('all')}
            style={selectedCategory === 'all' ? { backgroundColor: primary } : undefined}
            className={`min-h-[42px] px-3.5 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedCategory === 'all'
                ? 'text-white shadow-sm'
                : 'bg-[#141418] border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700'
            }`}
          >
            {t.menu.allCategories} ({categoryCounts.all ?? 0})
          </button>

          {sortedCategories.map((cat) => {
            const count = categoryCounts[cat.id] ?? 0;
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setSelectedCategory(cat.id)}
                style={isActive ? { backgroundColor: primary } : undefined}
                className={`min-h-[42px] px-3.5 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'text-white shadow-sm'
                    : 'bg-[#141418] border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700'
                }`}
              >
                {pick(cat.name)} ({count})
              </button>
            );
          })}
        </div>

        {activeCategoryObj && (
          <div className="mb-6 pb-3 border-b border-zinc-800/80">
            <h3 className="font-display text-2xl font-bold text-white">
              {pick(activeCategoryObj.name)}
            </h3>
            {pick(activeCategoryObj.description) && (
              <p className="text-sm text-zinc-400 mt-0.5">{pick(activeCategoryObj.description)}</p>
            )}
          </div>
        )}

        {/* Horizontal Compact Product Cards */}
        {filteredItems.length === 0 ? (
          <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-10 text-center max-w-lg mx-auto my-6">
            <h3 className="text-xl font-bold text-white">{t.menu.noResultsTitle}</h3>
            <p className="mt-2 text-sm text-zinc-400">{t.menu.noResultsBody}</p>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                setSearchQuery('');
                setAvailableOnly(false);
              }}
              style={{ backgroundColor: primary }}
              className="mt-5 inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg text-sm font-semibold text-white hover:brightness-110 transition cursor-pointer"
            >
              {t.menu.resetFilters}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 sm:gap-4">
            {visibleItems.map((dish) => (
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
                className={`group text-left flex items-stretch gap-3.5 sm:gap-4 rounded-2xl bg-[#141418] border p-3 sm:p-3.5 transition-transform duration-150 hover:-translate-y-0.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-orange-500 ${
                  dish.isAvailable
                    ? 'border-zinc-800/90 hover:border-orange-500/50'
                    : 'border-zinc-800/60 opacity-75 hover:opacity-95'
                }`}
              >
                {/* Left Thumbnail (Compact Square / Slight Rect with Fixed Dimensions) */}
                <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-xl overflow-hidden bg-zinc-900 self-center">
                  <CulinaryImage
                    src={dish.image}
                    alt={pick(dish.name)}
                    variant="thumb"
                    width={112}
                    height={112}
                    className={`w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.04] ${
                      dish.isAvailable ? '' : 'grayscale-[55%]'
                    }`}
                  />
                </div>

                {/* Right Text & Action Column (Majority of Space) */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm sm:text-base font-semibold text-white group-hover:text-orange-400 transition-colors leading-snug line-clamp-1">
                        {pick(dish.name)}
                      </h3>

                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap shrink-0 mt-0.5 ${
                          dish.isAvailable ? 'text-emerald-400' : 'text-red-300'
                        }`}
                      >
                        {dish.isAvailable ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                            <span className="hidden sm:inline">{t.menu.available}</span>
                          </>
                        ) : (
                          <>
                            <Ban className="w-3 h-3 shrink-0 text-red-400" aria-hidden="true" />
                            <span>{t.menu.unavailable}</span>
                          </>
                        )}
                      </span>
                    </div>

                    <p className="mt-1 text-xs sm:text-sm text-zinc-400 line-clamp-2 leading-snug">
                      {pick(dish.description)}
                    </p>

                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className="truncate">{getCategoryName(dish.categoryId)}</span>
                      {dish.prepMinutes ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums shrink-0">
                            {dish.prepMinutes} {t.menu.minutes}
                          </span>
                        </>
                      ) : null}
                      {dish.spiceLevel && dish.spiceLevel > 0 ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-0.5 text-orange-400 shrink-0">
                            <Flame className="w-3 h-3" aria-hidden="true" />
                            <span>{dish.spiceLevel}/3</span>
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Bottom Price & Add Button Row */}
                  <div className="mt-2.5 pt-2 border-t border-zinc-800/70 flex items-center justify-between gap-2">
                    <span
                      style={{ color: secondary }}
                      className="font-mono text-sm sm:text-base font-bold tabular-nums"
                    >
                      {formatFC(dish.priceFC)}
                    </span>

                    {dish.isAvailable ? (
                      <button
                        type="button"
                        onClick={(e) => handleQuickAdd(e, dish)}
                        aria-label={`${t.menu.addToCart} ${pick(dish.name)}`}
                        style={{ backgroundColor: primary }}
                        className="min-h-[36px] sm:min-h-[38px] px-3 sm:px-3.5 rounded-lg inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-white hover:brightness-110 transition cursor-pointer shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t.menu.addShort}</span>
                      </button>
                    ) : (
                      <span className="text-[11px] font-medium text-zinc-500">
                        {t.menu.unavailable}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {visibleCount < filteredItems.length && (
              <div ref={loadMoreRef} className="lg:col-span-2 py-3 flex justify-center">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleCount((prev) =>
                      Math.min(filteredItems.length, prev + DISH_BATCH_INCREMENT)
                    )
                  }
                  className="min-h-[40px] px-4 rounded-xl bg-[#141418] border border-zinc-800 text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
                >
                  +{filteredItems.length - visibleCount}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
