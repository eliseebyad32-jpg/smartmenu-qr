import React, { useEffect, useState } from 'react';
import { Ban, CheckCircle2, Clock, Flame, Minus, Plus, ShoppingBag, X } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { Category, MenuItem, Restaurant } from '../types/menu';
import { CulinaryImage } from './CulinaryImage';

interface DishDetailModalProps {
  dish: MenuItem | null;
  restaurant: Restaurant;
  categories: Category[];
  onClose: () => void;
}

export const DishDetailModal: React.FC<DishDetailModalProps> = ({
  dish,
  restaurant,
  categories,
  onClose,
}) => {
  const { t, pick, formatFC } = useLanguage();
  const { addToCart } = useCart();
  const { showToast } = useToast();
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  useEffect(() => {
    setQuantity(1);
    setNote('');
  }, [dish?.id]);

  useEffect(() => {
    if (!dish) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [dish, onClose]);

  if (!dish) return null;

  const category = categories.find((c) => c.id === dish.categoryId);
  const spiceLabel =
    dish.spiceLevel === 3
      ? t.menu.spiceHot
      : dish.spiceLevel === 2
      ? t.menu.spiceMedium
      : dish.spiceLevel === 1
      ? t.menu.spiceMild
      : t.menu.spiceNone;

  const handleAdd = () => {
    if (!dish.isAvailable) return;
    addToCart(restaurant.id, dish, quantity, note);
    showToast(`${t.toast.addedToCart} ${quantity}x ${pick(dish.name)}`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dish-detail-title"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl bg-[#141418] border border-zinc-800 overflow-hidden shadow-2xl max-h-[90vh] flex flex-col animate-modal-in"
      >
        <div className="relative aspect-[16/10] w-full bg-zinc-900 shrink-0">
          <CulinaryImage
            src={dish.image}
            alt={pick(dish.name)}
            variant="medium"
            priority
            className="w-full h-full object-cover"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t.menu.close}
            className="absolute top-3 right-3 z-20 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-black transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
              <span>{category ? pick(category.name) : dish.categoryId}</span>
              <span aria-hidden="true">·</span>
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  dish.isAvailable ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {dish.isAvailable ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t.menu.available}</span>
                  </>
                ) : (
                  <>
                    <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t.menu.unavailable}</span>
                  </>
                )}
              </span>
            </div>

            <h3
              id="dish-detail-title"
              className="mt-2 font-display text-3xl font-bold text-white tracking-tight"
            >
              {pick(dish.name)}
            </h3>

            <p className="mt-2.5 text-sm sm:text-base text-zinc-300 leading-relaxed">
              {pick(dish.description)}
            </p>
          </div>

          <div className="pt-4 border-t border-zinc-800/80">
            <p className="text-xs font-semibold text-zinc-400 tracking-wide">
              {t.menu.ingredientsLabel}
            </p>
            <p className="mt-1.5 text-sm text-zinc-300 leading-relaxed">
              {pick(dish.ingredients)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-1 text-xs sm:text-sm text-zinc-300">
            {dish.prepMinutes ? (
              <div className="inline-flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-orange-400" aria-hidden="true" />
                <span className="tabular-nums">
                  {t.menu.prepTime} {dish.prepMinutes} {t.menu.minutes}
                </span>
              </div>
            ) : null}

            <div className="inline-flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-red-500" aria-hidden="true" />
              <span>{spiceLabel}</span>
            </div>
          </div>

          {dish.isAvailable && (
            <div className="pt-2">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t.menu.itemNotePlaceholder}
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
              />
            </div>
          )}

          <div className="pt-4 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs text-zinc-400">{t.menu.priceLabel}</p>
              <p
                style={{ color: restaurant.secondaryColor || '#F97316' }}
                className="font-mono text-2xl font-bold tabular-nums"
              >
                {formatFC(dish.priceFC * quantity)}
              </p>
            </div>

            {dish.isAvailable ? (
              <div className="flex items-center gap-2.5">
                <div className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    aria-label="Diminuer la quantité"
                    className="min-h-[44px] min-w-[40px] flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="px-2.5 font-mono text-sm font-semibold text-white tabular-nums">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => q + 1)}
                    aria-label="Augmenter la quantité"
                    className="min-h-[44px] min-w-[40px] flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleAdd}
                  style={{ backgroundColor: restaurant.primaryColor || '#DC2626' }}
                  className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-lg text-sm font-semibold text-white hover:brightness-110 transition cursor-pointer"
                >
                  <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                  <span>{t.menu.addToCart}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-6 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold text-white transition-colors cursor-pointer"
              >
                {t.menu.close}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
